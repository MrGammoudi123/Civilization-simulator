import { RNG } from './rng';
import { SIM, TRIBE, WORLD_PARAMS } from './config';
import { createAgent, createChild } from './agent';
import { createEnergySource, regenEnergy } from './energy';
import { SpatialGrid } from './spatialGrid';
import { updateAgent } from './decisions';
import { updateTribes } from './tribes';
import { updateCities } from './cities';
import { updateRevolutions } from './revolution';
import { computeEconomy, emptyEconomy } from './economy';
import { emptyEcology, updateEcology } from './ecology';
import { assignRoles } from './roles';
import { updateCultures } from './culture';
import { recordGenesis, updateChronicle } from './chronicle';
import { createCouncil, updateHiddenCouncil } from './hiddenCouncil';
import { adjust, ensureRel, pruneDeadRelationships } from './relationships';
import { sanitizeDeadMemory } from './memory';
import { checkMembershipConsistency } from './validation';
import { devWarn, isDev } from './dev';
import type { Agent, BackgroundNode, CultureMemory, EnergySource, Tribe, WorldParams, WorldState } from './types';

export const DEFAULT_PARAMS = WORLD_PARAMS;

const SUBSTRATE_NODE_COUNT = 180;

/**
 * Build a fresh world from a seed. Deterministic: same seed + params => identical world.
 * Generation order (substrate → energy → agents) is fixed so the RNG stream is stable.
 */
export function generateWorld(seed: number, params: WorldParams = WORLD_PARAMS): WorldState {
  const rng = new RNG(seed);

  const backgroundNodes: BackgroundNode[] = [];
  for (let i = 0; i < SUBSTRATE_NODE_COUNT; i++) {
    backgroundNodes.push({
      x: rng.range(0, params.width),
      y: rng.range(0, params.height),
      r: rng.range(0.4, 2.2),
      intensity: rng.range(0.04, 0.22),
    });
  }

  const energySources: EnergySource[] = [];
  for (let i = 0; i < SIM.initialEnergySources; i++) {
    energySources.push(createEnergySource(i, rng, params));
  }

  const agents: Agent[] = [];
  for (let i = 0; i < SIM.initialAgents; i++) {
    agents.push(createAgent(i, rng, params));
  }

  const world: WorldState = {
    seed,
    cycle: 0,
    params,
    rngState: rng.getState(),
    backgroundNodes,
    agents,
    energySources,
    nextAgentId: SIM.initialAgents,
    nextEnergyId: SIM.initialEnergySources,
    totalBirths: 0,
    totalDeaths: 0,
    conversationLog: [],
    nextMessageId: 0,
    tribes: [],
    nextTribeId: 0,
    archivedTribes: [],
    cities: [],
    nextCityId: 0,
    ruins: [],
    nextRuinId: 0,
    era: 'Genesis',
    economy: emptyEconomy(),
    ecology: emptyEcology(),
    conflictPulses: [],
    totalConflicts: 0,
    totalRevolutions: 0,
    totalProtests: 0,
    chronicle: [],
    nextEventId: 0,
    milestones: [],
    history: [],
    hiddenCouncil: createCouncil(),
    // Autonomous intelligence (save v3) — empty at genesis; populated by W7/W8.
    discoveries: [],
    cultures: [],
    nextDiscoveryId: 0,
    nextSymbolSeq: 0,
  };
  recordGenesis(world);
  return world;
}

// Reusable scratch buffer for neighbor queries (avoids per-call allocation).
const neighborScratch: number[] = [];
// Reusable id->agent index, rebuilt each tick (lets decisions resolve target ids cheaply).
const byId = new Map<number, Agent>();
// Reusable id->tribe index, rebuilt each tick (lets decisions check tribe relations/war).
const tribesById = new Map<number, Tribe>();
// Reusable tribeId->culture index, rebuilt each tick (W11 — O(1) culture lookup in decisions).
const cultureByTribe = new Map<number, CultureMemory>();

/**
 * Advance the world by a single tick:
 *   1. Regenerate energy and occasionally spawn replacement sources.
 *   2. Rebuild the spatial grid + id index from agent positions.
 *   3. Update every agent (decisions, interactions, movement, death) — see decisions.ts.
 *   4. Resolve reproduction (with a parent↔child bond).
 *   5. Remove the dead.
 */
export function stepWorld(world: WorldState, rng: RNG, grid: SpatialGrid): void {
  world.cycle += 1;
  const { agents, energySources, params } = world;

  // 1. energy field
  for (let i = 0; i < energySources.length; i++) regenEnergy(energySources[i], rng);
  if (energySources.length < SIM.targetEnergySources && rng.chance(SIM.energySpawnChance)) {
    energySources.push(createEnergySource(world.nextEnergyId++, rng, params));
  }

  // 2. spatial index + id index (payload = index into the live agents array, stable this tick)
  grid.clear();
  byId.clear();
  for (let i = 0; i < agents.length; i++) {
    grid.insert(i, agents[i].x, agents[i].y);
    byId.set(agents[i].id, agents[i]);
  }
  tribesById.clear();
  for (let i = 0; i < world.tribes.length; i++) tribesById.set(world.tribes[i].id, world.tribes[i]);
  cultureByTribe.clear();
  if (world.cultures) for (const c of world.cultures) if (!c.archived) cultureByTribe.set(c.tribeId, c);

  // 3 + 4. update + reproduction
  const births: Agent[] = [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive) continue;
    updateAgent(a, world, grid, byId, tribesById, cultureByTribe, rng);
    if (a.alive && canReproduce(a, agents.length + births.length, world, grid, rng)) {
      a.energy -= SIM.reproduceCost;
      a.reproduceCooldown = SIM.reproduceCooldown;
      a.state = 'reproducing';
      const child = createChild(world.nextAgentId++, a, rng);
      bondFamily(a, child, world.cycle);
      births.push(child);
      world.totalBirths += 1;
    }
  }
  for (let i = 0; i < births.length; i++) agents.push(births[i]);

  // 5. cull the dead
  let removed = 0;
  for (let i = agents.length - 1; i >= 0; i--) {
    if (!agents[i].alive) {
      agents.splice(i, 1);
      removed += 1;
    }
  }
  world.totalDeaths += removed;

  // 6. tribe + city + economy dynamics (periodic; rebuild the grid over the now-compact,
  //    all-alive array first)
  if (world.cycle % TRIBE.interval === 0) {
    grid.clear();
    for (let i = 0; i < agents.length; i++) grid.insert(i, agents[i].x, agents[i].y);
    updateTribes(world, grid, rng);
    updateCities(world, rng);
    updateRevolutions(world, rng);
    world.economy = computeEconomy(world);
    updateEcology(world, rng);
    assignRoles(world);
    if (SIM.enableCulture) updateCultures(world);
    updateHiddenCouncil(world, rng);
    updateChronicle(world);
    if (world.conflictPulses.length > 0) {
      world.conflictPulses = world.conflictPulses.filter((p) => p.until > world.cycle);
    }

    // Phase 14: periodic dead-reference cleanup so a million-cycle run never re-accumulates
    // the relationship/memory leak the original suffered (49% dead targets in the save).
    // Throttled (every ~300 cycles); O(agents × cap), trivial at that cadence.
    if (world.cycle % (TRIBE.interval * 10) === 0) {
      const aliveIds = new Set<number>();
      for (const a of agents) if (a.alive) aliveIds.add(a.id);
      for (const a of agents) {
        pruneDeadRelationships(a, aliveIds);
        sanitizeDeadMemory(a, aliveIds);
      }
    }

    // Phase 2: in dev, periodically assert membership consistency (agent tribeId/cityId is
    // the source of truth). Throttled so it costs nothing on the hot path / in production.
    if (isDev() && world.cycle % (TRIBE.interval * 20) === 0) {
      const warnings = checkMembershipConsistency(world);
      for (const w of warnings) devWarn(`cycle ${world.cycle}: ${w}`);
    }
  }
}

/** Parent and child begin with a strong mutual bond — the seed of kinship/tribes. */
function bondFamily(parent: Agent, child: Agent, cycle: number): void {
  const cr = ensureRel(child, parent.id, cycle);
  adjust(cr, 'trust', 0.5);
  adjust(cr, 'friendship', 0.45);
  adjust(cr, 'loyalty', 0.4);
  const pr = ensureRel(parent, child.id, cycle);
  adjust(pr, 'trust', 0.4);
  adjust(pr, 'friendship', 0.45);
  adjust(pr, 'loyalty', 0.35);
}

function canReproduce(
  a: Agent,
  currentPop: number,
  world: WorldState,
  grid: SpatialGrid,
  rng: RNG,
): boolean {
  if (currentPop >= SIM.maxAgents) return false;
  if (a.energy < SIM.reproduceEnergy) return false;
  if (a.reproduceCooldown > 0) return false;
  if (a.age < SIM.maturityAge) return false;
  if (!rng.chance(SIM.reproduceChance)) return false;

  // local crowding gate
  grid.queryRadius(a.x, a.y, SIM.reproduceLocalRadius, neighborScratch);
  let count = 0;
  for (let i = 0; i < neighborScratch.length; i++) {
    const o = world.agents[neighborScratch[i]];
    if (o === a || !o.alive) continue;
    if (Math.hypot(a.x - o.x, a.y - o.y) <= SIM.reproduceLocalRadius) {
      count += 1;
      if (count > SIM.reproduceLocalLimit) return false;
    }
  }
  return true;
}
