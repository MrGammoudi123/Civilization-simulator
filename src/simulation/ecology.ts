import { RNG } from './rng';
import { ECOLOGY } from './config';
import { createEnergySource } from './energy';
import { recordEvent } from './chronicle';
import type { EcologyMetrics, EnergyKind, WorldState } from './types';

/**
 * Resource ecology (Phase 4). The original world drained its energy field to a permanent
 * near-zero floor: harvest (~1.8/tick) vastly outpaced per-source regen (~0.1–0.55/tick) and
 * nothing ever expanded the world's carrying capacity, so ~187 agents starved forever.
 *
 * This module treats the field as a living system. It measures scarcity each batch, and when
 * scarcity stays critical it lets recovery pressure build until a "recovery bloom" wells up a
 * few distant renewable/deep sources — making scarcity *cyclical* (collapse → recovery →
 * pressure → collapse) instead of terminal. Energy is never infinite: blooms are capped,
 * cooled down, and gated on genuine, sustained scarcity.
 */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function emptyEcology(): EcologyMetrics {
  return {
    totalNaturalEnergy: 0,
    totalCapacity: 0,
    renewableEnergyRate: 0,
    depletionRate: 0,
    scarcityIndex: 0,
    collapseRisk: 0,
    recoveryPressure: 0,
    lastRecoveryCycle: 0,
  };
}

/**
 * Measure the field. `recoveryPressure` and `lastRecoveryCycle` are carried from the previous
 * sample (they are driven by `updateEcology`, not measured here). `depletionRate` is the
 * natural energy lost since the previous sample.
 */
export function computeEcology(world: WorldState): EcologyMetrics {
  const prev = world.ecology;
  let total = 0;
  let cap = 0;
  let renew = 0;
  for (const s of world.energySources) {
    total += s.amount;
    cap += s.capacity;
    if (s.kind === 'renewable' || s.kind === 'sacred' || s.kind === 'deep') renew += s.regen;
  }
  const fill = cap > 0 ? total / cap : 0;
  const scarcity = clamp01(1 - fill);
  const depletion = prev ? Math.max(0, prev.totalNaturalEnergy - total) : 0;
  const collapseRisk = clamp01(
    scarcity * 0.6 + Math.max(0, (ECOLOGY.collapseFloor - fill) / ECOLOGY.collapseFloor) * 0.4,
  );
  return {
    totalNaturalEnergy: total,
    totalCapacity: cap,
    renewableEnergyRate: renew,
    depletionRate: depletion,
    scarcityIndex: scarcity,
    collapseRisk,
    recoveryPressure: prev ? prev.recoveryPressure : 0,
    lastRecoveryCycle: prev ? prev.lastRecoveryCycle : 0,
  };
}

/**
 * The world's current carrying capacity in number of sources (W1.5). It scales with the
 * harvesting population — more mouths earn a higher ceiling of relief — but is hard-capped at
 * `absoluteMaxSources` so energy is never infinite. Both ecology blooms and (W1.3) the Hidden
 * Council's energy spawns respect this single ceiling.
 */
export function currentMaxSources(world: WorldState): number {
  const pop = world.agents.length; // post-cull (all alive at the batch boundary)
  return Math.min(
    ECOLOGY.absoluteMaxSources,
    ECOLOGY.maxSources + Math.floor(pop * ECOLOGY.sourcesPerAgent),
  );
}

/**
 * Advance the ecology one batch: measure it, build/relax recovery pressure, and fire a
 * recovery bloom when sustained scarcity warrants it. Called every economy interval from
 * stepWorld. Deterministic (all randomness flows through the world RNG).
 *
 * W1.5 — prolonged *critical* scarcity earns a larger "renewal" bloom on a shorter cooldown, so
 * a depleted world has a genuine recovery path (scarcity becomes cyclical instead of a permanent
 * Dark Age floor). Capacity scales with population via `currentMaxSources`; energy stays finite.
 */
export function updateEcology(world: WorldState, rng: RNG): void {
  const ec = computeEcology(world);
  if (ec.scarcityIndex > ECOLOGY.scarcityHigh) {
    ec.recoveryPressure = clamp01(ec.recoveryPressure + ECOLOGY.pressureGain);
  } else {
    ec.recoveryPressure = clamp01(ec.recoveryPressure - ECOLOGY.pressureDecay);
  }
  world.ecology = ec;

  const maxSrc = currentMaxSources(world);
  const critical =
    ec.scarcityIndex >= ECOLOGY.criticalScarcity && ec.recoveryPressure >= ECOLOGY.criticalPressure;
  const cooldown = critical ? ECOLOGY.bloomCooldownCritical : ECOLOGY.bloomCooldown;
  const want = critical ? ECOLOGY.bloomSourcesCritical : ECOLOGY.bloomSources;
  const cooledDown = world.cycle - ec.lastRecoveryCycle >= cooldown;

  if (ec.recoveryPressure >= ECOLOGY.bloomPressure && cooledDown && world.energySources.length < maxSrc) {
    // renewal blooms favor the non-collapsing backbone (renewable/deep) so relief actually holds
    const kinds: EnergyKind[] = critical
      ? ['renewable', 'renewable', 'deep', 'renewable', 'deep']
      : ['renewable', 'renewable', 'deep', 'hidden'];
    let spawned = 0;
    for (let i = 0; i < want && world.energySources.length < maxSrc; i++) {
      const kind = kinds[i % kinds.length];
      const src = createEnergySource(world.nextEnergyId++, rng, world.params, kind);
      src.amount = src.capacity * rng.range(0.6, 1.0); // blooms arrive fairly full
      // a hidden bloom must still be discovered; everything else is visible relief
      src.discovered = kind !== 'hidden';
      world.energySources.push(src);
      spawned += 1;
    }
    ec.lastRecoveryCycle = world.cycle;
    ec.recoveryPressure *= 0.35;
    if (spawned > 0) {
      recordEvent(world, {
        category: 'discovery',
        severity: critical ? 3 : 2,
        title: critical ? 'A Great Renewal' : 'New Springs',
        description: `As scarcity bit deep, ${spawned} energy sources welled up in the distant wilds.`,
      });
    }
  }
}
