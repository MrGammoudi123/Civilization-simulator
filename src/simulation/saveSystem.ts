import { createCouncil } from './hiddenCouncil';
import { recalculateEconomy } from './economy';
import { roleFromTraits } from './roles';
import { normalizeWorldState, validateWorldState } from './validation';
import type { Agent, Relationship, Tribe, TribeRelation, WorldState } from './types';

/**
 * World serialization. The WorldState is plain JSON except for two `Map` fields — each
 * agent's `relationships` and each tribe's `relations` — which JSON.stringify cannot
 * represent. Here we convert those Maps to `[key, value][]` arrays on the way out and back
 * to Maps on the way in. The serialized RNG state (`world.rngState`) is preserved verbatim,
 * so a restored world continues the *exact* same deterministic stream.
 *
 * Save versioning (Phase 1):
 *   v1 — the original schema (everything below `SAVE_VERSION` history).
 *   v2 — adds the integrity layer: every load is run through `migrateSave` (default missing
 *        fields) and then `normalizeWorldState` (rebuild membership, prune dead references,
 *        clean the council watchlist, recompute economy). Old v1 saves still load — they are
 *        migrated forward, never rejected.
 *
 * This module is intentionally free of any IndexedDB/DOM dependency so it can be unit
 * tested headlessly; storage/indexedDb.ts handles persistence.
 */

export const SAVE_VERSION = 2;

type SerializedAgent = Omit<Agent, 'relationships'> & { relationships: [number, Relationship][] };
type SerializedTribe = Omit<Tribe, 'relations'> & { relations: [number, TribeRelation][] };
type SerializedWorld = Omit<WorldState, 'agents' | 'tribes'> & {
  agents: SerializedAgent[];
  tribes: SerializedTribe[];
};

export interface SaveData {
  version: number;
  savedAt: number; // ms since epoch; supplied by the caller (engine/UI)
  world: SerializedWorld;
}

export function serializeWorld(world: WorldState, savedAt: number): SaveData {
  // Phase 3: economy is derived — recompute it fresh so the saved snapshot is never stale.
  world.economy = recalculateEconomy(world);
  return {
    version: SAVE_VERSION,
    savedAt,
    world: {
      ...world,
      agents: world.agents.map((a) => ({ ...a, relationships: Array.from(a.relationships.entries()) })),
      tribes: world.tribes.map((t) => ({ ...t, relations: Array.from(t.relations.entries()) })),
    },
  };
}

/**
 * Migrate a save forward to the current `SAVE_VERSION`, defaulting any field that a newer
 * schema added. Structure-level only — referential consistency is handled afterwards by
 * `normalizeWorldState`. Unknown/older versions are upgraded, never rejected.
 */
export function migrateSave(data: SaveData): SaveData {
  const from = typeof data.version === 'number' ? data.version : 1;
  const w = data.world as SerializedWorld & Record<string, unknown>;

  // v1 → v2: the integrity layer. v1 has no new *persisted* fields to add (the additions are
  // either derived — economy median/min/max, recomputed on load — or live on later phases),
  // so the migration is structural defaulting + a version stamp. Future phases extend here.
  if (from < 2) {
    w.energySources ??= [];
    w.conversationLog ??= [];
    w.cities ??= [];
    w.conflictPulses ??= [];
    w.chronicle ??= [];
    w.milestones ??= [];
    w.history ??= [];
    w.archivedTribes ??= []; // Phase 2
    w.ruins ??= []; // Phase 6
    if (typeof w.nextRuinId !== 'number') w.nextRuinId = 0;
    if (typeof w.era !== 'string') w.era = 'Genesis';
    if (!w.hiddenCouncil) w.hiddenCouncil = createCouncil();
    // Phase 2: tribes gained a peak-population high-water mark.
    if (Array.isArray(w.tribes)) {
      for (const t of w.tribes as Array<Record<string, unknown>>) {
        if (typeof t.peakPopulation !== 'number') t.peakPopulation = (t.population as number) ?? 0;
      }
    }
    // Phase 5: agents gained a role; derive one from traits for legacy agents.
    if (Array.isArray(w.agents)) {
      for (const a of w.agents as unknown as Agent[]) {
        if (!a.role) a.role = roleFromTraits(a);
        if (typeof a.roleAssignedCycle !== 'number') a.roleAssignedCycle = 0;
      }
    }
  }

  return { ...data, version: SAVE_VERSION };
}

/**
 * Rebuild a live WorldState from a save. Migrates the save forward, restores the `Map`
 * fields, then normalizes the world into a self-consistent state (Phase 1). Tolerant of
 * missing collection fields so saves made by an earlier schema still load.
 */
export function deserializeWorld(data: SaveData): WorldState {
  const migrated = migrateSave(data);
  const w = migrated.world;
  const world = {
    ...w,
    agents: (w.agents ?? []).map((a) => ({ ...a, relationships: new Map(a.relationships ?? []) })),
    tribes: (w.tribes ?? []).map((t) => ({ ...t, relations: new Map(t.relations ?? []) })),
    energySources: w.energySources ?? [],
    conversationLog: w.conversationLog ?? [],
    cities: w.cities ?? [],
    conflictPulses: w.conflictPulses ?? [],
    chronicle: w.chronicle ?? [],
    milestones: w.milestones ?? [],
    history: w.history ?? [],
    hiddenCouncil: w.hiddenCouncil ?? createCouncil(),
  } as WorldState;

  return normalizeWorldState(world);
}

// Re-exported so the headless harness and UI can validate without importing the internals.
export { normalizeWorldState, validateWorldState };
