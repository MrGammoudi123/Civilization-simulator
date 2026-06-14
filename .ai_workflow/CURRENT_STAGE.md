# CURRENT PHASE

Campaign: **Long-Run Audit & Fix** (second campaign). Tracking is the spec's **15 phases** —
see `PHASE_PLAN.md`.

Status (2026-06-14): **🎉 ALL 15 PHASES COMPLETE.**

- `tsc --noEmit` → 0 errors
- headless harness (`scripts/simCheck.ts`) → **93 passed, 0 failed**
- uploaded v1 save (cycle 1,175,439) migration (`scripts/phase1Check.ts`) → **19/19**
- production build (`npm run build`) → clean (79 modules)

Every finding in `/AUDIT.md` is addressed and verified. Old v1 saves still load (migrated to
v2). No feature was removed; obsolete data is archived (ruins, archived tribes), never silently
discarded.

## Final deliverables
See `/AUDIT.md` → "Final Deliverables" for the audit summary, files changed, migration details,
new systems, known limitations, how to test with the uploaded save, and how to confirm the
civilization cycle now works.

## Possible follow-ups (not blocking)
- Tune the post-recovery equilibrium population back toward ~250 (perf for very long
  synchronous runs; gameplay already fine since the in-app loop is time-sliced).
- A bespoke faction system for civil wars (currently reuses emergent tribe re-formation).
- Surface ruins + per-city politics phase visually on the map / in the City inspector.
