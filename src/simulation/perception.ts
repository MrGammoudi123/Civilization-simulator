import { SIM } from './config';
import type { Agent, City, Perception, Tribe, WorldState } from './types';

/**
 * Perception (W3). Each deciding agent compresses its situation into a small, normalized vector
 * that the action-utility system (actions.ts) and the learning brain (brain.ts, W4) read. It is
 * recomputed each decision and never stored on the agent.
 *
 * Most fields are derived from the neighbor scan the decision pass already performs, handed in
 * as `PerceptionInputs` so we don't scan twice. Pure + deterministic (no RNG).
 */

export interface PerceptionInputs {
  nearbyCount: number;
  nearbyAllies: number; // neighbors with positive sentiment
  nearbyEnemies: number; // hostile / enemy-tribe neighbors
  danger: number; // strongest threat seen (0..~1)
  trustSum: number; // Σ trust toward nearby (for an average)
  trustCount: number;
  socialOpportunity: number; // a good ally/leader/help target is present (0..1)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function emptyPerceptionInputs(): PerceptionInputs {
  return {
    nearbyCount: 0,
    nearbyAllies: 0,
    nearbyEnemies: 0,
    danger: 0,
    trustSum: 0,
    trustCount: 0,
    socialOpportunity: 0,
  };
}

export function computePerception(
  a: Agent,
  world: WorldState,
  inp: PerceptionInputs,
  myTribe: Tribe | undefined,
  myCity: City | undefined,
): Perception {
  const frac = a.maxEnergy > 0 ? a.energy / a.maxEnergy : 0;

  // nearest available energy → proximity in 0..1 (linear scan over the bounded source list)
  let nearestD = Infinity;
  const sources = world.energySources;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s.amount < 1) continue;
    if (s.kind === 'hidden' && !s.discovered) continue;
    const d = Math.hypot(a.x - s.x, a.y - s.y);
    if (d < nearestD) nearestD = d;
  }
  const nearbyEnergy =
    nearestD === Infinity ? 0 : clamp01(1 - nearestD / (SIM.perceptionRadius * 1.5));

  // personal evidence that the world is watched (council suspicion / anomaly memories)
  let suspicion = 0;
  for (const m of a.memory) {
    if (m.kind === 'suspected_council') suspicion += 0.5;
    else if (m.kind === 'discovered_anomaly') suspicion += 0.4;
    else if (m.kind === 'witnessed_miracle') suspicion += 0.15;
  }

  const econ = world.economy;
  const scarcity = world.ecology ? world.ecology.scarcityIndex : 0;
  const tribeStability = myTribe ? myTribe.stability : 0.5;
  const cityUnrest = myCity ? myCity.unrest : econ ? econ.unrestLevel : 0;
  const inequality = myCity ? myCity.inequality : econ ? econ.inequalityIndex : 0;

  return {
    energyFrac: clamp01(frac),
    danger: clamp01(inp.danger),
    nearbyEnergy,
    nearbyAllies: clamp01(inp.nearbyAllies / 8), // normalized (≈ a "crowd of allies" at 8+)
    nearbyEnemies: clamp01(inp.nearbyEnemies / 8),
    nearbyCity: a.cityId !== null,
    tribeStability: clamp01(tribeStability),
    cityUnrest: clamp01(cityUnrest),
    inequality: clamp01(inequality),
    scarcity: clamp01(scarcity),
    trustNearby: inp.trustCount > 0 ? clamp01(inp.trustSum / inp.trustCount) : 0,
    suspicionEvidence: clamp01(suspicion),
    socialOpportunity: clamp01(inp.socialOpportunity),
    // a rough opportunity-to-experiment signal until W7 grounds it in real materials:
    // curious/intelligent minds near energy or anomalies sense something to probe.
    experimentOpportunity: clamp01(
      a.traits.curiosity * 0.5 + a.traits.intelligence * 0.3 + nearbyEnergy * 0.2,
    ),
  };
}
