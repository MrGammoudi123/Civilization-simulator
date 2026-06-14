import { RNG } from './rng';
import { CONFLICT, SIM } from './config';
import { SpatialGrid } from './spatialGrid';
import { adjust, decayRelationships, ensureRel, sentiment } from './relationships';
import { decayMemory, remember } from './memory';
import { emitSpeech } from './communication';
import { resolveFight } from './conflict';
import type { Agent, EnergySource, Tribe, WorldState } from './types';

/** An agent re-evaluates its goal every N ticks (staggered by id to spread CPU load). */
const DECISION_INTERVAL = 15;

const neighborScratch: number[] = [];

/**
 * Per-tick agent update: aging/death, periodic decision-making, acting on the current
 * goal, movement integration, and metabolism. The decision system is priority-based and
 * reads the agent's relationships + memory, so behavior reflects history.
 */
export function updateAgent(
  a: Agent,
  world: WorldState,
  grid: SpatialGrid,
  byId: Map<number, Agent>,
  tribesById: Map<number, Tribe>,
  rng: RNG,
): void {
  a.age += 1;
  if (a.reproduceCooldown > 0) a.reproduceCooldown -= 1;

  if (a.age > a.lifespan) {
    killAgent(a, world, grid);
    return;
  }

  // Periodic re-decision + slow forgetting.
  if ((world.cycle + a.id) % DECISION_INTERVAL === 0) {
    decide(a, world, grid, tribesById, rng);
    decayRelationships(a, 0.004);
    decayMemory(a, 0.002);
  }

  act(a, world, byId, tribesById, rng);

  integrate(a, world);
  a.energy -= SIM.metabolism + Math.hypot(a.vx, a.vy) * SIM.moveCost;
  if (a.energy <= 0) {
    a.energy = 0;
    killAgent(a, world, grid);
  }
}

// --------------------------------------------------------------------- deciding

function decide(
  a: Agent,
  world: WorldState,
  grid: SpatialGrid,
  tribesById: Map<number, Tribe>,
  rng: RNG,
): void {
  const frac = a.energy / a.maxEnergy;
  const myTribe = a.tribeId !== null ? tribesById.get(a.tribeId) : undefined;
  const wasProtesting = a.state === 'protesting';
  const protestTarget = a.targetAgentId;

  grid.queryRadius(a.x, a.y, SIM.perceptionRadius, neighborScratch);

  let fearedId = -1;
  let fearedName: string | null = null;
  let fearedDist = Infinity;
  let hostileId = -1;
  let hostileName: string | null = null;
  let hostileEnergy = 0;
  let hostileDist = Infinity;
  let helpId = -1;
  let helpScore = -Infinity;
  let followId = -1;
  let followName: string | null = null;
  let followScore = -Infinity;
  let allyId = -1; // highest-sentiment neighbor (for friendship/bonding talk)
  let allyName: string | null = null;
  let bestSent = 0.3;
  let nearbyCount = 0;

  for (let i = 0; i < neighborScratch.length; i++) {
    const o = world.agents[neighborScratch[i]];
    if (o === a || !o.alive) continue;
    const d = Math.hypot(o.x - a.x, o.y - a.y);
    if (d > SIM.perceptionRadius) continue;
    nearbyCount += 1;

    const rel = a.relationships.get(o.id);
    const sent = rel ? sentiment(rel) : 0;
    const fear = rel ? rel.fear : 0;

    // Tribe relationship modifiers.
    const sameTribe = a.tribeId !== null && o.tribeId === a.tribeId;
    const enemyTribe =
      myTribe !== undefined && o.tribeId !== null && o.tribeId !== a.tribeId
        ? (myTribe.relations.get(o.tribeId)?.war ?? false)
        : false;

    // Threat: someone I fear, an aggressive stronger agent, or an enemy-tribe member.
    const threat =
      fear + (o.traits.aggression > 0.6 && o.energy > a.energy ? 0.3 : 0) + (enemyTribe ? 0.4 : 0);
    if (threat > 0.35 && d < fearedDist) {
      fearedDist = d;
      fearedId = o.id;
      fearedName = o.name;
    }

    // Hostility: a rival (rivalry/resentment) or an enemy-tribe member — a potential foe.
    const hostility = (rel ? rel.rivalry + rel.resentment : 0) + (enemyTribe ? 0.6 : 0);
    if (hostility > CONFLICT.hostileThreshold && d < hostileDist) {
      hostileDist = d;
      hostileId = o.id;
      hostileName = o.name;
      hostileEnergy = o.energy;
    }

    // Help candidate: needy and not disliked (kin preferred).
    const need = 1 - o.energy / o.maxEnergy;
    if (need > 0.5 && sent >= -0.1) {
      const score = need + sent * 0.5 - d / SIM.perceptionRadius + (sameTribe ? 0.3 : 0);
      if (score > helpScore) {
        helpScore = score;
        helpId = o.id;
      }
    }

    // Follow candidate: admired and "successful" (own tribe leader strongly preferred).
    if (sent > 0.3 || (myTribe !== undefined && o.id === myTribe.leaderId)) {
      const status = (o.energy / o.maxEnergy) * 0.5 + Math.min(1, o.age / 3000) * 0.5;
      const tribeBonus = (sameTribe ? 0.3 : 0) + (myTribe !== undefined && o.id === myTribe.leaderId ? 0.5 : 0);
      const score = sent + status - d / SIM.perceptionRadius + tribeBonus;
      if (score > followScore) {
        followScore = score;
        followId = o.id;
        followName = o.name;
      }
    }

    // Highest-sentiment ally for friendly talk.
    if (sent > bestSent) {
      bestSent = sent;
      allyId = o.id;
      allyName = o.name;
    }

    // Passive familiarity: nearby compatible agents slowly bond.
    if (d < 70) bond(a, o, world.cycle);

    // Opportunistic theft: predatory + hungry, next to a richer agent.
    if (
      d < SIM.harvestRadius + 6 &&
      frac < SIM.lowEnergyFrac &&
      a.traits.aggression * a.traits.greed > 0.28 &&
      o.energy > a.energy + 8
    ) {
      applySteal(a, o, world.cycle);
    }
  }

  // Hunger hysteresis (as in Stage 2): hungry below low, keep feeding until full.
  const hungry =
    a.state === 'searching_energy' ? frac < SIM.fullEnergyFrac : frac < SIM.lowEnergyFrac;
  const discovery = world.hiddenCouncil?.discoveryRisk ?? 0;

  // Priority: aggression > fear > protest > survival(role-tinted) > role vocation > altruism >
  // sociality > rest > wander. The role tier (Phase 5) is what diversifies a fed population
  // beyond searching_energy — builders/traders/guards/historians/healers/scouts/etc.
  if (
    hostileId >= 0 &&
    a.traits.aggression > CONFLICT.attackAggression &&
    a.energy > hostileEnergy * 0.9
  ) {
    a.state = 'attacking';
    a.targetAgentId = hostileId;
    a.targetEnergyId = null;
  } else if (fearedId >= 0 && a.traits.fear > 0.3) {
    a.state = 'fleeing';
    a.targetAgentId = fearedId;
    a.targetEnergyId = null;
  } else if (wasProtesting && frac > 0.2 && frac < 0.5) {
    a.state = 'protesting';
    a.targetAgentId = protestTarget;
    a.targetEnergyId = null;
  } else if (hungry) {
    // Survival, role-tinted: scouts/explorers/investigators range wider for energy; rootless
    // refugees move on; everyone else forages. Below ~0.3 energy, always plain foraging.
    if (frac > 0.32 && (a.role === 'scout' || a.role === 'explorer' || a.role === 'investigator')) {
      a.state = 'scouting';
    } else if (frac > 0.28 && a.role === 'refugee' && a.tribeId === null) {
      a.state = 'migrating';
    } else {
      a.state = 'searching_energy';
    }
    a.targetAgentId = null;
  } else if (assignRoleState(a, helpId, allyId, myTribe, discovery)) {
    // a.state + a.targetAgentId were set by assignRoleState
    a.targetEnergyId = null;
  } else if (frac > 0.75 && a.traits.empathy > 0.5 && helpId >= 0) {
    a.state = 'helping';
    a.targetAgentId = helpId;
    a.targetEnergyId = null;
  } else if (a.traits.socialNeed > 0.45 && followId >= 0) {
    a.state = 'following_leader';
    a.targetAgentId = followId;
    a.targetEnergyId = null;
  } else if (frac > SIM.fullEnergyFrac) {
    a.state = 'resting';
    a.targetAgentId = null;
  } else {
    a.state = 'wandering';
    a.targetAgentId = null;
  }

  // Maybe say something, using the neighbor context just computed.
  emitSpeech(
    a,
    world,
    {
      nearbyCount,
      rivalId: hostileId >= 0 ? hostileId : fearedId,
      rivalName: hostileId >= 0 ? hostileName : fearedName,
      allyId,
      allyName,
      leaderId: followId,
      leaderName: followName,
    },
    rng,
  );
}

/**
 * Phase 5 role tier: turn a fed agent's vocation into an active state. Returns true (and sets
 * a.state + a.targetAgentId) if the role claims a vocation this tick; false to fall through to
 * the generic social/rest/wander tail (gatherers and idle thieves).
 */
function assignRoleState(
  a: Agent,
  helpId: number,
  allyId: number,
  myTribe: Tribe | undefined,
  discovery: number,
): boolean {
  switch (a.role) {
    case 'builder':
      if (!myTribe) return false;
      a.state = 'building';
      a.targetAgentId = null;
      return true;
    case 'leader':
      if (!myTribe) return false;
      a.state = 'governing';
      a.targetAgentId = null;
      return true;
    case 'historian':
      if (!myTribe) return false;
      a.state = 'archiving_history';
      a.targetAgentId = null;
      return true;
    case 'guard':
      if (!myTribe) return false;
      a.state = 'guarding';
      a.targetAgentId = null;
      return true;
    case 'rebel':
      if (!myTribe) return false;
      a.state = 'organizing_protest';
      a.targetAgentId = myTribe.leaderId;
      return true;
    case 'trader':
      if (allyId < 0) return false;
      a.state = 'trading';
      a.targetAgentId = allyId;
      return true;
    case 'healer':
      if (helpId < 0) return false;
      a.state = 'healing';
      a.targetAgentId = helpId;
      return true;
    case 'priest':
      a.state = 'worshipping';
      a.targetAgentId = null;
      return true;
    case 'prophet':
      a.state = discovery > 0.4 ? 'debating' : 'worshipping';
      a.targetAgentId = null;
      return true;
    case 'farmer':
      a.state = 'farming';
      a.targetAgentId = null;
      return true;
    case 'scout':
    case 'explorer':
      a.state = 'scouting';
      a.targetAgentId = null;
      return true;
    case 'investigator':
      a.state = discovery > 0.35 ? 'investigating_reality' : 'scouting';
      a.targetAgentId = null;
      return true;
    case 'refugee':
      if (a.tribeId !== null) return false;
      a.state = 'migrating';
      a.targetAgentId = null;
      return true;
    default:
      return false; // gatherer, idle thief -> social / rest / wander
  }
}

// --------------------------------------------------------------------- acting

function act(
  a: Agent,
  world: WorldState,
  byId: Map<number, Agent>,
  tribesById: Map<number, Tribe>,
  rng: RNG,
): void {
  switch (a.state) {
    case 'fleeing': {
      const o = a.targetAgentId != null ? byId.get(a.targetAgentId) : undefined;
      if (o && o.alive) steerAway(a, o.x, o.y);
      else fallbackWander(a, rng);
      break;
    }
    case 'helping': {
      const o = a.targetAgentId != null ? byId.get(a.targetAgentId) : undefined;
      if (o && o.alive && o.energy < o.maxEnergy * 0.6) {
        steerToward(a, o.x, o.y);
        if (Math.hypot(o.x - a.x, o.y - a.y) < 18) {
          applyHelp(a, o, world.cycle);
          a.state = 'wandering';
          a.targetAgentId = null;
        }
      } else {
        fallbackWander(a, rng);
      }
      break;
    }
    case 'following_leader': {
      const o = a.targetAgentId != null ? byId.get(a.targetAgentId) : undefined;
      if (o && o.alive) {
        const d = Math.hypot(o.x - a.x, o.y - a.y);
        if (d > 45) steerToward(a, o.x, o.y);
        else {
          a.vx *= 0.9;
          a.vy *= 0.9;
        }
        if ((world.cycle + a.id) % 30 === 0) {
          const r = ensureRel(a, o.id, world.cycle);
          adjust(r, 'loyalty', 0.01);
          adjust(r, 'trust', 0.006);
        }
      } else {
        fallbackWander(a, rng);
      }
      break;
    }
    case 'attacking': {
      const o = a.targetAgentId != null ? byId.get(a.targetAgentId) : undefined;
      if (o && o.alive) {
        steerToward(a, o.x, o.y);
        if (Math.hypot(o.x - a.x, o.y - a.y) < CONFLICT.attackRange) {
          resolveFight(a, o, world, rng);
          if (!o.alive || a.energy < a.maxEnergy * 0.3) {
            a.state = 'wandering';
            a.targetAgentId = null;
          }
        }
      } else {
        fallbackWander(a, rng);
      }
      break;
    }
    case 'protesting': {
      const o = a.targetAgentId != null ? byId.get(a.targetAgentId) : undefined;
      if (o && o.alive) {
        const d = Math.hypot(o.x - a.x, o.y - a.y);
        if (d > 35) steerToward(a, o.x, o.y);
        else {
          a.vx *= 0.9;
          a.vy *= 0.9;
        }
      } else {
        fallbackWander(a, rng);
      }
      break;
    }
    case 'searching_energy': {
      const t = findNearestEnergy(a, world, SIM.perceptionRadius);
      a.targetEnergyId = t ? t.id : null;
      if (t) {
        steerToward(a, t.x, t.y);
        if (Math.hypot(t.x - a.x, t.y - a.y) <= t.radius + SIM.harvestRadius) {
          const take = Math.min(SIM.harvestRate, t.amount, a.maxEnergy - a.energy);
          t.amount -= take;
          a.energy += take;
          t.discovered = true;
          a.vx *= 0.6;
          a.vy *= 0.6;
          if (take > 0 && (world.cycle + a.id) % 40 === 0) {
            remember(a, 'found_energy', world.cycle, { x: t.x, y: t.y, strength: 0.4 });
          }
        }
      } else {
        wander(a, rng);
      }
      break;
    }
    case 'resting': {
      a.vx *= 0.92;
      a.vy *= 0.92;
      break;
    }
    // --- Phase 5 role-driven states ---
    case 'scouting':
    case 'investigating_reality':
    case 'migrating': {
      // range wide for energy (including undiscovered hidden sources); discover + feed
      const t = findNearestEnergy(a, world, SIM.perceptionRadius * 1.8);
      a.targetEnergyId = t ? t.id : null;
      if (t) {
        steerToward(a, t.x, t.y);
        if (Math.hypot(t.x - a.x, t.y - a.y) <= t.radius + SIM.harvestRadius) {
          const take = Math.min(SIM.harvestRate, t.amount, a.maxEnergy - a.energy);
          t.amount -= take;
          a.energy += take;
          t.discovered = true;
          a.vx *= 0.6;
          a.vy *= 0.6;
        }
      } else {
        wander(a, rng);
      }
      break;
    }
    case 'farming': {
      // tend the nearest source: stay close, harvest gently
      const t = findNearestEnergy(a, world, SIM.perceptionRadius);
      a.targetEnergyId = t ? t.id : null;
      if (t) {
        steerToward(a, t.x, t.y);
        if (Math.hypot(t.x - a.x, t.y - a.y) <= t.radius + SIM.harvestRadius) {
          const take = Math.min(SIM.harvestRate * 0.7, t.amount, a.maxEnergy - a.energy);
          t.amount -= take;
          a.energy += take;
          t.discovered = true;
          a.vx *= 0.7;
          a.vy *= 0.7;
        }
      } else {
        wander(a, rng);
      }
      break;
    }
    case 'worshipping': {
      const sacred = nearestSacred(a, world);
      if (sacred) {
        if (Math.hypot(sacred.x - a.x, sacred.y - a.y) > sacred.radius + 10) {
          steerToward(a, sacred.x, sacred.y);
        } else {
          a.vx *= 0.85;
          a.vy *= 0.85;
        }
      } else {
        settleNearTribe(a, tribesById, 24);
      }
      break;
    }
    case 'healing': {
      const o = a.targetAgentId != null ? byId.get(a.targetAgentId) : undefined;
      if (o && o.alive && o.energy < o.maxEnergy * 0.6) {
        steerToward(a, o.x, o.y);
        if (Math.hypot(o.x - a.x, o.y - a.y) < 18) {
          applyHelp(a, o, world.cycle);
          a.state = 'wandering';
          a.targetAgentId = null;
        }
      } else {
        fallbackWander(a, rng);
      }
      break;
    }
    case 'trading': {
      const o = a.targetAgentId != null ? byId.get(a.targetAgentId) : undefined;
      if (o && o.alive) {
        const d = Math.hypot(o.x - a.x, o.y - a.y);
        if (d > 22) steerToward(a, o.x, o.y);
        else {
          a.vx *= 0.9;
          a.vy *= 0.9;
          if ((world.cycle + a.id) % 30 === 0) applyTrade(a, o, world.cycle);
        }
      } else {
        fallbackWander(a, rng);
      }
      break;
    }
    case 'guarding': {
      settleNearTribe(a, tribesById, 40);
      break;
    }
    case 'building':
    case 'governing':
    case 'archiving_history':
    case 'organizing_protest':
    case 'debating':
    case 'repairing': {
      settleNearTribe(a, tribesById, 24);
      break;
    }
    default: {
      // wandering, reproducing (transient), and any not-yet-specialised states
      wander(a, rng);
    }
  }
}

/** Steer toward (and settle near) the agent's tribe heart — for settled civic vocations. */
function settleNearTribe(a: Agent, tribesById: Map<number, Tribe>, hover: number): void {
  const t = a.tribeId !== null ? tribesById.get(a.tribeId) : undefined;
  if (!t) {
    a.vx *= 0.9;
    a.vy *= 0.9;
    return;
  }
  if (Math.hypot(t.cx - a.x, t.cy - a.y) > hover) steerToward(a, t.cx, t.cy);
  else {
    a.vx *= 0.88;
    a.vy *= 0.88;
  }
}

function nearestSacred(a: Agent, world: WorldState): EnergySource | null {
  let best: EnergySource | null = null;
  let bestD = SIM.perceptionRadius * 2;
  for (const s of world.energySources) {
    if (s.kind !== 'sacred') continue;
    const d = Math.hypot(a.x - s.x, a.y - s.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** A peaceful exchange: the richer party shares a little with the poorer; both gain trust. */
function applyTrade(a: Agent, o: Agent, cycle: number): void {
  const richer = a.energy >= o.energy ? a : o;
  const poorer = richer === a ? o : a;
  const amount = Math.min((richer.energy - poorer.energy) * 0.1, 6, poorer.maxEnergy - poorer.energy);
  if (amount > 0) {
    richer.energy -= amount;
    poorer.energy += amount;
  }
  const r1 = ensureRel(a, o.id, cycle);
  adjust(r1, 'trust', 0.04);
  adjust(r1, 'friendship', 0.03);
  r1.interactions += 1;
  r1.lastCycle = cycle;
  const r2 = ensureRel(o, a.id, cycle);
  adjust(r2, 'trust', 0.04);
  adjust(r2, 'friendship', 0.03);
  r2.interactions += 1;
  r2.lastCycle = cycle;
  // Phase 11 — a cooperative memory (drives gratitude/trade messages + future partner trust)
  remember(a, 'traded_with', cycle, { otherId: o.id, strength: 0.4 });
  remember(o, 'traded_with', cycle, { otherId: a.id, strength: 0.4 });
}

// --------------------------------------------------------------- interactions

/** Transfer energy from a well-off altruist to a needy neighbor; build gratitude. */
export function applyHelp(giver: Agent, receiver: Agent, cycle: number): boolean {
  const amount = Math.min(giver.energy - giver.maxEnergy * 0.5, receiver.maxEnergy - receiver.energy, 14);
  if (amount <= 0) return false;
  giver.energy -= amount;
  receiver.energy += amount;

  const rr = ensureRel(receiver, giver.id, cycle);
  adjust(rr, 'trust', 0.2);
  adjust(rr, 'friendship', 0.18);
  adjust(rr, 'loyalty', 0.12);
  adjust(rr, 'fear', -0.1);
  adjust(rr, 'resentment', -0.1);
  rr.interactions += 1;
  rr.lastCycle = cycle;
  remember(receiver, 'helped_by', cycle, { otherId: giver.id, strength: 0.8 });

  const gr = ensureRel(giver, receiver.id, cycle);
  adjust(gr, 'friendship', 0.1);
  adjust(gr, 'trust', 0.06);
  gr.interactions += 1;
  gr.lastCycle = cycle;
  remember(giver, 'helped', cycle, { otherId: receiver.id, strength: 0.4 });
  return true;
}

/** Steal energy from a richer neighbor; the victim learns to fear and resent the thief. */
export function applySteal(thief: Agent, victim: Agent, cycle: number): boolean {
  const amount = Math.min(victim.energy * 0.25, thief.maxEnergy - thief.energy, 12);
  if (amount <= 0) return false;
  victim.energy -= amount;
  thief.energy += amount;
  thief.state = 'attacking';

  const vr = ensureRel(victim, thief.id, cycle);
  adjust(vr, 'fear', 0.25);
  adjust(vr, 'resentment', 0.3);
  adjust(vr, 'rivalry', 0.2);
  adjust(vr, 'trust', -0.3);
  adjust(vr, 'friendship', -0.2);
  vr.interactions += 1;
  vr.lastCycle = cycle;
  remember(victim, 'stolen_from', cycle, { otherId: thief.id, strength: 0.85 });

  const tr = ensureRel(thief, victim.id, cycle);
  adjust(tr, 'rivalry', 0.1);
  tr.interactions += 1;
  tr.lastCycle = cycle;
  return true;
}

/** Proximity bonding between compatible (empathic/social) agents. */
function bond(a: Agent, o: Agent, cycle: number): void {
  const compat = (a.traits.empathy + a.traits.socialNeed + o.traits.empathy) / 3;
  if (compat < 0.4) return;
  const r = ensureRel(a, o.id, cycle);
  adjust(r, 'friendship', 0.01 * compat);
  adjust(r, 'trust', 0.006 * compat);
  if (a.traits.socialNeed > 0.6 && o.traits.empathy > 0.5) adjust(r, 'attraction', 0.004);
  r.interactions += 1;
  r.lastCycle = cycle;
}

// --------------------------------------------------------------------- death

function killAgent(a: Agent, world: WorldState, grid: SpatialGrid): void {
  a.alive = false;
  a.state = 'dying';
  // Nearby agents witness the death and remember it (fuels fear/messages later).
  const witnesses: number[] = [];
  grid.queryRadius(a.x, a.y, 90, witnesses);
  for (let i = 0; i < witnesses.length; i++) {
    const w = world.agents[witnesses[i]];
    if (w === a || !w.alive) continue;
    if (Math.hypot(w.x - a.x, w.y - a.y) > 90) continue;
    remember(w, 'witnessed_death', world.cycle, { otherId: a.id, x: a.x, y: a.y, strength: 0.5 });
  }
}

// --------------------------------------------------------------- movement utils

function findNearestEnergy(a: Agent, world: WorldState, radius: number): EnergySource | null {
  let best: EnergySource | null = null;
  let bestD = radius;
  const sources = world.energySources;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s.amount < 1) continue;
    const d = Math.hypot(a.x - s.x, a.y - s.y);
    if (s.kind === 'hidden' && !s.discovered) {
      if (d > 60 * (0.5 + a.traits.curiosity)) continue;
    }
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function steerToward(a: Agent, tx: number, ty: number): void {
  const dx = tx - a.x;
  const dy = ty - a.y;
  const d = Math.hypot(dx, dy) || 1;
  a.vx += (dx / d) * SIM.accel;
  a.vy += (dy / d) * SIM.accel;
}

function steerAway(a: Agent, tx: number, ty: number): void {
  const dx = a.x - tx;
  const dy = a.y - ty;
  const d = Math.hypot(dx, dy) || 1;
  a.vx += (dx / d) * SIM.accel;
  a.vy += (dy / d) * SIM.accel;
}

function wander(a: Agent, rng: RNG): void {
  a.vx += (rng.next() - 0.5) * SIM.wanderJitter;
  a.vy += (rng.next() - 0.5) * SIM.wanderJitter;
  a.vx *= 0.96;
  a.vy *= 0.96;
  if (Math.hypot(a.vx, a.vy) < 0.05) {
    a.vx += (rng.next() - 0.5) * 0.4;
    a.vy += (rng.next() - 0.5) * 0.4;
  }
}

function fallbackWander(a: Agent, rng: RNG): void {
  a.state = 'wandering';
  a.targetAgentId = null;
  wander(a, rng);
}

function integrate(a: Agent, world: WorldState): void {
  const speed = Math.hypot(a.vx, a.vy);
  if (speed > SIM.maxSpeed) {
    const s = SIM.maxSpeed / speed;
    a.vx *= s;
    a.vy *= s;
  }
  a.x += a.vx;
  a.y += a.vy;
  if (a.x < 0) {
    a.x = 0;
    a.vx = -a.vx;
  } else if (a.x > world.params.width) {
    a.x = world.params.width;
    a.vx = -a.vx;
  }
  if (a.y < 0) {
    a.y = 0;
    a.vy = -a.vy;
  } else if (a.y > world.params.height) {
    a.y = world.params.height;
    a.vy = -a.vy;
  }
}
