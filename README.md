# Genesis — Emergent Digital Civilization Simulator

A browser-based, real-time sandbox where artificial beings emerge from nothing, search for
energy, communicate, form relationships, build tribes and cities, develop an economy,
suffer inequality, fight, and revolt — and may begin to suspect that a hidden hand is
shaping their world. **Nothing is scripted.** The story emerges from the rules, and the
Chronicle records what actually happened.

Everything runs locally in the browser. No backend.

---

## How to run

```bash
npm install        # install dependencies
npm run dev        # start the dev server (Vite) -> open the printed localhost URL
npm run build      # type-check (tsc) + production build into dist/
npm run preview    # serve the production build
npm run typecheck  # type-check only
```

Open the dev URL, click **▶ Start**, raise the speed to **×10**, and watch a civilization
assemble itself.

---

## Main features

- **Seeded, deterministic simulation** — the same seed reproduces the exact same
  civilization. Start / Pause / Step / Reset / New-seed, speeds ×1–×50.
- **Agents** with 10 personality traits, energy, aging, death (starvation / old age /
  conflict), and reproduction with trait inheritance + mutation.
- **Energy economy** — common / rare / unstable / hidden sources; agents seek, feed, hoard,
  share, steal.
- **Decisions, memory & relationships** — a trait-driven state machine; agents remember who
  helped or robbed them and a trust/fear/friendship/rivalry graph shapes whether they help,
  follow, avoid, or attack.
- **Communication** — rule-based contextual messages (12 categories, emotional tone) shown
  as speech bubbles and in a filterable Conversations feed.
- **Tribes** — emerge from bonded clusters; name themselves, elect leaders, claim territory,
  adopt an ideology, and recruit / defect / disband / merge / split, and make war or peace.
- **Cities & economy** — large stable tribes urbanize into cities with buildings, social
  classes, taxation, and laws; an inequality (Gini) index, starvation, unrest, and
  rebellion risk respond to economic behavior.
- **Conflict & revolution** — fights, theft, skirmishes, city repression; and protest →
  revolution (a charismatic rebel overthrows the leader and redistributes wealth) emerging
  from inequality and broken trust.
- **Chronicle & Evolution Viewer** — an auto-recorded history of genesis, first-of-kind
  milestones, and major events; plus graphs (population / energy / inequality / tribes /
  cities / conflicts) with a range selector, event timeline, and scrub slider.
- **Save / Load** — full world persistence to IndexedDB and JSON export/import, auto-save,
  and a save-status indicator.
- **Offline Evolution** — return after time away and the world fast-forwards (tiered,
  deterministic, non-blocking) with a "what happened while you were gone" report.
- **Hidden Council** — a secret manipulation layer you can enable; it covertly steers the
  world (seeding/draining energy, protecting leaders, corrupting agents, planting rumors,
  raising a prophet, glitches, the secret agent *Zazra*), and curious beings start to
  suspect they're simulated.
- **God Mode** — intervene directly (seed/drain energy, spawn/smite agents, raise a prophet,
  ignite/quell war, reveal the council, glitch, miracle); every act is chronicled and the
  beings react.
- **Agent Inspector** — click a being to follow it and inspect its traits, state, last
  words, and social footprint.

---

## What files matter

```
src/
  App.tsx                      app shell + layout
  hooks/                       useEngine, useSaveSystem, useOfflineResume
  simulation/                  framework-agnostic core (no React/DOM)
    engine.ts                  fixed-timestep loop, snapshots, God Mode, selection
    world.ts                   world generation + per-tick orchestration
    rng.ts                     seeded PRNG (determinism)
    types.ts                   all shared types
    config.ts                  every tunable in one place
    agent.ts energy.ts spatialGrid.ts
    decisions.ts               trait-driven decision state machine + interactions
    memory.ts relationships.ts communication.ts
    tribes.ts cities.ts economy.ts conflict.ts revolution.ts
    chronicle.ts offlineEvolution.ts hiddenCouncil.ts godMode.ts saveSystem.ts
  rendering/                   canvasRenderer.ts, camera.ts (Canvas 2D)
  storage/                     indexedDb.ts, importExport.ts
  ui/                          the panels (ControlBar, SaveBar, WorldStats, RightPanel,
                               Conversations/Chronicle/Evolution, Agent/Tribe/City/Council/
                               God panels, OfflineReportModal)
  styles/global.css
scripts/simCheck.ts            headless validation harness (see "Testing")
```

The defining architectural choice: **the simulation core runs outside React.** The engine
owns the world and ticks on a fixed timestep; React panels read a throttled snapshot
(~12 Hz) and never re-render on the hot path. This is what keeps it fast.

---

## Controls

- Top bar: Start/Pause, Step, Reset, New Seed, speed ×1–×50, live readouts.
- Save bar: Save / Load / Export / Import / Delete / New Civilization, auto-save toggle.
- Canvas: **drag** to pan, **scroll** to zoom, **click a being** to follow + inspect it.
- Right panel tabs: Tribes · Cities · Council · God.
- Bottom tabs: Conversations · Chronicle · Evolution.

---

## How Save/Load and Offline Evolution work

**Save/Load.** The entire world — agents, energy, tribes, cities, the relationship and
tribe-relation graphs, memories, conversations, the chronicle, history samples, the Hidden
Council state, and the **RNG state** — is serialized (the two `Map` fields are converted to
arrays so it is plain JSON) and stored in IndexedDB under a single slot, with a `savedAt`
timestamp. Loading restores it exactly; because the RNG state is preserved, the world
continues the *identical* deterministic stream. Auto-save runs every 10 s while there are
unsaved changes, plus a best-effort save on page close. You can also Export/Import the save
as a `.json` file.

**Offline Evolution.** On reopening, the time since `savedAt` is converted into simulation
cycles and the world is fast-forwarded *deterministically* — tiered by how long you were
away (recent < 1 h, medium 1–12 h, long > 12 h, each capped so very long absences are
compressed rather than simulated tick-by-tick) and **time-sliced** (run in chunks that yield
to the browser, so the tab never freezes). You get a report of what changed — births,
deaths, new tribes and cities, revolutions, conflicts, collapses, and population/inequality
shifts — with options to fast-forward, resume as-is, or start fresh.

---

## Performance

Designed for the target of ~200 agents smoothly, ~500 with simplified rendering, and ~1,000
with reduced decision frequency, via: a **spatial grid** for O(n)-ish neighbor queries,
**decision throttling** (agents re-decide every 15 ticks, staggered), **off-screen culling**
and budgeted speech bubbles in the renderer, **capped** conversation/chronicle/history
buffers, and offline evolution that abstracts long absences. The render loop is decoupled
from the fixed-timestep logic loop.

---

## Testing

The simulation core is framework-free, so it is validated headlessly:

```bash
npx esbuild scripts/simCheck.ts --bundle --format=esm --platform=node --outfile=scripts/.check.mjs
node scripts/.check.mjs
```

It runs a long trajectory and asserts determinism, population stability, the
behaviour↔history causal links, economy/inequality responses, conflict/revolution,
chronicle recording, a lossless save round-trip, deterministic offline evolution, and the
Hidden Council / God Mode effects.

---

## What can be improved next

- Multi-slot saves and a save browser.
- A WebGL/PixiJS renderer backend for tens of thousands of agents.
- Richer two-parent (bonded) reproduction and inheritance.
- A dedicated "detailed replay" cinematic of the offline period (the Evolution Viewer
  scrubber already approximates this).
- More Hidden Council interventions and deeper agent "discovery" arcs.
- Long-run history compression (coarser old samples) for multi-day sessions.
- Audio / richer visual effects.

## Known limitations

- Visuals are intentionally minimal (glowing points, abstract city nodes).
- Very long offline absences are compressed (capped cycles), not simulated literally.
- History sampling is ring-capped (~45k cycles of fine detail).
- Single save slot in this version.
- No backend / multiplayer (by design for v1).
