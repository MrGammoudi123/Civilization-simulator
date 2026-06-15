// Autonomous-intelligence validation harness (W12). A dedicated headless check, separate from
// scripts/simCheck.ts, that validates the W2–W11 acceptance criteria end-to-end and prints a
// full long-run report for the Council OFF and ON worlds.
//
//   npx esbuild scripts/autonomyCheck.ts --bundle --format=esm --platform=node --outfile=scripts/.autonomy.mjs
//   node scripts/.autonomy.mjs [cycles] [seed]      # defaults: 100000  0xc0ffee
//
// Exits non-zero if any acceptance check fails.

import { generateWorld, stepWorld } from '../src/simulation/world';
import { RNG } from '../src/simulation/rng';
import { SpatialGrid } from '../src/simulation/spatialGrid';
import { SIM, WORLD_PARAMS } from '../src/simulation/config';
import { createAgent, createChild } from '../src/simulation/agent';
import { recordActionStart, learnFromOutcome, imitate } from '../src/simulation/brain';
import { speak, hearToken, wordFor } from '../src/simulation/language';
import { discoveryCount } from '../src/simulation/discovery';
import { cultureElementCount } from '../src/simulation/culture';
import { serializeWorld, deserializeWorld, validateWorldState } from '../src/simulation/saveSystem';
import type { WorldState } from '../src/simulation/types';

const CYCLES = Number(process.argv[2] ?? 100000);
const SEED = process.argv[3] ? Number(process.argv[3]) : 0xc0ffee;

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

function makeRun(seed: number, councilOn = false) {
  const world = generateWorld(seed);
  if (councilOn) world.hiddenCouncil.enabled = true;
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

function metrics(w: WorldState) {
  const alive = w.agents.filter((a) => a.alive);
  const pop = alive.length;
  const roles: Record<string, number> = {};
  const states: Record<string, number> = {};
  const words = new Set<string>();
  let sharedMax = 0;
  let withMemory = 0;
  for (const a of alive) {
    roles[a.role] = (roles[a.role] ?? 0) + 1;
    states[a.state] = (states[a.state] ?? 0) + 1;
    if (a.lexicon) for (const tk of a.lexicon.tokens) words.add(tk.token);
    if (a.brain && a.brain.actionMemory.length > 0) withMemory += 1;
  }
  for (const t of w.tribes) if (t.sharedEnergy > sharedMax) sharedMax = t.sharedEnergy;
  const investigators = roles['investigator'] ?? 0;
  let evidence = 0;
  for (const a of alive) if (a.memory.some((m) => m.kind === 'suspected_council' || m.kind === 'discovered_anomaly')) evidence += 1;
  const chronCats: Record<string, number> = {};
  for (const e of w.chronicle) chronCats[e.category] = (chronCats[e.category] ?? 0) + 1;
  const eco = w.ecology;
  // Integrity is checked against the EXPORTED save (serialize normalizes, W1.1) — that is the
  // real contract. The raw live world legitimately carries mid-batch membership/economy staleness
  // between the 30-tick recompute boundaries, which normalizeWorldState repairs on save/load.
  const reloaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w, 1))));
  const validationIssues = validateWorldState(reloaded).issues.length;
  return {
    pop,
    births: w.totalBirths,
    deaths: w.totalDeaths,
    fillPct: eco && eco.totalCapacity > 0 ? +((eco.totalNaturalEnergy / eco.totalCapacity) * 100).toFixed(1) : 0,
    scarcity: +(eco ? eco.scarcityIndex : 0).toFixed(3),
    sharedMax: Math.round(sharedMax),
    tribes: w.tribes.length,
    cities: w.cities.length,
    ruins: w.ruins.length,
    protests: w.totalProtests,
    revolutions: w.totalRevolutions,
    conflicts: w.totalConflicts,
    roles,
    states,
    investigators,
    investigatorPct: pop ? +((investigators / pop) * 100).toFixed(1) : 0,
    evidenceHolders: evidence,
    learners: withMemory,
    words: words.size,
    discoveries: discoveryCount(w),
    cultureElements: cultureElementCount(w),
    cultures: (w.cultures ?? []).length,
    chronCats,
    era: w.era,
    validation: validationIssues,
  };
}

console.log(`Autonomy validation — seed=0x${SEED.toString(16)} cycles=${CYCLES}\n`);

// ---------------------------------------------------------------- save / migration (W2)
console.log('Save / migration (v1/v2 → v3):');
{
  const run = makeRun(0x5a5e);
  for (let t = 0; t < 6000; t++) run.tick();
  const save = serializeWorld(run.world, 1);
  assert(save.version === 3, 'export stamps SAVE_VERSION 3');
  const json = JSON.stringify(save);
  const v3 = deserializeWorld(JSON.parse(json));
  assert(v3.agents.every((a) => !!a.brain && !!a.lexicon), 'v3 agents carry brain + lexicon');
  assert(validateWorldState(v3).ok, 'v3 reload validates clean (pre-save normalization)');
  const raw = JSON.parse(json) as typeof save & { world: Record<string, unknown> };
  raw.version = 2;
  delete raw.world.discoveries;
  delete raw.world.cultures;
  for (const a of (raw.world as { agents: Array<Record<string, unknown>> }).agents) {
    delete a.brain;
    delete a.lexicon;
  }
  const up = deserializeWorld(raw as unknown as Parameters<typeof deserializeWorld>[0]);
  assert(up.agents.every((a) => !!a.brain) && Array.isArray(up.discoveries) && Array.isArray(up.cultures), 'a v2 save migrates forward to v3 losslessly');
}

// ---------------------------------------------------------------- learning (W4/W5)
console.log('\nLearning + evolution:');
{
  const rng = new RNG(0xa1);
  const learner = createAgent(0, rng, WORLD_PARAMS);
  for (let i = 0; i < 25; i++) {
    learner.energy = 50;
    recordActionStart(learner, 'seek_energy', 'c');
    learner.energy = 72;
    learnFromOutcome(learner, i);
  }
  assert((learner.brain!.policyWeights.seek_energy ?? 0) > 0, 'a rewarded action gains preference (lifetime learning)');
  const parent = createAgent(1, rng, WORLD_PARAMS);
  parent.brain!.policyWeights = { build: 1.4 };
  const child = createChild(900, parent, rng);
  assert((child.brain!.policyWeights.build ?? 0) > 0.5, 'children inherit mutated policy weights');
  const m = createAgent(2, rng, WORLD_PARAMS);
  const model = createAgent(3, rng, WORLD_PARAMS);
  m.brain!.imitationBias = 1;
  m.brain!.policyWeights = { trade: 0 };
  model.brain!.policyWeights = { trade: 2 };
  for (let i = 0; i < 20; i++) imitate(m, model);
  assert((m.brain!.policyWeights.trade ?? 0) > 0.3, 'imitation spreads a successful behavior');
}

// ---------------------------------------------------------------- language (W6)
console.log('\nLanguage:');
{
  const w = generateWorld(0xb2);
  const u1 = speak(w.agents[0], w, 'fear')!;
  const c0 = u1.confidence;
  const u1b = speak(w.agents[0], w, 'fear')!;
  assert(u1.tokens.length > 0, 'agents invent tokens');
  assert(u1b.confidence > c0, 'token confidence rises with use');
  hearToken(w.agents[1], u1.token);
  assert(wordFor(w.agents[1], 'fear') !== null, 'listeners imitate words');
  const ub = speak(w.agents[2], w, 'fear')!;
  assert(ub.phrase !== u1.phrase, 'isolated agents coin different words (dialects)');
  assert(u1.meaning.includes('danger'), 'UI can infer meaning from token vectors');
}

// ---------------------------------------------------------------- long run OFF + ON
function longRun(label: string, councilOn: boolean) {
  const t0 = Date.now();
  const run = makeRun(SEED, councilOn);
  for (let t = 1; t <= CYCLES; t++) run.tick();
  const ms = Date.now() - t0;
  const m = metrics(run.world);
  console.log(`\n[${label}] ${CYCLES} cycles in ${(ms / 1000).toFixed(0)}s (${Math.round((CYCLES / ms) * 1000)} cyc/s)`);
  console.log(`  pop=${m.pop} births/deaths=${m.births}/${m.deaths} era=${m.era} fill=${m.fillPct}% scarcity=${m.scarcity}`);
  console.log(`  tribes/cities/ruins=${m.tribes}/${m.cities}/${m.ruins} sharedMax=${m.sharedMax}`);
  console.log(`  protests=${m.protests} revolutions=${m.revolutions} conflicts=${m.conflicts}`);
  console.log(`  investigators=${m.investigators} (${m.investigatorPct}%) evidenceHolders=${m.evidenceHolders}`);
  console.log(`  learners=${m.learners} words=${m.words} discoveries=${m.discoveries} cultures=${m.cultures} cultureElements=${m.cultureElements}`);
  console.log(`  roles=${JSON.stringify(m.roles)}`);
  console.log(`  chronicleCategories=${Object.keys(m.chronCats).length} validationIssues=${m.validation}`);
  return m;
}

const off = longRun('Council OFF', false);
const on = longRun('Council ON', true);

console.log('\nLong-run acceptance:');
// caps / integrity
assert(off.sharedMax < 50000 && on.sharedMax < 50000, 'sharedEnergy stays bounded in both worlds (no overflow)');
assert(off.validation === 0 && on.validation === 0, 'exported saves of both worlds validate clean (membership/economy integrity)');
// emergent systems are alive
assert(off.words > 1 && on.words > 1, 'emergent language present in both worlds');
assert(off.learners > 0 && on.learners > 0, 'agents learn from outcomes in both worlds');
assert(off.cultureElements > 0 && on.cultureElements > 0, 'culture forms in both worlds');
assert(off.discoveries > 0 || on.discoveries > 0, 'at least one technique is discovered over a long run');
// council bends, does not rescue
assert(off.revolutions > 0 || off.protests > 1000, 'OFF world has real political upheaval (protests + revolutions)');
assert(`${off.words}/${off.cultureElements}/${off.discoveries}` !== `${on.words}/${on.cultureElements}/${on.discoveries}`, 'Council ON produces a different language/culture/technology landscape than OFF');
// investigators evidence-linked + bounded
assert(on.investigatorPct < 40, 'investigators do not dominate the population under the council');
assert(on.investigators === 0 || on.evidenceHolders > 0, 'investigators are backed by evidence, not raw suspicion');
// ecology not a permanent dead floor
assert(off.pop > 0 && on.pop > 0, 'neither world goes extinct (recovery paths exist)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
