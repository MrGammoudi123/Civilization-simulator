import { RNG } from './rng';
import { TRIBE } from './config';
import { sentiment } from './relationships';
import { remember } from './memory';
import { recordEvent } from './chronicle';
import { loseDiscoveriesOnCollapse } from './discovery';
import { SpatialGrid } from './spatialGrid';
import type { Agent, ArchivedTribe, Tribe, TribeIdeology, WorldState } from './types';

/** Keep this many tribe epitaphs (oldest dropped). Bounds memory over million-cycle runs. */
const ARCHIVE_CAP = 300;

/**
 * Emergent tribes. None of this is scripted: tribes form from clusters of mutually-bonded
 * agents, elect the highest-status member as leader, derive an ideology from their members'
 * average traits, claim the territory their members occupy, and change over time through
 * recruitment, defection, disbanding, merging, splitting, and inter-tribe war.
 *
 * Runs every TRIBE.interval ticks (called from world.stepWorld with a freshly built grid).
 */

const PALETTE: [number, number, number][] = [
  [232, 93, 117],
  [86, 180, 233],
  [240, 180, 80],
  [120, 200, 140],
  [180, 140, 240],
  [90, 200, 210],
  [235, 130, 200],
  [150, 170, 250],
  [210, 160, 90],
  [120, 220, 180],
  [200, 120, 120],
  [160, 200, 90],
];

const NAME_ADJ = [
  'First', 'Pale', 'Iron', 'Hidden', 'Bright', 'Silent', 'Broken', 'Free',
  'Eternal', 'Lost', 'High', 'Deep', 'Red', 'Golden', 'Ashen', 'Wandering',
];
const NAME_NOUN = [
  'Light', 'Vale', 'Circle', 'Pact', 'Flame', 'Reach', 'Hollow', 'Spire',
  'Dawn', 'Veil', 'Gate', 'Wardens', 'Kin', 'Tide', 'Ember', 'Accord',
];

const IDEOLOGY_AGGRESSION: Record<TribeIdeology, number> = {
  cooperative: 0.1,
  spiritual: 0.2,
  trader: 0.3,
  isolationist: 0.4,
  authoritarian: 0.6,
  revolutionary: 0.6,
  expansionist: 0.7,
  militaristic: 0.9,
};

const neighborScratch: number[] = [];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function status(a: Agent): number {
  return (
    a.traits.ambition * 0.4 +
    (a.energy / a.maxEnergy) * 0.25 +
    Math.min(1, a.age / 4000) * 0.2 +
    a.traits.intelligence * 0.15
  );
}

function makeTribeName(rng: RNG): string {
  return `The ${rng.pick(NAME_ADJ)} ${rng.pick(NAME_NOUN)}`;
}

function logHistory(tribe: Tribe, cycle: number, text: string): void {
  tribe.history.push({ cycle, text });
  if (tribe.history.length > TRIBE.historyCap) tribe.history.shift();
}

/**
 * Record a collapsed tribe as an archived epitaph rather than discarding it (Phase 2). Only
 * once-substantial tribes (peak ≥ 8) are kept, so the list stays meaningful and bounded; it
 * feeds Chronicle (Phase 8), cultural memory and successor tribes (Phase 6).
 */
function archiveTribe(world: WorldState, tribe: Tribe, members: Agent[]): void {
  if (tribe.peakPopulation < 8) return;
  let leaderName: string | null = null;
  if (tribe.leaderId !== null) {
    const fromMembers = members.find((m) => m.id === tribe.leaderId);
    const leader = fromMembers ?? world.agents.find((a) => a.id === tribe.leaderId);
    leaderName = leader ? leader.name : null;
  }
  const epitaph: ArchivedTribe = {
    id: tribe.id,
    name: tribe.name,
    ideology: tribe.ideology,
    foundedCycle: tribe.foundedCycle,
    collapseCycle: world.cycle,
    peakPopulation: tribe.peakPopulation,
    lastLeaderName: leaderName,
  };
  world.archivedTribes.push(epitaph);
  if (world.archivedTribes.length > ARCHIVE_CAP) world.archivedTribes.shift();
}

function computeIdeology(avg: Agent['traits'], inequality: number): TribeIdeology {
  const scores: Record<TribeIdeology, number> = {
    cooperative: avg.empathy + avg.loyalty - avg.aggression,
    authoritarian: avg.ambition + avg.aggression * 0.5 - avg.empathy,
    spiritual: avg.curiosity * 0.6 + avg.empathy * 0.6 - avg.aggression * 0.3,
    trader: avg.greed + avg.intelligence * 0.5,
    militaristic: avg.aggression + avg.ambition * 0.4 - avg.empathy * 0.5,
    isolationist: avg.independence - avg.socialNeed,
    revolutionary: inequality * 1.2 + avg.aggression * 0.4 - avg.loyalty,
    expansionist: avg.ambition + avg.curiosity * 0.4 + avg.socialNeed * 0.3,
  };
  let best: TribeIdeology = 'cooperative';
  let bestScore = -Infinity;
  (Object.keys(scores) as TribeIdeology[]).forEach((k) => {
    if (scores[k] > bestScore) {
      bestScore = scores[k];
      best = k;
    }
  });
  return best;
}

/** Recompute a tribe's identity from its current members, and run shared-energy sharing. */
function recomputeTribe(tribe: Tribe, members: Agent[], cycle: number): void {
  tribe.population = members.length;
  if (members.length > tribe.peakPopulation) tribe.peakPopulation = members.length;
  tribe.memberIds = members.map((m) => m.id);

  // leader = highest status (deterministic id tie-break)
  let leader = members[0];
  let bestStatus = -Infinity;
  for (const m of members) {
    const s = status(m);
    if (s > bestStatus || (s === bestStatus && m.id < leader.id)) {
      bestStatus = s;
      leader = m;
    }
  }
  const prevLeader = tribe.leaderId;
  tribe.leaderId = leader.id;
  if (prevLeader !== null && prevLeader !== leader.id) {
    logHistory(tribe, cycle, `${leader.name} became leader`);
  }

  // centroid + spread
  let sx = 0;
  let sy = 0;
  for (const m of members) {
    sx += m.x;
    sy += m.y;
  }
  tribe.cx = sx / members.length;
  tribe.cy = sy / members.length;
  let spread = 0;
  for (const m of members) spread += Math.hypot(m.x - tribe.cx, m.y - tribe.cy);
  spread /= members.length;
  tribe.radius = Math.max(50, Math.min(360, spread * 1.3 + 30));

  // average traits + ideology
  const avg = {
    curiosity: 0, aggression: 0, empathy: 0, fear: 0, greed: 0,
    loyalty: 0, intelligence: 0, socialNeed: 0, independence: 0, ambition: 0,
  };
  for (const m of members) {
    avg.curiosity += m.traits.curiosity;
    avg.aggression += m.traits.aggression;
    avg.empathy += m.traits.empathy;
    avg.fear += m.traits.fear;
    avg.greed += m.traits.greed;
    avg.loyalty += m.traits.loyalty;
    avg.intelligence += m.traits.intelligence;
    avg.socialNeed += m.traits.socialNeed;
    avg.independence += m.traits.independence;
    avg.ambition += m.traits.ambition;
  }
  const n = members.length;
  (Object.keys(avg) as (keyof typeof avg)[]).forEach((k) => {
    avg[k] /= n;
  });
  tribe.aggressionLevel = avg.aggression;

  // energy inequality (mean absolute deviation / mean)
  let meanE = 0;
  for (const m of members) meanE += m.energy;
  meanE /= n;
  let mad = 0;
  for (const m of members) mad += Math.abs(m.energy - meanE);
  mad /= n;
  tribe.inequalityLevel = clamp01(meanE > 0 ? mad / meanE : 0);

  const prevIdeology = tribe.ideology;
  tribe.ideology = computeIdeology(avg, tribe.inequalityLevel);
  if (prevIdeology !== tribe.ideology) {
    logHistory(tribe, cycle, `turned ${tribe.ideology}`);
  }

  // shared energy: surplus tithe in (bounded), starving fed out, slow spoilage decay.
  // W1.2 — the pool is capped (base + per-capita) and tithing tapers as it fills, so a
  // well-fed tribe can no longer hoard unbounded energy (the audit's 959k Council-ON overflow).
  const cap = TRIBE.sharedEnergyBaseCap + TRIBE.sharedEnergyPerCapita * members.length;
  for (const m of members) {
    if (tribe.sharedEnergy >= cap) break;
    const frac = m.energy / m.maxEnergy;
    if (frac > 0.8) {
      const fillRatio = cap > 0 ? tribe.sharedEnergy / cap : 1;
      const headroom = cap - tribe.sharedEnergy;
      // diminishing returns: contribute less the closer the pool is to its cap
      const take = Math.min((m.energy - 0.8 * m.maxEnergy) * TRIBE.titheFrac * (1 - fillRatio), headroom);
      if (take > 0) {
        m.energy -= take;
        tribe.sharedEnergy += take;
      }
    }
  }
  for (const m of members) {
    const frac = m.energy / m.maxEnergy;
    if (frac < 0.25 && tribe.sharedEnergy > 0) {
      const give = Math.min(TRIBE.feedFrac * m.maxEnergy - m.energy, tribe.sharedEnergy);
      if (give > 0) {
        m.energy += give;
        tribe.sharedEnergy -= give;
        remember(m, 'shared_energy', cycle, { strength: 0.4 }); // Phase 11 — the tribe fed me
      }
    }
  }
  // hard ceiling + spoilage decay (excess bleeds away rather than compounding forever)
  if (tribe.sharedEnergy > cap) tribe.sharedEnergy = cap;
  tribe.sharedEnergy *= 1 - TRIBE.sharedEnergyDecay;

  // stability = loyalty toward leader + low inequality + treasury adequacy
  let loy = 0;
  let counted = 0;
  for (const m of members) {
    if (m.id === leader.id) continue;
    const rel = m.relationships.get(leader.id);
    loy += rel ? rel.loyalty * 0.6 + rel.trust * 0.4 : 0;
    counted += 1;
  }
  const avgLoy = counted > 0 ? loy / counted : 0.5;
  tribe.stability = clamp01(
    avgLoy * 0.5 + (1 - tribe.inequalityLevel) * 0.3 + Math.min(1, tribe.sharedEnergy / (n * 8)) * 0.2,
  );
}

function createTribe(world: WorldState, founders: Agent[], rng: RNG): Tribe {
  const id = world.nextTribeId++;
  const tribe: Tribe = {
    id,
    name: makeTribeName(rng),
    color: PALETTE[id % PALETTE.length],
    leaderId: null,
    memberIds: [],
    population: 0,
    peakPopulation: 0,
    cx: 0,
    cy: 0,
    radius: 60,
    sharedEnergy: 0,
    stability: 0.5,
    ideology: 'cooperative',
    aggressionLevel: 0,
    inequalityLevel: 0,
    foundedCycle: world.cycle,
    history: [],
    relations: new Map(),
  };
  for (const f of founders) f.tribeId = id;
  recomputeTribe(tribe, founders, world.cycle);
  logHistory(tribe, world.cycle, `founded by ${founders.length} agents`);
  world.tribes.push(tribe);
  return tribe;
}

export function updateTribes(world: WorldState, grid: SpatialGrid, rng: RNG): void {
  // 1. group living members by tribe
  const groups = new Map<number, Agent[]>();
  for (const a of world.agents) {
    if (a.tribeId === null) continue;
    let g = groups.get(a.tribeId);
    if (!g) {
      g = [];
      groups.set(a.tribeId, g);
    }
    g.push(a);
  }

  // Tribes that already host a city get a cohesion bonus (civic order) so cities persist.
  const urbanized = new Set<number>();
  for (const c of world.cities) urbanized.add(c.tribeId);

  // 2. update survivors, disband the too-small
  const survivors: Tribe[] = [];
  for (const tribe of world.tribes) {
    const members = groups.get(tribe.id);
    if (!members || members.length < TRIBE.minMembers) {
      if (members) for (const m of members) m.tribeId = null;
      // Archive the fallen tribe (don't silently discard) before it leaves the active set.
      archiveTribe(world, tribe, members ?? []);
      // W7 — the tribe's un-archived technical knowledge is lost with it (archived tech survives).
      loseDiscoveriesOnCollapse(world, tribe.id);
      // A once-substantial tribe falling apart is a notable collapse.
      if (tribe.population >= 8) {
        recordEvent(world, {
          category: 'collapse',
          severity: 3,
          title: 'A Tribe Scatters',
          description: `${tribe.name} (${tribe.population} strong) fell apart.`,
          tribeId: tribe.id,
        });
      }
      continue;
    }
    recomputeTribe(tribe, members, world.cycle);
    if (urbanized.has(tribe.id)) tribe.stability = clamp01(tribe.stability + 0.3);
    survivors.push(tribe);
  }
  world.tribes = survivors;

  // 3. recruitment + formation among tribeless agents
  recruitAndForm(world, grid, rng);

  // 4. inter-tribe relations (cooperate / compete / war)
  updateRelations(world);

  // 5. merge allied neighbors, split unstable giants
  mergeAndSplit(world, rng);

  // 6. final reconciliation: recruitment/merge/split above mutate agent.tribeId *after*
  //    recomputeTribe ran, so member lists can lag the source of truth. Rebuild every tribe's
  //    members + population from agent.tribeId so each batch ends fully consistent (Phase 2).
  reconcileMembership(world);
}

/**
 * Cheap O(agents) membership rebuild from `agent.tribeId` (the source of truth). Does NOT
 * recompute identity/ideology/sharing (that's the periodic `recomputeTribe`); it only keeps
 * `memberIds`/`population` exactly in sync after late membership changes.
 */
function reconcileMembership(world: WorldState): void {
  const groups = new Map<number, number[]>();
  for (const a of world.agents) {
    if (!a.alive || a.tribeId === null) continue;
    let g = groups.get(a.tribeId);
    if (!g) groups.set(a.tribeId, (g = []));
    g.push(a.id);
  }
  for (const t of world.tribes) {
    const ids = groups.get(t.id) ?? [];
    t.memberIds = ids;
    t.population = ids.length;
    if (ids.length > t.peakPopulation) t.peakPopulation = ids.length;
  }
}

function recruitAndForm(world: WorldState, grid: SpatialGrid, rng: RNG): void {
  const tribeById = new Map<number, Tribe>();
  for (const t of world.tribes) tribeById.set(t.id, t);

  for (let i = 0; i < world.agents.length; i++) {
    const a = world.agents[i];
    if (a.tribeId !== null || !a.alive) continue;

    grid.queryRadius(a.x, a.y, TRIBE.recruitRadius, neighborScratch);
    const pull = new Map<number, number>();
    const bondedTribeless: Agent[] = [];

    for (let k = 0; k < neighborScratch.length; k++) {
      const o = world.agents[neighborScratch[k]];
      if (o === a || !o.alive) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d > TRIBE.recruitRadius) continue;
      const rel = a.relationships.get(o.id);
      const sent = rel ? sentiment(rel) : 0;
      if (o.tribeId !== null) {
        if (sent > TRIBE.bondSentiment) pull.set(o.tribeId, (pull.get(o.tribeId) ?? 0) + 1);
      } else if (sent > TRIBE.bondSentiment && d < TRIBE.formRadius) {
        bondedTribeless.push(o);
      }
    }

    // recruit into the existing tribe that pulls hardest
    let bestTribe = -1;
    let bestPull = TRIBE.recruitPull - 1;
    for (const [tid, count] of pull) {
      if (count > bestPull || (count === bestPull && tid < bestTribe)) {
        bestPull = count;
        bestTribe = tid;
      }
    }
    if (bestTribe >= 0 && tribeById.has(bestTribe)) {
      a.tribeId = bestTribe;
      remember(a, 'joined_tribe', world.cycle, { strength: 0.5 }); // Phase 11
      continue;
    }

    // otherwise, found a new tribe from a bonded tribeless cluster
    if (bondedTribeless.length >= TRIBE.formMembers - 1) {
      const founders = [a];
      for (const o of bondedTribeless) {
        if (o.tribeId === null) founders.push(o);
      }
      if (founders.length >= TRIBE.formMembers) {
        const t = createTribe(world, founders, rng);
        tribeById.set(t.id, t);
      }
    }
  }
}

function updateRelations(world: WorldState): void {
  const tribes = world.tribes;
  for (let i = 0; i < tribes.length; i++) {
    for (let j = i + 1; j < tribes.length; j++) {
      const t1 = tribes[i];
      const t2 = tribes[j];
      const dist = Math.hypot(t1.cx - t2.cx, t1.cy - t2.cy);
      const overlap = t1.radius + t2.radius - dist;
      const overlapFactor = clamp01(overlap / (t1.radius + t2.radius));
      const aggr = (IDEOLOGY_AGGRESSION[t1.ideology] + IDEOLOGY_AGGRESSION[t2.ideology]) / 2;
      const coopBonus = aggr < 0.3 ? 0.3 : 0;
      const target = Math.max(-1, Math.min(1, 0.4 - overlapFactor * 0.7 - aggr * 0.5 + coopBonus));

      const r1 = ensureRelation(t1, t2.id);
      const r2 = ensureRelation(t2, t1.id);
      r1.standing += (target - r1.standing) * 0.25;
      r2.standing = r1.standing;

      const war = r1.standing < -0.5 && aggr > 0.5;
      if (war && !r1.war) {
        logHistory(t1, world.cycle, `war with ${t2.name}`);
        logHistory(t2, world.cycle, `war with ${t1.name}`);
      } else if (!war && r1.war) {
        logHistory(t1, world.cycle, `peace with ${t2.name}`);
        logHistory(t2, world.cycle, `peace with ${t1.name}`);
      }
      r1.war = war;
      r2.war = war;
    }
  }
}

function ensureRelation(tribe: Tribe, otherId: number) {
  let r = tribe.relations.get(otherId);
  if (!r) {
    r = { standing: 0, war: false };
    tribe.relations.set(otherId, r);
  }
  return r;
}

function mergeAndSplit(world: WorldState, rng: RNG): void {
  // --- merge: allied, overlapping, small-enough pairs (smaller folds into larger) ---
  for (let i = 0; i < world.tribes.length; i++) {
    for (let j = i + 1; j < world.tribes.length; j++) {
      const a = world.tribes[i];
      const b = world.tribes[j];
      const rel = a.relations.get(b.id);
      if (!rel || rel.standing < TRIBE.mergeStanding) continue;
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (dist > (a.radius + b.radius) * 0.6) continue;
      if (a.population + b.population > TRIBE.mergeMaxPop) continue;

      const keep = a.population >= b.population ? a : b;
      const gone = keep === a ? b : a;
      for (const ag of world.agents) {
        if (ag.tribeId === gone.id) ag.tribeId = keep.id;
      }
      logHistory(keep, world.cycle, `merged with ${gone.name}`);
      world.tribes = world.tribes.filter((t) => t.id !== gone.id);
      return; // one structural change per update keeps things stable
    }
  }

  // --- split: an unstable, large tribe sheds its disloyal faction ---
  for (const tribe of world.tribes) {
    if (tribe.stability > TRIBE.splitStabilityMax || tribe.population < TRIBE.splitMinPop) continue;
    if (tribe.leaderId === null) continue;
    const dissidents: Agent[] = [];
    for (const ag of world.agents) {
      if (ag.tribeId !== tribe.id || ag.id === tribe.leaderId) continue;
      const rel = ag.relationships.get(tribe.leaderId);
      const disloyal = !rel || rel.loyalty < 0.15 || rel.rivalry > 0.4 || rel.resentment > 0.4;
      if (disloyal) dissidents.push(ag);
    }
    if (dissidents.length >= TRIBE.minMembers) {
      const t = createTribe(world, dissidents, rng);
      logHistory(t, world.cycle, `split from ${tribe.name}`);
      return;
    }
  }
}
