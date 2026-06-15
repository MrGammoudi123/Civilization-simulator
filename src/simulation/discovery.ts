import { SIM } from './config';
import { recordEvent } from './chronicle';
import type { Agent, Discovery, WorldState } from './types';

/**
 * Autonomous experimentation & technology discovery (W7). The developer writes the *hidden
 * physics* — recipes of world materials that, probed enough, yield a technique — but agents never
 * see the recipes. An agent discovers by repeatedly choosing to `experiment` where the right
 * materials happen to be present; once its accumulated effort crosses a recipe threshold, a
 * Discovery is made, grounded in its tribe, with a BOUNDED effect on the world (energy never
 * becomes infinite). Discoveries are lost when a tribe collapses unless the tribe kept an archive.
 *
 * Different worlds discover different things in different orders, because *which* materials an
 * agent experiments near is itself emergent (where tribes settle, what the council hides, etc.).
 *
 * Deterministic: materials are sensed from world state, progress is integer accumulation, and the
 * discovery id uses a world counter — no RNG, so discovery never perturbs the simulation stream.
 */

interface Recipe {
  id: string;
  materials: string[]; // ALL must be sensed near the experimenter
  threshold: number; // experiment "efforts" needed
  kind: Discovery['kind'];
  label: string; // human label for the chronicle (never shown to agents)
}

// Hidden recipe table — the laws of the world, not agent knowledge.
const RECIPES: Recipe[] = [
  { id: 'energy_harvest', materials: ['light', 'structure'], threshold: 8, kind: 'energy', label: 'Energy Harvesting' },
  { id: 'deep_extract', materials: ['deep_node', 'structure'], threshold: 10, kind: 'energy', label: 'Deep Extraction' },
  { id: 'regen_gardens', materials: ['light', 'city_storage'], threshold: 12, kind: 'building', label: 'Regeneration Gardens' },
  { id: 'storage_discipline', materials: ['city_storage', 'structure'], threshold: 10, kind: 'storage', label: 'Storage Discipline' },
  { id: 'healing_ritual', materials: ['sacred'], threshold: 8, kind: 'medicine', label: 'Healing Ritual' },
  { id: 'anomaly_tracking', materials: ['anomaly'], threshold: 6, kind: 'council_anomaly', label: 'Anomaly Tracking' },
  { id: 'archive_learning', materials: ['ruins', 'archive'], threshold: 8, kind: 'social', label: 'Archive Learning' },
];

const MAX_REGEN = 1.3; // hard cap on per-source regen (energy is never infinite)
const MAX_DISCOVERIES = 300; // W11 — bound the registry over million-cycle runs (oldest dropped)

/** Sense which hidden materials are present near an agent (from real world state). */
function senseMaterials(a: Agent, world: WorldState): Set<string> {
  const mats = new Set<string>();
  const sources = world.energySources;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    // sense the material by PROXITY, not current fill — a drained source is still, physically, a
    // light/heat/deep/sacred source to experiment on (and the technique then helps it refill).
    if (Math.hypot(a.x - s.x, a.y - s.y) > SIM.perceptionRadius) continue;
    if (s.kind === 'common' || s.kind === 'renewable') mats.add('light');
    else if (s.kind === 'unstable') mats.add('heat');
    else if (s.kind === 'deep') mats.add('deep_node');
    else if (s.kind === 'sacred') mats.add('sacred');
  }
  if (a.cityId !== null) {
    mats.add('structure');
    const city = world.cities.find((c) => c.id === a.cityId);
    if (city) {
      if (city.buildings.some((b) => b.type === 'energy_storage')) mats.add('city_storage');
      if (city.buildings.some((b) => b.type === 'memory_archive')) mats.add('archive');
    }
  } else if (a.tribeId !== null) {
    mats.add('structure'); // a tribe's gathering place is rudimentary structure
  }
  for (const r of world.ruins) {
    if (Math.hypot(a.x - r.x, a.y - r.y) < 120) {
      mats.add('ruins');
      break;
    }
  }
  for (const m of a.memory) {
    if (m.kind === 'suspected_council' || m.kind === 'discovered_anomaly') {
      mats.add('anomaly');
      break;
    }
  }
  return mats;
}

/** Does the agent's tribe keep an archive (a memory_archive building)? Archived tech survives collapse. */
function tribeHasArchive(world: WorldState, tribeId: number | null): boolean {
  if (tribeId === null) return false;
  return world.cities.some((c) => c.tribeId === tribeId && c.buildings.some((b) => b.type === 'memory_archive'));
}

/** Apply a discovery's bounded effect to the world. Energy techniques speed regeneration (capped);
 *  storage/building techniques bolster the city treasury — never an infinite-energy loop. */
function applyEffect(a: Agent, world: WorldState, r: Recipe): void {
  if (r.kind === 'energy') {
    let boosted = 0;
    for (const s of world.energySources) {
      if (boosted >= 2) break;
      if (Math.hypot(a.x - s.x, a.y - s.y) > SIM.perceptionRadius) continue;
      s.regen = Math.min(s.regen + 0.15, MAX_REGEN); // faster refill, hard-capped
      boosted += 1;
    }
  } else if (r.kind === 'storage' || r.kind === 'building') {
    const city = a.cityId !== null ? world.cities.find((c) => c.id === a.cityId) : undefined;
    if (city) city.storedEnergy += 20;
  }
  // medicine / social / council_anomaly: non-ecological techniques (status, clues, cohesion) —
  // their value is cultural and is realized through W8 culture / W9 council, not raw energy.
}

function makeDiscovery(a: Agent, world: WorldState, r: Recipe): void {
  if (!Array.isArray(world.discoveries)) world.discoveries = [];
  const tribeId = a.tribeId;
  // already known by this tribe? deepen its spread instead of duplicating
  const existing = world.discoveries.find((d) => d.effect.kind === r.id && d.tribeId === tribeId);
  if (existing) {
    existing.spread = Math.min(1, existing.spread + 0.05);
    existing.confidence = Math.min(1, existing.confidence + 0.02);
    return;
  }
  const disc: Discovery = {
    id: `${r.id}#${world.nextDiscoveryId ?? 0}`,
    kind: r.kind,
    discoveredBy: a.id,
    tribeId,
    cycle: world.cycle,
    confidence: 0.5,
    effect: { kind: r.id, magnitude: 1, target: r.kind },
    spread: 0.1,
    archived: tribeHasArchive(world, tribeId),
  };
  world.nextDiscoveryId = (world.nextDiscoveryId ?? 0) + 1;
  world.discoveries.push(disc);
  if (world.discoveries.length > MAX_DISCOVERIES) world.discoveries.shift(); // W11 — bound the registry
  applyEffect(a, world, r);
  recordEvent(world, {
    category: 'discovery',
    severity: 3,
    title: `Discovery: ${r.label}`,
    description: `${a.name} worked out ${r.label} through repeated experiment.`,
    agentIds: [a.id],
    tribeId,
  });
}

/**
 * Called from the decision pass when an agent chooses to experiment/investigate. Accrues effort
 * toward any recipe whose materials are present, and fires a discovery at threshold. Cheap +
 * deterministic.
 */
export function attemptExperiment(a: Agent, world: WorldState): void {
  const br = a.brain;
  if (!br) return;
  const mats = senseMaterials(a, world);
  if (mats.size === 0) return;
  const prog = (br.experimentProgress ??= {});
  for (const r of RECIPES) {
    if (!r.materials.every((m) => mats.has(m))) continue;
    const p = (prog[r.id] ?? 0) + 1;
    if (p >= r.threshold) {
      prog[r.id] = 0;
      makeDiscovery(a, world, r);
    } else {
      prog[r.id] = p;
    }
  }
}

/** When a tribe collapses, its un-archived discoveries are forgotten (W7). Archived ones — held in
 *  a city's memory archive — survive, so successors can inherit the knowledge. */
export function loseDiscoveriesOnCollapse(world: WorldState, tribeId: number): void {
  if (!Array.isArray(world.discoveries)) return;
  world.discoveries = world.discoveries.filter((d) => d.tribeId !== tribeId || d.archived);
}

/** Count distinct discovered techniques (for the World Health panel / tests). */
export function discoveryCount(world: WorldState): number {
  return Array.isArray(world.discoveries) ? world.discoveries.length : 0;
}
