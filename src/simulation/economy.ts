import { CITY } from './config';
import type { EconomyStats, WorldState } from './types';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Gini coefficient over a set of non-negative values (0 = perfect equality, →1 = maximal
 * inequality). Used as the world inequality index over agent energies.
 */
export function gini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  let cum = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    cum += sorted[i] * (i + 1);
    total += sorted[i];
  }
  if (total <= 0) return 0;
  return clamp01((2 * cum) / (n * total) - (n + 1) / n);
}

const EMPTY_ECONOMY: EconomyStats = {
  totalEnergy: 0,
  avgEnergy: 0,
  medianEnergy: 0,
  minEnergy: 0,
  maxEnergy: 0,
  inequalityIndex: 0,
  richestId: -1,
  richestEnergy: 0,
  poorestId: -1,
  poorestEnergy: 0,
  starvationCount: 0,
  unrestLevel: 0,
  rebellionRisk: 0,
};

export function emptyEconomy(): EconomyStats {
  return { ...EMPTY_ECONOMY };
}

/**
 * Recompute world economic metrics. Unrest rises with inequality and starvation;
 * rebellion risk blends overall unrest with average city unrest. Stage 7 reads these.
 */
export function computeEconomy(world: WorldState): EconomyStats {
  const agents = world.agents;

  // Phase 3: economy is derived from actual LIVING agents (not stale/dead entries). In normal
  // flow the dead are culled each tick so this matches; being explicit makes it correct even
  // when called on a freshly-loaded or hand-constructed world that still holds dead agents.
  const energies: number[] = [];
  let total = 0;
  let richest = -Infinity;
  let richestId = -1;
  let poorest = Infinity;
  let poorestId = -1;
  let starvation = 0;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive) continue;
    const e = a.energy;
    energies.push(e);
    total += e;
    if (e > richest) {
      richest = e;
      richestId = a.id;
    }
    if (e < poorest) {
      poorest = e;
      poorestId = a.id;
    }
    if (e < CITY.starveThreshold) starvation += 1;
  }
  const n = energies.length;
  if (n === 0) return emptyEconomy();

  let stored = 0;
  for (const c of world.cities) stored += c.storedEnergy;
  for (const t of world.tribes) stored += t.sharedEnergy;

  const inequality = gini(energies);
  const starvationFrac = starvation / n;
  const unrest = clamp01(inequality * 0.6 + starvationFrac * 0.5);

  let cityUnrest = 0;
  for (const c of world.cities) cityUnrest += c.unrest;
  cityUnrest = world.cities.length > 0 ? cityUnrest / world.cities.length : 0;
  const rebellion = clamp01(unrest * 0.6 + cityUnrest * 0.4);

  // median (sort a copy; n is bounded by maxAgents so this is cheap)
  const sortedE = energies.slice().sort((a, b) => a - b);
  const mid = n >> 1;
  const median = n % 2 === 1 ? sortedE[mid] : (sortedE[mid - 1] + sortedE[mid]) / 2;

  return {
    totalEnergy: total + stored,
    avgEnergy: total / n,
    medianEnergy: median,
    minEnergy: poorest,
    maxEnergy: richest,
    inequalityIndex: inequality,
    richestId,
    richestEnergy: richest,
    poorestId,
    poorestEnergy: poorest,
    starvationCount: starvation,
    unrestLevel: unrest,
    rebellionRisk: rebellion,
  };
}

/**
 * Fresh, authoritative recomputation of world economy from the *current* living agents and
 * city/tribe treasuries — never a cached read. The spec (Phase 3) requires this be called
 * before every save, after every load, and after every tick batch. Identical to
 * `computeEconomy`; the distinct name documents intent at call sites.
 */
export const recalculateEconomy = computeEconomy;
