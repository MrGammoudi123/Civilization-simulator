import { RNG, randomSeed } from './rng';
import { DEFAULT_PARAMS, generateWorld, stepWorld } from './world';
import { SIM } from './config';
import { SpatialGrid } from './spatialGrid';
import { applyGodAction } from './godMode';
import { setDevMode } from './dev';
import { roleDistribution } from './roles';
import type { AgentDetail, GodActionType } from './types';
import type {
  ChronicleEvent,
  CitySummary,
  ConversationMessage,
  CultureMemory,
  EngineSnapshot,
  HistorySample,
  SpeedMultiplier,
  Tribe,
  TribeSummary,
  WorldParams,
  WorldState,
} from './types';

/** Ticks per second at speed ×1. Speed multipliers scale this, not the simulation physics. */
const BASE_TPS = 8;

type FrameCb = (world: WorldState, alpha: number) => void;
type SnapshotCb = (snap: EngineSnapshot) => void;

/**
 * The simulation engine. Owns the authoritative WorldState and drives a fixed-timestep
 * logic loop decoupled from rendering:
 *
 *  - A single requestAnimationFrame loop accumulates real elapsed time and runs as many
 *    discrete ticks as the current speed calls for (with a per-frame cap to avoid the
 *    "spiral of death" after a tab is backgrounded).
 *  - Rendering subscribers (`onFrame`) are called every animation frame.
 *  - UI subscribers (`subscribe`) receive a throttled lightweight snapshot (~12 Hz), so
 *    React never re-renders on the hot path.
 *
 * This separation is what lets the sim scale to hundreds/thousands of agents later.
 */
export class Engine {
  private world: WorldState;
  private rng: RNG;
  private grid: SpatialGrid;

  private running = false;
  private speed: SpeedMultiplier = 1;
  private dirty = true; // unsaved changes since the last save
  private selectedId: number | null = null; // followed/inspected agent

  private rafId: number | null = null;
  private lastTime = 0;
  private acc = 0; // fractional tick accumulator

  private frameCbs = new Set<FrameCb>();
  private snapshotCbs = new Set<SnapshotCb>();

  // --- metrics ---
  private lastEmit = 0;
  private fps = 0;
  private fpsSamples: number[] = [];
  private ticksThisWindow = 0;
  private tpsWindowStart = 0;
  private effectiveTps = 0;

  constructor(seed: number = randomSeed(), params: WorldParams = DEFAULT_PARAMS) {
    // Surface simulation-core dev warnings (membership desync, etc.) only in a dev build.
    setDevMode(Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV));
    this.world = generateWorld(seed, params);
    this.rng = new RNG(this.world.rngState);
    this.grid = new SpatialGrid(params.width, params.height, SIM.spatialCellSize);
  }

  // ---------------------------------------------------------------- world access
  getWorld(): WorldState {
    return this.world;
  }

  /** Recent conversation messages (tail of the capped log) for the Conversations panel. */
  getRecentMessages(limit = 200): ConversationMessage[] {
    const log = this.world.conversationLog;
    return log.length <= limit ? log.slice() : log.slice(log.length - limit);
  }

  /** Compact tribe summaries for the UI (Tribe Inspector + Conversations tribe filter). */
  getTribesSummary(): TribeSummary[] {
    return this.buildTribeSummaries();
  }

  /** Compact city summaries for the City Inspector. */
  getCitiesSummary(): CitySummary[] {
    return this.buildCitySummaries();
  }

  /** Recent chronicle events (tail of the capped log) for the Chronicle panel. */
  getChronicle(limit = 400): ChronicleEvent[] {
    const c = this.world.chronicle;
    return c.length <= limit ? c.slice() : c.slice(c.length - limit);
  }

  /** Metric history samples for the Evolution Viewer. */
  getHistory(): HistorySample[] {
    return this.world.history.slice();
  }

  private buildCouncilSummary() {
    const c = this.world.hiddenCouncil;
    return {
      enabled: c.enabled,
      revealed: c.revealed,
      manipulation: c.manipulation,
      discoveryRisk: c.discoveryRisk,
      interventions: c.interventions,
      lastKind: c.lastKind,
      nextKind: c.nextKind,
      secretLog: c.secretLog.slice(-12),
      watched: c.watchedAgentIds.length,
    };
  }

  private buildCitySummaries(): CitySummary[] {
    const cities = this.world.cities;
    if (cities.length === 0) return [];
    const tribeById = new Map<number, Tribe>();
    for (const t of this.world.tribes) tribeById.set(t.id, t);
    const names = new Map<number, string>();
    for (const a of this.world.agents) names.set(a.id, a.name);
    return cities.map((c) => {
      const tribe = tribeById.get(c.tribeId);
      return {
        id: c.id,
        name: c.name,
        color: tribe ? tribe.color : [200, 200, 210],
        population: c.population,
        storedEnergy: c.storedEnergy,
        taxRate: c.taxRate,
        classElite: c.classElite,
        classMiddle: c.classMiddle,
        classPoor: c.classPoor,
        inequality: c.inequality,
        unrest: c.unrest,
        ideology: tribe ? tribe.ideology : 'cooperative',
        leaderName: c.leaderId !== null ? (names.get(c.leaderId) ?? null) : null,
        buildings: c.buildings.map((b) => b.type),
        x: c.x,
        y: c.y,
      };
    });
  }

  private buildTribeSummaries(): TribeSummary[] {
    const tribes = this.world.tribes;
    if (tribes.length === 0) return [];
    const names = new Map<number, string>();
    for (const a of this.world.agents) names.set(a.id, a.name);
    const tribeNames = new Map<number, string>();
    for (const t of tribes) tribeNames.set(t.id, t.name);
    const cultureByTribe = new Map<number, CultureMemory>();
    for (const c of this.world.cultures ?? []) if (!c.archived) cultureByTribe.set(c.tribeId, c);
    return tribes.map((t) => {
      const atWarWith: string[] = [];
      for (const [otherId, rel] of t.relations) {
        const other = tribeNames.get(otherId);
        if (rel.war && other) atWarWith.push(other);
      }
      const culture = cultureByTribe.get(t.id);
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        population: t.population,
        leaderName: t.leaderId !== null ? (names.get(t.leaderId) ?? null) : null,
        ideology: t.ideology,
        stability: t.stability,
        aggressionLevel: t.aggressionLevel,
        inequalityLevel: t.inequalityLevel,
        sharedEnergy: t.sharedEnergy,
        cx: t.cx,
        cy: t.cy,
        radius: t.radius,
        atWarWith,
        // W10 — emergent culture / dialect / technology
        techLevel: culture ? culture.techLevel : 0,
        cultureNorms: culture ? culture.norms.map((n) => n.subject) : [],
        cultureTaboos: culture ? culture.taboos.map((tb) => tb.subject) : [],
        cultureMyths: culture ? culture.myths.map((m) => m.theme) : [],
        dialect: culture ? culture.lexicon.slice(0, 6).map((tk) => tk.token) : [],
      };
    });
  }

  // ---------------------------------------------------------------- subscriptions
  /** Render callback, invoked every animation frame. Returns an unsubscribe fn. */
  onFrame(cb: FrameCb): () => void {
    this.frameCbs.add(cb);
    return () => {
      this.frameCbs.delete(cb);
    };
  }

  /** UI snapshot callback (throttled). Fires once immediately with current state. */
  subscribe(cb: SnapshotCb): () => void {
    this.snapshotCbs.add(cb);
    cb(this.snapshot());
    return () => {
      this.snapshotCbs.delete(cb);
    };
  }

  snapshot(): EngineSnapshot {
    const agents = this.world.agents;
    let totalEnergy = 0;
    let maxGeneration = 1;
    let socialBonds = 0;
    let rivalries = 0;
    let protesters = 0;
    let fighters = 0;
    // W10 — autonomous-intelligence metrics
    let investigators = 0;
    let rewardSum = 0;
    let brainCount = 0;
    const words = new Set<string>();
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      totalEnergy += a.energy;
      if (a.generation > maxGeneration) maxGeneration = a.generation;
      if (a.state === 'protesting') protesters += 1;
      else if (a.state === 'attacking') fighters += 1;
      if (a.role === 'investigator') investigators += 1;
      if (a.brain) {
        rewardSum += a.brain.lastReward;
        brainCount += 1;
      }
      if (a.lexicon) for (const tk of a.lexicon.tokens) words.add(tk.token);
      for (const r of a.relationships.values()) {
        if (r.friendship > 0.4) socialBonds += 1;
        if (r.rivalry > 0.6 || r.resentment > 0.6) rivalries += 1;
      }
    }
    let cultureCount = 0;
    let techLevel = 0;
    for (const c of this.world.cultures ?? []) {
      cultureCount += c.norms.length + c.laws.length + c.taboos.length + c.myths.length;
      if (c.techLevel > techLevel) techLevel = c.techLevel;
    }
    const population = agents.length;
    const eco = this.world.ecology;
    const avgEnergy = population > 0 ? totalEnergy / population : 0;
    // composite 0..1 world-health: population vitality × energy security × (1 − scarcity)
    const health =
      population === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              Math.min(1, population / 200) * 0.4 +
                Math.min(1, avgEnergy / 60) * 0.3 +
                (1 - (eco ? eco.scarcityIndex : 0.5)) * 0.3,
            ),
          );
    return {
      seed: this.world.seed,
      cycle: this.world.cycle,
      running: this.running,
      speed: this.speed,
      tps: this.effectiveTps,
      fps: this.fps,
      population,
      births: this.world.totalBirths,
      deaths: this.world.totalDeaths,
      avgEnergy,
      maxGeneration,
      energySources: this.world.energySources.length,
      socialBonds,
      rivalries,
      messageCount: this.world.nextMessageId,
      tribeCount: this.world.tribes.length,
      tribes: this.buildTribeSummaries(),
      inequalityIndex: this.world.economy.inequalityIndex,
      starvationCount: this.world.economy.starvationCount,
      unrestLevel: this.world.economy.unrestLevel,
      rebellionRisk: this.world.economy.rebellionRisk,
      cityCount: this.world.cities.length,
      cities: this.buildCitySummaries(),
      protesters,
      fighters,
      totalConflicts: this.world.totalConflicts,
      totalRevolutions: this.world.totalRevolutions,
      eventCount: this.world.chronicle.length,
      dirty: this.dirty,
      council: this.buildCouncilSummary(),
      // Phase 13 — World Health + Civilization Cycle
      totalProtests: this.world.totalProtests,
      totalBirths: this.world.totalBirths,
      naturalEnergy: eco ? eco.totalNaturalEnergy : 0,
      scarcityIndex: eco ? eco.scarcityIndex : 0,
      discoveryRisk: this.world.hiddenCouncil.discoveryRisk,
      health,
      civPhase: this.world.era,
      era: this.world.era,
      ruinsCount: this.world.ruins.length,
      roleCounts: roleDistribution(this.world),
      // W10 — autonomous-intelligence metrics
      languageDiversity: words.size,
      discoveryCount: Array.isArray(this.world.discoveries) ? this.world.discoveries.length : 0,
      cultureCount,
      investigatorPct: population > 0 ? investigators / population : 0,
      avgLearningReward: brainCount > 0 ? rewardSum / brainCount : 0,
      techLevel,
    };
  }

  // ---------------------------------------------------------------- controls
  start(): void {
    this.running = true;
    this.emit();
  }

  pause(): void {
    this.running = false;
    this.effectiveTps = 0;
    this.emit();
  }

  resume(): void {
    this.running = true;
    this.emit();
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.resume();
  }

  setSpeed(speed: SpeedMultiplier): void {
    this.speed = speed;
    this.acc = 0;
    this.emit();
  }

  /** Run exactly one tick (intended for use while paused). */
  step(): void {
    this.tick();
    this.emit();
  }

  /** Rebuild the world from the SAME seed (deterministic reset). */
  reset(): void {
    this.loadWorld(generateWorld(this.world.seed, this.world.params));
    this.dirty = true;
    this.emit();
  }

  /** Start a fresh civilization from a new seed (random unless one is supplied). */
  newWorld(seed: number = randomSeed()): void {
    this.loadWorld(generateWorld(seed, this.world.params));
    this.dirty = true;
    this.emit();
  }

  /** Replace the world with a deserialized save (paused, and marked as already saved). */
  loadSerialized(world: WorldState): void {
    this.loadWorld(world);
    this.dirty = false;
    this.emit();
  }

  /** Clear the unsaved-changes flag (called after a successful save). */
  markSaved(): void {
    this.dirty = false;
    this.emit();
  }

  /** Enable/disable the Hidden Council. */
  setCouncilEnabled(on: boolean): void {
    this.world.hiddenCouncil.enabled = on;
    this.dirty = true;
    this.emit();
  }

  /** Apply a God Mode intervention (mutates the world, logs to the chronicle). */
  godAction(action: GodActionType): void {
    applyGodAction(this.world, action, this.rng);
    this.world.rngState = this.rng.getState();
    this.dirty = true;
    this.emit();
  }

  // ---------------------------------------------------------------- selection
  /** Select the nearest living agent to a world point (deselects if none in range). */
  selectAgentAt(wx: number, wy: number, maxDist = 40): void {
    let best: number | null = null;
    let bestD = maxDist;
    for (const a of this.world.agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - wx, a.y - wy);
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    this.selectedId = best;
    this.emit();
  }

  getSelectedId(): number | null {
    return this.selectedId;
  }

  clearSelection(): void {
    this.selectedId = null;
    this.emit();
  }

  getSelectedAgent(): AgentDetail | null {
    if (this.selectedId === null) return null;
    const a = this.world.agents.find((x) => x.id === this.selectedId && x.alive);
    if (!a) {
      this.selectedId = null;
      return null;
    }
    let tribeName: string | null = null;
    if (a.tribeId !== null) {
      const t = this.world.tribes.find((x) => x.id === a.tribeId);
      tribeName = t ? t.name : null;
    }

    // W10 — autonomous-intelligence detail
    let dialectWord: string | null = null;
    if (a.lexicon && a.lexicon.tokens.length > 0) {
      let best = a.lexicon.tokens[0];
      for (const tk of a.lexicon.tokens) if (tk.confidence * tk.uses > best.confidence * best.uses) best = tk;
      dialectWord = best.token;
    }
    let suspicion = 0;
    for (const m of a.memory) if (m.kind === 'suspected_council' || m.kind === 'discovered_anomaly') suspicion += 1;
    let lastExperiment: string | null = null;
    if (a.brain && a.brain.experimentProgress) {
      let bestK: string | null = null;
      let bestV = 0;
      for (const k in a.brain.experimentProgress) {
        const v = a.brain.experimentProgress[k];
        if (v > bestV) {
          bestV = v;
          bestK = k;
        }
      }
      lastExperiment = bestK;
    }
    let topCulture: string | null = null;
    if (a.tribeId !== null) {
      const c = (this.world.cultures ?? []).find((x) => x.tribeId === a.tribeId && !x.archived);
      if (c) {
        const el = [...c.norms.map((n) => n.subject), ...c.myths.map((m) => `myth:${m.theme}`), ...c.taboos.map((t) => `taboo:${t.subject}`)];
        topCulture = el[0] ?? null;
      }
    }

    return {
      id: a.id,
      name: a.name,
      age: a.age,
      generation: a.generation,
      energy: a.energy,
      maxEnergy: a.maxEnergy,
      state: a.state,
      role: a.role,
      tribeName,
      traits: a.traits,
      lastMessage: a.bubble ? a.bubble.text : null,
      memories: a.memory.length,
      relationships: a.relationships.size,
      x: a.x,
      y: a.y,
      lastReward: a.brain ? a.brain.lastReward : 0,
      knownSymbols: a.lexicon ? a.lexicon.tokens.length : 0,
      dialectWord,
      suspicionEvidence: suspicion,
      topCulture,
      lastExperiment,
    };
  }

  private loadWorld(world: WorldState): void {
    this.world = world;
    this.rng = new RNG(world.rngState);
    this.grid = new SpatialGrid(world.params.width, world.params.height, SIM.spatialCellSize);
    this.running = false;
    this.acc = 0;
    this.effectiveTps = 0;
    this.ticksThisWindow = 0;
    this.emit();
  }

  // ---------------------------------------------------------------- tick
  private tick(): void {
    stepWorld(this.world, this.rng, this.grid);
    // Keep the serialized RNG state on the world current, so a save at any moment
    // captures the exact random stream position.
    this.world.rngState = this.rng.getState();
    this.ticksThisWindow += 1;
    this.dirty = true;
  }

  // ---------------------------------------------------------------- RAF loop
  startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private loop = (now: number): void => {
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.tpsWindowStart = now;
      this.lastEmit = now;
    }

    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25; // clamp large gaps (e.g. returning to a backgrounded tab)

    // smoothed fps
    const instFps = dt > 0 ? 1 / dt : 0;
    this.fpsSamples.push(instFps);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    this.fps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;

    if (this.running) {
      const targetTps = BASE_TPS * this.speed;
      this.acc += dt * targetTps;
      let ticks = Math.floor(this.acc);
      const maxTicksPerFrame = Math.max(60, targetTps);
      if (ticks > maxTicksPerFrame) {
        ticks = maxTicksPerFrame;
        this.acc = 0; // drop backlog rather than freeze
      } else {
        this.acc -= ticks;
      }
      for (let i = 0; i < ticks; i++) this.tick();
    }

    // measure effective tps over ~1s windows
    if (now - this.tpsWindowStart >= 1000) {
      this.effectiveTps = Math.round((this.ticksThisWindow * 1000) / (now - this.tpsWindowStart));
      this.ticksThisWindow = 0;
      this.tpsWindowStart = now;
    }

    // render (alpha = fractional progress toward the next tick, for future interpolation)
    const alpha = Math.min(1, this.acc);
    for (const cb of this.frameCbs) cb(this.world, alpha);

    // throttled UI snapshot (~12 Hz)
    if (now - this.lastEmit >= 80) {
      this.lastEmit = now;
      this.emit();
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.snapshotCbs) cb(snap);
  }
}
