import type { Agent, Relationship } from './types';

/** Max relationships kept per agent; weakest are pruned beyond this (bounds memory/save). */
const REL_CAP = 16;

export type MoodField =
  | 'trust'
  | 'fear'
  | 'friendship'
  | 'rivalry'
  | 'resentment'
  | 'attraction'
  | 'loyalty';

const MOOD_FIELDS: MoodField[] = [
  'trust',
  'fear',
  'friendship',
  'rivalry',
  'resentment',
  'attraction',
  'loyalty',
];

export function neutralRelationship(cycle: number): Relationship {
  return {
    trust: 0,
    fear: 0,
    friendship: 0,
    rivalry: 0,
    resentment: 0,
    attraction: 0,
    loyalty: 0,
    interactions: 0,
    lastCycle: cycle,
  };
}

/** Total emotional weight of a relationship — used to decide which to prune. */
function weight(r: Relationship): number {
  let w = 0;
  for (let i = 0; i < MOOD_FIELDS.length; i++) w += r[MOOD_FIELDS[i]];
  return w;
}

function pruneWeakest(a: Agent): void {
  let weakestId = -1;
  let weakest = Infinity;
  for (const [id, r] of a.relationships) {
    const w = weight(r);
    if (w < weakest) {
      weakest = w;
      weakestId = id;
    }
  }
  if (weakestId >= 0) a.relationships.delete(weakestId);
}

/** Fetch the relationship `a` holds toward `otherId`, creating a neutral one if absent. */
export function ensureRel(a: Agent, otherId: number, cycle: number): Relationship {
  let r = a.relationships.get(otherId);
  if (!r) {
    r = neutralRelationship(cycle);
    a.relationships.set(otherId, r);
    if (a.relationships.size > REL_CAP) pruneWeakest(a);
  }
  return r;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function adjust(r: Relationship, field: MoodField, delta: number): void {
  r[field] = clamp01(r[field] + delta);
}

/**
 * Net sentiment: how positively the holder regards the other. Positive => like/admire
 * (drives following/helping), negative => dislike/fear (drives avoidance/fleeing).
 */
export function sentiment(r: Relationship): number {
  return (
    r.friendship +
    0.6 * r.trust +
    0.5 * r.attraction +
    0.4 * r.loyalty -
    r.fear -
    0.8 * r.rivalry -
    r.resentment
  );
}

/** Slowly fade all relationships toward neutral (time heals / forgets). */
export function decayRelationships(a: Agent, rate: number): void {
  const k = 1 - rate;
  for (const r of a.relationships.values()) {
    for (let i = 0; i < MOOD_FIELDS.length; i++) r[MOOD_FIELDS[i]] *= k;
  }
}

/**
 * Remove this agent's relationships toward agents that no longer exist (dead/culled). Over a
 * very long run these accumulate into the majority of the graph (the 1.17M-cycle save had
 * 49% dead targets), bloating saves and wasting lookups. Returns the number removed.
 * `aliveIds` is the set of currently-living agent ids.
 */
export function pruneDeadRelationships(a: Agent, aliveIds: Set<number>): number {
  let removed = 0;
  for (const id of a.relationships.keys()) {
    if (!aliveIds.has(id)) {
      a.relationships.delete(id);
      removed += 1;
    }
  }
  return removed;
}
