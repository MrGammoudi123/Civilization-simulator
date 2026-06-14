import type { WorldParams } from './types';

export const WORLD_PARAMS: WorldParams = { width: 1600, height: 1000 };

/**
 * Central tunables for the simulation. Kept in one place so balancing is a single-file
 * concern. Values are chosen to produce a self-sustaining population (~150–250) with
 * emergent boom/bust dynamics rather than instant extinction or runaway growth.
 */
export const SIM = {
  // population
  initialAgents: 90,
  maxAgents: 700, // hard performance ceiling

  // energy field
  initialEnergySources: 64,
  targetEnergySources: 64,
  energySpawnChance: 0.03, // per tick, only while below target

  // agent energy
  agentMaxEnergy: 100,
  startEnergyMin: 45,
  startEnergyMax: 75,
  metabolism: 0.035, // base drain / tick
  moveCost: 0.01, // extra drain per unit speed / tick

  // movement
  maxSpeed: 1.5,
  accel: 0.25,
  wanderJitter: 0.5,

  // perception / harvest
  perceptionRadius: 200,
  harvestRadius: 15,
  harvestRate: 1.8, // energy / tick while feeding
  lowEnergyFrac: 0.55, // below -> seek energy
  fullEnergyFrac: 0.92, // above -> rest

  // lifespan
  lifespanBase: 5200,
  lifespanVar: 2000,

  // reproduction
  maturityAge: 200,
  reproduceEnergy: 80,
  reproduceCost: 46, // energy transferred to the child
  reproduceChance: 0.02, // per eligible tick
  reproduceCooldown: 360,
  reproduceLocalRadius: 64,
  reproduceLocalLimit: 5, // max neighbors within radius to allow a birth

  // genetics
  mutationRate: 0.07,

  // spatial index
  spatialCellSize: 80,
} as const;

/** Tribe formation / dynamics tunables. */
export const TRIBE = {
  interval: 30, // tribe update runs every N ticks
  minMembers: 3, // tribe disbands below this
  formMembers: 4, // bonded tribeless agents needed to found a tribe
  formRadius: 95,
  recruitRadius: 110,
  recruitPull: 2, // bonded members nearby needed to be recruited
  bondSentiment: 0.3, // sentiment threshold to count as "bonded"
  mergeStanding: 0.6, // allied tribes above this can merge
  mergeMaxPop: 64, // only merge if combined population stays manageable
  splitStabilityMax: 0.3, // unstable below this can split
  splitMinPop: 12, // only large tribes split
  titheFrac: 0.08, // surplus fraction contributed to the shared pool per update
  feedFrac: 0.35, // starving members are fed up to this energy fraction from the pool
  historyCap: 24,
} as const;

/** City formation / economy tunables. */
export const CITY = {
  minPop: 8, // a tribe needs at least this many members to urbanize
  minStability: 0.4, // ...and this stability, unless it is old enough
  ageBypass: 1500, // a long-lived tribe can urbanize at lower stability
  minSharedEnergy: 20, // ...and a treasury to seed the city
  disbandPop: 6, // city disbands below this (hysteresis vs minPop)
  subsistence: 30, // energy above which a resident is taxed
  collectFrac: 0.12, // fraction of taxable surplus collected per update
  payoutFrac: 0.15, // fraction of treasury paid out per update
  starveThreshold: 18, // energy below which an agent counts as starving
  econInterval: 30, // economy + city update cadence (aligned with tribes)
  historyCap: 24,
} as const;

/** Conflict (combat) tunables. */
export const CONFLICT = {
  attackAggression: 0.55, // min aggression to attack rather than flee
  hostileThreshold: 0.4, // rivalry+resentment over which a neighbor is "hostile"
  attackRange: 18,
  baseDamage: 4,
  aggressionDamage: 6,
  retaliation: 3,
  pulseCap: 160,
  pulseTicks: 70,
} as const;

/** Hidden Council tunables. */
export const COUNCIL = {
  interval: 120, // cycles between interventions (when enabled)
  logCap: 30,
  watchCap: 6,
  manipPerAct: 0.06,
  manipDecay: 0.004,
  // Phase 10 — director-style behavior
  watchTarget: 6, // desired number of live watched agents
  failedSuppressRisk: 0.05, // discoveryRisk added when a suppression finds nothing
  suspicion25: 0.25, // discovery-risk milestones with escalating social consequences
  suspicion50: 0.5,
  suspicion75: 0.75,
  suspicion90: 0.9,
} as const;

/** Resource-ecology tunables (Phase 4). Drives cyclical scarcity → recovery. */
export const ECOLOGY = {
  scarcityHigh: 0.8, // scarcityIndex above which recovery pressure builds
  pressureGain: 0.06, // recoveryPressure gained per econ interval under high scarcity
  pressureDecay: 0.03, // recoveryPressure shed per interval when not scarce
  bloomPressure: 0.6, // recoveryPressure at/above which a recovery bloom can fire
  bloomCooldown: 2500, // min cycles between recovery blooms
  bloomSources: 2, // sources created per bloom (emergency relief, kept small)
  maxSources: 70, // only +6 over the base 64 — relief, not a carrying-capacity glut
  collapseFloor: 0.06, // natural-energy fill fraction below which collapseRisk maxes out
} as const;

/** Chronicle + history-sampling tunables. */
export const CHRONICLE = {
  eventCap: 2000, // ring-buffer cap on recorded events
  historyCap: 1500, // ring-buffer cap on metric samples (sampled every TRIBE.interval)
  // Phase 8 — anti-spam + era summaries
  collapseThrottle: 600, // min cycles between same-category 'collapse' chronicle entries
  eraSummaryInterval: 25000, // emit an era-summary event every N cycles
  minorSeverity: 2, // events at/below this severity are subject to throttling near cap
} as const;

/** Revolution / protest / repression tunables. */
export const REVOLUTION = {
  protestUnrest: 0.45, // city unrest over which protests appear
  revoltUnrest: 0.6, // ...and over which revolution can fire (with a rebel)
  rebelScoreMin: 0.55, // a charismatic-rebel score must exceed this
  maxProtesters: 8,
  redistributeFrac: 0.6, // treasury fraction seized + redistributed on revolution
  eliteSkim: 0.2, // fraction taken from each elite on revolution
  repressDamage: 10,
  pulseTicks: 90,
} as const;

/** Politics escalation ladder (Phase 7). discontent → protest → movement → riot → outcome. */
export const POLITICS = {
  grievanceUnrest: 0.3, // unrest at which discontent (grievance) begins
  movementUnrest: 0.45, // ...organized movement
  riotUnrest: 0.6, // ...riot, where an outcome resolves
  rebelScoreMin: 0.42, // lower than the old one-shot gate, so rebels emerge under real strain
  pressureGain: 0.12, // protest/revolutionary pressure gained per interval above threshold
  pressureDecay: 0.05, // ...shed per interval in calm
  revoltPressure: 0.6, // revolutionaryPressure at/above which revolt/civil war fires
  reformPressure: 0.55, // reformPressure at/above which a peaceful reform fires
  cooldown: 240, // cycles of aftermath calm after any escalation event
  repressionsBeforeReform: 3, // repeated crackdowns force a reform (or revolution if rigid)
  repressionWindow: 1200, // window over which crackdowns are counted
  unrestDecay: 0.985, // slow per-interval unrest relaxation once founded a while
} as const;

/** Civilization-cycle tunables (Phase 6): collapse → ruins → refugees → rebuilding. */
export const CIV = {
  ruinsCap: 60, // max remembered ruins
  refugeeShare: 0.5, // fraction of a fallen city's residents that become refugees (vs scatter)
  successorMinRefugees: 6, // refugees needed near a ruin to found a successor tribe
  rebuildBonusCycles: 600, // a successor founded soon after collapse inherits culture
  goldenAgeUnrest: 0.25, // unrest below this (with growth) = golden age
  goldenAgeEnergyFrac: 0.45, // ...and field fill above this
  darkAgeScarcity: 0.85, // scarcity above this (with decline) = dark age
} as const;
