// Headless validation: population dynamics, determinism, and (Stage 3) the causal link
// between interaction history and future behavior. Bundled with esbuild, run under Node.
import { generateWorld, stepWorld } from '../src/simulation/world';
import { RNG } from '../src/simulation/rng';
import { SpatialGrid } from '../src/simulation/spatialGrid';
import { SIM, WORLD_PARAMS, TRIBE, ECOLOGY } from '../src/simulation/config';
import { computeEcology } from '../src/simulation/ecology';
import { createAgent } from '../src/simulation/agent';
import { updateAgent, applyHelp, applySteal } from '../src/simulation/decisions';
import { emitSpeech } from '../src/simulation/communication';
import { ensureRel } from '../src/simulation/relationships';
import { gini, recalculateEconomy } from '../src/simulation/economy';
import { runCityEconomy } from '../src/simulation/cities';
import { updateRevolutions } from '../src/simulation/revolution';
import { chooseNormalLifeState, actionNoise } from '../src/simulation/actions';
import { learnFromOutcome, recordActionStart, imitate } from '../src/simulation/brain';
import { createChild } from '../src/simulation/agent';
import { computePerception, emptyPerceptionInputs } from '../src/simulation/perception';
import { speak, hearToken, wordFor } from '../src/simulation/language';
import { attemptExperiment, loseDiscoveriesOnCollapse, discoveryCount } from '../src/simulation/discovery';
import { updateCultures, cultureBias, tabooStrength, inheritCulture, cultureElementCount } from '../src/simulation/culture';
import { serializeWorld, deserializeWorld, validateWorldState, normalizeWorldState } from '../src/simulation/saveSystem';
import { planOffline, runOfflineEvolution } from '../src/simulation/offlineEvolution';
import { createCouncil, selectHiddenCouncilIntervention } from '../src/simulation/hiddenCouncil';
import { applyGodAction } from '../src/simulation/godMode';
import { Engine } from '../src/simulation/engine';
import type { City, Tribe, TribeIdeology, WorldState as WS } from '../src/simulation/types';
import type { Agent, WorldState } from '../src/simulation/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
    console.log('  PASS:', msg);
  } else {
    failed += 1;
    console.log('  FAIL:', msg);
  }
}

function makeRun(seed: number) {
  const world = generateWorld(seed);
  const rng = new RNG(world.rngState);
  const grid = new SpatialGrid(world.params.width, world.params.height, SIM.spatialCellSize);
  return {
    world,
    tick() {
      stepWorld(world, rng, grid);
      world.rngState = rng.getState();
    },
  };
}

function relStats(w: WorldState) {
  let rels = 0;
  let bonds = 0;
  let rivalrous = 0;
  let mem = 0;
  for (const a of w.agents) {
    rels += a.relationships.size;
    mem += a.memory.length;
    for (const r of a.relationships.values()) {
      if (r.friendship > 0.4) bonds += 1;
      if (r.rivalry > 0.6 || r.resentment > 0.6) rivalrous += 1;
    }
  }
  return { rels, bonds, rivalrous, avgMem: w.agents.length ? mem / w.agents.length : 0 };
}

function fingerprint(w: WorldState): string {
  let h = 0;
  let rels = 0;
  for (const a of w.agents) {
    h += a.x * 0.131 + a.y * 0.177 + a.energy * 0.7 + a.id * 3;
    rels += a.relationships.size;
  }
  return (
    `pop=${w.agents.length} rels=${rels} msgs=${w.nextMessageId} ` +
    `tribes=${w.tribes.length}/${w.nextTribeId} cities=${w.cities.length}/${w.nextCityId} ` +
    `gini=${w.economy.inequalityIndex.toFixed(3)} confl=${w.totalConflicts}/${w.totalRevolutions} ` +
    `events=${w.nextEventId} hist=${w.history.length} rng=${w.rngState} chk=${h.toFixed(2)}`
  );
}

// ---------------------------------------------------------------- trajectory
console.log('Trajectory (seed=0xc0ffee, 30000 ticks):');
console.log('  cycle   pop  births  deaths  tribes  cities  gini  unrest  confl  rev');
{
  const run = makeRun(0xc0ffee);
  let minPop = Infinity;
  let maxPop = 0;
  let maxTribes = 0;
  for (let t = 1; t <= 20000; t++) {
    run.tick();
    const p = run.world.agents.length;
    if (p < minPop) minPop = p;
    if (p > maxPop) maxPop = p;
    if (run.world.tribes.length > maxTribes) maxTribes = run.world.tribes.length;
    if (t % 5000 === 0) {
      const w = run.world;
      console.log(
        `  ${String(w.cycle).padStart(5)}  ${String(w.agents.length).padStart(4)}  ` +
          `${String(w.totalBirths).padStart(6)}  ${String(w.totalDeaths).padStart(6)}  ` +
          `${String(w.tribes.length).padStart(6)}  ${String(w.cities.length).padStart(6)}  ` +
          `${w.economy.inequalityIndex.toFixed(2).padStart(4)}  ` +
          `${(w.economy.unrestLevel * 100).toFixed(0).padStart(5)}%  ` +
          `${String(w.totalConflicts).padStart(5)}  ${String(w.totalRevolutions).padStart(3)}`,
      );
    }
    if (p === 0) {
      console.log(`  !! EXTINCTION at cycle ${run.world.cycle}`);
      break;
    }
  }
  const w = run.world;
  const rs = relStats(w);
  console.log(`  population range: [${minPop}, ${maxPop}]  avgMemory=${rs.avgMem.toFixed(1)}`);
  console.log(`  tribes alive=${w.tribes.length} peak=${maxTribes} founded=${w.nextTribeId}`);
  console.log(`  cities alive=${w.cities.length} founded=${w.nextCityId}`);
  console.log(`  conflicts=${w.totalConflicts} revolutions=${w.totalRevolutions}`);
  if (w.cities.length > 0) {
    const c = w.cities.slice().sort((a, b) => b.population - a.population)[0];
    console.log(
      `  city: "${c.name}" pop=${c.population} tax=${(c.taxRate * 100).toFixed(0)}% ` +
        `classes=${c.classElite}/${c.classMiddle}/${c.classPoor} ineq=${c.inequality.toFixed(2)} ` +
        `unrest=${c.unrest.toFixed(2)} buildings=${c.buildings.length}`,
    );
  }
  assert(w.agents.length > 0, 'population survives 20k ticks');
  assert(rs.bonds > 0, 'social bonds form over a run');
  assert(w.nextTribeId > w.tribes.length, 'tribe membership changes over time');
  assert(w.nextCityId > 0, 'at least one city emerges from a thriving tribe');
  assert(w.economy.inequalityIndex >= 0 && w.economy.inequalityIndex <= 1, 'inequality index is valid');
  assert(w.totalConflicts > 0, 'conflict reliably occurs (scarcity/inequality breeds fights)');
  if (w.cities.length > 0) {
    const c = w.cities[0];
    assert(c.buildings.length >= 2, 'cities have buildings');
    assert(c.population >= 6, 'cities hold a population');
  }

  const cats = new Set(w.chronicle.map((e) => e.category));
  console.log(
    `  chronicle: ${w.nextEventId} events, ${cats.size} categories; history: ${w.history.length} samples`,
  );
  console.log('  recent chronicle:');
  for (const e of w.chronicle.slice(-5)) {
    console.log(`    [${e.cycle}] ${e.title} — ${e.description}`);
  }
  assert(w.nextEventId > 0, 'chronicle auto-fills from real events');
  assert(
    w.chronicle.some((e) => e.category === 'genesis'),
    'genesis is recorded',
  );
  assert(cats.size >= 4, 'chronicle spans multiple categories');
  assert(w.history.length > 0, 'history samples accumulate for the Evolution Viewer');
  assert(
    w.milestones.includes('firstTribe') && w.milestones.includes('firstConflict'),
    'first-of-kind milestones fire (firstTribe, firstConflict)',
  );
}

// ---------------------------------------------------------------- economy: Gini + response
console.log('\nEconomy:');
{
  assert(gini([10, 10, 10, 10]) < 0.01, 'Gini of equal energies ≈ 0');
  assert(gini([0, 0, 0, 40]) > 0.6, 'Gini of concentrated energy is high');

  // Inequality responds to economic behavior: authoritarian concentrates, cooperative levels.
  const makeCity = (): City => ({
    id: 0,
    tribeId: 0,
    name: 'Test',
    x: 0,
    y: 0,
    population: 10,
    storedEnergy: 240,
    taxRate: 0.2,
    classElite: 0,
    classMiddle: 0,
    classPoor: 0,
    inequality: 0,
    unrest: 0,
    buildings: [],
    leaderId: 0,
    foundedCycle: 0,
    history: [],
  });
  const startEnergies = [85, 80, 72, 65, 58, 50, 44, 36, 28, 20];
  const buildMembers = () => {
    const r = new RNG(5);
    return startEnergies.map((e, i) => {
      const a = createAgent(i, r, WORLD_PARAMS);
      a.energy = e;
      return a;
    });
  };

  const authCity = makeCity();
  const authMembers = buildMembers();
  const coopCity = makeCity();
  const coopMembers = buildMembers();
  for (let s = 0; s < 40; s++) {
    runCityEconomy(authCity, authMembers, 'authoritarian');
    runCityEconomy(coopCity, coopMembers, 'cooperative');
  }
  const authGini = gini(authMembers.map((m) => m.energy));
  const coopGini = gini(coopMembers.map((m) => m.energy));
  console.log(`  authoritarian gini=${authGini.toFixed(3)}  cooperative gini=${coopGini.toFixed(3)}`);
  assert(authGini > coopGini, 'authoritarian economy yields more inequality than cooperative');
}

// ---------------------------------------------------------------- revolution
console.log('\nRevolution:');
{
  const makeRevWorld = (ideology: TribeIdeology) => {
    const rng = new RNG(77);
    const members: Agent[] = [];
    const energies = [90, 85, 80, 55, 45, 38, 30, 25, 20, 15];
    for (let i = 0; i < 10; i++) {
      const a = createAgent(i, rng, WORLD_PARAMS);
      a.tribeId = 0;
      a.cityId = 0;
      a.x = 800;
      a.y = 500;
      a.energy = energies[i];
      members.push(a);
    }
    const leader = members[0];
    const rebel = members[1];
    rebel.traits.ambition = 0.9;
    rebel.traits.aggression = 0.8;
    const rr = ensureRel(rebel, leader.id, 0);
    rr.loyalty = 0;
    rr.resentment = 0.8;
    rr.rivalry = 0.6;

    const tribe: Tribe = {
      id: 0,
      name: 'The Test Pact',
      color: [120, 120, 120],
      leaderId: leader.id,
      memberIds: members.map((m) => m.id),
      population: members.length,
      cx: 800,
      cy: 500,
      radius: 120,
      sharedEnergy: 0,
      stability: 0.5,
      ideology,
      aggressionLevel: 0.5,
      inequalityLevel: 0.4,
      foundedCycle: 0,
      history: [],
      relations: new Map(),
    };
    const city: City = {
      id: 0,
      tribeId: 0,
      name: 'Testopolis',
      x: 800,
      y: 500,
      population: members.length,
      storedEnergy: 300,
      taxRate: 0.2,
      classElite: 2,
      classMiddle: 4,
      classPoor: 4,
      inequality: 0.45,
      unrest: 0.7,
      buildings: [
        { type: 'council_hall', dx: 0, dy: 0, level: 1, damaged: false },
        { type: 'energy_storage', dx: 10, dy: 0, level: 1, damaged: false },
      ],
      leaderId: leader.id,
      foundedCycle: 0,
      history: [],
    };
    const world: WS = {
      seed: 1,
      cycle: 100,
      params: WORLD_PARAMS,
      rngState: 0,
      backgroundNodes: [],
      agents: members,
      energySources: [],
      nextAgentId: 10,
      nextEnergyId: 0,
      totalBirths: 0,
      totalDeaths: 0,
      conversationLog: [],
      nextMessageId: 0,
      tribes: [tribe],
      nextTribeId: 1,
      cities: [city],
      nextCityId: 1,
      economy: {
        totalEnergy: 0,
        avgEnergy: 0,
        inequalityIndex: 0,
        richestId: -1,
        richestEnergy: 0,
        poorestId: -1,
        poorestEnergy: 0,
        starvationCount: 0,
        unrestLevel: 0,
        rebellionRisk: 0,
      },
      conflictPulses: [],
      totalConflicts: 0,
      totalRevolutions: 0,
      totalProtests: 0,
      chronicle: [],
      nextEventId: 0,
      milestones: [],
      history: [],
      hiddenCouncil: createCouncil(),
    };
    return { world, rng, tribe, city, rebel, leader, members };
  };

  // Phase 7 escalation: a cooperative city under sustained riot-level unrest + a rebel must be
  // RESOLVED by the ladder — a revolution or (cooperative-leaning) a reform — redistributing to
  // the poor and releasing the unrest. (The old one-shot revolt is now a cumulative process.)
  {
    const { world, rng, tribe, city, rebel } = makeRevWorld('cooperative');
    const poorBefore = world.agents.slice(5).reduce((s, m) => s + m.energy, 0);
    const taxBefore = city.taxRate;
    let resolved = false;
    for (let i = 0; i < 40 && !resolved; i++) {
      city.unrest = 0.72; // sustained discontent drives pressure up each interval
      updateRevolutions(world, rng);
      const revolted = tribe.leaderId === rebel.id && world.totalRevolutions > 0;
      const reformed = city.taxRate < taxBefore || world.chronicle.some((e) => e.title === 'Reform');
      if (revolted || reformed) resolved = true;
    }
    const poorAfter = world.agents.slice(5).reduce((s, m) => s + m.energy, 0);
    assert(resolved, 'sustained unrest is resolved by revolution or reform (Phase 7 ladder)');
    assert(poorAfter > poorBefore, 'the resolution redistributes wealth to the poor');
    assert(city.unrest < 0.6, 'the resolution releases the unrest');
  }

  // Authoritarian city: sustained unrest escalates to a crackdown (or, eventually, revolution).
  {
    const { world, rng, tribe, leader, rebel } = makeRevWorld('authoritarian');
    let acted = false;
    for (let i = 0; i < 60 && !acted; i++) {
      if (tribe.leaderId === leader.id) world.cities[0].leaderId = leader.id;
      world.cities[0].unrest = 0.74;
      leader.energy = 90;
      rebel.energy = 85;
      updateRevolutions(world, rng);
      if (world.milestones.includes('firstRepression') || world.totalRevolutions > 0) acted = true;
    }
    assert(acted, 'authoritarian unrest escalates to a crackdown or revolution (Phase 7)');
  }
}

// ---------------------------------------------------------------- determinism
console.log('\nDeterminism (two runs, seed=0x1234, 8000 ticks):');
{
  const a = makeRun(0x1234);
  const b = makeRun(0x1234);
  for (let t = 0; t < 8000; t++) {
    a.tick();
    b.tick();
  }
  const fa = fingerprint(a.world);
  const fb = fingerprint(b.world);
  console.log('  A:', fa);
  console.log('  B:', fb);
  assert(fa === fb, 'identical fingerprint for same seed (incl. relationships)');
  const c = makeRun(0x9999);
  for (let t = 0; t < 8000; t++) c.tick();
  assert(fingerprint(c.world) !== fa, 'different seed => different world');
}

// ---------------------------------------------------------------- communication
console.log('\nCommunication:');
{
  const run = makeRun(0xbeef);
  for (let t = 0; t < 8000; t++) run.tick();
  const log = run.world.conversationLog;
  const cats: Record<string, number> = {};
  for (const m of log) cats[m.category] = (cats[m.category] ?? 0) + 1;
  console.log('  total spoken:', run.world.nextMessageId, ' log length (capped):', log.length);
  console.log('  categories in window:', JSON.stringify(cats));
  assert(run.world.nextMessageId > 0, 'messages are generated during a run');
  assert(log.length <= 500, 'conversation log is capped at 500');
  assert(Object.keys(cats).length >= 3, 'multiple message categories appear');
}

// ---------------------------------------------------------------- micro: interactions
console.log('\nInteraction effects:');
{
  const rng = new RNG(42);
  const giver = createAgent(0, rng, WORLD_PARAMS);
  const receiver = createAgent(1, rng, WORLD_PARAMS);
  giver.energy = 90;
  receiver.energy = 20;
  applyHelp(giver, receiver, 100);
  const rr = receiver.relationships.get(0);
  assert(!!rr && rr.trust > 0 && rr.friendship > 0, 'help raises receiver trust + friendship');
  assert(
    receiver.memory.some((m) => m.kind === 'helped_by' && m.otherId === 0),
    'receiver remembers being helped',
  );

  const thief = createAgent(2, rng, WORLD_PARAMS);
  const victim = createAgent(3, rng, WORLD_PARAMS);
  thief.energy = 20;
  victim.energy = 90;
  applySteal(thief, victim, 100);
  const vr = victim.relationships.get(2);
  assert(!!vr && vr.fear > 0 && vr.resentment > 0, 'theft raises victim fear + resentment');
  assert(
    victim.memory.some((m) => m.kind === 'stolen_from' && m.otherId === 2),
    'victim remembers being stolen from',
  );
}

// ---------------------------------------------------------------- micro: behavior follows history
function microWorld(): { world: WorldState; grid: SpatialGrid } {
  const world: WorldState = {
    seed: 1,
    cycle: 0,
    params: WORLD_PARAMS,
    rngState: 0,
    backgroundNodes: [],
    agents: [],
    energySources: [],
    nextAgentId: 0,
    nextEnergyId: 0,
    totalBirths: 0,
    totalDeaths: 0,
    conversationLog: [],
    nextMessageId: 0,
  };
  const grid = new SpatialGrid(WORLD_PARAMS.width, WORLD_PARAMS.height, SIM.spatialCellSize);
  return { world, grid };
}

function reindex(world: WorldState, grid: SpatialGrid): Map<number, Agent> {
  grid.clear();
  const byId = new Map<number, Agent>();
  for (let i = 0; i < world.agents.length; i++) {
    grid.insert(i, world.agents[i].x, world.agents[i].y);
    byId.set(world.agents[i].id, world.agents[i]);
  }
  return byId;
}

console.log('\nBehavior driven by history:');
{
  // Thieves get avoided: a victim that fears its thief flees from it.
  const { world, grid } = microWorld();
  const rng = new RNG(7);
  const thief = createAgent(0, rng, WORLD_PARAMS);
  const victim = createAgent(1, rng, WORLD_PARAMS);
  thief.x = 800;
  thief.y = 500;
  thief.energy = 80;
  victim.x = 820; // victim is to the RIGHT of the thief
  victim.y = 500;
  victim.energy = 70;
  victim.traits.fear = 0.8;
  victim.state = 'wandering';
  const f = ensureRel(victim, thief.id, 0);
  f.fear = 0.9;
  f.resentment = 0.6;
  world.agents = [thief, victim];
  world.cycle = 14; // (14 + victim.id=1) % 15 === 0 -> a decision happens this tick
  const byId = reindex(world, grid);
  updateAgent(victim, world, grid, byId, new Map(), new Map(), rng);
  assert(victim.state === 'fleeing' && victim.targetAgentId === 0, 'feared thief triggers fleeing');
  assert(victim.vx > 0 && victim.x > 820, 'victim moves away from the thief');
}
{
  // Helped agents get followed: a beneficiary follows its repeated benefactor.
  const { world, grid } = microWorld();
  const rng = new RNG(9);
  const giver = createAgent(0, rng, WORLD_PARAMS);
  const receiver = createAgent(1, rng, WORLD_PARAMS);
  giver.x = 800;
  giver.y = 500;
  giver.energy = 95;
  giver.age = 2500;
  giver.traits.aggression = 0.1;
  receiver.x = 830;
  receiver.y = 500;
  receiver.energy = 70;
  receiver.state = 'wandering';
  receiver.traits.socialNeed = 0.8;
  receiver.traits.empathy = 0.2;
  receiver.traits.fear = 0.2;
  applyHelp(giver, receiver, 0);
  applyHelp(giver, receiver, 0);
  applyHelp(giver, receiver, 0);
  world.agents = [giver, receiver];
  world.cycle = 14;
  const byId = reindex(world, grid);
  updateAgent(receiver, world, grid, byId, new Map(), new Map(), rng);
  assert(
    receiver.state === 'following_leader' && receiver.targetAgentId === 0,
    'helped agent follows its benefactor',
  );
}
{
  // A robbed agent voices conflict (message content reflects the event).
  const { world } = microWorld();
  const rng = new RNG(123);
  const victim = createAgent(1, rng, WORLD_PARAMS);
  const thief = createAgent(2, rng, WORLD_PARAMS);
  applySteal(thief, victim, world.cycle); // records 'stolen_from' on victim
  const ctx = {
    nearbyCount: 1,
    rivalId: thief.id,
    rivalName: thief.name,
    allyId: -1,
    allyName: null,
    leaderId: -1,
    leaderName: null,
  };
  let spoke = false;
  for (let i = 0; i < 80 && !spoke; i++) {
    victim.speakCooldown = 0;
    emitSpeech(victim, world, ctx, rng);
    if (world.conversationLog.length > 0) spoke = true;
  }
  const m = world.conversationLog[world.conversationLog.length - 1];
  assert(spoke, 'robbed agent eventually speaks');
  assert(!!m && m.category === 'conflict' && m.recipientId === thief.id, 'robbed agent voices conflict at the thief');
}

// ---------------------------------------------------------------- save round-trip
console.log('\nSave / load round-trip:');
{
  const continueWorld = (w: WS, ticks: number) => {
    const rng = new RNG(w.rngState);
    const grid = new SpatialGrid(w.params.width, w.params.height, SIM.spatialCellSize);
    for (let i = 0; i < ticks; i++) {
      stepWorld(w, rng, grid);
      w.rngState = rng.getState();
    }
  };

  const run = makeRun(0x5a5e);
  for (let t = 0; t < 6000; t++) run.tick();

  const save = serializeWorld(run.world, 1717171717);
  const json = JSON.stringify(save); // proves no Maps leak through (would serialize to {})
  const restored = deserializeWorld(JSON.parse(json));

  assert(save.version === 3 && save.savedAt === 1717171717, 'save carries version + savedAt');
  assert(restored.agents.every((a) => !!a.brain && !!a.lexicon), 'restored agents carry a brain + lexicon (v3)');
  assert(restored.agents[0].relationships instanceof Map, 'agent relationships restored as a Map');
  assert(
    restored.tribes.length === 0 || restored.tribes[0].relations instanceof Map,
    'tribe relations restored as a Map',
  );
  assert(restored.cycle === run.world.cycle && restored.rngState === run.world.rngState, 'cycle + RNG state preserved');
  // Phase 1: loading now NORMALIZES (prunes references to dead agents, recomputes the derived
  // economy), so a freshly-run world holds dead-ref relationships its restore does not.
  assert(restored.economy.richestId === -1 || restored.agents.some((a) => a.alive && a.id === restored.economy.richestId), 'restored economy.richestId is a living agent');

  // The lossless guarantee post-normalization: a *canonical* (already-normalized) world
  // round-trips with zero loss and continues identically. Verify with a second round-trip.
  const restored2 = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(restored, 1717171717))));
  continueWorld(restored, 4000);
  continueWorld(restored2, 4000);
  const fa = fingerprint(restored);
  const fb = fingerprint(restored2);
  console.log('  restored  :', fa);
  console.log('  restored2 :', fb);
  assert(fa === fb, 'a normalized world round-trips losslessly and continues identically');

  // W2 — a v2 save (no brain/lexicon/discoveries/cultures) migrates forward to v3 on load.
  const v2raw = JSON.parse(json) as typeof save & { world: Record<string, unknown> };
  v2raw.version = 2;
  delete (v2raw.world as Record<string, unknown>).discoveries;
  delete (v2raw.world as Record<string, unknown>).cultures;
  delete (v2raw.world as Record<string, unknown>).nextDiscoveryId;
  delete (v2raw.world as Record<string, unknown>).nextSymbolSeq;
  for (const a of (v2raw.world as { agents: Array<Record<string, unknown>> }).agents) {
    delete a.brain;
    delete a.lexicon;
  }
  const upgraded = deserializeWorld(v2raw as unknown as Parameters<typeof deserializeWorld>[0]);
  assert(Array.isArray(upgraded.discoveries) && Array.isArray(upgraded.cultures), 'v2→v3: world gains discoveries + cultures arrays');
  assert(upgraded.agents.every((a) => !!a.brain && !!a.lexicon), 'v2→v3: every agent gains a brain + lexicon');
  assert(validateWorldState(upgraded).ok, 'a migrated v2→v3 world validates clean');
}

// ---------------------------------------------------------------- tribe/city consistency (Phase 2)
console.log('\nTribe / city consistency (Phase 2):');
{
  const run = makeRun(0x2b2b);
  for (let t = 0; t < 6000; t++) run.tick();
  // Membership is rebuilt every batch (TRIBE.interval); the contract holds at batch boundaries.
  while (run.world.cycle % TRIBE.interval !== 0) run.tick();
  const w = run.world;
  const rep = validateWorldState(w);
  const membershipKinds = [
    'agent_missing_tribe',
    'agent_missing_city',
    'tribe_member_mismatch',
    'city_population_mismatch',
    'dead_leader',
  ];
  const memberOK = !rep.issues.some((i) => membershipKinds.includes(i.kind));

  // independent recompute from agent tribeId/cityId (the source of truth)
  let mismatch = 0;
  for (const tr of w.tribes) {
    const actual = w.agents.filter((a) => a.alive && a.tribeId === tr.id).length;
    if (actual !== tr.population || actual !== tr.memberIds.length) mismatch += 1;
  }
  for (const c of w.cities) {
    const actual = w.agents.filter((a) => a.alive && a.cityId === c.id).length;
    if (actual !== c.population) mismatch += 1;
  }
  const aliveSet = new Set(w.agents.filter((a) => a.alive).map((a) => a.id));
  let deadLeaders = 0;
  for (const tr of w.tribes) if (tr.leaderId !== null && !aliveSet.has(tr.leaderId)) deadLeaders += 1;
  for (const c of w.cities) if (c.leaderId !== null && !aliveSet.has(c.leaderId)) deadLeaders += 1;

  console.log(`  tribes=${w.tribes.length} cities=${w.cities.length} archived=${w.archivedTribes.length}`);
  assert(mismatch === 0, 'every tribe/city population matches its living members at a batch boundary');
  assert(memberOK, 'validation finds no membership inconsistencies at a batch boundary');
  assert(deadLeaders === 0, 'no tribe/city is led by a dead agent');
  assert(w.archivedTribes.every((e) => e.peakPopulation >= 8), 'archived tribes were once substantial (peak>=8)');

  // normalizeWorldState is the ABSOLUTE guarantee: consistent at ANY tick, even mid-batch.
  run.tick(); // step off the batch boundary
  normalizeWorldState(run.world);
  const afterNorm = validateWorldState(run.world).issues.filter((i) => membershipKinds.includes(i.kind));
  assert(afterNorm.length === 0, 'normalize restores full membership consistency at any tick');
}

// ---------------------------------------------------------------- economy sync (Phase 3)
console.log('\nEconomy sync (Phase 3):');
{
  const run = makeRun(0x3c3c);
  for (let t = 0; t < 8000; t++) run.tick();
  const w = run.world;

  // 1. manual energy change -> recalc matches agents, and survives save/reload
  const a0 = w.agents.find((a) => a.alive)!;
  a0.energy = 3; // force a starving poorest
  w.economy = recalculateEconomy(w);
  const sumAlive = w.agents.filter((a) => a.alive).reduce((s, a) => s + a.energy, 0);
  let storedSum = 0;
  for (const c of w.cities) storedSum += c.storedEnergy;
  for (const tr of w.tribes) storedSum += tr.sharedEnergy;
  assert(Math.abs(w.economy.totalEnergy - (sumAlive + storedSum)) < 1e-6, 'totalEnergy = living-agent energy + treasuries');
  const reloaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w, 1))));
  assert(Math.abs(reloaded.economy.totalEnergy - w.economy.totalEnergy) < 1e-6, 'economy survives save/reload and matches a fresh recompute');

  // 2. kill the richest -> richestId moves to a different living agent
  const before = recalculateEconomy(w);
  const rich = w.agents.find((a) => a.id === before.richestId)!;
  rich.alive = false;
  const after = recalculateEconomy(w);
  const aliveIds = new Set(w.agents.filter((a) => a.alive).map((a) => a.id));
  assert(after.richestId !== before.richestId && aliveIds.has(after.richestId), 'killing the richest moves richestId to a living agent');
  rich.alive = true; // restore for subsequent checks

  // 3. spawn poor agents -> starvationCount rises
  const baseStarv = recalculateEconomy(w).starvationCount;
  const seed = w.agents.find((a) => a.alive)!;
  for (let i = 0; i < 5; i++) {
    w.agents.push({ ...seed, id: 900000 + i, energy: 1, alive: true, relationships: new Map(), memory: [] });
  }
  assert(recalculateEconomy(w).starvationCount === baseStarv + 5, 'spawning 5 starving agents raises starvationCount by 5');

  // 4. change city stored energy -> totalEnergy reflects it
  if (w.cities.length > 0) {
    const eA = recalculateEconomy(w).totalEnergy;
    w.cities[0].storedEnergy += 250;
    assert(Math.abs(recalculateEconomy(w).totalEnergy - (eA + 250)) < 1e-6, 'city treasury change is reflected in totalEnergy');
  } else {
    const eA = recalculateEconomy(w).totalEnergy;
    w.tribes[0].sharedEnergy += 250;
    assert(Math.abs(recalculateEconomy(w).totalEnergy - (eA + 250)) < 1e-6, 'tribe treasury change is reflected in totalEnergy');
  }
}

// ---------------------------------------------------------------- resource ecology (Phase 4)
console.log('\nResource ecology (Phase 4):');
{
  // (a) recovery mechanism: force a near-total field collapse, verify blooms restore capacity
  const run = makeRun(0x4ec0);
  for (let t = 0; t < 2000; t++) run.tick();
  const w = run.world;
  for (const s of w.energySources) s.amount = 0;
  w.ecology = computeEcology(w);
  const srcBefore = w.energySources.length;
  assert(w.ecology.scarcityIndex > 0.95, 'a fully drained field registers as critical scarcity');
  for (let t = 0; t < 8000; t++) run.tick();
  assert(w.ecology.lastRecoveryCycle > 0, 'a recovery bloom fired under sustained scarcity');
  assert(w.energySources.length > srcBefore, 'recovery added new sources (carrying capacity expanded)');
  assert(w.energySources.length <= ECOLOGY.absoluteMaxSources, 'source count stays bounded (energy is not infinite)');
  const backbone = w.energySources.filter((s) => s.kind === 'renewable' || s.kind === 'deep').length;
  assert(backbone > 0, 'the recovered field contains renewable/deep backbone sources');
  console.log(`  collapse→recovery: sources ${srcBefore}→${w.energySources.length}, natER=${w.ecology.totalNaturalEnergy.toFixed(0)}, scarcity=${w.ecology.scarcityIndex.toFixed(2)}`);

  // (b) resources recover after population pressure drops (the spec's key claim). Run to a
  //     scarce state, crash the population (famine/plague), then watch the field rebound in
  //     the window before the population regrows.
  const run2 = makeRun(0x4ec1);
  for (let t = 0; t < 6000; t++) run2.tick();
  const w2 = run2.world;
  const fillOf = () => (w2.ecology.totalCapacity > 0 ? w2.ecology.totalNaturalEnergy / w2.ecology.totalCapacity : 0);
  const popBefore = w2.agents.filter((a) => a.alive).length;
  const fillScarce = fillOf();
  // simulate a population crash: cull ~80% of agents
  let i = 0;
  for (const a of w2.agents) {
    if (a.alive && i++ % 5 !== 0) a.alive = false;
  }
  // fewer harvesters -> the field rebounds; capture the peak before the population regrows
  let fillPeak = fillScarce;
  let popLow = popBefore;
  for (let t = 0; t < 1200; t++) {
    run2.tick();
    fillPeak = Math.max(fillPeak, fillOf());
    popLow = Math.min(popLow, w2.agents.filter((a) => a.alive).length);
  }
  console.log(`  pop ${popBefore}→${popLow} (crash), field fill ${(fillScarce * 100).toFixed(1)}%→peak ${(fillPeak * 100).toFixed(1)}%`);
  assert(w2.ecology.totalNaturalEnergy > 0, 'the energy field is never fully dead (renewable inflow + blooms)');
  assert(popLow < popBefore * 0.5, 'the population crash took effect');
  assert(fillPeak > fillScarce * 1.5, 'resources recover after population pressure drops');
}

// ---------------------------------------------------------------- agent roles (Phase 5)
console.log('\nAgent roles & state diversity (Phase 5):');
{
  const run = makeRun(0x5d05);
  for (let t = 0; t < 6000; t++) run.tick();
  const alive = run.world.agents.filter((a) => a.alive);
  const roles = new Set(alive.map((a) => a.role));
  const states = new Set(alive.map((a) => a.state));
  const searching = alive.filter((a) => a.state === 'searching_energy').length;
  const vocStates = ['building', 'guarding', 'trading', 'healing', 'scouting', 'archiving_history', 'governing', 'farming', 'worshipping', 'organizing_protest', 'investigating_reality', 'migrating', 'debating'];
  const vocations = alive.filter((a) => vocStates.includes(a.state)).length;
  console.log(`  pop=${alive.length} roles=${roles.size} states=${states.size} searching=${searching} vocational=${vocations}`);
  console.log(`  roles seen: ${[...roles].join(', ')}`);
  assert(alive.every((a) => !!a.role), 'every living agent has a role');
  assert(roles.size >= 6, 'agents occupy a diversity of roles (>=6 distinct)');
  assert(searching < alive.length, 'not every agent is stuck in searching_energy');
  assert(states.size >= 5, 'agents occupy a diversity of active states (>=5 distinct)');
}

// ---------------------------------------------------------------- perception & action (W3)
console.log('\nPerception & action utility (W3):');
{
  const rng = new RNG(0x9e3);
  const a = createAgent(0, rng, WORLD_PARAMS);
  const b = createAgent(1, rng, WORLD_PARAMS);
  a.energy = 70;
  b.energy = 70;
  a.role = 'gatherer';
  b.role = 'gatherer';
  const perc = {
    energyFrac: 0.7, danger: 0, nearbyEnergy: 0.5, nearbyAllies: 0.1, nearbyEnemies: 0,
    nearbyCity: false, tribeStability: 0.5, cityUnrest: 0, inequality: 0.1, scarcity: 0.2,
    trustNearby: 0.3, suspicionEvidence: 0, socialOpportunity: 0.4, experimentOpportunity: 0.3,
  };
  const ctx = { helpId: -1, allyId: -1, followId: -1, leaderId: -1, discovery: 0 };
  // Policy weights (the substrate W4 learning will drive) must steer the choice.
  a.brain!.policyWeights = { rest: 5 };
  b.brain!.policyWeights = { seek_energy: 5 };
  const ca = chooseNormalLifeState(a, perc, ctx, undefined, 100);
  const cb = chooseNormalLifeState(b, perc, ctx, undefined, 100);
  console.log(`  A(rest-biased)→${ca.state}  B(seek-biased)→${cb.state}`);
  assert(ca.state === 'resting', 'policy weights steer choice: a rest-biased agent rests');
  assert(cb.state === 'searching_energy', 'policy weights steer choice: a seek-biased agent forages');
  const ca2 = chooseNormalLifeState(a, perc, ctx, undefined, 100);
  assert(ca.state === ca2.state && ca.action === ca2.action, 'utility selection is deterministic');
  assert(
    actionNoise(7, 100, 1) === actionNoise(7, 100, 1) && actionNoise(7, 100, 1) !== actionNoise(7, 100, 2),
    'action noise is a deterministic, salt-sensitive hash (not a world-RNG draw)',
  );

  // perception fields computed for a real agent are finite + normalized
  const run = makeRun(0x9e3a);
  for (let t = 0; t < 600; t++) run.tick();
  const live = run.world.agents.find((x) => x.alive)!;
  const p = computePerception(live, run.world, emptyPerceptionInputs(), undefined, undefined);
  const nums = Object.values(p).filter((v) => typeof v === 'number') as number[];
  assert(nums.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), 'perception fields are finite + normalized to [0,1]');
  console.log(`  perception sample: energyFrac=${p.energyFrac.toFixed(2)} scarcity=${p.scarcity.toFixed(2)} danger=${p.danger.toFixed(2)}`);
}

// ---------------------------------------------------------------- lifetime learning (W4)
console.log('\nLifetime learning (W4):');
{
  const rng = new RNG(0x1ea2);
  const learner = createAgent(0, rng, WORLD_PARAMS);
  const br = learner.brain!;
  // reward 'seek_energy' (energy gained), then punish 'rest' (energy lost), in the same context
  for (let i = 0; i < 30; i++) {
    learner.energy = 50;
    recordActionStart(learner, 'seek_energy', 'ctxA');
    learner.energy = 70; // foraging found energy
    learnFromOutcome(learner, i);
  }
  for (let i = 0; i < 30; i++) {
    learner.energy = 70;
    recordActionStart(learner, 'rest', 'ctxA');
    learner.energy = 55; // drained while idle
    learnFromOutcome(learner, i + 100);
  }
  const ws = br.policyWeights;
  const qa = br.qByContext['ctxA'] ?? {};
  console.log(`  policyWeights seek=${(ws.seek_energy ?? 0).toFixed(2)} rest=${(ws.rest ?? 0).toFixed(2)}; Q[ctxA] seek=${(qa.seek_energy ?? 0).toFixed(2)} rest=${(qa.rest ?? 0).toFixed(2)}; memory=${br.actionMemory.length}`);
  assert((ws.seek_energy ?? 0) > (ws.rest ?? 0), 'a rewarded action gains policy preference over a punished one');
  assert((qa.seek_energy ?? 0) > (qa.rest ?? 0), 'per-context value learns: the rewarded action has the higher Q');
  assert(br.actionMemory.length > 0 && br.actionMemory.length <= 16, 'action-outcome memory accrues and stays capped');

  // two agents, opposite reward histories → different learned preferences (W4 acceptance)
  const A = createAgent(1, rng, WORLD_PARAMS);
  const B = createAgent(2, rng, WORLD_PARAMS);
  for (let i = 0; i < 25; i++) {
    A.energy = 50; recordActionStart(A, 'seek_energy', 'c'); A.energy = 72; learnFromOutcome(A, i);
    B.energy = 50; recordActionStart(B, 'rest', 'c'); B.energy = 72; learnFromOutcome(B, i);
  }
  assert((A.brain!.policyWeights.seek_energy ?? 0) > (B.brain!.policyWeights.seek_energy ?? 0), 'agents with different histories develop different policy weights');

  // a live run exercises learning end-to-end
  const run = makeRun(0x1ea2b);
  for (let t = 0; t < 4000; t++) run.tick();
  const withMem = run.world.agents.filter((a) => a.alive && a.brain && a.brain.actionMemory.length > 0).length;
  const withW = run.world.agents.filter((a) => a.alive && a.brain && Object.keys(a.brain.policyWeights).length > 0).length;
  console.log(`  live run: ${withMem} agents accrued action memory, ${withW} have learned policy weights`);
  assert(withMem > 0 && withW > 0, 'agents learn from outcomes during a live run');
}

// ---------------------------------------------------------------- evolution (W5)
console.log('\nGenetic + cultural evolution (W5):');
{
  const rng = new RNG(0x5e5);
  const parent = createAgent(0, rng, WORLD_PARAMS);
  parent.brain!.policyWeights = { build: 1.5, steal: -1.2, trade: 0.8 };
  parent.brain!.learningRate = 0.2;
  parent.brain!.imitationBias = 0.5;
  const child = createChild(500, parent, rng);
  const cw = child.brain!.policyWeights;
  console.log(`  child inherited: build=${(cw.build ?? 0).toFixed(2)} steal=${(cw.steal ?? 0).toFixed(2)} trade=${(cw.trade ?? 0).toFixed(2)}`);
  assert(cw.build !== undefined && cw.steal !== undefined && cw.trade !== undefined, 'child inherits the parent action-weight genes');
  assert((cw.build ?? 0) > 0.5 && (cw.steal ?? 0) < -0.5, 'inherited weights track the parent (build favored, steal avoided)');
  assert(cw.build !== parent.brain!.policyWeights.build, 'inheritance applies mutation (not an exact copy)');
  assert(child.brain!.actionMemory.length === 0 && Object.keys(child.brain!.qByContext).length === 0, 'lifetime learning (memory/Q) is NOT inherited — each child learns its own');

  // imitation: a follower adopts a successful model's preference over time
  const learner = createAgent(1, rng, WORLD_PARAMS);
  const model = createAgent(2, rng, WORLD_PARAMS);
  learner.brain!.imitationBias = 1;
  learner.brain!.policyWeights = { build: 0 };
  model.brain!.policyWeights = { build: 2 };
  const before = learner.brain!.policyWeights.build ?? 0;
  for (let i = 0; i < 20; i++) imitate(learner, model);
  const after = learner.brain!.policyWeights.build ?? 0;
  console.log(`  imitation: learner build weight ${before.toFixed(2)} → ${after.toFixed(2)} (model=2.0)`);
  assert(after > before + 0.3, 'imitation moves a follower toward a successful model');
}

// ---------------------------------------------------------------- emergent language (W6)
console.log('\nEmergent language (W6):');
{
  const w = makeRun(0x106).world; // full world (has nextSymbolSeq)
  const a1 = w.agents[0];
  const a2 = w.agents[1];
  const b1 = w.agents[2];

  const u1 = speak(a1, w, 'fear')!;
  assert(!!u1 && u1.tokens.length > 0, 'an agent invents a token to speak a concept');
  assert(u1.meaning.includes('danger'), 'UI can infer meaning from the token vector (fear → danger)');
  const conf0 = u1.confidence;
  const u1b = speak(a1, w, 'fear')!;
  assert(u1b.phrase === u1.phrase && u1b.confidence > conf0, 'reusing a token raises its confidence');

  hearToken(a2, u1.token);
  assert(wordFor(a2, 'fear') !== null, 'a listener imitates — it adopts a word for the concept it heard');

  const ub = speak(b1, w, 'fear')!;
  assert(ub.phrase !== u1.phrase, 'an independent agent coins a different word for the same concept (dialect divergence)');

  console.log(`  a1 "fear"=${u1.phrase} [${u1.meaning}]  b1 "fear"=${ub.phrase}  a2 adopted=${wordFor(a2, 'fear')}`);

  // live run: tokens spread, messages carry token phrases, many words are coined
  const run = makeRun(0x106b);
  for (let t = 0; t < 4000; t++) run.tick();
  const withLex = run.world.agents.filter((a) => a.alive && a.lexicon && a.lexicon.tokens.length > 0).length;
  const msgTok = run.world.conversationLog.filter((m) => m.tokens && m.tokens.length > 0).length;
  const words = new Set(run.world.agents.flatMap((a) => (a.lexicon ? a.lexicon.tokens.map((t) => t.token) : [])));
  console.log(`  live: ${withLex} agents have lexicons, ${msgTok}/${run.world.conversationLog.length} logged msgs carry tokens, ${words.size} distinct words coined`);
  assert(withLex > 0, 'agents accumulate lexicons during a live run');
  assert(msgTok > 0, 'spoken messages carry emergent token phrases (not hardcoded sentences)');
  assert(words.size > 1, 'multiple distinct words are coined (no single scripted vocabulary)');
}

// ---------------------------------------------------------------- technology discovery (W7)
console.log('\nAutonomous discovery (W7):');
{
  const w = generateWorld(0x707);
  const a = w.agents[0];
  a.x = 800;
  a.y = 500;
  a.cityId = 0;
  a.tribeId = 0;
  w.cities = [
    {
      id: 0, tribeId: 0, name: 'Probe', x: 800, y: 500, population: 1, storedEnergy: 50,
      taxRate: 0.1, classElite: 0, classMiddle: 0, classPoor: 1, inequality: 0, unrest: 0,
      buildings: [{ type: 'energy_storage', dx: 0, dy: 0, level: 1, damaged: false }],
      leaderId: a.id, foundedCycle: 0, history: [],
    },
  ] as unknown as typeof w.cities;
  w.energySources = [{ id: 0, x: 810, y: 500, amount: 50, capacity: 100, regen: 0.2, radius: 12, kind: 'common', discovered: true }];
  w.discoveries = [];
  w.nextDiscoveryId = 0;
  const regenBefore = w.energySources[0].regen;
  for (let i = 0; i < 12; i++) attemptExperiment(a, w);
  console.log(`  forced: discoveries=${discoveryCount(w)} regen ${regenBefore}→${w.energySources[0].regen.toFixed(2)}`);
  assert(discoveryCount(w) > 0, 'repeated experimentation near the right materials yields a discovery');
  assert(w.energySources[0].regen > regenBefore, 'an energy discovery improves the ecology (faster regen)');
  assert(w.energySources[0].regen <= 1.31, 'discovery effects are bounded (no infinite energy)');

  // lost on collapse unless archived
  const d = w.discoveries![0];
  d.tribeId = 0;
  d.archived = false;
  loseDiscoveriesOnCollapse(w, 0);
  assert(discoveryCount(w) === 0, 'un-archived technology is lost when its tribe collapses');
  w.discoveries = [{ ...d, archived: true }];
  loseDiscoveriesOnCollapse(w, 0);
  assert(discoveryCount(w) === 1, 'archived technology survives a collapse (preserved for successors)');

  // live run: a long-lived world discovers techniques on its own
  const run = makeRun(0x707b);
  for (let t = 0; t < 12000; t++) run.tick();
  const kinds = new Set((run.world.discoveries ?? []).map((x) => x.effect.kind));
  console.log(`  live: ${discoveryCount(run.world)} discoveries across ${kinds.size} techniques: ${[...kinds].join(', ')}`);
  assert(discoveryCount(run.world) > 0, 'agents discover at least one technique autonomously in a long run');
}

// ---------------------------------------------------------------- culture (W8)
console.log('\nCulture (W8):');
{
  const mkMem = (kind: string) => [{ cycle: 0, kind, otherId: null, x: null, y: null, strength: 0.5 }];
  const seedTribe = (seed: number, kind: string) => {
    const w = generateWorld(seed);
    const leader = w.agents[0];
    w.tribes = [{ id: 0, name: kind === 'shared_energy' ? 'Givers' : 'Thieves', leaderId: leader.id } as unknown as (typeof w.tribes)[number]];
    w.cultures = [];
    for (const m of w.agents.slice(0, 10)) {
      m.tribeId = 0;
      m.memory = mkMem(kind) as unknown as typeof m.memory;
    }
    for (let i = 0; i < 8; i++) {
      w.cycle = i * 30;
      updateCultures(w);
    }
    return w.cultures.find((c) => c.tribeId === 0)!;
  };

  const givers = seedTribe(0x808, 'shared_energy');
  const thieves = seedTribe(0x809, 'stolen_from');
  console.log(`  Givers: norms=${givers.norms.map((n) => n.subject)} taboos=${givers.taboos.map((t) => t.subject)}`);
  console.log(`  Thieves: norms=${thieves.norms.map((n) => n.subject)} taboos=${thieves.taboos.map((t) => t.subject)}`);
  assert(givers.norms.some((n) => n.subject === 'generosity'), 'repeated sharing crystallizes a generosity norm');
  assert(cultureBias(givers, 'share') > 0, 'culture biases behavior — a generosity norm boosts sharing');
  assert(thieves.taboos.some((t) => t.subject === 'theft'), 'repeated theft crystallizes an anti-theft taboo');
  assert(tabooStrength(thieves, 'theft') > 0, 'a taboo has measurable strength (suppresses the act)');
  assert(!thieves.norms.some((n) => n.subject === 'generosity'), 'two tribes with different histories develop different cultures');

  // inheritance: a fallen culture passes a fragment to a successor
  const w = generateWorld(0x808);
  w.tribes = [{ id: 0, name: 'Old', leaderId: w.agents[0].id } as unknown as (typeof w.tribes)[number]];
  w.cultures = [];
  for (const m of w.agents.slice(0, 10)) {
    m.tribeId = 0;
    m.memory = mkMem('shared_energy') as unknown as typeof m.memory;
  }
  for (let i = 0; i < 8; i++) {
    w.cycle = i * 30;
    updateCultures(w);
  }
  w.cultures[0].archived = true;
  const ok = inheritCulture(w, 5);
  const heir = w.cultures.find((c) => c.tribeId === 5);
  assert(ok && !!heir && (heir.norms.length > 0 || heir.myths.length > 0), 'a successor inherits a fragment of a fallen culture');

  // live run: cultures form on their own
  const run = makeRun(0x808b);
  for (let t = 0; t < 14000; t++) run.tick();
  console.log(`  live: ${(run.world.cultures ?? []).length} cultures, ${cultureElementCount(run.world)} norms/laws/taboos/myths`);
  assert(cultureElementCount(run.world) > 0, 'cultures form from repeated events in a live run');
}

// ---------------------------------------------------------------- council × emergent (W9)
console.log('\nHidden Council × emergent systems (W9):');
{
  // at high suspicion with discoveries present, the council can target the emergent systems
  const w = generateWorld(0x909);
  w.hiddenCouncil.enabled = true;
  w.hiddenCouncil.discoveryRisk = 0.8;
  w.discoveries = [
    { id: 'x#0', kind: 'energy', discoveredBy: 0, tribeId: 0, cycle: 0, confidence: 0.5, effect: { kind: 'energy_harvest', magnitude: 1, target: 'energy' }, spread: 0.1, archived: false },
  ];
  const picked = selectHiddenCouncilIntervention(w);
  console.log(`  high-suspicion pick: ${picked}`);
  assert(
    ['cause_false_miracle', 'silence_investigator', 'distort_symbol', 'sanctify_discovery', 'plant_rumor'].includes(picked),
    'at high suspicion with discoveries, the council can target the emergent systems',
  );

  // ON vs OFF diverge in culture + language + discovery (the council bends what emerges)
  const off = makeRun(0xc0ffee);
  const on = makeRun(0xc0ffee);
  on.world.hiddenCouncil.enabled = true;
  for (let t = 0; t < 14000; t++) {
    off.tick();
    on.tick();
  }
  const tokensOf = (run: typeof off) => new Set(run.world.agents.flatMap((a) => (a.lexicon ? a.lexicon.tokens.map((t) => t.token) : []))).size;
  const offSig = `${cultureElementCount(off.world)}/${tokensOf(off)}/${discoveryCount(off.world)}`;
  const onSig = `${cultureElementCount(on.world)}/${tokensOf(on)}/${discoveryCount(on.world)}`;
  const onKinds = new Set(on.world.hiddenCouncil.secretLog.map((l) => l.kind));
  console.log(`  culture/words/disc — OFF ${offSig} vs ON ${onSig}; recent ON kinds: ${[...onKinds].join(',')}`);
  assert(offSig !== onSig, 'Council ON produces a different culture/language/technology landscape than OFF');
  assert(on.world.hiddenCouncil.discoveryRisk > 0, 'the council raises suspicion when enabled');
}

// ----------------------------------------- politics / chronicle / memory (Phases 6–11)
console.log('\nPolitics / chronicle / memory (Phases 6–11):');
{
  // With the full learning/language/culture stack active, agents are far more dynamic and the
  // first revolutions fire early (~cycle 15k for this seed); 22k captures them with margin while
  // keeping the suite fast.
  const run = makeRun(0xc0ffee);
  for (let t = 0; t < 22000; t++) run.tick();
  const w = run.world;
  const cats: Record<string, number> = {};
  for (const e of w.chronicle) cats[e.category] = (cats[e.category] ?? 0) + 1;
  const total = w.chronicle.length;
  const collapse = cats['collapse'] ?? 0;
  console.log(`  revolutions=${w.totalRevolutions} cats=${Object.keys(cats).length} collapse=${collapse}/${total} era=${w.era} ruins=${w.ruins.length}`);
  assert(w.totalRevolutions > 0, 'revolutions fire over a long run (Phase 7)');
  assert(['firstRiot', 'firstRevolution'].every((k) => w.milestones.includes(k)), 'escalation ladder reaches riot + revolution (Phase 7)');
  assert(Object.keys(cats).length >= 6, 'chronicle spans many categories (Phase 8)');
  assert(total === 0 || collapse / total < 0.6, 'collapse is no longer the bulk of the chronicle (Phase 8)');

  const hs = w.history[w.history.length - 1];
  assert(!!hs && typeof hs.protests === 'number' && typeof hs.scarcityIndex === 'number' && typeof hs.eraLabel === 'string', 'history samples carry the Phase 9 fields');

  const mk: Record<string, number> = {};
  for (const a of w.agents) for (const m of a.memory) mk[m.kind] = (mk[m.kind] ?? 0) + 1;
  const positive = (mk['traded_with'] ?? 0) + (mk['joined_tribe'] ?? 0) + (mk['shared_energy'] ?? 0) + (mk['helped_by'] ?? 0);
  console.log(`  memory kinds=${Object.keys(mk).length} cooperative=${positive}`);
  assert(Object.keys(mk).length >= 6, 'memory spans many kinds (Phase 11)');
  assert(positive > 0, 'cooperative/cultural memories are recorded, not only theft/death (Phase 11)');
}

// ----------------------------------------- Hidden Council director (Phase 10)
console.log('\nHidden Council director (Phase 10):');
{
  const run = makeRun(0xc0ffee);
  run.world.hiddenCouncil.enabled = true;
  for (let t = 0; t < 14000; t++) run.tick();
  const w = run.world;
  const alive = new Set(w.agents.filter((a) => a.alive).map((a) => a.id));
  const deadWatched = w.hiddenCouncil.watchedAgentIds.filter((id) => !alive.has(id)).length;
  const kinds = new Set(w.hiddenCouncil.secretLog.map((l) => l.kind));
  const uselessSuppress = w.hiddenCouncil.secretLog.filter((l) => l.kind === 'suppress_memory' && l.text.includes('Suppressed 0')).length;
  console.log(`  interventions=${w.hiddenCouncil.interventions} watched=${w.hiddenCouncil.watchedAgentIds.length} deadWatched=${deadWatched} kinds=${kinds.size} risk=${w.hiddenCouncil.discoveryRisk.toFixed(2)}`);
  assert(deadWatched === 0, 'Hidden Council never watches dead agents (Phase 10)');
  assert(kinds.size >= 3, 'Hidden Council uses varied interventions, not one repeated act (Phase 10)');
  assert(uselessSuppress === 0, 'Hidden Council never logs a useless "Suppressed 0" act (Phase 10)');
  assert(w.hiddenCouncil.discoveryRisk > 0, 'discovery risk rises with the council enabled (Phase 10)');
}

// ---------------------------------------------------------------- offline evolution
console.log('\nOffline evolution:');
{
  assert(planOffline(30 * 60 * 1000).tier === 'recent', '<1h maps to the recent tier');
  assert(planOffline(3 * 3600 * 1000).tier === 'medium', '1–12h maps to the medium tier');
  assert(planOffline(20 * 3600 * 1000).tier === 'long', '>12h maps to the long tier');
  assert(planOffline(20 * 3600 * 1000).capped, 'a very long absence is capped (compressed)');

  const base = makeRun(0x0ff11e);
  for (let t = 0; t < 4000; t++) base.tick();
  const save = serializeWorld(base.world, 1_000_000);
  const json = JSON.stringify(save);
  const w1 = deserializeWorld(JSON.parse(json));
  const w2 = deserializeWorld(JSON.parse(json));
  const elapsed = 20 * 60 * 1000; // 20 min -> recent tier (kept light so the suite stays fast)

  const r1 = await runOfflineEvolution(w1, elapsed);
  const r2 = await runOfflineEvolution(w2, elapsed);
  console.log(`  ${r1.summary}`);
  assert(r1.tier === 'recent', 'report tier matches plan');
  assert(r1.cyclesSimulated > 0 && w1.cycle > save.world.cycle, 'offline evolution advances the world');
  assert(r1.births >= 0 && r1.deaths >= 0 && r1.populationAfter >= 0, 'report deltas are sane');
  assert(
    fingerprint(w1) === fingerprint(w2),
    'offline evolution is deterministic (identical input => identical output)',
  );
}

// ---------------------------------------------------------------- hidden council + god mode
console.log('\nHidden Council & God Mode:');
{
  // Council covertly intervenes when enabled.
  const run = makeRun(0xc0c0a);
  run.world.hiddenCouncil.enabled = true;
  for (let t = 0; t < 3000; t++) run.tick();
  const c = run.world.hiddenCouncil;
  console.log(
    `  interventions=${c.interventions} discoveryRisk=${c.discoveryRisk.toFixed(2)} secretLog=${c.secretLog.length}`,
  );
  assert(c.interventions > 0, 'hidden council covertly intervenes when enabled');
  assert(c.secretLog.length > 0, 'council interventions are logged secretly');
  assert(c.discoveryRisk > 0, 'discovery risk rises as the council manipulates');

  // Council-enabled runs remain deterministic.
  const a = makeRun(0xbeef2);
  a.world.hiddenCouncil.enabled = true;
  const b = makeRun(0xbeef2);
  b.world.hiddenCouncil.enabled = true;
  for (let t = 0; t < 3000; t++) {
    a.tick();
    b.tick();
  }
  assert(fingerprint(a.world) === fingerprint(b.world), 'council-enabled runs stay deterministic');

  // God Mode interventions take effect, are logged, and provoke reactions.
  const g = makeRun(0x90d);
  for (let t = 0; t < 600; t++) g.tick();
  const grng = new RNG(1);
  const ev0 = g.world.chronicle.length;
  const e0 = g.world.energySources.length;
  const msg0 = g.world.nextMessageId;
  applyGodAction(g.world, 'add_energy', grng);
  assert(g.world.energySources.length > e0, 'God Mode add-energy takes effect');
  assert(g.world.chronicle.length > ev0, 'God Mode action is logged to the chronicle');
  assert(g.world.nextMessageId > msg0, 'beings react to a visible divine act');
  applyGodAction(g.world, 'smite', grng);
  assert(
    g.world.agents.some((ag) => !ag.alive),
    'God Mode smite strikes a being down',
  );
  applyGodAction(g.world, 'reveal_council', grng);
  assert(
    g.world.hiddenCouncil.revealed && g.world.hiddenCouncil.enabled,
    'God Mode reveal exposes the council',
  );
}

// ---------------------------------------------------------------- agent selection
console.log('\nAgent selection / inspector:');
{
  const e = new Engine(0x5e1ec7); // Engine is DOM-free until startLoop()
  for (let i = 0; i < 300; i++) e.step();
  const w = e.getWorld();
  const target = w.agents[Math.floor(w.agents.length / 2)];
  e.selectAgentAt(target.x, target.y, 5);
  const d = e.getSelectedAgent();
  assert(d !== null && d.id === target.id, 'clicking near a being selects it');
  assert(!!d && typeof d.energy === 'number' && d.traits !== undefined, 'inspector detail is populated');
  e.selectAgentAt(1e9, 1e9, 5); // far away
  assert(e.getSelectedAgent() === null, 'clicking empty space deselects');
}

// ---------------------------------------------------------------- UI snapshot data (W10)
console.log('\nUI snapshot data (W10):');
{
  const e = new Engine(0x5e1ec7);
  for (let i = 0; i < 4000; i++) e.step();
  const snap = e.snapshot();
  console.log(`  snapshot: lang=${snap.languageDiversity} disc=${snap.discoveryCount} culture=${snap.cultureCount} investPct=${(snap.investigatorPct * 100).toFixed(0)}% tech=${snap.techLevel} avgReward=${snap.avgLearningReward.toFixed(2)}`);
  assert(typeof snap.languageDiversity === 'number' && snap.languageDiversity >= 0, 'snapshot carries languageDiversity');
  assert(typeof snap.discoveryCount === 'number' && typeof snap.cultureCount === 'number', 'snapshot carries discovery + culture counts');
  assert(typeof snap.investigatorPct === 'number' && typeof snap.avgLearningReward === 'number', 'snapshot carries investigator% + avg learning reward');
  assert(snap.languageDiversity > 0, 'emergent language is surfaced to the UI');

  const w = e.getWorld();
  const a0 = w.agents.find((a) => a.alive)!;
  e.selectAgentAt(a0.x, a0.y, 9999);
  const d = e.getSelectedAgent();
  assert(!!d && typeof d.lastReward === 'number' && typeof d.knownSymbols === 'number', 'agent inspector detail carries learning + language fields');

  const ts = e.getTribesSummary();
  assert(ts.every((x) => Array.isArray(x.cultureNorms) && Array.isArray(x.dialect) && typeof x.techLevel === 'number'), 'tribe summaries carry culture + dialect + tech');

  const hist = e.getHistory();
  const hs = hist[hist.length - 1];
  assert(!hs || typeof hs.languageDiversity === 'number', 'history samples carry the W10 series');
}

// ---------------------------------------------------------------- performance & caps (W11)
console.log('\nPerformance & caps (W11):');
{
  const run = makeRun(0xca95);
  const t0 = Date.now();
  const capCycles = 12000; // caps fill within a few thousand cycles; this proves they hold + reports perf
  for (let t = 0; t < capCycles; t++) run.tick();
  const ms = Date.now() - t0;
  const w = run.world;
  let maxLex = 0;
  let maxMem = 0;
  let maxQ = 0;
  let maxRel = 0;
  let maxAgentMem = 0;
  for (const a of w.agents) {
    if (a.lexicon) maxLex = Math.max(maxLex, a.lexicon.tokens.length);
    if (a.brain) {
      maxMem = Math.max(maxMem, a.brain.actionMemory.length);
      maxQ = Math.max(maxQ, Object.keys(a.brain.qByContext).length);
    }
    maxRel = Math.max(maxRel, a.relationships.size);
    maxAgentMem = Math.max(maxAgentMem, a.memory.length);
  }
  let maxDialect = 0;
  for (const c of w.cultures ?? []) maxDialect = Math.max(maxDialect, c.lexicon.length);
  const saveKB = JSON.stringify(serializeWorld(w, 1)).length / 1024;
  console.log(`  ${capCycles} cycles in ${ms}ms (${Math.round((capCycles / ms) * 1000)} cyc/s); pop=${w.agents.filter((a) => a.alive).length} save=${saveKB.toFixed(0)}KB`);
  console.log(`  caps — lex ${maxLex}/24, actMem ${maxMem}/16, qCtx ${maxQ}/32, rel ${maxRel}/16, mem ${maxAgentMem}/20, dialect ${maxDialect}/16, disc ${(w.discoveries ?? []).length}/300, cultures ${(w.cultures ?? []).length}/200, log ${w.conversationLog.length}/500, chron ${w.chronicle.length}/2000, hist ${w.history.length}/1500`);
  assert(maxLex <= 24, 'agent lexicon stays within cap');
  assert(maxMem <= 16, 'action-outcome memory stays within cap');
  assert(maxQ <= 32, 'per-context value table stays within cap');
  assert(maxRel <= 16, 'relationships stay within cap');
  assert(maxAgentMem <= 20, 'episodic memory stays within cap');
  assert(maxDialect <= 16, 'tribe dialect stays within cap');
  assert((w.discoveries ?? []).length <= 300, 'discovery registry stays within cap');
  assert((w.cultures ?? []).length <= 200, 'culture registry stays within cap');
  assert(
    w.conversationLog.length <= 500 && w.chronicle.length <= 2000 && w.history.length <= 1500,
    'log / chronicle / history ring buffers stay bounded',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
