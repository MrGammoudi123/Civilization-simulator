import { RNG } from './rng';
import type { EnergyKind, EnergySource, WorldParams } from './types';

interface KindSpec {
  capacity: [number, number];
  regen: [number, number];
  radius: [number, number];
}

// Phase 4 ecology: common (small/plentiful), rare (large), unstable (volatile), hidden (must
// be discovered), renewable (the stable backbone — strong regen, never collapses), deep (huge
// but slow, spawned far out during scarcity), sacred (steady, settlement-adjacent).
const KIND_SPECS: Record<EnergyKind, KindSpec> = {
  common: { capacity: [60, 120], regen: [0.1, 0.22], radius: [10, 18] },
  rare: { capacity: [180, 320], regen: [0.2, 0.4], radius: [16, 26] },
  unstable: { capacity: [80, 200], regen: [0.05, 0.55], radius: [12, 20] },
  hidden: { capacity: [120, 260], regen: [0.1, 0.26], radius: [12, 20] },
  renewable: { capacity: [90, 170], regen: [0.45, 0.8], radius: [12, 20] },
  deep: { capacity: [320, 560], regen: [0.18, 0.34], radius: [20, 32] },
  sacred: { capacity: [140, 240], regen: [0.16, 0.3], radius: [14, 22] },
};

// Baseline (genesis + replacement) distribution is kept identical to the original so the
// world's population equilibrium (~150–250) is unchanged. The new renewable/deep/sacred kinds
// arrive via scarcity-triggered recovery blooms (see ecology.ts) — they are *relief*, not a
// permanent fertility boost, which keeps scarcity meaningful instead of trivialised.
function pickKind(rng: RNG): EnergyKind {
  const r = rng.next();
  if (r < 0.66) return 'common';
  if (r < 0.8) return 'rare';
  if (r < 0.92) return 'unstable';
  return 'hidden';
}

export function createEnergySource(
  id: number,
  rng: RNG,
  params: WorldParams,
  forcedKind?: EnergyKind,
): EnergySource {
  const kind = forcedKind ?? pickKind(rng);
  const spec = KIND_SPECS[kind];
  const capacity = rng.range(spec.capacity[0], spec.capacity[1]);
  return {
    id,
    x: rng.range(0, params.width),
    y: rng.range(0, params.height),
    capacity,
    amount: capacity * rng.range(0.4, 1.0),
    regen: rng.range(spec.regen[0], spec.regen[1]),
    radius: rng.range(spec.radius[0], spec.radius[1]),
    kind,
    // hidden sources start undiscovered; everything else is visible from the start.
    discovered: kind !== 'hidden',
  };
}

/** Per-tick regeneration, tiered by kind (Phase 4). */
export function regenEnergy(src: EnergySource, rng: RNG): void {
  if (src.kind === 'unstable') {
    // net-positive but volatile; rare catastrophic collapse
    src.amount += (rng.next() - 0.4) * src.regen * 3;
    if (rng.chance(0.0008)) src.amount *= 0.25;
  } else if (src.kind === 'renewable') {
    // the ecological backbone: regenerates strongly and CANNOT collapse — a self-healing
    // floor that gives a depleted world something to recover from.
    src.amount += src.regen;
  } else {
    src.amount += src.regen;
  }

  // Depleted sources recover after a long rest: a source scraped near-empty gets a small
  // self-healing nudge so it can climb back once harvest pressure eases (renewable excluded —
  // it already regenerates strongly).
  if (src.kind !== 'renewable' && src.amount < src.capacity * 0.04) {
    src.amount += src.regen * 0.5;
  }

  if (src.amount < 0) src.amount = 0;
  else if (src.amount > src.capacity) src.amount = src.capacity;
}
