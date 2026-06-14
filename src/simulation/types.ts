// Shared simulation types. Kept framework-agnostic (no React / DOM imports) so the
// engine can run in a Web Worker or during headless offline evolution later.

export const SPEED_OPTIONS = [1, 2, 5, 10, 50] as const;
export type SpeedMultiplier = (typeof SPEED_OPTIONS)[number];

export interface WorldParams {
  width: number;
  height: number;
}

/**
 * A faint background "substrate" node — purely visual. Generated deterministically from
 * the seed so the same seed always yields the same backdrop.
 */
export interface BackgroundNode {
  x: number;
  y: number;
  r: number;
  intensity: number;
}

/** Personality traits, each in [0, 1]. Drive decisions and are inherited with mutation. */
export interface PersonalityTraits {
  curiosity: number;
  aggression: number;
  empathy: number;
  fear: number;
  greed: number;
  loyalty: number;
  intelligence: number;
  socialNeed: number;
  independence: number;
  ambition: number;
}

/**
 * Full behavioral state set from the spec. Stages implement a growing subset:
 *   Stage 2: wandering, searching_energy, resting, reproducing, dying
 *   Stage 3: + fleeing, helping, following_leader, attacking
 * The remainder (communicating, trading, forming_group, defending, building, protesting,
 * rebelling, worshipping, investigating_reality) are filled by later stages.
 */
export type AgentState =
  | 'wandering'
  | 'searching_energy'
  | 'resting'
  | 'communicating'
  | 'helping'
  | 'trading'
  | 'following_leader'
  | 'forming_group'
  | 'defending'
  | 'attacking'
  | 'fleeing'
  | 'reproducing'
  | 'building'
  | 'protesting'
  | 'rebelling'
  | 'worshipping'
  | 'investigating_reality'
  // Phase 5 — role-driven active states (so agents diversify beyond searching_energy)
  | 'scouting'
  | 'guarding'
  | 'teaching'
  | 'healing'
  | 'governing'
  | 'migrating'
  | 'farming'
  | 'archiving_history'
  | 'organizing_protest'
  | 'debating'
  | 'repairing'
  | 'dying';

/**
 * Agent vocation (Phase 5). Assigned from traits + context and re-evaluated as the world
 * changes, so a stable city produces builders/traders/guards/historians/healers rather than
 * a uniform mass of energy-seekers. Drives decisions, messages, and which active state an
 * agent enters when it is not in immediate survival danger.
 */
export type AgentRole =
  | 'gatherer'
  | 'scout'
  | 'trader'
  | 'builder'
  | 'guard'
  | 'healer'
  | 'historian'
  | 'rebel'
  | 'leader'
  | 'priest'
  | 'prophet'
  | 'thief'
  | 'farmer'
  | 'explorer'
  | 'investigator'
  | 'refugee';

/** Kinds of episodic events an agent can remember. Phase 11 adds positive/cultural kinds so
 *  memory is no longer dominated by theft + death. */
export type MemoryKind =
  | 'helped_by'
  | 'helped'
  | 'stolen_from'
  | 'attacked_by'
  | 'found_energy'
  | 'witnessed_death'
  // Phase 11 — cooperation, culture, and political/council memory
  | 'traded_with'
  | 'taught_by'
  | 'learned_from'
  | 'protected_by'
  | 'healed_by'
  | 'built_with'
  | 'followed_leader'
  | 'betrayed_by'
  | 'shared_energy'
  | 'joined_tribe'
  | 'left_tribe'
  | 'migrated'
  | 'witnessed_reform'
  | 'witnessed_revolution'
  | 'witnessed_miracle'
  | 'suspected_council'
  | 'discovered_anomaly'
  | 'mourned_dead'
  | 'celebrated_survival';

export interface MemoryEvent {
  cycle: number;
  kind: MemoryKind;
  otherId: number | null; // other agent involved, if any
  x: number | null; // location, if relevant (e.g. found_energy)
  y: number | null;
  strength: number; // 0..1 emotional weight; decays over time
}

/**
 * A directed relationship: how *this* agent feels about another. Each dimension is in
 * [0, 1]. Built up through interactions and decayed slowly toward neutral.
 */
export interface Relationship {
  trust: number;
  fear: number;
  friendship: number;
  rivalry: number;
  resentment: number;
  attraction: number;
  loyalty: number;
  interactions: number;
  lastCycle: number;
}

export interface Agent {
  id: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  maxEnergy: number;
  age: number; // in cycles
  lifespan: number; // age at which old-age death occurs
  generation: number;
  tribeId: number | null;
  cityId: number | null;
  state: AgentState;
  role: AgentRole; // Phase 5 — vocation; re-evaluated periodically from traits + context
  roleAssignedCycle: number; // when the role was last (re)assigned, for drift hysteresis
  traits: PersonalityTraits;
  targetEnergyId: number | null;
  targetAgentId: number | null; // current social/flee target
  reproduceCooldown: number;
  relationships: Map<number, Relationship>; // keyed by other agent id
  memory: MemoryEvent[];
  speakCooldown: number; // counts down in decision intervals
  bubble: SpeechBubble | null;
  alive: boolean;
}

/** Message categories from the spec. Some are sparse until their systems exist (trade →
 *  Stage 6 economy; council_rumor → Stage 11). */
export type MessageCategory =
  | 'survival'
  | 'fear'
  | 'friendship'
  | 'bonding'
  | 'trade'
  | 'leadership'
  | 'conflict'
  | 'revolution'
  | 'suspicion'
  | 'discovery'
  | 'myth'
  | 'council_rumor'
  // Phase 12 — richer civic / cultural / emotional categories
  | 'city_life'
  | 'protest'
  | 'reform'
  | 'cult'
  | 'investigation'
  | 'migration'
  | 'grief'
  | 'gratitude'
  | 'betrayal'
  | 'building'
  | 'history';

export type MessageTone = 'neutral' | 'happy' | 'afraid' | 'angry' | 'sad' | 'hopeful' | 'curious';

export interface ConversationMessage {
  id: number;
  cycle: number;
  speakerId: number;
  speakerName: string;
  recipientId: number | null;
  recipientName: string | null;
  text: string;
  tone: MessageTone;
  category: MessageCategory;
  x: number;
  y: number;
  tribeId: number | null;
}

/** Transient speech shown above an agent until `until` (a cycle number). */
export interface SpeechBubble {
  text: string;
  tone: MessageTone;
  until: number;
}

/** Live detail view of a selected agent, for the Agent Inspector. */
export interface AgentDetail {
  id: number;
  name: string;
  age: number;
  generation: number;
  energy: number;
  maxEnergy: number;
  state: AgentState;
  role: AgentRole; // Phase 13 — vocation in the inspector
  tribeName: string | null;
  traits: PersonalityTraits;
  lastMessage: string | null;
  memories: number;
  relationships: number;
  x: number;
  y: number;
}

export type EnergyKind =
  | 'common'
  | 'rare'
  | 'unstable'
  | 'hidden'
  | 'renewable' // regenerates strongly, never collapses — the stable backbone of the ecology
  | 'deep' // huge capacity, slow regen, appears far out during deep scarcity
  | 'sacred'; // steady, often near settlements; cults may form around it

export interface EnergySource {
  id: number;
  x: number;
  y: number;
  amount: number;
  capacity: number;
  regen: number;
  radius: number;
  kind: EnergyKind;
  discovered: boolean;
}

/**
 * World-level resource ecology (Phase 4). Tracks the natural energy field as a living system
 * so scarcity becomes *cyclical* (collapse → recovery) instead of a permanent starvation
 * floor. The recovery driver spawns distant renewable/deep sources when scarcity persists.
 */
export interface EcologyMetrics {
  totalNaturalEnergy: number; // Σ source.amount
  totalCapacity: number; // Σ source.capacity
  renewableEnergyRate: number; // sustainable inflow (regen of non-collapsing sources)
  depletionRate: number; // natural energy lost since the previous sample (≥0)
  scarcityIndex: number; // 0 (abundant) .. 1 (exhausted)
  collapseRisk: number; // 0..1 risk the field collapses to a starvation floor
  recoveryPressure: number; // 0..1 builds under sustained scarcity; triggers recovery blooms
  lastRecoveryCycle: number; // cycle of the last recovery bloom
}

export type TribeIdeology =
  | 'cooperative'
  | 'authoritarian'
  | 'spiritual'
  | 'trader'
  | 'militaristic'
  | 'isolationist'
  | 'revolutionary'
  | 'expansionist';

/** How one tribe regards another. */
export interface TribeRelation {
  standing: number; // -1 (war) .. 1 (alliance)
  war: boolean;
}

export interface TribeEvent {
  cycle: number;
  text: string;
}

export interface Tribe {
  id: number;
  name: string;
  color: [number, number, number];
  leaderId: number | null;
  memberIds: number[];
  population: number;
  peakPopulation: number; // high-water mark, for collapse epitaphs + history
  cx: number; // territory center
  cy: number;
  radius: number; // territory radius
  sharedEnergy: number;
  stability: number; // 0..1
  ideology: TribeIdeology;
  aggressionLevel: number; // 0..1
  inequalityLevel: number; // 0..1
  foundedCycle: number;
  history: TribeEvent[];
  relations: Map<number, TribeRelation>; // keyed by other tribe id
}

/**
 * A collapsed tribe's epitaph. When a tribe falls apart we do not silently discard it
 * (Phase 2 "archive it as collapsed"); we keep a compact record so the Chronicle, successor
 * tribes, and cultural memory (Phase 6) can refer to the fallen.
 */
export interface ArchivedTribe {
  id: number;
  name: string;
  ideology: TribeIdeology;
  foundedCycle: number;
  collapseCycle: number;
  peakPopulation: number;
  lastLeaderName: string | null;
}

export type BuildingType =
  | 'council_hall'
  | 'energy_storage'
  | 'market'
  | 'defense_wall'
  | 'temple'
  | 'prison'
  | 'memory_archive'
  | 'hidden_node';

export interface CityBuilding {
  type: BuildingType;
  dx: number; // offset from city center
  dy: number;
  level: number;
  damaged: boolean;
}

export type ConflictPulseKind = 'fight' | 'revolution' | 'repression' | 'council';

/** A transient on-map effect (combat flash, uprising, crackdown). Expires by `until`. */
export interface ConflictPulse {
  x: number;
  y: number;
  born: number;
  until: number;
  kind: ConflictPulseKind;
}

/** A city's political phase in the escalation ladder (Phase 7). */
export type PoliticsPhase =
  | 'stable'
  | 'grievance'
  | 'movement'
  | 'riot'
  | 'repression'
  | 'reform';

/**
 * Per-city political state (Phase 7). Drives the escalation ladder
 * discontent → protest → movement → riot → repression/reform → revolution, with cumulative
 * pressure + cooldowns + aftermath so revolutions actually fire and don't spam.
 */
export interface CityPolitics {
  phase: PoliticsPhase;
  legitimacy: number; // 0..1 — ruler's standing; low legitimacy fuels unrest
  protestPressure: number; // 0..1 — builds with unrest, decays in calm
  revolutionaryPressure: number; // 0..1 — builds at riot phase; triggers revolt/civil war
  repressionLevel: number; // 0..1 — recent crackdown intensity
  reformPressure: number; // 0..1 — appetite for peaceful reform
  repressionCount: number; // crackdowns within the current window
  lastProtestCycle: number;
  lastRevolutionCycle: number;
  lastReformCycle: number;
  cooldownUntil: number; // no new escalation event before this cycle
}

export interface City {
  id: number;
  tribeId: number;
  name: string;
  x: number;
  y: number;
  population: number;
  storedEnergy: number;
  taxRate: number;
  classElite: number;
  classMiddle: number;
  classPoor: number;
  inequality: number; // 0..1 among residents
  unrest: number; // 0..1
  buildings: CityBuilding[];
  leaderId: number | null;
  foundedCycle: number;
  history: TribeEvent[];
  politics: CityPolitics; // Phase 7
}

/**
 * A fallen city, remembered on the map (Phase 6). Successor settlements can rebuild on ruins
 * and inherit a fragment of the old culture (ideology, founding name).
 */
export interface CityRuin {
  id: number;
  name: string;
  x: number;
  y: number;
  fallCycle: number;
  peakPopulation: number;
  ideology: TribeIdeology;
  lastLeaderName: string | null;
  rebuiltCount: number; // how many times a city has risen on this site
}

/** Compact, serializable view of a city for the UI. */
export interface CitySummary {
  id: number;
  name: string;
  color: [number, number, number];
  population: number;
  storedEnergy: number;
  taxRate: number;
  classElite: number;
  classMiddle: number;
  classPoor: number;
  inequality: number;
  unrest: number;
  ideology: TribeIdeology;
  leaderName: string | null;
  buildings: BuildingType[];
  x: number;
  y: number;
}

/** World-level economic snapshot. */
export interface EconomyStats {
  totalEnergy: number; // agents + city treasuries + tribe pools
  avgEnergy: number;
  medianEnergy: number; // median of living-agent energies
  minEnergy: number; // lowest living-agent energy
  maxEnergy: number; // highest living-agent energy
  inequalityIndex: number; // Gini over agent energies, 0..1
  richestId: number;
  richestEnergy: number;
  poorestId: number;
  poorestEnergy: number;
  starvationCount: number;
  unrestLevel: number; // 0..1
  rebellionRisk: number; // 0..1
}

/**
 * Result of `validateWorldState` — a diagnostic, non-destructive report of every
 * inconsistency found in a (loaded) world. `ok` is true only when `issues` is empty.
 * Used after load (dev warnings), by the headless harness, and surfaced in the UI.
 */
export interface ValidationIssue {
  kind:
    | 'agent_missing_tribe'
    | 'agent_missing_city'
    | 'tribe_member_mismatch'
    | 'city_population_mismatch'
    | 'dead_relationship_target'
    | 'dead_memory_target'
    | 'dead_watched_agent'
    | 'dead_leader'
    | 'stale_economy'
    | 'missing_chronicle'
    | 'missing_history'
    | 'missing_council_field'
    | 'missing_role'
    | 'impossible_counter'
    | 'broken_energy_source'
    | 'missing_ecology';
  detail: string;
  count: number;
}

export interface ValidationReport {
  ok: boolean;
  fromVersion: number;
  issues: ValidationIssue[];
}

export type ChronicleCategory =
  | 'genesis'
  | 'survival'
  | 'social'
  | 'economy'
  | 'politics'
  | 'conflict'
  | 'revolution'
  | 'collapse'
  | 'hidden_council'
  | 'discovery'
  // Phase 8 — culture + era-summary events
  | 'culture'
  | 'era';

export interface ChronicleEvent {
  id: number;
  cycle: number;
  category: ChronicleCategory;
  severity: number; // 1 (minor) .. 5 (epochal)
  title: string;
  description: string;
  agentIds: number[];
  tribeId: number | null;
  cityId: number | null;
}

export type CouncilInterventionKind =
  | 'spawn_energy'
  | 'create_scarcity'
  | 'protect_leader'
  | 'corrupt_agent'
  | 'plant_rumor'
  | 'create_prophet'
  | 'system_glitch'
  | 'secret_agent'
  | 'suppress_memory'
  // Phase 10 — director-style interventions with real, varied effects
  | 'spawn_hidden_energy'
  | 'silence_investigator'
  | 'amplify_cult'
  | 'frame_rebel'
  | 'cause_false_miracle'
  | 'seed_discovery_clue';

export interface CouncilLogEntry {
  cycle: number;
  kind: CouncilInterventionKind;
  text: string;
}

export interface HiddenCouncilState {
  enabled: boolean;
  revealed: boolean; // agents know the council exists (God Mode reveal)
  manipulation: number; // 0..1 cumulative intervention intensity
  discoveryRisk: number; // 0..1 probability agents suspect they are simulated
  interventions: number;
  lastKind: CouncilInterventionKind | null;
  nextKind: CouncilInterventionKind | null;
  secretLog: CouncilLogEntry[];
  watchedAgentIds: number[];
}

export interface HiddenCouncilSummary {
  enabled: boolean;
  revealed: boolean;
  manipulation: number;
  discoveryRisk: number;
  interventions: number;
  lastKind: CouncilInterventionKind | null;
  nextKind: CouncilInterventionKind | null;
  secretLog: CouncilLogEntry[];
  watched: number;
}

export type GodActionType =
  | 'add_energy'
  | 'remove_energy'
  | 'spawn_agent'
  | 'smite'
  | 'spawn_prophet'
  | 'trigger_scarcity'
  | 'trigger_war'
  | 'trigger_peace'
  | 'reveal_council'
  | 'glitch'
  | 'miracle';

/** A periodic sample of world metrics, for the Evolution Viewer graphs. Phase 9 widens this
 *  to cover the politics, ecology, and Hidden Council systems. Older 8-field samples still
 *  load (missing fields read as undefined and are tolerated by the viewer). */
export interface HistorySample {
  cycle: number;
  population: number;
  avgEnergy: number;
  inequality: number;
  tribes: number;
  cities: number;
  conflicts: number; // cumulative
  deaths: number; // cumulative
  // Phase 9 additions
  births: number; // cumulative
  protests: number; // cumulative
  revolutions: number; // cumulative
  naturalEnergy: number; // total energy in the field at sample time
  scarcityIndex: number; // 0..1
  discoveryRisk: number; // 0..1 Hidden Council
  manipulation: number; // 0..1 Hidden Council
  dominantIdeology: TribeIdeology | null;
  eraLabel: string;
}

/** Compact, serializable view of a tribe for the UI. */
export interface TribeSummary {
  id: number;
  name: string;
  color: [number, number, number];
  population: number;
  leaderName: string | null;
  ideology: TribeIdeology;
  stability: number;
  aggressionLevel: number;
  inequalityLevel: number;
  sharedEnergy: number;
  cx: number;
  cy: number;
  radius: number;
  atWarWith: string[]; // names of tribes this one is at war with
}

/**
 * The full simulation state — everything needed to reproduce / save the world. Future
 * stages extend this (tribes, cities, economy, conversations, chronicle, council…).
 */
export interface WorldState {
  seed: number;
  cycle: number;
  params: WorldParams;
  /** Serialized RNG state so the random stream resumes deterministically after load. */
  rngState: number;
  backgroundNodes: BackgroundNode[];
  agents: Agent[];
  energySources: EnergySource[];
  nextAgentId: number;
  nextEnergyId: number;
  totalBirths: number;
  totalDeaths: number;
  conversationLog: ConversationMessage[]; // capped ring buffer
  nextMessageId: number;
  tribes: Tribe[];
  nextTribeId: number;
  /** Epitaphs of tribes that have collapsed (Phase 2 — archived, never silently discarded). */
  archivedTribes: ArchivedTribe[];
  cities: City[];
  nextCityId: number;
  /** Fallen cities remembered on the map; successors can rebuild on them (Phase 6). */
  ruins: CityRuin[];
  nextRuinId: number;
  /** Current civilization-cycle era label (Phase 6/8/9), e.g. "Golden Age", "Dark Age". */
  era: string;
  economy: EconomyStats;
  /** Resource-ecology metrics (Phase 4) — drives cyclical scarcity/recovery. */
  ecology: EcologyMetrics;
  conflictPulses: ConflictPulse[];
  totalConflicts: number;
  totalRevolutions: number;
  totalProtests: number;
  chronicle: ChronicleEvent[];
  nextEventId: number;
  milestones: string[]; // fired first-of-kind milestone keys
  history: HistorySample[];
  hiddenCouncil: HiddenCouncilState;
}

/**
 * A lightweight, throttled view of engine state for the React UI (~12 Hz). The UI never
 * reads the live mutable WorldState on every tick.
 */
export interface EngineSnapshot {
  seed: number;
  cycle: number;
  running: boolean;
  speed: SpeedMultiplier;
  tps: number; // effective ticks/sec actually executed
  fps: number; // smoothed render fps
  population: number;
  births: number;
  deaths: number;
  avgEnergy: number;
  maxGeneration: number;
  energySources: number;
  socialBonds: number; // directed relationships with strong friendship
  rivalries: number; // directed relationships with strong rivalry/resentment
  messageCount: number; // total messages ever spoken
  tribeCount: number;
  tribes: TribeSummary[];
  inequalityIndex: number;
  starvationCount: number;
  unrestLevel: number;
  rebellionRisk: number;
  cityCount: number;
  cities: CitySummary[];
  protesters: number;
  fighters: number;
  totalConflicts: number;
  totalRevolutions: number;
  eventCount: number;
  dirty: boolean; // unsaved changes since last save
  council: HiddenCouncilSummary;
  // Phase 13 — World Health + Civilization Cycle panels
  totalProtests: number;
  totalBirths: number;
  naturalEnergy: number;
  scarcityIndex: number;
  discoveryRisk: number;
  health: number; // 0..1 composite world-health index
  civPhase: string; // current civilization-cycle phase label
  era: string;
  ruinsCount: number;
  roleCounts: Record<string, number>; // living agents by role
}
