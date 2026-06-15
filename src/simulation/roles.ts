import type { Agent, AgentRole, City, Tribe, WorldState } from './types';

/**
 * Agent roles (Phase 5). The original sim had no vocations, so a depleted world collapsed
 * into a uniform mass of `searching_energy`. Here every agent has a role derived from its
 * traits + situation (city membership, scarcity, Hidden Council suspicion, age), re-evaluated
 * periodically so it drifts as the world changes. Roles steer decisions and messages, so a
 * stable city grows builders, traders, guards, historians and healers while a scarce frontier
 * grows scouts, thieves, refugees and rebels.
 *
 * Pure + deterministic (no RNG): scoring is a function of state, so determinism is preserved.
 */

/** How often (cycles) an agent re-evaluates its role. Staggered by id to spread cost + churn. */
const ROLE_REVIEW = 450;

const ALL_ROLES: AgentRole[] = [
  'leader', 'rebel', 'guard', 'healer', 'thief', 'scout', 'investigator', 'trader',
  'historian', 'builder', 'priest', 'prophet', 'farmer', 'explorer', 'refugee', 'gatherer',
];

interface RoleContext {
  inCity: boolean;
  isLeader: boolean;
  spiritual: boolean; // governing tribe is spiritual
  tribeless: boolean;
  frac: number; // energy fraction
  scarcity: number; // world ecology scarcity 0..1
  discovery: number; // Hidden Council discovery risk 0..1
  ageNorm: number; // min(1, age/4000)
}

/**
 * W1.4 — personal evidence that the world is watched: investigation must be driven by what an
 * agent has actually witnessed/heard, not by society-wide discoveryRisk alone (which converted
 * up to 82% of the ON population into evidence-free investigators in the audit).
 */
function evidenceScore(a: Agent): number {
  let ev = 0;
  for (const m of a.memory) {
    if (m.kind === 'suspected_council') ev += 0.5;
    else if (m.kind === 'discovered_anomaly') ev += 0.4;
    else if (m.kind === 'witnessed_miracle') ev += 0.15;
  }
  return Math.min(1.2, ev);
}

/** Score every role for an agent in a context; higher = better fit. */
function scoreRoles(a: Agent, c: RoleContext): Record<AgentRole, number> {
  const t = a.traits;
  const evidence = evidenceScore(a);
  return {
    // an actual elected leader is overwhelmingly the 'leader' role
    leader: c.isLeader ? 10 : t.ambition * 0.4 + t.socialNeed * 0.2 - 0.6,
    rebel: t.ambition * 0.6 + t.aggression * 0.4 - t.loyalty * 0.6 + c.scarcity * 0.3,
    guard: t.aggression * 0.6 + t.loyalty * 0.55 + (c.inCity ? 0.3 : 0),
    healer: t.empathy * 0.95 + (c.frac > 0.4 ? 0.2 : -0.2),
    thief: t.greed * 0.7 + t.aggression * 0.3 - t.empathy * 0.6 + c.scarcity * 0.25,
    scout: t.curiosity * 0.7 + t.intelligence * 0.3 + t.independence * 0.2,
    // W1.4 — gated on personal evidence; society-wide suspicion is only a faint nudge, so a
    // curious-but-uninformed agent becomes a scout/prophet/priest (or denies it) instead.
    investigator: t.curiosity * 0.5 + t.intelligence * 0.45 + evidence * 0.9 + c.discovery * 0.15 - 0.35,
    trader: t.socialNeed * 0.5 + t.intelligence * 0.45 + t.greed * 0.3 + (c.inCity ? 0.35 : -0.2),
    historian: t.intelligence * 0.6 + t.socialNeed * 0.35 + c.ageNorm * 0.4 + (c.inCity ? 0.2 : -0.1),
    builder: t.ambition * 0.45 + t.intelligence * 0.4 + (c.inCity ? 0.6 : -0.5),
    priest: t.empathy * 0.35 + t.curiosity * 0.3 + (c.spiritual ? 0.6 : -0.1),
    prophet: t.curiosity * 0.5 + c.discovery * 0.7 + t.independence * 0.3 - 0.5,
    farmer: (1 - t.aggression) * 0.4 + t.loyalty * 0.3 + t.empathy * 0.2,
    explorer: t.curiosity * 0.6 + t.independence * 0.6 - (c.inCity ? 0.4 : 0),
    refugee:
      t.fear * 0.6 + (c.frac < 0.3 ? 0.6 : 0) + (c.tribeless ? 0.4 : -0.2) + c.scarcity * 0.3,
    // baseline vocation; stronger when hungry so survival still dominates when it must
    gatherer: 0.5 + (c.frac < 0.45 ? 0.45 : 0),
  };
}

/** Context-free role from traits alone — used to seed newborns and migrate old saves. */
export function roleFromTraits(a: Agent): AgentRole {
  const scores = scoreRoles(a, {
    inCity: a.cityId !== null,
    isLeader: false,
    spiritual: false,
    tribeless: a.tribeId === null,
    frac: a.maxEnergy > 0 ? a.energy / a.maxEnergy : 0.5,
    scarcity: 0,
    discovery: 0,
    ageNorm: Math.min(1, a.age / 4000),
  });
  return pickBest(scores);
}

function pickBest(scores: Record<AgentRole, number>): AgentRole {
  let best: AgentRole = 'gatherer';
  let bestScore = -Infinity;
  for (const r of ALL_ROLES) {
    if (scores[r] > bestScore) {
      bestScore = scores[r];
      best = r;
    }
  }
  return best;
}

/** Best-fitting role other than `except` (used by the W1.4 investigator soft cap). */
function pickBestExcept(scores: Record<AgentRole, number>, except: AgentRole): AgentRole {
  let best: AgentRole = 'gatherer';
  let bestScore = -Infinity;
  for (const r of ALL_ROLES) {
    if (r === except) continue;
    if (scores[r] > bestScore) {
      bestScore = scores[r];
      best = r;
    }
  }
  return best;
}

/** W1.4 — max fraction of a tribe that may be investigators (soft cap; converges as agents
 *  are re-scored on their stagger). Keeps investigators present but not dominant. */
const INVESTIGATOR_CAP = 0.25;

/**
 * Re-evaluate roles across the population (called each economy interval from stepWorld). Each
 * agent is only re-scored every ROLE_REVIEW cycles (staggered by id), bounding both cost and
 * role churn. Returns nothing; mutates `a.role`.
 */
export function assignRoles(world: WorldState): void {
  const tribeById = new Map<number, Tribe>();
  for (const t of world.tribes) tribeById.set(t.id, t);
  const cityById = new Map<number, City>();
  for (const c of world.cities) cityById.set(c.id, c);
  const scarcity = world.ecology ? world.ecology.scarcityIndex : 0;
  const discovery = world.hiddenCouncil ? world.hiddenCouncil.discoveryRisk : 0;

  // W1.4 — per-tribe investigator + population tallies for the soft cap (tribeless keyed -1).
  const invByTribe = new Map<number, number>();
  const popByTribe = new Map<number, number>();
  for (const a of world.agents) {
    if (!a.alive) continue;
    const k = a.tribeId ?? -1;
    popByTribe.set(k, (popByTribe.get(k) ?? 0) + 1);
    if (a.role === 'investigator') invByTribe.set(k, (invByTribe.get(k) ?? 0) + 1);
  }

  for (const a of world.agents) {
    if (!a.alive) continue;
    if (world.cycle - a.roleAssignedCycle < ROLE_REVIEW && (world.cycle + a.id) % ROLE_REVIEW !== 0) {
      continue;
    }
    const tribe = a.tribeId !== null ? tribeById.get(a.tribeId) : undefined;
    const city = a.cityId !== null ? cityById.get(a.cityId) : undefined;
    const isLeader = (tribe?.leaderId === a.id) || (city?.leaderId === a.id);
    const scores = scoreRoles(a, {
      inCity: a.cityId !== null,
      isLeader,
      spiritual: tribe?.ideology === 'spiritual',
      tribeless: a.tribeId === null,
      frac: a.maxEnergy > 0 ? a.energy / a.maxEnergy : 0.5,
      scarcity,
      discovery,
      ageNorm: Math.min(1, a.age / 4000),
    });
    let best = pickBest(scores);
    // W1.4 — soft-cap investigators per tribe so suspicion can't convert a whole population.
    const k = a.tribeId ?? -1;
    if (best === 'investigator') {
      const pop = popByTribe.get(k) ?? 1;
      const inv = invByTribe.get(k) ?? 0;
      if (inv / pop >= INVESTIGATOR_CAP) best = pickBestExcept(scores, 'investigator');
    }
    if (a.role === 'investigator' && best !== 'investigator') {
      invByTribe.set(k, Math.max(0, (invByTribe.get(k) ?? 1) - 1));
    } else if (a.role !== 'investigator' && best === 'investigator') {
      invByTribe.set(k, (invByTribe.get(k) ?? 0) + 1);
    }
    a.role = best;
    a.roleAssignedCycle = world.cycle;
  }
}

/** Count agents by role (for the World Health panel / tests). */
export function roleDistribution(world: WorldState): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const a of world.agents) {
    if (!a.alive) continue;
    dist[a.role] = (dist[a.role] ?? 0) + 1;
  }
  return dist;
}
