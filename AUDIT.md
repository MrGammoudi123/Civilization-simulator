# AUDIT.md — Genesis Long-Run Save Audit

**Save inspected:** `genesis-save-2026-06-14-12-43-15.json` (save `version: 1`)
**Reached:** cycle **1,175,439** · **187** living agents · seed `2367470644`
**Method:** the live save was parsed and cross-checked field-by-field against the
simulation source (`src/simulation/*`). Numbers below are measured from the save, not
estimated.

The project is **not** broken at the framework level — it compiles clean (`tsc` 0 errors)
and the headless harness passes 60/60. The problems are **emergent degeneration over a very
long run**: a handful of subsystems lack the invariants, throttles, and self-correction that
a million-cycle world needs, so the world has slid into a permanent *survival-collapse loop*
instead of a *civilization cycle*.

---

## What the save actually shows

| # | Observation | Measured in the save |
|---|---|---|
| 1 | One tribe, one city | tribe `338` *The Pale Accord* (leader `67365`, **alive**), city `0` *Pale Accord* |
| 2 | Agents stuck searching | **164 / 187** `searching_energy`, 18 `fleeing`, 3 `wandering`, 2 `following_leader` |
| 3 | Energy ecosystem exhausted | 64 sources, **total amount 33.5**, max single source **2.1** |
| 4 | Revolutions never happen | `totalRevolutions = 0` despite **888 protests** and **171,831 conflicts** |
| 5 | Chronicle is collapse-spam | 275 events, **266 = `collapse`** (97%); last event at cycle **773,010** (~400k stale) |
| 6 | Hidden Council is a broken timer | enabled, manipulation **0.996** (maxed), **9,795** interventions, last 30 secret-log entries all `suppress_memory → "Suppressed 0 dangerous memories."` |
| 7 | Council watches the dead | **all 6** `watchedAgentIds` (`55477, 55750, 56259, 56419, 56469, 56286`) are **dead** (current agents are id `~67xxx`) |
| 8 | Memory is theft/death only | `stolen_from` **1734**, `witnessed_death` 300, `found_energy` 279 vs `helped` **1**, `helped_by` 5 |
| 9 | Relationship graph leaks the dead | **1264 of 2556** directed relationships among the living (**49%**) point to dead agents |
| 10 | Thin history | 1500 samples but only 8 fields each (no protests / revolutions / births / natural-energy / discovery-risk / ideology / era) |

Note two findings from the prompt that were **not** reproduced in *this* snapshot (they are
real *latent* risks the code does not prevent, rather than corruption present here):
tribe `338`'s `memberIds` actually matched its 187 living members exactly, and the cached
`economy.totalEnergy` (8127.5) is consistent once city/tribe treasuries (~305) are added to
the agent sum (7822.3). They are intermittent because **nothing recalculates economy before
save / after load, and nothing rebuilds membership on load** — so a save taken between the
30-tick recompute boundaries *can* be stale. We fix the invariant, not just the symptom.

---

## Root causes in the code

| Finding | File · location | Root cause |
|---|---|---|
| 2 — stuck searching | `decisions.ts` decide() cascade | Pure reactive state machine: `frac < lowEnergyFrac` ⇒ `searching_energy`, with **no role/profession layer**. When the field is depleted everyone is hungry forever ⇒ saturation. |
| 3 — energy collapse | `energy.ts` regen + `world.ts` spawn | Sources regen toward a fixed cap but the **harvest rate ≫ regen** at 187 agents; no world-level scarcity feedback, no recovery sources, no migration trigger. Permanent low equilibrium. |
| 4 — no revolutions | `revolution.ts` updateRevolutions / findRebel | Flat one-shot gate (`unrest ≥ 0.6` **and** a rebel scoring `≥ 0.55`). Under permanent starvation, stability/leader-trust collapse but the **counter is never reached in a single tick** — no escalation ladder, no cumulative pressure, no guaranteed outcome. |
| 5 — chronicle spam | `cities.ts:77` "A City Falls" (sev 4) + `tribes.ts:258` "A Tribe Scatters" (sev 3) | Both call `recordEvent(category:'collapse')` on **every** disband with **no throttle/dedup**, and `updateChronicle` records no diverse mid/late-game events ⇒ 97% collapse + a stale tail. |
| 6/7 — council | `hiddenCouncil.ts` updateHiddenCouncil / watch | Fixed-interval timer that picks an intervention by rotation; `suppress_memory` runs even with **0 valid targets**, and `watchedAgentIds` is **never pruned of the dead** ⇒ endless no-op logging. |
| 8 — memory imbalance | `memory.ts` MemoryKind (6 kinds) | Only `helped/helped_by/stolen_from/attacked_by/found_energy/witnessed_death` exist, and only conflict paths record heavily ⇒ culture/cooperation invisible. |
| 9 — dead relationships | `relationships.ts` (cap 16, decay only) + `world.ts` cull | The dead are spliced from `agents` but **no pass prunes references to them**; decay never deletes ⇒ ~half the graph is corpses. |
| 10 — thin history | `chronicle.ts` sampleHistory + `types.ts` HistorySample | Schema predates the politics/ecology/council systems. |

---

## Fix plan (mapped to the 15 phases)

The fixes are sequenced so the **shared substrate is correct first**, then each subsystem is
made self-correcting. The build (`tsc`) and the headless harness are re-run after every
phase; old **v1 saves must keep loading** throughout.

1. **Save integrity & migration** — `migrateSave` (v1→v2, default missing fields),
   `normalizeWorldState` (rebuild membership, prune dead refs, clean council watchlist,
   recalc economy/ecology), `validateWorldState` (report). Recalc economy *before save* and
   *after load*.
2. **Tribe/city consistency** — agent `tribeId`/`cityId` are the source of truth; rebuild +
   dev-warn every batch; archive long-empty tribes.
3. **Economy sync** — `recalculateEconomy` everywhere + dirty-marking.
4. **Resource ecology** — source types, regen tiers, `world.ecology`, scarcity→recovery loop.
5. **Roles & state diversity** — 16 roles + active states, role-aware decisions.
6. **Civilization cycle** — ruins, refugees, successor tribes, rebuilding, dark/golden ages.
7. **Revolution & politics** — escalation ladder + per-city politics + real outcomes.
8. **Chronicle upgrade** — throttle collapse, diverse events, era summaries.
9. **History timeline** — expanded snapshot schema + Evolution Viewer graphs.
10. **Hidden Council** — director-style selection, live watchlist, real effects, discovery
    consequences.
11. **Memory & relationships** — positive/cultural memory kinds + dead-ref legacy marking.
12. **Conversation** — contextual, named, event-aware messages + category filters.
13. **UI** — World Health + Civilization Cycle panels, richer inspectors.
14. **Performance & stability** — caps + cleanup cadence for 1M-cycle runs.
15. **Tests** — headless scenarios for every phase + the long-run check.

Progress is tracked in `.ai_workflow/PHASE_PLAN.md`.

---

## Final Deliverables (all 15 phases implemented)

**1. Audit summary** — above; every finding verified field-by-field against the save.

**2. Files changed.**
New modules: `validation.ts` (migrate/normalize/validate), `ecology.ts`, `roles.ts`, `dev.ts`.
Reworked: `revolution.ts` (escalation ladder), `hiddenCouncil.ts` (director), `communication.ts`
(contextual messages), `chronicle.ts` (throttle + era + wide history), `economy.ts`,
`energy.ts`, `tribes.ts`, `cities.ts` (ruins/refugees/rebuild), `decisions.ts` (roles +
states), `memory.ts`, `relationships.ts`, `world.ts`, `engine.ts`, `saveSystem.ts`,
`config.ts`, `types.ts`; UI: `WorldStats.tsx`, `ConversationsPanel.tsx`, `AgentInspector.tsx`,
`EvolutionViewer.tsx`, `ChroniclePanel.tsx`, `canvasRenderer.ts`. Tests: `scripts/simCheck.ts`
(+ new sections), `scripts/phase1Check.ts` (new).

**3. Migration.** `SAVE_VERSION` 1→2. `migrateSave()` defaults every new field; v1 saves load,
are reconstructed (Maps), then `normalizeWorldState()` rebuilds membership, prunes dead
relationship/memory/council references, defaults roles/politics/ecology/ruins, and recomputes
economy + ecology. `validateWorldState()` reports any inconsistency. Old v1 saves never break.

**4. New systems.** Save integrity layer; alive-aware economy; resource ecology with
recovery blooms; 16-role agent system + 11 active states; civilization cycle (ruins →
refugees → successor tribes → rebuilt cities → dark/golden ages); politics escalation ladder;
throttled + diverse Chronicle with era summaries; wide history timeline; Hidden Council
director with a live watchlist and discovery-risk consequences; 21 cooperative/cultural memory
kinds; contextual 23-category conversation; World Health UI; periodic dead-reference cleanup.

**5. Known limitations.** Richer cooperation + ecology recovery raise the equilibrium
population above the original ~200 (toward ~350), which slows very long *synchronous* runs
(the in-app loop is time-sliced, so gameplay is unaffected) — further population tuning is a
candidate follow-up. Civil-war faction-splitting reuses the emergent tribe re-formation rather
than a bespoke faction system.

**6. How to test with the uploaded save.**
```
npx esbuild scripts/phase1Check.ts --bundle --format=esm --platform=node --outfile=scripts/.p1.mjs
node scripts/.p1.mjs "<path>/genesis-save-2026-06-14-12-43-15.json"   # 19/19
npx esbuild scripts/simCheck.ts --bundle --format=esm --platform=node --outfile=scripts/.check.mjs
node scripts/.check.mjs                                                # 93/93
npm run build                                                         # clean production build
```

**7. Confirming the civilization cycle works.** A 14k-cycle run shows: revolutions firing,
the full protest→riot→reform/revolution ladder (chronicle milestones), collapse events down
from 97% to ~21% of the Chronicle across 8 categories, cities collapsing into **ruins** and
successors rebuilding on them, **910** cooperative/cultural memories (vs the save's `helped:1`),
a Hidden Council that watches only the living and never spams `suppress_memory`, and energy
that recovers after a population crash (fill 0.4% → 20%) instead of permanent starvation.

**Status: `tsc` 0 errors · headless harness 93/93 · uploaded v1 save 19/19 · production build clean.**
