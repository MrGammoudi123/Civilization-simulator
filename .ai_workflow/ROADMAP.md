# ROADMAP — Genesis: Emergent Digital Civilization Simulator

Work is divided into ordered stages. **One stage is executed per response.** A stage is
not started until the previous one is truly complete and the user approves moving on.

The stages below are adapted to this specific project (they map onto the spec's 11
implementation phases + 20 feature sections), not the generic example template.

Legend: ☐ not started · ◐ in progress · ☑ complete

---

## Stage 1 — Scaffold & Core Simulation Loop  ☐
**Maps to spec Phase 1.**
- Vite + React + TypeScript project (strict), npm scripts working.
- App shell with the spec's layout regions (top bar / left / center canvas / right / bottom).
- `rng.ts` seeded PRNG; `types.ts` foundational types.
- `engine.ts` fixed-timestep tick loop with start / pause / resume / step / reset / new-seed.
- Speed controls x1 / x2 / x5 / x10 / x50.
- `canvasRenderer.ts` + `camera.ts` drawing an empty seeded world and a cycle counter.
- **Done when:** `npm run dev` shows the lab UI shell, the loop ticks, speed/pause/step/reset all work, and the build (`npm run build`) passes with no TS errors.

## Stage 2 — Agents, Energy, Life Cycle  ☐
**Maps to spec Phase 2 (§2, §3, §4).**
- Agent struct (id, name, pos, velocity, energy, age, generation, traits, state…).
- Energy sources (common/rare/unstable/hidden) spawning in the world.
- Spatial grid for neighbor lookups.
- Movement toward energy, consumption, starvation death, age death.
- Reproduction with trait inheritance + mutation.
- Render agents (color by tribe placeholder, brightness by energy) and energy nodes.
- **Done when:** a seeded world sustains a population that searches, eats, dies, and reproduces, visibly on canvas, at target frame rates for ~200 agents.

## Stage 3 — Decisions, Memory & Relationships  ☐
**Maps to spec Phases 2→4 (§2 states, §6).**
- `decisions.ts` state machine driven by energy, neighbors, threats, traits, memory.
- Full personality traits (curiosity, aggression, empathy, fear, greed, loyalty,
  intelligence, socialNeed, independence, ambition).
- `memory.ts` event memory; `relationships.ts` trust/fear/friendship/rivalry graph.
- Behaviors (help / avoid / follow / attack) influenced by relationships.
- **Done when:** agents demonstrably change behavior based on history (e.g. helped agents get followed; thieves get avoided), not just random walks.

## Stage 4 — Communication System  ☐
**Maps to spec Phase 3 (§5).**
- `communication.ts` rule-based message generation (categories, emotional tone, topic).
- Speech bubbles above agents.
- Conversations panel (timestamp, speaker, recipient, message, tone, topic, location).
- Filters: all / agent / tribe / conflict / trade / revolutionary / Hidden Council rumors.
- Capped/ring-buffered conversation log.
- **Done when:** contextual messages appear in bubbles and the panel, and every filter works.

## Stage 5 — Tribes  ☐
**Maps to spec Phase 5 (§7).**
- `tribes.ts`: emergent formation (proximity + sharing + trust + leader + danger).
- Tribe fields (name, color, members, leader, territory, shared energy, stability,
  ideology, aggression, inequality, population, history).
- Tribe ideologies + cooperate/compete/ally/war/merge/split dynamics.
- Tribe Inspector panel; agents colored by tribe.
- **Done when:** tribes form, name themselves, claim territory, and change over time without being scripted.

## Stage 6 — Cities & Economy & Inequality  ☐
**Maps to spec Phase 6 (§8, §9).**
- `cities.ts`: large stable tribes form cities (center, population, stored energy,
  buildings, guards, leaders, classes, laws, unrest, economy, history).
- City buildings as abstract visual nodes; cities drawn on the map.
- `economy.ts`: collect/store/trade/gift/steal/tax/hoard; inequality index, richest/
  poorest, starvation count, unrest, rebellion risk.
- City Inspector panel.
- **Done when:** at least one city can emerge from a thriving tribe and inequality metrics respond to economic behavior.

## Stage 7 — Conflict & Revolution  ☐
**Maps to spec Phase 7 (§10).**
- `conflict.ts`: individual fights, theft, tribal skirmish, city repression.
- `revolution.ts`: unrest → protest → civil war → revolution thresholds driven by
  inequality, starvation, leader trust, revolutionary message spread, charismatic rebel.
- Visual indicators (red pulses, conflict lines, protest clusters, damaged structures).
- Conflict/revolution events recorded.
- **Done when:** scarcity/inequality reliably (but emergently) produces conflict and, under the right conditions, revolution — visible on map and in messages.

## Stage 8 — Chronicle & Evolution Viewer  ☐
**Maps to spec §15, §14.**
- `chronicle.ts`: records first-of-kind and major events (genesis…extinction) with
  cycle, title, description, involved agents/tribe/city, severity, category.
- Chronicle panel (readable, dramatic, but fact-based).
- Evolution Viewer: population / energy / inequality / tribe-count / conflict graphs +
  event timeline; ranges (last 100 / 1,000 / all); timeline slider with snapshots.
- **Done when:** the chronicle auto-fills from real events and all graphs + the slider work.

## Stage 9 — Save / Load (IndexedDB) & Import/Export  ☐
**Maps to spec Phase 8 (§12).**
- `storage/indexedDb.ts` + `saveSystem.ts`: full world serialization (seed, cycle,
  lastSavedAt, agents, energy, tribes, cities, relationships, memories, conversations,
  chronicle, Hidden Council, God Mode, stats, params).
- Save / Load / Auto-save toggle (every 10s) / Export JSON / Import JSON / Delete / New.
- `beforeunload` save; save-status indicator (Saved / Saving… / Unsaved / Last saved).
- **Done when:** a world round-trips losslessly through IndexedDB and JSON, and auto-save + status work.

## Stage 10 — Offline Evolution  ☐
**Maps to spec Phase 9 (§13).**
- On load: read `lastSavedAt`, compute elapsed real time, convert to cycles.
- Tiered fast-forward (<1h / 1–12h / >12h), deterministic, time-sliced (non-blocking).
- Offline Evolution Report modal (time away, cycles, births/deaths, tribes, cities,
  wars, revolutions, discoveries, council interventions, key conversations, inequality/
  population deltas) with Skip / Simulate / Fast-forward / Detailed-replay options.
- **Done when:** returning after a real gap fast-forwards the saved world and shows a correct, deterministic report without freezing the tab.

## Stage 11 — Hidden Council & God Mode  ☐
**Maps to spec Phase 10 (§11, §16).**
- `hiddenCouncil.ts`: enable/disable; tracks population/inequality/conflict/discovery &
  rebellion risk/stability; interventions (spawn/remove energy, scarcity, protect leader,
  corrupt agent, plant rumors, false miracle, create prophet, crisis, glitch, secret
  agent). Discovery mechanic for high-curiosity/intelligence agents.
- Hidden Council panel (interventions, manipulation level, discovery risk, secret logs,
  watched agents, next planned intervention).
- God Mode panel (add/remove energy, spawn/select/inspect/boost/kill agent, create tribe,
  trigger scarcity/war/peace, reveal council, glitch, reset, speed up). Actions logged to
  chronicle; visible interventions can trigger agent reactions.
- **Done when:** the council can covertly steer the world, agents may begin to suspect it, and God Mode interventions take effect + are logged.

## Stage 12 — Polish, Performance & Final Deliverable  ☐
**Maps to spec Phase 11 + Final Deliverable.**
- Visual polish (dark lab aesthetic, glow, glitch, state-based glyphs), follow-agent mode.
- Performance pass to meet 200 smooth / 500 simplified / 1,000 reduced-frequency targets.
- Tooltips, in-app docs.
- README with: how to run, features implemented, key files, next steps, limitations,
  and a short explainer of how save/load + offline evolution work.
- Final error check + production build.
- **Done when:** all 20 spec sections are functional, perf targets met, build is clean, and deliverable docs are complete.

---

### Notes
- Stages 2–7 each end with a runnable, observable milestone so progress is verifiable.
- Rendering/visuals are introduced incrementally and finalized in Stage 12.
- If any stage proves too large, it is split into sub-tasks **within that stage** — we do
  not advance to the next stage early.
