/* eslint-disable no-console */
// Phase 1 verification against the real uploaded v1 save. Bundle + run:
//   npx esbuild scripts/phase1Check.ts --bundle --format=esm --platform=node --outfile=scripts/.p1.mjs
//   node scripts/.p1.mjs "<path-to-save.json>"
import fs from 'node:fs';
import { createCouncil } from '../src/simulation/hiddenCouncil';
import { deserializeWorld, serializeWorld, migrateSave } from '../src/simulation/saveSystem';
import { normalizeWorldState, validateWorldState } from '../src/simulation/validation';
import { recalculateEconomy } from '../src/simulation/economy';
import type { SaveData } from '../src/simulation/saveSystem';
import type { WorldState } from '../src/simulation/types';

const SAVE = process.argv[2] ?? 'C:/Users/MrGammoudi/Downloads/genesis-save-2026-06-14-12-43-15.json';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  PASS: ${label}${extra ? ' — ' + extra : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL: ${label}${extra ? ' — ' + extra : ''}`);
  }
}

// Build a world WITHOUT normalization, to measure the "before" state.
function rawWorld(data: SaveData): WorldState {
  const m = migrateSave(data);
  const w = m.world;
  return {
    ...w,
    agents: (w.agents ?? []).map((a) => ({ ...a, relationships: new Map(a.relationships ?? []) })),
    tribes: (w.tribes ?? []).map((t) => ({ ...t, relations: new Map(t.relations ?? []) })),
    hiddenCouncil: w.hiddenCouncil ?? createCouncil(),
  } as WorldState;
}

const data: SaveData = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
console.log(`\nPhase 1 — Save Integrity & Migration  (save v${data.version}, ${SAVE.split(/[\\/]/).pop()})\n`);

// ---- BEFORE normalization ----
const raw = rawWorld(data);
const before = validateWorldState(raw, data.version);
const beforeDeadRel = before.issues.find((i) => i.kind === 'dead_relationship_target')?.count ?? 0;
const beforeDeadWatch = before.issues.find((i) => i.kind === 'dead_watched_agent')?.count ?? 0;
console.log('BEFORE normalize:');
console.log(`  issues: ${before.issues.map((i) => `${i.kind}=${i.count}`).join(', ') || 'none'}`);
check('the raw v1 save has the expected corruption (dead relationships present)', beforeDeadRel > 0, `${beforeDeadRel} dead rels`);

const aliveBefore = raw.agents.filter((a) => a.alive).length;

// ---- migrate + normalize via the real load path ----
const world = deserializeWorld(data);
const after = validateWorldState(world, data.version);
console.log('\nAFTER migrate + normalize:');
console.log(`  issues: ${after.issues.map((i) => `${i.kind}=${i.count}`).join(', ') || 'none'}`);

check('migration does not crash and returns a world', !!world);
check('all living agents preserved', world.agents.filter((a) => a.alive).length === aliveBefore, `${aliveBefore} agents`);
check('Pale Accord city still exists', world.cities.some((c) => c.name === 'Pale Accord'));
check('the tribe still exists with a rebuilt member list', world.tribes.length >= 1 && world.tribes[0].memberIds.length === world.tribes[0].population);
check('tribe membership == living agents with that tribeId', (() => {
  for (const t of world.tribes) {
    const actual = world.agents.filter((a) => a.alive && a.tribeId === t.id).length;
    if (actual !== t.population || actual !== t.memberIds.length) return false;
  }
  return true;
})());
check('city population == living residents', (() => {
  for (const c of world.cities) {
    const actual = world.agents.filter((a) => a.alive && a.cityId === c.id).length;
    if (actual !== c.population) return false;
  }
  return true;
})());

const deadRelAfter = after.issues.find((i) => i.kind === 'dead_relationship_target')?.count ?? 0;
const deadWatchAfter = after.issues.find((i) => i.kind === 'dead_watched_agent')?.count ?? 0;
check('0 dead relationships after normalize', deadRelAfter === 0, `was ${beforeDeadRel}`);
check('0 dead watched agents after normalize', deadWatchAfter === 0, `was ${beforeDeadWatch}`);
check('every tribe/city leader is alive or null', (() => {
  const alive = new Set(world.agents.filter((a) => a.alive).map((a) => a.id));
  for (const t of world.tribes) if (t.leaderId !== null && !alive.has(t.leaderId)) return false;
  for (const c of world.cities) if (c.leaderId !== null && !alive.has(c.leaderId)) return false;
  return true;
})());

// economy freshness
const fresh = recalculateEconomy(world);
check('economy matches a fresh recompute (totalEnergy)', Math.abs(fresh.totalEnergy - world.economy.totalEnergy) < 1e-6);
check('economy richest/poorest are living agents', (() => {
  const alive = new Set(world.agents.filter((a) => a.alive).map((a) => a.id));
  return alive.has(world.economy.richestId) && alive.has(world.economy.poorestId);
})());
check('economy has median/min/max populated', Number.isFinite(world.economy.medianEnergy) && world.economy.maxEnergy >= world.economy.minEnergy);
check('validation report is clean after normalize', after.ok, after.ok ? '' : after.issues.map((i) => i.kind).join(','));

// ---- round-trip stability ----
const reser = serializeWorld(world, Date.now());
check('re-serialized save is stamped v2', reser.version === 2);
const reloaded = deserializeWorld(reser);
check('round-trip preserves agent count', reloaded.agents.length === world.agents.length);
check('round-trip preserves economy.totalEnergy', Math.abs(reloaded.economy.totalEnergy - world.economy.totalEnergy) < 1e-6);
check('round-trip preserves RNG state (determinism)', reloaded.rngState === world.rngState);
check('round-trip validation stays clean', validateWorldState(reloaded).ok);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
