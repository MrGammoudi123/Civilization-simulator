# PROJECT ANALYSIS — Genesis: Emergent Digital Civilization Simulator

_Last updated: 2026-06-14 (preparation phase)_

---

## 1. What the project is

**Genesis** is a browser-based, real-time **emergent civilization sandbox**. Artificial
beings ("agents") spawn into a 2D digital world, search for energy, survive, die,
reproduce, communicate, remember, form relationships, build tribes, grow cities,
develop an economy, suffer inequality, fight, revolt — and may eventually suspect
that a **Hidden Council** is manipulating their reality.

The defining constraint from the spec: **this is NOT a scripted story or particle toy.**
The narrative must *emerge from rules*. We never hardcode "Agent X becomes leader" or
"a revolution happens at cycle N." We build the rules that *allow* those outcomes, and
the **Chronicle** records what actually occurred.

### Current state
- The directory is **empty** apart from `Prompt.txt` (the full specification) and this
  `.ai_workflow/` folder.
- **Nothing is implemented yet.** This is a from-scratch build.
- The folder lives inside a larger git repo rooted at `C:/Users/MrGammoudi/Desktop`.
  We will keep all project files inside `World from 0/` and will not commit unless asked.

### Environment
- Node `v24.16.0`, npm `11.13.0` available locally.
- OS: Windows 11. Shell: PowerShell (Bash also available).

---

## 2. Required technologies (from spec)

| Concern | Choice | Decision / Rationale |
|--------|--------|----------------------|
| Build tool | **Vite** | Required by spec. Fast HMR, TS-first. |
| Language | **TypeScript** | Required. Strict mode on. |
| UI framework | **React 18** | Required. UI panels only — NOT the simulation hot loop. |
| Rendering | **Canvas 2D API** | Spec allows "Canvas or PixiJS". **Decision: native Canvas 2D for the MVP** behind a `Renderer` interface, so PixiJS/WebGL can be swapped later if 1,000-agent perf demands it. Avoids a heavy dependency; Canvas 2D comfortably draws thousands of glowing points. |
| Persistence | **IndexedDB** | Required (not just localStorage). Hand-rolled thin wrapper to avoid deps, or `idb` if ergonomics warrant — decided in the save stage. |
| Backend | **None (v1)** | Everything runs locally in the browser. |
| Architecture | **Clean, modular** | Simulation core is framework-agnostic plain TS; React reads immutable-ish snapshots. |

---

## 3. Key architectural decisions (documented up front)

These resolve ambiguities the spec told us to decide ourselves:

1. **Simulation lives outside React.** The engine is a plain-TS module that owns world
   state and ticks on a fixed timestep. React panels subscribe to throttled snapshots
   (~10–15 Hz UI refresh) rather than re-rendering per tick. This is the single most
   important decision for hitting the 200/500/1,000-agent performance targets.
2. **Deterministic seeded RNG everywhere.** A single seeded PRNG (mulberry32 / xorshift)
   threads through world gen, decisions, mutation, and offline evolution. Same seed +
   same inputs ⇒ identical civilization. No bare `Math.random()` in simulation code.
3. **Fixed-timestep simulation, decoupled render.** Logic advances in discrete "cycles."
   Speed multipliers (x1…x50) change how many cycles run per real second, not the
   physics. Render interpolates between cycles for smoothness.
4. **Spatial grid for neighbor lookup.** O(1)-ish nearby queries instead of O(n²).
   Required to scale past a few hundred agents.
5. **Decision throttling.** Expensive agent "thinking" runs every few ticks (staggered
   across agents), not every tick. Movement/physics still updates each tick.
6. **Rule-based language, no LLM.** Messages are generated from templates keyed by agent
   state, emotion, topic, relationships, and world context. Deterministic and cheap.
7. **Capped logs & compressed history.** Conversation buffer and per-cycle history are
   ring-buffered / down-sampled so memory stays bounded over long runs.
8. **Offline evolution is tiered & deterministic.** <1h: high-detail ticks. 1–12h:
   medium detail. >12h: abstracted historical-event simulation. Runs chunked (e.g. via
   `requestIdleCallback` / time-sliced loop) so it never freezes the tab.

---

## 4. Main components (target architecture)

Mirrors the structure suggested in the spec:

```
src/
  main.tsx, App.tsx
  simulation/
    engine.ts          # tick loop, scheduling, speed, step
    world.ts           # world state container + generation
    agent.ts           # agent struct + lifecycle
    energy.ts          # energy sources & consumption
    decisions.ts       # state machine: needs + traits + memory -> action
    memory.ts          # event memory store per agent
    relationships.ts   # trust/fear/friendship/rivalry graph
    communication.ts   # rule-based message generation
    tribes.ts          # tribe formation, leadership, ideology
    cities.ts          # city formation, buildings, classes
    economy.ts         # collect/store/trade/steal/tax, inequality index
    conflict.ts        # fights, theft, skirmishes, repression
    revolution.ts      # unrest -> protest -> revolution thresholds
    hiddenCouncil.ts   # secret observer + interventions
    chronicle.ts       # major-event recorder
    offlineEvolution.ts# elapsed-time fast-forward + report
    saveSystem.ts      # serialize/deserialize full world
    rng.ts             # seeded PRNG
    types.ts           # shared types
  rendering/
    canvasRenderer.ts, camera.ts, visualEffects.ts
  ui/  (12 panels — see spec §17)
    ControlBar, WorldStats, AgentInspector, TribeInspector, CityInspector,
    ConversationsPanel, ChroniclePanel, EvolutionViewer, HiddenCouncilPanel,
    GodModePanel, SaveLoadPanel, OfflineReportModal
  storage/
    indexedDb.ts, importExport.ts
  styles/
    global.css
```

---

## 5. What needs to be built (everything — gap analysis)

Since the project is empty, "missing parts" = the entire scope. Grouped by risk:

### High-complexity / high-risk (need the most care)
- **Emergent behavior tuning.** Getting tribes/cities/revolutions to *emerge* from
  rules (not scripts) is the hard creative core. Requires iteration on thresholds.
- **Performance at 1,000 agents.** Spatial grid, decision throttling, render budget.
- **Offline evolution determinism + non-blocking execution.** Must match what a live
  run would produce, time-sliced so the UI doesn't hang, and tiered by elapsed time.
- **Save fidelity.** Full graph (relationships, memories, conversations, history) must
  round-trip through IndexedDB and JSON export without loss.

### Medium-complexity
- Rule-based communication that feels contextual and dramatic but stays cheap.
- Economy + inequality index driving conflict/revolution feedback loops.
- Hidden Council intervention system + agent "discovery" mechanic.
- Evolution Viewer graphs + timeline scrubber.

### Lower-complexity (but lots of surface area)
- 12 UI panels + dark "laboratory" aesthetic.
- God Mode controls wired to engine actions + chronicle logging.
- Control bar (start/pause/resume/speed/step/reset/new-seed).

### Known limitations to expect in the MVP
- Visual fidelity kept minimal (glowing points/glyphs) by design.
- Very large absences (weeks) use heavily abstracted simulation, not tick-accurate.
- No multiplayer / no backend in v1.
- Balance/tuning will be "reasonable defaults," not exhaustively play-tested.

---

## 6. Definition of "done" for the MVP

All 20 spec sections functional end-to-end: a user can start a world from a seed, watch
beings emerge and self-organize, save/load via IndexedDB, return after time away and get
an Offline Evolution Report, read Conversations + Chronicle, use the Evolution Viewer,
toggle the Hidden Council, and intervene via God Mode — with the build running cleanly
(`npm run dev` / `npm run build`) and the final deliverable docs (run steps, features,
key files, next steps, limitations, save/offline explainer) written.
