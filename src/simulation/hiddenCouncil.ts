import { RNG } from './rng';
import { COUNCIL } from './config';
import { createAgent } from './agent';
import { createEnergySource } from './energy';
import { adjust, ensureRel } from './relationships';
import { remember } from './memory';
import { pushPulse } from './conflict';
import { recordEvent } from './chronicle';
import type { Agent, CouncilInterventionKind, HiddenCouncilState, WorldState } from './types';

/**
 * The Hidden Council (Phase 10): a secret manipulation layer the user can enable. Rewritten
 * from a fixed-interval timer that endlessly re-ran `suppress_memory` on dead agents into an
 * director that:
 *   • keeps a LIVE watchlist (dead agents are pruned; new watched chosen by curiosity,
 *     intelligence, leadership and suspicion),
 *   • SELECTS interventions from world conditions and never repeats a useless one (it will
 *     not choose suppress_memory unless live watched agents actually hold dangerous memories),
 *   • gives every intervention a real effect + secret log + (when revealed) a chronicle entry,
 *   • escalates DISCOVERY-RISK consequences at 0.25 / 0.5 / 0.75 / 0.9 (suspicion → investigators
 *     → cults → revelation crisis).
 * While DISABLED the council consumes no RNG, so default runs stay byte-identical.
 */

export function createCouncil(): HiddenCouncilState {
  return {
    enabled: false,
    revealed: false,
    manipulation: 0,
    discoveryRisk: 0,
    interventions: 0,
    lastKind: null,
    nextKind: null,
    secretLog: [],
    watchedAgentIds: [],
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function log(c: HiddenCouncilState, cycle: number, kind: CouncilInterventionKind, text: string): void {
  c.secretLog.push({ cycle, kind, text });
  if (c.secretLog.length > COUNCIL.logCap) c.secretLog.shift();
}

/** Prune dead/missing watched agents, then top up the watchlist with the most "interesting"
 *  living agents (curious + intelligent + influential + suspicious). */
function refreshWatched(world: WorldState): void {
  const c = world.hiddenCouncil;
  const alive = new Map<number, Agent>();
  for (const a of world.agents) if (a.alive) alive.set(a.id, a);
  c.watchedAgentIds = c.watchedAgentIds.filter((id) => alive.has(id));

  if (c.watchedAgentIds.length >= COUNCIL.watchTarget) return;
  const watched = new Set(c.watchedAgentIds);
  const leaderIds = new Set<number>();
  for (const t of world.tribes) if (t.leaderId !== null) leaderIds.add(t.leaderId);

  const score = (a: Agent): number => {
    let s = a.traits.curiosity * a.traits.intelligence + a.traits.ambition * 0.3;
    if (leaderIds.has(a.id)) s += 0.4;
    for (const m of a.memory) if (m.kind === 'suspected_council' || m.kind === 'discovered_anomaly') s += 0.3;
    return s;
  };
  const candidates = world.agents
    .filter((a) => a.alive && !watched.has(a.id))
    .sort((a, b) => score(b) - score(a) || a.id - b.id);
  for (const a of candidates) {
    if (c.watchedAgentIds.length >= COUNCIL.watchTarget) break;
    c.watchedAgentIds.push(a.id);
  }
}

function liveWatched(world: WorldState): Agent[] {
  const out: Agent[] = [];
  for (const id of world.hiddenCouncil.watchedAgentIds) {
    const a = world.agents.find((x) => x.id === id && x.alive);
    if (a) out.push(a);
  }
  return out;
}

function hasSuppressibleMemories(world: WorldState): boolean {
  for (const a of liveWatched(world)) {
    for (const m of a.memory) {
      if (m.kind === 'witnessed_death' || m.kind === 'stolen_from' || m.kind === 'suspected_council' || m.kind === 'discovered_anomaly') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Director-style intervention selection from world conditions (deterministic, no RNG). Never
 * returns the last kind twice in a row for flavor interventions, and never returns
 * suppress_memory unless it would actually clear something.
 */
export function selectHiddenCouncilIntervention(world: WorldState): CouncilInterventionKind {
  const e = world.economy;
  const c = world.hiddenCouncil;
  const eco = world.ecology;
  const rotate = (...opts: CouncilInterventionKind[]): CouncilInterventionKind => {
    for (let i = 0; i < opts.length; i++) {
      const k = opts[(c.interventions + i) % opts.length];
      if (k !== c.lastKind) return k;
    }
    return opts[0];
  };

  if (world.agents.length < 70) return 'spawn_energy';
  if (eco && eco.scarcityIndex > 0.85) return 'spawn_hidden_energy';
  if (c.discoveryRisk > COUNCIL.suspicion75) return rotate('cause_false_miracle', 'silence_investigator', 'plant_rumor');
  if (c.discoveryRisk > COUNCIL.suspicion50) {
    if (hasSuppressibleMemories(world)) return rotate('suppress_memory', 'silence_investigator', 'seed_discovery_clue', 'plant_rumor');
    return rotate('silence_investigator', 'seed_discovery_clue', 'plant_rumor');
  }
  if (e.rebellionRisk > 0.55) return rotate('protect_leader', 'frame_rebel');
  if (e.inequalityIndex < 0.18) return 'create_scarcity';
  return rotate('plant_rumor', 'create_prophet', 'corrupt_agent', 'system_glitch', 'amplify_cult', 'seed_discovery_clue', 'secret_agent');
}

function intervene(world: WorldState, kind: CouncilInterventionKind, rng: RNG): void {
  const c = world.hiddenCouncil;
  const agents = world.agents;
  switch (kind) {
    case 'spawn_energy': {
      const src = createEnergySource(world.nextEnergyId++, rng, world.params, 'rare');
      world.energySources.push(src);
      log(c, world.cycle, kind, 'Seeded a rich energy source to sustain the population.');
      break;
    }
    case 'spawn_hidden_energy': {
      const src = createEnergySource(world.nextEnergyId++, rng, world.params, 'renewable');
      src.discovered = false;
      world.energySources.push(src);
      c.discoveryRisk = clamp01(c.discoveryRisk - 0.04);
      log(c, world.cycle, kind, 'Hid a renewable spring in the wilds for the curious to find.');
      break;
    }
    case 'create_scarcity': {
      for (const s of world.energySources) s.amount *= 0.6;
      log(c, world.cycle, kind, 'Drained energy reserves to manufacture scarcity.');
      break;
    }
    case 'protect_leader': {
      let best: Agent | null = null;
      for (const t of world.tribes) {
        if (t.leaderId === null) continue;
        const leader = agents.find((a) => a.id === t.leaderId && a.alive);
        if (leader && (!best || t.population > 0)) best = leader;
      }
      if (best) {
        best.energy = best.maxEnergy;
        log(c, world.cycle, kind, `Shielded ${best.name} from harm.`);
      }
      break;
    }
    case 'frame_rebel': {
      // turn the people against the most rebellious agent (defuses a brewing revolt)
      let rebel: Agent | null = null;
      for (const a of agents) {
        if (!a.alive) continue;
        if (a.role === 'rebel' && (!rebel || a.traits.ambition > rebel.traits.ambition)) rebel = a;
      }
      if (rebel) {
        for (const a of agents) {
          if (!a.alive || a.id === rebel.id) continue;
          if (Math.hypot(a.x - rebel.x, a.y - rebel.y) < 160) {
            const r = ensureRel(a, rebel.id, world.cycle);
            adjust(r, 'resentment', 0.15);
            adjust(r, 'trust', -0.1);
          }
        }
        log(c, world.cycle, kind, `Framed ${rebel.name}, turning the people against the rebel.`);
      }
      break;
    }
    case 'corrupt_agent': {
      const a = agents[rng.int(0, agents.length)];
      if (a && a.alive) {
        a.traits.aggression = clamp01(a.traits.aggression + 0.3);
        a.traits.greed = clamp01(a.traits.greed + 0.3);
        a.traits.empathy = clamp01(a.traits.empathy - 0.2);
        log(c, world.cycle, kind, `Corrupted ${a.name} toward greed and aggression.`);
      }
      break;
    }
    case 'plant_rumor': {
      c.discoveryRisk = clamp01(c.discoveryRisk - 0.15); // misdirection
      log(c, world.cycle, kind, 'Planted false rumors to muddy the truth.');
      break;
    }
    case 'create_prophet': {
      let p: Agent | null = null;
      for (const a of agents) if (a.alive && (!p || a.traits.curiosity > p.traits.curiosity)) p = a;
      if (p) {
        p.traits.curiosity = clamp01(p.traits.curiosity + 0.2);
        p.traits.intelligence = clamp01(p.traits.intelligence + 0.2);
        p.traits.socialNeed = clamp01(p.traits.socialNeed + 0.2);
        log(c, world.cycle, kind, `Raised ${p.name} as a prophet.`);
      }
      break;
    }
    case 'amplify_cult': {
      // empower a prophet/priest and bind nearby followers to them (a cult coalesces)
      let prophet: Agent | null = null;
      for (const a of agents) {
        if (!a.alive) continue;
        if ((a.role === 'prophet' || a.role === 'priest') && (!prophet || a.traits.socialNeed > prophet.traits.socialNeed)) prophet = a;
      }
      if (prophet) {
        prophet.traits.socialNeed = clamp01(prophet.traits.socialNeed + 0.15);
        let bound = 0;
        for (const a of agents) {
          if (!a.alive || a.id === prophet.id) continue;
          if (Math.hypot(a.x - prophet.x, a.y - prophet.y) < 140) {
            const r = ensureRel(a, prophet.id, world.cycle);
            adjust(r, 'loyalty', 0.12);
            adjust(r, 'trust', 0.08);
            bound += 1;
          }
        }
        log(c, world.cycle, kind, `Amplified ${prophet.name}'s following (${bound} drawn in).`);
      }
      break;
    }
    case 'system_glitch': {
      pushPulse(world, rng.range(0, world.params.width), rng.range(0, world.params.height), 'council', 80);
      c.discoveryRisk = clamp01(c.discoveryRisk + 0.08);
      log(c, world.cycle, kind, 'A reality glitch rippled through the world.');
      break;
    }
    case 'seed_discovery_clue': {
      // plant an anomaly that a curious agent "discovers" — feeds investigation arcs
      let seer: Agent | null = null;
      for (const a of agents) {
        if (!a.alive) continue;
        const s = a.traits.curiosity * a.traits.intelligence;
        if (!seer || s > seer.traits.curiosity * seer.traits.intelligence) seer = a;
      }
      if (seer) {
        remember(seer, 'discovered_anomaly', world.cycle, { x: seer.x, y: seer.y, strength: 0.7 });
        c.discoveryRisk = clamp01(c.discoveryRisk + 0.04);
        log(c, world.cycle, kind, `Left a clue for ${seer.name} to find.`);
      }
      break;
    }
    case 'silence_investigator': {
      // dull the most dangerous investigator and erase what they suspected
      let target: Agent | null = null;
      let best = -Infinity;
      for (const a of agents) {
        if (!a.alive) continue;
        let s = a.traits.curiosity * a.traits.intelligence;
        for (const m of a.memory) if (m.kind === 'suspected_council' || m.kind === 'discovered_anomaly') s += 0.5;
        if (a.role === 'investigator') s += 0.5;
        if (s > best) {
          best = s;
          target = a;
        }
      }
      if (target) {
        target.traits.curiosity = clamp01(target.traits.curiosity - 0.2);
        target.memory = target.memory.filter((m) => m.kind !== 'suspected_council' && m.kind !== 'discovered_anomaly');
        c.discoveryRisk = clamp01(c.discoveryRisk - 0.1);
        log(c, world.cycle, kind, `Silenced the investigator ${target.name}.`);
      }
      break;
    }
    case 'cause_false_miracle': {
      // a "miracle" buys legitimacy + awe, but wonder breeds suspicion
      let leader: Agent | null = null;
      for (const t of world.tribes) {
        if (t.leaderId === null) continue;
        const l = agents.find((a) => a.id === t.leaderId && a.alive);
        if (l && (!leader || t.population > 0)) leader = l;
      }
      if (leader) {
        leader.energy = leader.maxEnergy;
        for (const a of agents) {
          if (!a.alive || a.id === leader.id) continue;
          const r = ensureRel(a, leader.id, world.cycle);
          adjust(r, 'trust', 0.06);
          if (a.memory.length && rng.chance(0.05)) remember(a, 'witnessed_miracle', world.cycle, { otherId: leader.id, strength: 0.6 });
        }
        c.discoveryRisk = clamp01(c.discoveryRisk + 0.05);
        log(c, world.cycle, kind, `Staged a false miracle around ${leader.name}.`);
      }
      break;
    }
    case 'secret_agent': {
      const z = createAgent(world.nextAgentId++, rng, world.params);
      z.name = 'Zazra';
      z.traits.intelligence = 0.95;
      z.traits.curiosity = 0.95;
      z.traits.ambition = 0.9;
      z.traits.empathy = 0.2;
      agents.push(z);
      log(c, world.cycle, kind, 'Inserted the secret agent Zazra into the world.');
      break;
    }
    case 'suppress_memory': {
      let cleared = 0;
      for (const a of liveWatched(world)) {
        const before = a.memory.length;
        a.memory = a.memory.filter(
          (m) =>
            m.kind !== 'witnessed_death' &&
            m.kind !== 'stolen_from' &&
            m.kind !== 'suspected_council' &&
            m.kind !== 'discovered_anomaly',
        );
        cleared += before - a.memory.length;
      }
      if (cleared > 0) {
        c.discoveryRisk = clamp01(c.discoveryRisk - 0.2);
        log(c, world.cycle, kind, `Suppressed ${cleared} dangerous memories.`);
      } else {
        // should be gated out by selection, but never log a useless act — penalize instead
        c.discoveryRisk = clamp01(c.discoveryRisk + COUNCIL.failedSuppressRisk);
        log(c, world.cycle, kind, 'A suppression found nothing — the watched are clean (suspicion grew).');
      }
      break;
    }
    default:
      break;
  }
  c.interventions += 1;
  c.lastKind = kind;
  c.manipulation = clamp01(c.manipulation + COUNCIL.manipPerAct);
}

/** Escalating social consequences of discovery risk, fired once per threshold crossed. */
function discoveryConsequences(world: WorldState): void {
  const c = world.hiddenCouncil;
  const fire = (key: string, ev: Parameters<typeof recordEvent>[1]) => {
    if (world.milestones.includes(key)) return;
    world.milestones.push(key);
    recordEvent(world, ev);
  };
  if (c.discoveryRisk >= COUNCIL.suspicion25) {
    fire('council25', { category: 'discovery', severity: 2, title: 'A Whisper of Doubt', description: 'Some begin to suspect the world is not as it seems.' });
  }
  if (c.discoveryRisk >= COUNCIL.suspicion50) {
    fire('council50', { category: 'discovery', severity: 3, title: 'Investigators Rise', description: 'The curious openly investigate the anomalies that shape their world.' });
  }
  if (c.discoveryRisk >= COUNCIL.suspicion75) {
    fire('council75', { category: 'discovery', severity: 4, title: 'Cults of the Watchers', description: 'Movements form around the belief that hidden hands rule the world.' });
  }
  if (c.discoveryRisk >= COUNCIL.suspicion90) {
    fire('council90', { category: 'hidden_council', severity: 5, title: 'Revelation Crisis', description: 'The truth is almost out — the world teeters on revelation.' });
  }
}

/** Run each economy interval (only when enabled). Updates risk + watchlist + acts on schedule. */
export function updateHiddenCouncil(world: WorldState, rng: RNG): void {
  const c = world.hiddenCouncil;
  if (!c.enabled) return;

  refreshWatched(world);

  const agents = world.agents;
  let curio = 0;
  let n = 0;
  for (const a of agents) {
    if (!a.alive) continue;
    curio += a.traits.curiosity * a.traits.intelligence;
    n += 1;
  }
  curio = n > 0 ? curio / n : 0;
  const target = clamp01(curio * 0.6 + c.manipulation * 0.5 + (c.revealed ? 0.3 : 0));
  c.discoveryRisk += (target - c.discoveryRisk) * 0.2;
  c.manipulation = clamp01(c.manipulation - COUNCIL.manipDecay);

  // Phase 11 — at high suspicion, a watched curious mind starts to *remember* its doubt;
  // that memory feeds investigation, the watchlist, and 'suspicion' conversation (one/interval).
  if (c.discoveryRisk > COUNCIL.suspicion50) {
    for (const a of liveWatched(world)) {
      if (
        a.traits.curiosity * a.traits.intelligence > 0.4 &&
        !a.memory.some((m) => m.kind === 'suspected_council' && world.cycle - m.cycle < 2000)
      ) {
        remember(a, 'suspected_council', world.cycle, { strength: 0.6 });
        break;
      }
    }
  }

  c.nextKind = selectHiddenCouncilIntervention(world);
  if (world.cycle % COUNCIL.interval === 0) {
    intervene(world, c.nextKind, rng);
    if (c.revealed) {
      recordEvent(world, {
        category: 'hidden_council',
        severity: 2,
        title: 'Council Intervention',
        description: c.secretLog.length > 0 ? c.secretLog[c.secretLog.length - 1].text : 'The council acted.',
      });
    }
  }

  discoveryConsequences(world);
}

/** Toggle a tribe leader's adoration after a council "miracle" (used by God Mode reveal). */
export function councilAdore(world: WorldState, agentId: number): void {
  for (const a of world.agents) {
    if (a.id === agentId) continue;
    const r = ensureRel(a, agentId, world.cycle);
    adjust(r, 'trust', 0.05);
  }
}
