import { TRIBE } from './config';
import { recalculateEconomy } from './economy';
import { computeEcology, emptyEcology } from './ecology';
import { roleFromTraits } from './roles';
import { emptyPolitics } from './revolution';
import { pruneDeadRelationships } from './relationships';
import { sanitizeDeadMemory } from './memory';
import { createCouncil } from './hiddenCouncil';
import { ensureBrain, ensureLexicon } from './brain';
import type { Agent, ValidationIssue, ValidationReport, WorldState } from './types';

/**
 * World-state integrity: the invariants a million-cycle save needs but the original build
 * never enforced. Two entry points:
 *
 *   normalizeWorldState(world)  — mutates the world back into a self-consistent state
 *                                 (rebuild membership, prune dead references, clean the
 *                                 council watchlist, recompute economy). Called after every
 *                                 load (all paths funnel through saveSystem.deserializeWorld).
 *   validateWorldState(world)   — non-destructive diagnostic. Returns every inconsistency
 *                                 found, for dev warnings, the headless harness, and the UI.
 *
 * Framework-free (no React/DOM) so it runs headlessly.
 */

function statusOf(a: Agent): number {
  return (
    a.traits.ambition * 0.4 +
    (a.energy / a.maxEnergy) * 0.25 +
    Math.min(1, a.age / 4000) * 0.2 +
    a.traits.intelligence * 0.15
  );
}

/** Highest-status living member (deterministic id tie-break), or null if none. */
function electLeader(members: Agent[]): number | null {
  let leader: Agent | null = null;
  let best = -Infinity;
  for (const m of members) {
    const s = statusOf(m);
    if (s > best || (s === best && (leader === null || m.id < leader.id))) {
      best = s;
      leader = m;
    }
  }
  return leader ? leader.id : null;
}

function ensureArray<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Rebuild a loaded world into a self-consistent state. Agent `tribeId`/`cityId` are the
 * single source of truth for membership; everything else is derived from them.
 */
export function normalizeWorldState(world: WorldState): WorldState {
  // 0. defensive: every collection must exist (tolerant of partial/legacy saves)
  world.agents = ensureArray(world.agents);
  world.energySources = ensureArray(world.energySources);
  world.tribes = ensureArray(world.tribes);
  world.cities = ensureArray(world.cities);
  world.conflictPulses = ensureArray(world.conflictPulses);
  world.conversationLog = ensureArray(world.conversationLog);
  world.chronicle = ensureArray(world.chronicle);
  world.milestones = ensureArray(world.milestones);
  world.history = ensureArray(world.history);
  world.archivedTribes = ensureArray(world.archivedTribes);
  world.ruins = ensureArray(world.ruins);
  if (typeof world.nextRuinId !== 'number') world.nextRuinId = 0;
  if (typeof world.era !== 'string') world.era = 'Genesis';
  // Autonomous intelligence (save v3) — default the new world collections.
  world.discoveries = ensureArray(world.discoveries);
  world.cultures = ensureArray(world.cultures);
  if (typeof world.nextDiscoveryId !== 'number') world.nextDiscoveryId = 0;
  if (typeof world.nextSymbolSeq !== 'number') world.nextSymbolSeq = 0;
  world.backgroundNodes = ensureArray(world.backgroundNodes);
  if (!world.hiddenCouncil) world.hiddenCouncil = createCouncil();
  if (!Array.isArray(world.hiddenCouncil.watchedAgentIds)) world.hiddenCouncil.watchedAgentIds = [];
  if (!Array.isArray(world.hiddenCouncil.secretLog)) world.hiddenCouncil.secretLog = [];
  if (typeof world.hiddenCouncil.lastSpawnCycle !== 'number') world.hiddenCouncil.lastSpawnCycle = -1_000_000;

  // 1. indices of what currently exists
  const aliveIds = new Set<number>();
  for (const a of world.agents) if (a.alive) aliveIds.add(a.id);
  const tribeIds = new Set<number>();
  for (const t of world.tribes) tribeIds.add(t.id);
  const cityIds = new Set<number>();
  for (const c of world.cities) cityIds.add(c.id);

  // 2. orphan membership: an agent pointing at a tribe/city that no longer exists is reset
  for (const a of world.agents) {
    if (a.tribeId !== null && !tribeIds.has(a.tribeId)) a.tribeId = null;
    if (a.cityId !== null && !cityIds.has(a.cityId)) a.cityId = null;
  }

  // 3. rebuild tribe membership from agent.tribeId (the source of truth)
  const tribeMembers = new Map<number, Agent[]>();
  for (const a of world.agents) {
    if (!a.alive || a.tribeId === null) continue;
    let g = tribeMembers.get(a.tribeId);
    if (!g) tribeMembers.set(a.tribeId, (g = []));
    g.push(a);
  }
  for (const t of world.tribes) {
    const members = tribeMembers.get(t.id) ?? [];
    t.memberIds = members.map((m) => m.id);
    t.population = members.length;
    if (typeof t.peakPopulation !== 'number' || t.peakPopulation < members.length) {
      t.peakPopulation = members.length;
    }
    if (t.sharedEnergy < 0 || !Number.isFinite(t.sharedEnergy)) t.sharedEnergy = 0;
    // leader must be a living member; re-elect if stale
    const leaderAliveMember =
      t.leaderId !== null && members.some((m) => m.id === t.leaderId);
    if (!leaderAliveMember) t.leaderId = electLeader(members);
    // drop relations to tribes that no longer exist
    if (t.relations instanceof Map) {
      for (const otherId of t.relations.keys()) {
        if (!tribeIds.has(otherId)) t.relations.delete(otherId);
      }
    }
  }

  // 4. rebuild city population from agent.cityId
  const cityResidents = new Map<number, Agent[]>();
  for (const a of world.agents) {
    if (!a.alive || a.cityId === null) continue;
    let g = cityResidents.get(a.cityId);
    if (!g) cityResidents.set(a.cityId, (g = []));
    g.push(a);
  }
  const tribeById = new Map(world.tribes.map((t) => [t.id, t]));
  for (const c of world.cities) {
    if (!c.politics) c.politics = emptyPolitics(world.cycle);
    const residents = cityResidents.get(c.id) ?? [];
    c.population = residents.length;
    if (c.storedEnergy < 0 || !Number.isFinite(c.storedEnergy)) c.storedEnergy = 0;
    // city leader must be alive; fall back to the governing tribe's leader, else null
    const leaderAlive = c.leaderId !== null && aliveIds.has(c.leaderId);
    if (!leaderAlive) {
      const tribe = tribeById.get(c.tribeId);
      c.leaderId = tribe && tribe.leaderId !== null && aliveIds.has(tribe.leaderId)
        ? tribe.leaderId
        : null;
    }
  }

  // 5. prune dead references from every agent (relationships dropped, memories legacy-kept);
  //    ensure every agent has a role (Phase 5 — derive from traits if a legacy save lacks one)
  for (const a of world.agents) {
    if (a.relationships instanceof Map) pruneDeadRelationships(a, aliveIds);
    sanitizeDeadMemory(a, aliveIds);
    if (!a.role) a.role = roleFromTraits(a);
    if (typeof a.roleAssignedCycle !== 'number') a.roleAssignedCycle = 0;
    // Autonomous intelligence (save v3) — every agent must carry a brain + lexicon.
    ensureBrain(a);
    ensureLexicon(a);
  }

  // 6. Hidden Council must not watch the dead
  world.hiddenCouncil.watchedAgentIds = world.hiddenCouncil.watchedAgentIds.filter((id) =>
    aliveIds.has(id),
  );

  // 7. economy + ecology are derived — recompute them fresh from the now-consistent state
  world.economy = recalculateEconomy(world);
  if (!world.ecology) world.ecology = emptyEcology();
  world.ecology = computeEcology(world);

  return world;
}

/** Non-destructive scan. Returns every inconsistency; `ok` iff none. */
export function validateWorldState(world: WorldState, fromVersion = 0): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (kind: ValidationIssue['kind'], detail: string, count: number) => {
    if (count > 0) issues.push({ kind, detail, count });
  };

  const aliveIds = new Set<number>();
  for (const a of world.agents ?? []) if (a.alive) aliveIds.add(a.id);
  const tribeById = new Map((world.tribes ?? []).map((t) => [t.id, t]));
  const cityById = new Map((world.cities ?? []).map((c) => [c.id, c]));

  // agents → tribes / cities
  let missTribe = 0;
  let missCity = 0;
  const tribeCount = new Map<number, number>();
  const cityCount = new Map<number, number>();
  for (const a of world.agents ?? []) {
    if (!a.alive) continue;
    if (a.tribeId !== null) {
      if (!tribeById.has(a.tribeId)) missTribe += 1;
      else tribeCount.set(a.tribeId, (tribeCount.get(a.tribeId) ?? 0) + 1);
    }
    if (a.cityId !== null) {
      if (!cityById.has(a.cityId)) missCity += 1;
      else cityCount.set(a.cityId, (cityCount.get(a.cityId) ?? 0) + 1);
    }
  }
  add('agent_missing_tribe', 'living agents reference a non-existent tribe', missTribe);
  add('agent_missing_city', 'living agents reference a non-existent city', missCity);

  // tribe member lists vs actual members
  let tribeMismatch = 0;
  let deadTribeLeaders = 0;
  for (const t of world.tribes ?? []) {
    const actual = tribeCount.get(t.id) ?? 0;
    const listed = new Set(t.memberIds ?? []);
    let listedAlive = 0;
    for (const id of listed) if (aliveIds.has(id)) listedAlive += 1;
    if (actual !== listedAlive || (t.population ?? 0) !== actual) tribeMismatch += 1;
    if (t.leaderId !== null && !aliveIds.has(t.leaderId)) deadTribeLeaders += 1;
  }
  add('tribe_member_mismatch', 'tribes whose member list/population != actual members', tribeMismatch);

  // city population vs residents
  let cityMismatch = 0;
  let deadCityLeaders = 0;
  for (const c of world.cities ?? []) {
    const actual = cityCount.get(c.id) ?? 0;
    if ((c.population ?? 0) !== actual) cityMismatch += 1;
    if (c.leaderId !== null && !aliveIds.has(c.leaderId)) deadCityLeaders += 1;
  }
  add('city_population_mismatch', 'cities whose population != actual residents', cityMismatch);
  add('dead_leader', 'tribes/cities led by a dead/missing agent', deadTribeLeaders + deadCityLeaders);

  // dead references + missing roles
  let deadRel = 0;
  let deadMem = 0;
  let missingRole = 0;
  for (const a of world.agents ?? []) {
    if (a.relationships instanceof Map) {
      for (const id of a.relationships.keys()) if (!aliveIds.has(id)) deadRel += 1;
    }
    for (const m of a.memory ?? []) if (m.otherId !== null && !aliveIds.has(m.otherId)) deadMem += 1;
    if (a.alive && !a.role) missingRole += 1;
  }
  add('dead_relationship_target', 'relationships pointing to dead/missing agents', deadRel);
  add('dead_memory_target', 'memories referencing dead/missing agents', deadMem);
  add('missing_role', 'living agents without an assigned role', missingRole);

  // hidden council
  const hc = world.hiddenCouncil;
  if (!hc) {
    add('missing_council_field', 'hiddenCouncil object is missing', 1);
  } else {
    let deadWatched = 0;
    for (const id of hc.watchedAgentIds ?? []) if (!aliveIds.has(id)) deadWatched += 1;
    add('dead_watched_agent', 'Hidden Council watches dead/missing agents', deadWatched);
    if (!Array.isArray(hc.secretLog)) add('missing_council_field', 'council secretLog missing', 1);
  }

  // stale economy: compare cached vs fresh
  if (world.economy) {
    const fresh = recalculateEconomy(world);
    let drift = 0;
    if (Math.abs(fresh.totalEnergy - world.economy.totalEnergy) > 1) drift += 1;
    if (fresh.starvationCount !== world.economy.starvationCount) drift += 1;
    if (
      world.economy.richestId !== -1 &&
      !aliveIds.has(world.economy.richestId)
    )
      drift += 1;
    add('stale_economy', 'cached economy disagrees with a fresh recompute', drift);
  } else {
    add('stale_economy', 'economy object is missing', 1);
  }

  // arrays / counters / energy sources
  if (!Array.isArray(world.chronicle)) add('missing_chronicle', 'chronicle array missing', 1);
  if (!Array.isArray(world.history)) add('missing_history', 'history array missing', 1);
  if (!world.ecology) add('missing_ecology', 'ecology metrics object missing', 1);
  let badCounters = 0;
  for (const k of ['totalBirths', 'totalDeaths', 'totalConflicts', 'totalProtests', 'totalRevolutions'] as const) {
    const v = world[k];
    if (typeof v !== 'number' || v < 0 || !Number.isFinite(v)) badCounters += 1;
  }
  add('impossible_counter', 'world counters are negative/NaN', badCounters);
  let brokenSrc = 0;
  for (const e of world.energySources ?? []) {
    if (!Number.isFinite(e.amount) || !Number.isFinite(e.capacity) || e.capacity <= 0 || e.amount < 0)
      brokenSrc += 1;
  }
  add('broken_energy_source', 'energy sources with broken amount/capacity', brokenSrc);

  // W1.2 — implausible treasury: a tribe whose shared pool dwarfs its plausible carrying
  // capacity (cap = base + per-capita) signals the unbounded-growth bug has reappeared.
  let implausible = 0;
  for (const t of world.tribes ?? []) {
    const cap = TRIBE.sharedEnergyBaseCap + TRIBE.sharedEnergyPerCapita * (t.population ?? 0);
    if (!Number.isFinite(t.sharedEnergy) || t.sharedEnergy > cap * 4) implausible += 1;
  }
  add('implausible_treasury', 'tribes whose sharedEnergy far exceeds its plausible cap', implausible);

  return { ok: issues.length === 0, fromVersion, issues };
}

/**
 * Phase 2 dev aid: the membership-only subset of `validateWorldState`, formatted as warning
 * strings. The Engine runs this throttled, in dev mode only, so a desync is caught the moment
 * it appears instead of silently corrupting a long run.
 */
export function checkMembershipConsistency(world: WorldState): string[] {
  const membershipKinds = new Set<ValidationIssue['kind']>([
    'agent_missing_tribe',
    'agent_missing_city',
    'tribe_member_mismatch',
    'city_population_mismatch',
    'dead_leader',
  ]);
  return validateWorldState(world).issues
    .filter((i) => membershipKinds.has(i.kind))
    .map((i) => `${i.kind}: ${i.detail} (${i.count})`);
}
