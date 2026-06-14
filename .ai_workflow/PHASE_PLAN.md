# PHASE PLAN — Genesis Long-Run Audit & Fix

> The original 12-stage build is **complete** (see `DONE.md` / `ROADMAP.md`). This plan is
> the **second campaign**: auditing and repairing the million-cycle save per `Prompt.txt`.
> Work is organized into the spec's **15 phases**. One phase (or a tight batch) is executed
> at a time; after each, `tsc --noEmit` and the headless harness are re-run, and **old v1
> saves must still load**. Findings are recorded in `/AUDIT.md`.

Legend: ☐ not started · ◐ in progress · ☑ complete

---

- ☑ **Phase 0 — Audit** — analyze the save + code, write `AUDIT.md`, flip tracking to phases.
- ☑ **Phase 1 — Save Integrity & Migration** — `migrateSave` (v1→v2), `normalizeWorldState`,
  `validateWorldState`; recalc economy before save / after load; prune dead relationship,
  memory, and council-watch references; rebuild tribe/city membership on load.
  *(Verified: 19/19 against the real 1.17M save; harness 61/61; 1264 dead rels + 762 dead
  memories + 6 dead watched → 0.)*
- ☑ **Phase 2 — Tribe & City Consistency** — agent `tribeId`/`cityId` as source of truth;
  `reconcileMembership` so every batch ends consistent; dev warnings; tribe collapse archived.
  *(Verified: membership matches living members at batch boundaries; normalize is the absolute
  guarantee at any tick.)*
- ☑ **Phase 3 — Economy Sync** — `recalculateEconomy` (now alive-aware, with median/min/max)
  before save / after load / every batch; city/tribe inequality & unrest recomputed.
  *(Verified: 4 economy scenarios — energy change, kill-richest, spawn-poor, treasury change.)*
- ☑ **Phase 4 — Resource Ecology** — renewable/deep/sacred kinds + regen tiers; `world.ecology`
  metrics; scarcity-driven recovery blooms → cyclical scarcity, never permanent starvation.
  *(Verified: drained field recovers via blooms; pop crash 483→97 → field fill 0.4%→20%.)*
- ☑ **Phase 5 — Agent Roles & State Diversity** — 16-role system assigned from traits/context;
  11 new active states; role-aware decisions. *(Verified: 13 roles / 14 states / 79 agents in
  vocational states in a 20k run — the "164/187 stuck searching" finding is fixed.)*
- ☑ **Phase 6 — Rebuilding & Civilization Cycle** — city collapse leaves `ruins`, scatters
  refugees (carrying memory), and successors rebuild on the ruins with inherited culture
  (name + ideology). *(Verified: 9 ruins + "A City Reborn" events in a run.)*
- ☑ **Phase 7 — Revolution & Politics** — escalation ladder (grievance→movement→riot→
  reform/repression/revolution/civil-war) on per-city `politics` with cumulative pressure +
  cooldowns. *(Verified: revolutions fire, firstRiot/Reform/Revolution milestones, cooperative
  cities reform, authoritarian crackdowns — the `totalRevolutions = 0` bug is fixed.)*
- ☑ **Phase 8 — Chronicle Upgrade** — collapse throttle + era summaries + diverse events.
  *(Verified: collapse fell from 97% → ~21% of the chronicle; 8 categories.)*
- ☑ **Phase 9 — History Timeline** — `HistorySample` widened (births/protests/revolutions/
  naturalEnergy/scarcity/discoveryRisk/manipulation/ideology/era) + 4 new Evolution Viewer
  graphs. *(Verified: samples carry the new fields.)*
- ☑ **Phase 10 — Hidden Council Upgrade** — director `selectHiddenCouncilIntervention`, live
  watchlist (dead pruned), 6 new real-effect interventions, never logs "Suppressed 0",
  discovery-risk milestones (0.25/0.5/0.75/0.9). *(Verified: 0 dead watched, varied kinds.)*
- ☑ **Phase 11 — Memory & Relationship Balance** — 21 new memory kinds hooked at trade / tribe-
  join / shared-energy / reform / revolution / council sites; dead-ref cleanup. *(Verified:
  11 memory kinds in a run, 910 cooperative memories vs the save's `helped:1`.)*
- ☑ **Phase 12 — Conversation Upgrade** — contextual, named, event-aware messages across 23
  categories (names, directions, city/tribe/leader, recent events, council clues).
- ☑ **Phase 13 — UI Improvements** — World Health panel (era/health/scarcity/protests/
  revolutions/council-risk/ruins), agent role in the inspector, 18 conversation filters, new
  Evolution Viewer graphs.
- ☑ **Phase 14 — Performance & Stability** — periodic runtime dead-reference cleanup; bounded
  caps (memory/relationships/chronicle/history/conversation/council/ruins/archive); ecology
  blooms tuned so population/perf stay sane.
- ☑ **Phase 15 — Required Tests + Final Deliverables** — headless scenarios for every phase.
  *(`tsc` 0 errors · harness 93/93 · real 1.17M save 19/19 · production build clean.)*

### 🎉 All 15 phases complete (2026-06-14) — see `/AUDIT.md` Final Deliverables.

---

### Invariants enforced every phase
1. `npx tsc --noEmit` → 0 errors.
2. Headless harness (`scripts/simCheck.ts`) stays green (baseline 60/60; new checks added).
3. Determinism preserved (same seed ⇒ same world).
4. A **version-1** save (the uploaded 1.17M-cycle file) still loads and is normalized.
5. No existing feature removed; obsolete data archived, never silently discarded.
