import { RNG } from './rng';
import { SIM } from './config';
import { SpatialGrid } from './spatialGrid';
import { stepWorld } from './world';
import type { ChronicleEvent, WorldState } from './types';

/**
 * Offline evolution. When a saved world is reopened, the elapsed real-world time is
 * converted into simulation cycles and the world is fast-forwarded deterministically. The
 * run is time-sliced (chunked with yields) so it never freezes the tab, and tiered so very
 * long absences are capped rather than simulating literal weeks tick-by-tick:
 *
 *   < 1h    "recent"  → up to 30k cycles (typically the full elapsed amount)
 *   1–12h   "medium"  → up to 60k cycles
 *   > 12h   "long"    → up to 90k cycles (abstracted: capped)
 *
 * Determinism: the fast-forward uses the world's restored RNG state, so the result depends
 * only on the loaded world + elapsed time — never on wall-clock chunk timing.
 */

export const OFFLINE_CYCLES_PER_SEC = 8; // matches the ×1 base tick rate

export type OfflineTier = 'recent' | 'medium' | 'long';

const TIER_CAP: Record<OfflineTier, number> = {
  recent: 30000,
  medium: 60000,
  long: 90000,
};

const CHUNK = 2000;

export interface OfflinePlan {
  tier: OfflineTier;
  rawCycles: number;
  targetCycles: number;
  capped: boolean;
}

export function planOffline(elapsedMs: number): OfflinePlan {
  const secs = Math.max(0, elapsedMs) / 1000;
  const hours = secs / 3600;
  const tier: OfflineTier = hours < 1 ? 'recent' : hours < 12 ? 'medium' : 'long';
  const rawCycles = Math.floor(secs * OFFLINE_CYCLES_PER_SEC);
  const cap = TIER_CAP[tier];
  const targetCycles = Math.min(rawCycles, cap);
  return { tier, rawCycles, targetCycles, capped: rawCycles > cap };
}

export interface OfflineReport {
  timeAwayMs: number;
  tier: OfflineTier;
  cyclesSimulated: number;
  capped: boolean;
  populationBefore: number;
  populationAfter: number;
  inequalityBefore: number;
  inequalityAfter: number;
  births: number;
  deaths: number;
  tribesFormed: number;
  citiesFounded: number;
  revolutions: number;
  conflicts: number;
  collapses: number;
  events: ChronicleEvent[]; // most significant new events, for the report
  summary: string;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} hour${h > 1 ? 's' : ''} and ${m} minute${m !== 1 ? 's' : ''}`;
  if (m > 0) return `${m} minute${m > 1 ? 's' : ''}`;
  return `${sec} second${sec !== 1 ? 's' : ''}`;
}

/**
 * Fast-forward `world` (mutated in place) by the elapsed time, yielding between chunks.
 * The caller adopts the evolved world afterward (engine.loadSerialized) to re-sync the RNG.
 */
export async function runOfflineEvolution(
  world: WorldState,
  timeAwayMs: number,
  onProgress?: (fraction: number) => void,
): Promise<OfflineReport> {
  const plan = planOffline(timeAwayMs);

  const before = {
    population: world.agents.length,
    inequality: world.economy.inequalityIndex,
    births: world.totalBirths,
    deaths: world.totalDeaths,
    nextTribeId: world.nextTribeId,
    nextCityId: world.nextCityId,
    revolutions: world.totalRevolutions,
    conflicts: world.totalConflicts,
    chronicleLen: world.chronicle.length,
  };

  const rng = new RNG(world.rngState);
  const grid = new SpatialGrid(world.params.width, world.params.height, SIM.spatialCellSize);

  let done = 0;
  while (done < plan.targetCycles && world.agents.length > 0) {
    const n = Math.min(CHUNK, plan.targetCycles - done);
    for (let i = 0; i < n; i++) {
      stepWorld(world, rng, grid);
      world.rngState = rng.getState();
      if (world.agents.length === 0) break;
    }
    done += n;
    if (onProgress) onProgress(done / plan.targetCycles);
    await nextTick();
  }

  const newEvents = world.chronicle.slice(before.chronicleLen);
  const collapses = newEvents.filter((e) => e.category === 'collapse').length;
  const topEvents = newEvents
    .slice()
    .sort((a, b) => b.severity - a.severity || a.cycle - b.cycle)
    .slice(0, 8);

  const report: OfflineReport = {
    timeAwayMs,
    tier: plan.tier,
    cyclesSimulated: done,
    capped: plan.capped,
    populationBefore: before.population,
    populationAfter: world.agents.length,
    inequalityBefore: before.inequality,
    inequalityAfter: world.economy.inequalityIndex,
    births: world.totalBirths - before.births,
    deaths: world.totalDeaths - before.deaths,
    tribesFormed: world.nextTribeId - before.nextTribeId,
    citiesFounded: world.nextCityId - before.nextCityId,
    revolutions: world.totalRevolutions - before.revolutions,
    conflicts: world.totalConflicts - before.conflicts,
    collapses,
    events: topEvents,
    summary: '',
  };
  report.summary = buildSummary(report);
  return report;
}

function buildSummary(r: OfflineReport): string {
  const parts: string[] = [
    `While you were away for ${fmtDuration(r.timeAwayMs)}, ${r.cyclesSimulated.toLocaleString()} cycles passed.`,
  ];
  if (r.births || r.deaths) parts.push(`${r.births} were born and ${r.deaths} died.`);
  if (r.tribesFormed) parts.push(`${r.tribesFormed} new tribe${r.tribesFormed > 1 ? 's' : ''} formed.`);
  if (r.citiesFounded) parts.push(`${r.citiesFounded} cit${r.citiesFounded > 1 ? 'ies' : 'y'} rose.`);
  if (r.revolutions) parts.push(`${r.revolutions} revolution${r.revolutions > 1 ? 's' : ''} erupted.`);
  if (r.collapses) parts.push(`${r.collapses} group${r.collapses > 1 ? 's' : ''} collapsed.`);
  const dPop = r.populationAfter - r.populationBefore;
  parts.push(`Population ${dPop >= 0 ? 'grew' : 'fell'} from ${r.populationBefore} to ${r.populationAfter}.`);
  const dIneq = r.inequalityAfter - r.inequalityBefore;
  if (Math.abs(dIneq) > 0.02) {
    parts.push(
      `Inequality ${dIneq > 0 ? 'rose' : 'eased'} (${r.inequalityBefore.toFixed(2)} → ${r.inequalityAfter.toFixed(2)}).`,
    );
  }
  if (r.populationAfter === 0) parts.push('The civilization went extinct in your absence.');
  if (r.capped) parts.push('(Long absence — evolution was compressed.)');
  return parts.join(' ');
}
