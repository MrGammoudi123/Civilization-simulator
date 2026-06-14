import { CHRONICLE, CIV } from './config';
import type { ChronicleCategory, TribeIdeology, WorldState } from './types';

/**
 * The historical chronicle: a fact-based, dramatic record of what actually happened.
 * Two sources feed it:
 *   1. Direct hooks from the simulation for notable, infrequent events (genesis, a city
 *      rising/falling, a revolution, a crackdown, a great tribe scattering) — these call
 *      `recordEvent` from cities.ts / revolution.ts / tribes.ts.
 *   2. `updateChronicle` (run each economy interval) which detects first-of-kind
 *      milestones and samples world metrics for the Evolution Viewer.
 * Kept dependency-light (imports only types/config) so the sim modules can import it
 * without cycles.
 */

interface EventInput {
  category: ChronicleCategory;
  severity: number;
  title: string;
  description: string;
  agentIds?: number[];
  tribeId?: number | null;
  cityId?: number | null;
}

export function recordEvent(world: WorldState, e: EventInput): void {
  // Phase 8 — collapse-spam throttle. Minor/medium collapse entries (a tribe scattering, a
  // small city abandoned) are deduped: skip if another collapse fired within the throttle
  // window. Major collapses (severity ≥ 4: a great city falls, extinction) always record.
  if (e.category === 'collapse' && e.severity <= 3) {
    const lo = Math.max(0, world.chronicle.length - 80);
    for (let i = world.chronicle.length - 1; i >= lo; i--) {
      if (world.chronicle[i].category === 'collapse') {
        if (world.cycle - world.chronicle[i].cycle < CHRONICLE.collapseThrottle) return;
        break;
      }
    }
  }
  world.chronicle.push({
    id: world.nextEventId++,
    cycle: world.cycle,
    category: e.category,
    severity: e.severity,
    title: e.title,
    description: e.description,
    agentIds: e.agentIds ?? [],
    tribeId: e.tribeId ?? null,
    cityId: e.cityId ?? null,
  });
  if (world.chronicle.length > CHRONICLE.eventCap) world.chronicle.shift();
}

/** Record the world's first moment. Called once from generateWorld. */
export function recordGenesis(world: WorldState): void {
  recordEvent(world, {
    category: 'genesis',
    severity: 5,
    title: 'Genesis',
    description: `${world.agents.length} beings flickered into existence from nothing.`,
  });
}

function fired(world: WorldState, key: string): boolean {
  return world.milestones.includes(key);
}

function fire(world: WorldState, key: string, e: EventInput): void {
  if (!fired(world, key)) {
    world.milestones.push(key);
    recordEvent(world, e);
  }
}

function anyFriendship(world: WorldState): boolean {
  for (const a of world.agents) {
    for (const r of a.relationships.values()) {
      if (r.friendship > 0.6) return true;
    }
  }
  return false;
}

function anyWar(world: WorldState): boolean {
  for (const t of world.tribes) {
    for (const rel of t.relations.values()) if (rel.war) return true;
  }
  return false;
}

function anyMarket(world: WorldState): boolean {
  for (const c of world.cities) {
    for (const b of c.buildings) if (b.type === 'market') return true;
  }
  return false;
}

/** The ideology of the most populous tribe (Phase 9), or null if there are no tribes. */
export function dominantIdeology(world: WorldState): TribeIdeology | null {
  let best: TribeIdeology | null = null;
  let bestPop = -1;
  for (const t of world.tribes) {
    if (t.population > bestPop) {
      bestPop = t.population;
      best = t.ideology;
    }
  }
  return best;
}

/**
 * Derive the civilization-cycle era label from world state (Phase 6/8/9). This is the
 * narrative phase shown in the UI and stamped onto history samples + era summaries.
 */
export function computeEra(world: WorldState): string {
  const pop = world.agents.filter((a) => a.alive).length;
  if (pop === 0) return 'Extinction';
  const ec = world.ecology;
  const fill = ec && ec.totalCapacity > 0 ? ec.totalNaturalEnergy / ec.totalCapacity : 0.5;
  let cityUnrest = 0;
  for (const c of world.cities) cityUnrest += c.unrest;
  cityUnrest = world.cities.length > 0 ? cityUnrest / world.cities.length : world.economy.unrestLevel;

  if (ec && ec.scarcityIndex > CIV.darkAgeScarcity) return 'Dark Age';
  if (
    world.cities.length > 0 &&
    cityUnrest < CIV.goldenAgeUnrest &&
    fill > CIV.goldenAgeEnergyFrac
  ) {
    return 'Golden Age';
  }
  if (world.totalRevolutions > 0 && cityUnrest > 0.5) return 'Age of Revolution';
  if (world.cities.length > 0) return 'City Age';
  if (world.tribes.length > 0) return 'Tribal Age';
  return 'Survival';
}

function sampleHistory(world: WorldState): void {
  world.history.push({
    cycle: world.cycle,
    population: world.agents.length,
    avgEnergy: world.economy.avgEnergy,
    inequality: world.economy.inequalityIndex,
    tribes: world.tribes.length,
    cities: world.cities.length,
    conflicts: world.totalConflicts,
    deaths: world.totalDeaths,
    // Phase 9 additions
    births: world.totalBirths,
    protests: world.totalProtests,
    revolutions: world.totalRevolutions,
    naturalEnergy: world.ecology ? world.ecology.totalNaturalEnergy : 0,
    scarcityIndex: world.ecology ? world.ecology.scarcityIndex : 0,
    discoveryRisk: world.hiddenCouncil ? world.hiddenCouncil.discoveryRisk : 0,
    manipulation: world.hiddenCouncil ? world.hiddenCouncil.manipulation : 0,
    dominantIdeology: dominantIdeology(world),
    eraLabel: world.era,
  });
  if (world.history.length > CHRONICLE.historyCap) world.history.shift();
}

/**
 * Phase 8 era summary: every CHRONICLE.eraSummaryInterval cycles, condense the period into a
 * single chronicle entry instead of leaving the late game empty between rare milestones.
 */
function maybeEraSummary(world: WorldState): void {
  if (world.cycle === 0 || world.cycle % CHRONICLE.eraSummaryInterval !== 0) return;
  const pop = world.agents.filter((a) => a.alive).length;
  const ideo = dominantIdeology(world);
  recordEvent(world, {
    category: 'era',
    severity: 3,
    title: `Era Summary — ${world.era}`,
    description:
      `By cycle ${world.cycle}: ${pop} live, ${world.tribes.length} tribes, ${world.cities.length} cities, ` +
      `${world.totalRevolutions} revolutions, ${world.totalProtests} protests; ` +
      `${ideo ?? 'no'} ideology dominant; scarcity ` +
      `${(world.ecology ? world.ecology.scarcityIndex * 100 : 0).toFixed(0)}%, ` +
      `council suspicion ${(world.hiddenCouncil ? world.hiddenCouncil.discoveryRisk * 100 : 0).toFixed(0)}%.`,
  });
}

/** Detect first-of-kind milestones and take a metric sample. Run each economy interval. */
export function updateChronicle(world: WorldState): void {
  if (world.nextMessageId > 0) {
    fire(world, 'firstComm', {
      category: 'social',
      severity: 2,
      title: 'First Words',
      description: 'A being spoke for the first time.',
    });
  }
  if (world.nextTribeId > 0) {
    fire(world, 'firstTribe', {
      category: 'social',
      severity: 3,
      title: 'First Tribe',
      description: 'Scattered beings gathered into the first tribe.',
    });
  }
  if (world.totalConflicts > 0) {
    fire(world, 'firstConflict', {
      category: 'conflict',
      severity: 3,
      title: 'First Blood',
      description: 'The first act of violence broke the peace.',
    });
  }
  if (world.totalProtests > 0) {
    fire(world, 'firstProtest', {
      category: 'revolution',
      severity: 2,
      title: 'First Protest',
      description: 'The discontented gathered and raised their voices.',
    });
  }
  if (world.economy.inequalityIndex > 0.5) {
    fire(world, 'firstInequalityCrisis', {
      category: 'economy',
      severity: 3,
      title: 'Inequality Crisis',
      description: 'Wealth concentrated sharply while many went hungry.',
    });
  }
  if (world.agents.length === 0) {
    fire(world, 'firstExtinction', {
      category: 'collapse',
      severity: 5,
      title: 'Extinction',
      description: 'The last being fell silent. The world is empty.',
    });
  }
  if (!fired(world, 'firstFriendship') && anyFriendship(world)) {
    fire(world, 'firstFriendship', {
      category: 'social',
      severity: 2,
      title: 'First Bond',
      description: 'Two beings formed the first true friendship.',
    });
  }
  if (!fired(world, 'firstWar') && anyWar(world)) {
    fire(world, 'firstWar', {
      category: 'conflict',
      severity: 3,
      title: 'First War',
      description: 'Two tribes declared open hostility.',
    });
  }
  if (!fired(world, 'firstMarket') && anyMarket(world)) {
    fire(world, 'firstMarket', {
      category: 'economy',
      severity: 2,
      title: 'First Market',
      description: 'Trade took root: the first market was raised.',
    });
  }
  if (world.nextCityId > 0) {
    fire(world, 'firstCity', {
      category: 'politics',
      severity: 4,
      title: 'The First City',
      description: 'A thriving tribe raised the first city.',
    });
  }
  if (world.totalBirths > 0) {
    fire(world, 'firstBirth', {
      category: 'social',
      severity: 2,
      title: 'First Birth',
      description: 'A new being was born into the world.',
    });
  }
  if (world.ruins.length > 0) {
    fire(world, 'firstRuins', {
      category: 'collapse',
      severity: 3,
      title: 'Ruins',
      description: 'The first city fell to ruins — its stones remember.',
    });
  }

  // Phase 6/8 — current era + periodic era summaries (keeps the late game from going silent).
  world.era = computeEra(world);
  maybeEraSummary(world);
  sampleHistory(world);
}
