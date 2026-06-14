# STAGE LOG

Chronological record of completed work. One entry per stage (or sub-task) as it finishes.

---

## Preparation Phase — 2026-06-14
**Status:** Complete

**What was done**
- Read and analyzed `Prompt.txt` (full Genesis specification).
- Confirmed the working directory is empty/greenfield (only `Prompt.txt` present) and
  sits inside a git repo rooted at `C:/Users/MrGammoudi/Desktop`. Node v24.16.0 / npm
  11.13.0 available.
- Created `.ai_workflow/` with: `PROJECT_ANALYSIS.md`, `ROADMAP.md`, `CURRENT_STAGE.md`,
  `STAGE_LOG.md`, `DONE.md`.
- Wrote the project analysis (goal, tech choices, architecture decisions, components,
  gap analysis, MVP definition of done).
- Wrote a 12-stage roadmap adapted to this project (mapped onto the spec's 11 phases /
  20 feature sections).
- Set `CURRENT_STAGE.md` to **Stage 1 — Scaffold & Core Simulation Loop**, status
  *Pending Approval (Not Started)*.

**Files created**
- `.ai_workflow/PROJECT_ANALYSIS.md`
- `.ai_workflow/ROADMAP.md`
- `.ai_workflow/CURRENT_STAGE.md`
- `.ai_workflow/STAGE_LOG.md`
- `.ai_workflow/DONE.md`

**Key decisions documented**
- Canvas 2D (behind a Renderer interface) over PixiJS for the MVP.
- Simulation core lives outside React; React reads throttled snapshots.
- Single seeded PRNG for full determinism (incl. offline evolution).
- Fixed-timestep logic with decoupled, interpolated rendering.
- Spatial grid + decision throttling for performance.

**Remaining**
- All 12 implementation stages. Stage 1 awaits user approval ("Start Stage 1").

**The preparation phase is complete. Waiting for user approval to begin Stage 1.**

---

## Stage 1 — Scaffold & Core Simulation Loop — 2026-06-14
**Status:** Complete

**What was done**
- Hand-authored a Vite + React 18 + TypeScript (strict) scaffold inside `World from 0/`
  (chose hand-authoring over `npm create vite` because the dir wasn't empty — avoids the
  interactive overwrite prompt and pins exact versions).
- Built the dark "laboratory" App shell with all spec layout regions: top control bar,
  left World Stats, center canvas stage, right Inspector, bottom tabbed panel.
- Implemented the simulation core (framework-agnostic, no React/DOM imports):
  - `rng.ts` — mulberry32 seeded PRNG with serializable state + `randomSeed`/`hashStringToSeed`.
  - `types.ts` — `WorldState`, `EngineSnapshot`, `SpeedMultiplier`, etc.
  - `world.ts` — deterministic `generateWorld(seed)` + `stepWorld` (cycle-only for now).
  - `engine.ts` — fixed-timestep RAF loop decoupled from render; start/pause/resume/
    step/reset/newWorld; speed ×1–×50; throttled UI snapshots (~12 Hz) + per-frame render
    hook; fps/effective-tps metrics; spiral-of-death cap.
- Implemented the rendering layer: `camera.ts` (world↔screen, pan, cursor-anchored zoom,
  fit-to-world) and `canvasRenderer.ts` (DPR-aware Canvas 2D: gradient backdrop, world
  bounds, grid, seeded pulsing substrate, HUD; off-screen culling).
- Wired React to the engine via `useEngine` (single engine in a ref — StrictMode-safe;
  RAF lifecycle in an effect) and `SimulationCanvas` (ResizeObserver + pointer/wheel
  pan-zoom + frame subscription).
- Authored `global.css` dark theme (CSS grid layout, control bar, buttons, readouts,
  panels, tabs, scrollbars).

**Files created (23)**
- Config: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- Entry: `src/main.tsx`, `src/vite-env.d.ts`, `src/App.tsx`, `src/styles/global.css`
- Simulation: `src/simulation/{rng,types,world,engine}.ts`
- Rendering: `src/rendering/{camera,canvasRenderer}.ts`
- React glue: `src/hooks/useEngine.ts`
- UI: `src/ui/{SimulationCanvas,ControlBar,WorldStats,Inspector,BottomTabs}.tsx`

**Verification**
- `npm install` → 68 packages, no errors.
- `npm run build` (`tsc --noEmit && vite build`) → **0 TypeScript errors**; 43 modules
  transformed; bundle ~155 kB JS / 4.6 kB CSS.
- `npm run dev` → Vite ready in ~1.5s; `GET /` → 200 (contains `#root`),
  `GET /src/main.tsx` → 200. Dev server then stopped.

**Decisions / notes**
- Build script is `tsc --noEmit && vite build` with a single `tsconfig.json` (no project
  references / `tsc -b`) — simplest robust setup, avoids composite-config pitfalls.
- Determinism is guaranteed *by construction* (seeded PRNG, serialized state, zero
  nondeterministic calls in gen/tick). Formal unit tests for determinism are deferred to
  the testing work in Stage 12.
- Stage 1 created lightweight placeholder panels (`Inspector`, `BottomTabs`); the full
  spec-named inspectors/panels are created in the stages that fill them.

**Remaining (next stage)**
- Stage 2 — Agents, Energy & Life Cycle: agent struct, energy sources, spatial grid,
  movement/consumption, starvation/age death, reproduction with trait inheritance, and
  rendering agents/energy on the canvas.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 2 — Agents, Energy & Life Cycle — 2026-06-14
**Status:** Complete

**What was done**
- Agent model + helpers (`agent.ts`): full 10-trait personality, procedural names,
  `createAgent`, `createChild` (trait inheritance with bounded mutation), lifespans.
- Energy system (`energy.ts`): four source kinds (common/rare/unstable/hidden) with
  capacity, per-kind regen, harvest radius; unstable sources fluctuate & can collapse;
  hidden sources stay invisible until an agent discovers them.
- `spatialGrid.ts`: uniform spatial hash (rebuilt each tick) for O(n) neighbor queries;
  reusable scratch buffer to avoid per-call allocations.
- `config.ts`: all simulation tunables centralized for balancing.
- Life cycle in `stepWorld` (`world.ts`): energy regen + source respawn → grid rebuild →
  per-agent update (hunger-hysteresis seek/eat/wander, steering, bounds reflection,
  metabolism) → reproduction (energy + maturity + cooldown + local-crowding gate) →
  cull dead. Tracks cumulative births/deaths.
- Engine: owns the spatial grid (recreated on world load), passes it to `stepWorld`, and
  computes population stats (population, births, deaths, avg energy, max generation,
  node count) in the throttled snapshot.
- Rendering (`canvasRenderer.ts`): energy sources drawn as radial-glow nodes colored by
  kind and sized by fill (hidden = faint shimmer until found); agents as points, blue and
  brightening with energy, red while dying; off-screen culling for both.
- UI: World Stats panel now shows population/births/deaths/avg-energy/max-gen/nodes split
  into World + Engine sections; control bar readout shows live `pop`.

**Files created (4)**
- `src/simulation/{config,spatialGrid,energy,agent}.ts`
- `scripts/simCheck.ts` — headless validation harness (not part of the app build)

**Files modified (6)**
- `src/simulation/types.ts` — Agent, EnergySource, PersonalityTraits, AgentState,
  EnergyKind; extended WorldState (agents/energy/counters/birth-death) and EngineSnapshot.
- `src/simulation/world.ts` — full life-cycle step (rewritten).
- `src/simulation/engine.ts` — grid ownership + population-stat snapshot.
- `src/rendering/canvasRenderer.ts` — energy + agent rendering.
- `src/ui/WorldStats.tsx`, `src/ui/ControlBar.tsx` — population stats.
- `.gitignore` — ignore generated `scripts/*.mjs`.

**Verification**
- `npm run build` → 0 TS errors, 47 modules.
- Headless harness (esbuild-bundled `simCheck.ts`, run under Node):
  - Trajectory over 40,000 ticks: pop stabilizes ~240 (range [90, 349]); 3,866 births /
    3,716 deaths; no extinction / no cap-out.
  - Determinism: two independent same-seed runs produce **identical** fingerprints;
    a different seed differs. PASS.
- `npm run dev` → serves `index.html`, `main.tsx`, and the transformed `world.ts` (full
  runtime module graph resolves). Server then stopped.

**Bug found & fixed (via harness)**
- First run went **extinct by cycle ~7200 with 0 births**: the founding cohort aged out
  together and reproduction never triggered. Cause: agents stopped seeking food the moment
  energy rose above the *low* threshold, so they never reached the reproduction threshold.
  Fix: proper hunger hysteresis — a hungry agent now feeds until *full*. Post-fix the
  population is healthy and self-renewing.

**Decisions / notes**
- Equilibrium ~240 means the world sits near energy carrying-capacity (avg energy ~39) —
  intentional: the resulting scarcity is the substrate for inequality/conflict later.
- Stage 2 reproduction is asexual + mutation; bonded/two-parent reproduction arrives with
  relationships (Stage 3/4). AgentState is the survival subset; the full state set lands
  with the decision system (Stage 3).
- `scripts/simCheck.ts` retained as a reusable balancing/regression tool.

**Remaining (next stage)**
- Stage 3 — Decisions, Memory & Relationships: a real decision state machine driven by
  traits + neighbors + threats + memory; per-agent event memory; trust/fear/friendship/
  rivalry graph; behavior (help/avoid/follow) shaped by relationship history.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 3 — Decisions, Memory & Relationships — 2026-06-14
**Status:** Complete

**What was done**
- `relationships.ts`: directed pairwise relationships (trust/fear/friendship/rivalry/
  resentment/attraction/loyalty), `ensureRel`/`adjust`/`sentiment`/`decayRelationships`,
  weakest-first pruning to cap per-agent relationships (16) for bounded memory/save.
- `memory.ts`: bounded episodic memory (cap 20) — `remember`/`decayMemory`/`lastMemoryOf`;
  kinds: helped_by, helped, stolen_from, attacked_by, found_energy, witnessed_death.
- `decisions.ts`: priority decision state machine (flee → feed → help → follow → rest →
  wander) reading energy + neighbors + threats + traits + relationships; **decision
  throttling** (re-decide every 15 ticks, staggered by id); per-tick acting on the current
  goal; interaction resolution — `applyHelp` (gratitude), `applySteal` (fear/resentment),
  proximity `bond`, and death-witnessing (nearby agents remember a death).
- Birth bonds: parent↔child start with a strong mutual relationship (`bondFamily`).
- Engine snapshot now counts social bonds + rivalries; World Stats panel shows them;
  renderer tints agents by behavioral state (flee=amber, help=green, attack=orange,
  follow=violet, dying=red, default blue).

**Files created (3)**
- `src/simulation/{relationships,memory,decisions}.ts`

**Files modified (7)**
- `src/simulation/types.ts` — full AgentState union; Relationship + MemoryEvent/MemoryKind;
  Agent gains relationships/memory/targetAgentId; EngineSnapshot gains socialBonds/rivalries.
- `src/simulation/agent.ts` — init relationships/memory/targetAgentId on create + child.
- `src/simulation/world.ts` — delegate per-agent update to `decisions.updateAgent`; build
  per-tick id→agent index; add `bondFamily` on reproduction. (Behavior helpers removed —
  they now live in decisions.ts.)
- `src/simulation/engine.ts` — snapshot counts bonds/rivalries.
- `src/rendering/canvasRenderer.ts` — state-based agent tints.
- `src/ui/WorldStats.tsx` — social-bond / rivalry rows.
- `scripts/simCheck.ts` — added relationship stats + interaction + behavior micro-tests.

**Verification**
- `npm run build` → 0 TS errors, 50 modules.
- Harness (11/11 PASS):
  - Trajectory 24k ticks: pop stable ~220–275 (range [90, 342]); bonds 29–177; rivalries
    48–167; avg memory 13.8/20; survives.
  - Determinism: identical fingerprint for same seed incl. 2,602 relationships; differs
    across seeds.
  - Interaction effects: help raises trust/friendship + records memory; theft raises
    fear/resentment + records memory.
  - **Behavior from history**: feared thief → victim flees and moves away; repeatedly
    helped agent → follows benefactor.
- `npm run dev` → serves app + transforms `decisions.ts`. Server then stopped.

**Decisions / notes**
- Lowered the "social bond" snapshot metric threshold from friendship>0.6 to >0.4 so
  moderate/family friendships register (cosmetic metric only — no dynamics/determinism
  change). Strong persistent clusters (and thus high friendships) are expected to grow
  once tribe cohesion lands in Stage 5.
- Theft is opportunistic (predatory + hungry + adjacent richer agent); full conflict /
  group violence is Stage 7. Reproduction remains asexual+mutation; bonded reproduction
  can build on the now-present relationship graph in a later stage.
- Only one grid query per agent per decision tick (+ one on death) keeps the hot path cheap.

**Remaining (next stage)**
- Stage 4 — Communication System: rule-based contextual messages (categories + emotional
  tone + topic) from agent state/memory/relationships; speech bubbles on the canvas; the
  Conversations panel with filters (all / agent / tribe / conflict / trade / revolutionary
  / Hidden Council rumors); capped conversation log.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 4 — Communication System — 2026-06-14
**Status:** Complete

**What was done**
- `communication.ts`: rule-based (no LLM) message system. 12 categories with PLAIN +
  NAMED template pools, per-category emotional tone, and {name}/{place}/{dir} fill from
  context (cardinal regions like "the eastern field"). `compose()` chooses by priority:
  recent-event (stolen_from→conflict, witnessed_death→suspicion, helped_by→friendship,
  found_energy→survival) → distress (hunger→revolution/fear/survival) → social
  (conflict/friendship/bonding/leadership) → trait-flavored musings (suspicion/myth).
  `emitSpeech()` gates on a per-agent speak cooldown + socialNeed/event-scaled chance,
  sets the speech bubble, and appends to the capped log.
- Decision pass (`decisions.ts`) now captures neighbor context (rival/ally/leader names +
  nearby count) and calls `emitSpeech` each decision; clears expired bubbles.
- Conversation model + capped ring-buffer log (500) on WorldState; agent gains
  `speakCooldown` + `bubble`; engine exposes `getRecentMessages()` and `messageCount`.
- Rendering: tone-colored speech bubbles above agents, budgeted (≤48/frame) and
  zoom-gated (≥0.55) to avoid clutter; rounded-rect backgrounds for legibility.
- UI: real `ConversationsPanel` (polls the engine at 4 Hz, decoupled from the 12 Hz
  snapshot) with category filter chips + name search; wired into `BottomTabs`; World Stats
  gains a Messages row.

**Files created (2)**
- `src/simulation/communication.ts`
- `src/ui/ConversationsPanel.tsx`

**Files modified (8)**
- `src/simulation/types.ts` — MessageCategory/MessageTone/ConversationMessage/SpeechBubble;
  Agent gains speakCooldown+bubble; WorldState gains conversationLog+nextMessageId;
  EngineSnapshot gains messageCount.
- `src/simulation/agent.ts` — init speakCooldown/bubble.
- `src/simulation/world.ts` — init conversationLog/nextMessageId.
- `src/simulation/decisions.ts` — neighbor-context capture + emitSpeech call (decide now
  takes rng).
- `src/simulation/engine.ts` — getRecentMessages() + messageCount in snapshot.
- `src/rendering/canvasRenderer.ts` — speech-bubble pass + tone colors + roundRect.
- `src/ui/BottomTabs.tsx` — render ConversationsPanel; `src/App.tsx` — pass engine;
  `src/ui/WorldStats.tsx` — Messages row.
- `src/styles/global.css` — conversations panel + tone-dot styling.
- `scripts/simCheck.ts` — communication stats + content micro-test (+ fixture fix).

**Verification**
- `npm run build` → 0 TS errors, 52 modules.
- Harness 16/16 PASS:
  - Communication: 9,649 msgs over 8k ticks, log capped at 500, 8 categories present.
  - Determinism: identical fingerprint incl. msgs=9922; differs across seeds.
  - Content: a robbed agent eventually speaks, and voices `conflict` addressed to the thief.
  - (All Stage 2/3 checks still pass; population stable ~220–280.)
- `npm run dev` → serves app + transforms communication.ts & ConversationsPanel.tsx.

**Decisions / notes**
- Conversations panel polls `engine.getRecentMessages()` every 250 ms instead of riding
  the 12 Hz snapshot — keeps the snapshot light and the feed smooth.
- "Selected tribe" filter is deferred to Stage 5 (tribes don't exist yet); name search
  covers the "selected agent" case for now.
- Caught a fixture bug only because tsc checks `src/` not `scripts/`: the harness's
  hand-built `microWorld()` predated the new WorldState fields. Fixed.

**Remaining (next stage)**
- Stage 5 — Tribes: emergent group formation (proximity + sharing + trust + leader +
  danger); tribe identity (name/color/leader/territory/ideology/stability); cooperate/
  compete/ally/war/merge/split; Tribe Inspector; agents colored by tribe.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 5 — Tribes — 2026-06-14
**Status:** Complete

**What was done**
- `tribes.ts`: full emergent tribe system. `updateTribes` (every 30 ticks) groups members,
  disbands the too-small, recomputes each tribe (leader by status, centroid+radius
  territory, ideology from averaged member traits, energy inequality, stability,
  shared-energy pool with surplus tithe + starving-member feeding), then runs:
  - recruitment + formation (bonded tribeless clusters found new tribes; tribeless agents
    near a tribe they like get recruited),
  - inter-tribe relations (standing from ideology aggression + territory overlap; war/peace
    flags with history logging),
  - merge (allied + overlapping + small → fold smaller into larger) and split (unstable +
    large → disloyal faction breaks away).
  Deterministic (id tie-breaks; rng only for naming). Tribe naming "The {Adj} {Noun}",
  deterministic palette by id, capped history log.
- War + cohesion feed behavior (`decisions.ts`): enemy-tribe members read as threats
  (flee); same-tribe + own-leader strongly boost follow; kin preferred for help.
- Rendering: translucent territory circles + tribe labels; agents colored by tribe (feral
  agents keep behavioral-state tints; dying=red, attacking=orange override).
- UI: `TribesPanel` (right panel) — per-tribe card with color, name, population, ideology
  badge, war badge, leader, stability/aggression/inequality bars, shared energy, enemies.
  World Stats gains a Tribes row; Conversations gains a tribe `<select>` filter.
- Engine: `getTribesSummary()` + `buildTribeSummaries()`; snapshot carries tribeCount + a
  serializable `tribes` summary array.

**Files created (2)**
- `src/simulation/tribes.ts`, `src/ui/TribesPanel.tsx`

**Files modified (9)**
- `src/simulation/config.ts` — `TRIBE` tunables.
- `src/simulation/types.ts` — TribeIdeology/TribeRelation/TribeEvent/Tribe/TribeSummary;
  WorldState gains tribes+nextTribeId; EngineSnapshot gains tribeCount+tribes.
- `src/simulation/world.ts` — init tribes; per-tick tribesById index; pass to updateAgent;
  call updateTribes (rebuilds grid) every TRIBE.interval.
- `src/simulation/decisions.ts` — updateAgent/decide take tribesById; war→threat, cohesion
  → follow/help.
- `src/simulation/engine.ts` — tribe summaries (snapshot + getTribesSummary).
- `src/rendering/canvasRenderer.ts` — territory circles + tribe-colored agents.
- `src/App.tsx` (right panel → TribesPanel), `src/ui/WorldStats.tsx` (Tribes row),
  `src/ui/ConversationsPanel.tsx` (tribe select filter), `src/styles/global.css`.
- `scripts/simCheck.ts` — tribe stats + assertions (+ micro-test arity fix).
- (`src/ui/Inspector.tsx` no longer mounted; retained for the future agent inspector.)

**Verification**
- `npm run build` → 0 TS errors, 53 modules.
- Harness 22/22 PASS:
  - Tribes: 76 founded over 24k ticks, peak 29, 9 alive; largest "The First Spire" pop 11,
    trader ideology, elected leader, radius 360. Asserts: form, name, elect leader, claim
    territory, hold ≥3 members, and **change over time** (founded ≫ alive).
  - Determinism: identical fingerprint incl. `tribes=14/54`; differs across seeds.
  - Communication categories shifted with war (conflict 254). Population stable (~220–285).
- `npm run dev` → serves app + transforms tribes.ts & TribesPanel.tsx. Server stopped.

**Decisions / notes**
- Tribe energy sharing is modest (8% surplus tithe; feed starving to 35%) — verified not
  to destabilize population. Full economy/inequality/tax is Stage 6.
- One structural change (merge or split) per tribe-update keeps dynamics stable.
- "Selected tribe" Conversations filter now implemented (was deferred from Stage 4).
- Same scripts-vs-tsc gotcha recurred (micro-test arity) — fixed; `tsc` only checks `src/`.

**Remaining (next stage)**
- Stage 6 — Cities & Economy & Inequality: large stable tribes form cities (buildings,
  classes, stored energy, laws, unrest); economy (collect/store/trade/gift/steal/tax/
  hoard); inequality index, richest/poorest, starvation, rebellion risk; City Inspector.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 6 — Cities & Economy & Inequality — 2026-06-14
**Status:** Complete

**What was done**
- `economy.ts`: `gini()` (Gini coefficient) + `computeEconomy()` → world EconomyStats
  (total/avg energy incl. treasuries, inequality index, richest/poorest, starvation count,
  unrest = f(inequality, starvation), rebellion risk = f(unrest, avg city unrest)).
- `cities.ts`: cities crystallize from qualifying tribes (pop≥8 + stability≥0.4 or
  age≥1500 + treasury≥20); the tribe's pool seeds the city. Per-update: follow tribe
  centroid, set tax rate by ideology, run taxation (collect surplus → treasury) +
  ideology-driven redistribution (authoritarian → elite, cooperative → welfare;
  energy-conserving with overflow returned), compute social classes (elite/middle/poor),
  resident Gini inequality, unrest (inequality + starving + low leader-trust), and grow
  buildings (council_hall/energy_storage at founding; market/defense_wall/temple/prison/
  memory_archive by condition). Cities disband when their tribe collapses (hysteresis).
- Urbanized tribes get a +0.3 stability cohesion bonus (civic order) so cities persist —
  without it cities formed but their volatile tribes collapsed (0 alive); now ≥1 alive.
- Residency: every agent's `cityId` stamped from its tribe's city each update.
- Rendering: city center diamond (red ring when unrest>0.55), building squares, label.
- UI: `CitiesPanel` (City Inspector) + `RightPanel` tab switch (Tribes | Cities);
  World Stats gains an Economy section (inequality, starving, unrest, rebellion risk, with
  warn coloring) + a Cities row.
- Engine: `getCitiesSummary()` + `buildCitySummaries()`; snapshot carries economy fields +
  cityCount + city summaries.

**Files created (4)**
- `src/simulation/{economy,cities}.ts`, `src/ui/{CitiesPanel,RightPanel}.tsx`

**Files modified (8)**
- `config.ts` (CITY tunables), `types.ts` (City/CityBuilding/BuildingType/CitySummary/
  EconomyStats; WorldState+EngineSnapshot fields), `world.ts` (init + call updateCities +
  computeEconomy each econ interval), `tribes.ts` (urbanized stability bonus),
  `engine.ts` (city summaries + economy snapshot), `canvasRenderer.ts` (drawCities),
  `App.tsx` (RightPanel), `WorldStats.tsx` (economy rows), `global.css` (right tabs etc.).
- `scripts/simCheck.ts` — Gini + city-formation + economy-response tests.
- (`src/ui/Inspector.tsx` and the old direct TribesPanel mount superseded by RightPanel.)

**Verification**
- `npm run build` → 0 TS errors, 57 modules.
- Harness 24/24 PASS:
  - Cities: over 30k ticks, 4 founded, ≥1 alive; example city has classes, tax, buildings,
    population. Asserts: a city emerges, has buildings, holds a population.
  - Economy: gini([equal])≈0, gini([concentrated])>0.6; **authoritarian gini 0.151 >
    cooperative 0.049** from identical starts → inequality responds to behavior.
  - Determinism: identical fingerprint incl. `cities`/`gini`; differs across seeds.
  - Population stable (~220–240); all prior checks still pass.
- `npm run dev` → serves app + transforms cities.ts/economy.ts/CitiesPanel/RightPanel.

**Decisions / notes**
- City redistribution is energy-conserving (tax in, payout out, overflow returned) so it
  shifts *distribution* (inequality) without changing total energy / population.
- Lowered city formation thresholds + added urbanized-tribe cohesion to make cities a
  reliable, visible feature rather than a rare transient.
- Trade/gift remain represented by help/sharing; explicit reciprocal trade is optional
  polish. Hidden-system-node building deferred to Stage 11 (Hidden Council).

**Remaining (next stage)**
- Stage 7 — Conflict & Revolution: emergent fights/theft/skirmish/repression; unrest →
  protest → civil war → revolution thresholds (driven by inequality/starvation/leader
  trust/revolutionary spread/charismatic rebel); visual conflict indicators.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 7 — Conflict & Revolution — 2026-06-14
**Status:** Complete

**What was done**
- `conflict.ts`: `resolveFight()` (damage scaled by aggression, retaliation, death,
  relationship/memory fallout — victim gains fear/resentment/rivalry + `attacked_by`
  memory) + `pushPulse()` transient on-map effects; skirmish detection between warring
  tribes.
- Attack decision (`decisions.ts`): a neighbor with high rivalry/resentment or an
  enemy-tribe member is "hostile"; an aggressive agent that is *stronger* attacks
  (state `attacking`) instead of fleeing; act resolves the fight when adjacent. Weaker/
  fearful agents still flee. Conflict messages now target the hostile.
- `revolution.ts` (`updateRevolutions`, per city each econ interval): pressure = city
  unrest; finds a charismatic rebel (ambition+aggression+disloyalty). unrest≥0.45 →
  protests (poor rally to the rebel: state `protesting`); unrest≥0.6 + rebel →
  **revolution** (rebel ousts leader, treasury seized + elite skimmed → redistributed to
  the poor, unrest released, a building damaged) — unless an authoritarian/militaristic
  leader **represses** (protesters/rebel struck, resentment rises, unrest briefly
  suppressed). Protest state persists between updates via a decide() guard (poor-but-not-
  starving stay protesting).
- Rendering: conflict pulses (expanding rings: fight=red, revolution=bright red,
  repression=orange), attacking (orange) + protesting (crimson) tints override tribe color,
  damaged buildings (red outline).
- Stats: World Stats Conflict section (fighting, protesting, total conflicts, revolutions);
  snapshot counts protesters/fighters + carries conflict/revolution totals.

**Files created (2)**
- `src/simulation/{conflict,revolution}.ts`

**Files modified (7)**
- `config.ts` (CONFLICT + REVOLUTION), `types.ts` (ConflictPulse/kind, CityBuilding.damaged,
  WorldState + EngineSnapshot fields), `cities.ts` (building.damaged init),
  `decisions.ts` (hostile tracking + attack/protest priority + act cases),
  `world.ts` (init + updateRevolutions + pulse expiry), `engine.ts` (snapshot counts),
  `canvasRenderer.ts` (pulses + tints + damaged buildings), `WorldStats.tsx` (Conflict section).
- `scripts/simCheck.ts` — conflict + revolution/repression tests.

**Verification**
- `npm run build` → 0 TS errors (fixed an `as const` literal-type issue on a `let`).
- Harness 30/30 PASS:
  - Conflict reliably occurs: 1,977 fights / 30k ticks; population stable (~218–243, no
    extinction from combat).
  - Revolution: 9 fired naturally; controlled test proves rebel overthrows leader +
    redistributes wealth to poor + releases unrest; authoritarian repression proven.
  - Cities persist (e.g. "Free Dawn" pop 69, 4 buildings). Determinism incl. `confl=780/1`.
- `npm run dev` → serves app + transforms conflict.ts/revolution.ts.

**Decisions / notes**
- Combat damage kept moderate + gated (only stronger aggressors attack hostiles) so it
  enriches dynamics without collapsing the population — verified.
- "Civil war" is represented by skirmishes + revolution/repression rather than a separate
  faction-vs-faction battle system; tribe split (Stage 5) already models faction fracture.
- Conflict/revolution events recorded in tribe/city history + world counters; the
  cross-cutting Chronicle timeline is Stage 8.

**Remaining (next stage)**
- Stage 8 — Chronicle & Evolution Viewer: `chronicle.ts` records major first-of-kind +
  significant events (genesis…extinction) with category/severity; Chronicle panel; and the
  Evolution Viewer (population/energy/inequality/tribe/conflict graphs + timeline slider).

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 8 — Chronicle & Evolution Viewer — 2026-06-14
**Status:** Complete

**What was done**
- `chronicle.ts`: `recordEvent` (capped ring buffer), `recordGenesis`, and `updateChronicle`
  (run each econ interval) which detects first-of-kind milestones (firstComm/firstTribe/
  firstConflict/firstFriendship/firstWar/firstMarket/firstProtest/firstInequalityCrisis/
  firstExtinction) and samples world metrics into `world.history`. Dependency-light
  (types/config only) so sim modules can import it without cycles.
- Direct chronicle hooks: genesis (world gen); city rise + city fall (cities.ts); revolution
  + crackdown (revolution.ts); a substantial tribe scattering (tribes.ts). `totalProtests`
  counter wired in `assignProtests`.
- Engine: `getChronicle()`, `getHistory()`, and `eventCount` in the snapshot.
- UI: `ChroniclePanel` (category-filtered, severity dots, color-coded, fact-based feed) and
  `EvolutionViewer` (6 SVG sparklines — population/avg-energy/inequality/tribes/cities/
  conflicts — with 1k/10k/all range selector, an event-timeline strip, and a scrub slider
  that shows the nearest snapshot + nearby events). Both poll the engine (~2–2.5 Hz).
  Wired into `BottomTabs`; shared category-color map exported from ChroniclePanel.

**Files created (3)**
- `src/simulation/chronicle.ts`, `src/ui/{ChroniclePanel,EvolutionViewer}.tsx`

**Files modified (8)**
- `config.ts` (CHRONICLE caps), `types.ts` (ChronicleCategory/ChronicleEvent/HistorySample;
  WorldState + EngineSnapshot fields), `world.ts` (init + genesis + updateChronicle; fixed
  the return to assign to a `world` const), `cities.ts`/`revolution.ts`/`tribes.ts` (event
  hooks), `engine.ts` (accessors + eventCount), `BottomTabs.tsx` (real panels).
- `scripts/simCheck.ts` — chronicle/history asserts (+ revolution fixture field fix).

**Verification**
- `npm run build` → 0 TS errors.
- Harness 35/35 PASS:
  - Chronicle: 107 events / 7 categories over 30k ticks; genesis recorded; milestones fire;
    history 1000 samples. Sample tail: "A City Rises — First Veil founded", "A Tribe
    Scatters".
  - Determinism: identical fingerprint incl. `events=14 hist=266`.
  - All prior checks still pass.
- `npm run dev` → serves app + transforms chronicle.ts/ChroniclePanel/EvolutionViewer.

**Decisions / notes**
- History sampled every TRIBE.interval (30 cycles), ring-capped at 1500 samples (~45k
  cycles); long-run compression is a known limitation (offline evolution, Stage 10, handles
  long absences differently).
- Sparklines drawn as inline SVG polylines (no charting dependency) — cheap for ≤1000 pts.
- Recurring scripts-vs-tsc gotcha hit again (the hand-built revolution fixture predated the
  new world fields) — fixed.

**Remaining (next stage)**
- Stage 9 — Save / Load (IndexedDB) & Import/Export: serialize/deserialize the full world
  (handling Maps), IndexedDB persistence, auto-save (10s) + beforeunload, Export/Import
  JSON, Delete, New, and a save-status indicator.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 9 — Save / Load (IndexedDB) & Import/Export — 2026-06-14
**Status:** Complete

**What was done**
- `saveSystem.ts` (pure, no DOM/IDB — stays headlessly testable): versioned
  `serializeWorld(world, savedAt)` / `deserializeWorld(save)` converting the two `Map`
  fields (agent.relationships, tribe.relations) ↔ `[key,value][]` arrays, preserving
  `rngState` verbatim; deserialize defaults missing collection fields (forward-compatible).
- `storage/indexedDb.ts`: promise-based IndexedDB get/put/delete, single save slot
  ("current"), DB `genesis-sim`.
- `storage/importExport.ts`: JSON `downloadSave` + `readSaveFile` (with validation).
- Engine: `loadSerialized` (replaces world, paused, clean), `markSaved`, dirty tracking
  (set in tick / reset / newWorld; cleared on save/load), `dirty` in the snapshot.
- `useSaveSystem` hook: save/load/remove/export/import, auto-save every 10s while dirty,
  best-effort `beforeunload` save, existing-save detection.
- `SaveBar` (second header row): status pill (Saved/Saving…/Unsaved/error) + last-saved
  time + Save / Load / Export / Import / Delete / New Civilization + auto-save toggle.

**Files created (5)**
- `src/simulation/saveSystem.ts`, `src/storage/{indexedDb,importExport}.ts`,
  `src/hooks/useSaveSystem.ts`, `src/ui/SaveBar.tsx`

**Files modified (4)**
- `types.ts` (EngineSnapshot.dirty), `engine.ts` (loadSerialized/markSaved/dirty),
  `App.tsx` (SaveBar row), `global.css` (4-row grid + savebar styles).
- `scripts/simCheck.ts` — save round-trip test.

**Verification**
- `npm run build` → 0 TS errors.
- Harness 40/40 PASS, incl.:
  - save carries version + savedAt; agent/tribe Maps restored as Maps; cycle + RNG state
    preserved; and the restored world **continues byte-identically** for 4k more ticks
    (lossless round-trip through JSON.stringify/parse — proves no Map data is dropped).
- `npm run dev` → serves app + transforms saveSystem/indexedDb/importExport/useSaveSystem/SaveBar.

**Decisions / notes**
- JSON round-trip (the hard part: Maps + RNG state) is proven headlessly. IndexedDB stores
  the same plain serialized object via structured clone, so it's lossless too; the IDB
  wrapper is thin standard code (build-checked, serves) and the actual persistence is
  exercised in-browser (Save → refresh → Load).
- Single save slot for v1 (multi-slot is easy future work). `beforeunload` IDB write is
  best-effort (async); the 10s auto-save bounds worst-case loss.
- `savedAt` is supplied by the caller (Date.now() in the UI) — keeps serialize pure and
  lets Stage 10 (offline evolution) compute elapsed time from it.

**Remaining (next stage)**
- Stage 10 — Offline Evolution: on load, read `lastSavedAt`, compute elapsed real time →
  cycles, tiered deterministic fast-forward (non-blocking), and an Offline Evolution Report
  modal (births/deaths/tribes/cities/wars/revolutions/deltas) with skip/apply options.

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 10 — Offline Evolution — 2026-06-14
**Status:** Complete

**What was done**
- `offlineEvolution.ts`: `planOffline(elapsedMs)` (tiers recent<1h / medium 1–12h / long
  >12h, each with a cycle cap; rate = 8 cycles/sec) and async
  `runOfflineEvolution(world, elapsedMs, onProgress)` — fast-forwards the world in 2000-tick
  chunks with `setTimeout(0)` yields (non-blocking), stops early on extinction, and returns
  an OfflineReport (population/inequality before→after, births/deaths, tribes formed,
  cities founded, revolutions, conflicts, collapses, top new chronicle events) + a
  humanized `summary` string. Deterministic: uses the restored RNG state; chunk timing
  never affects the result.
- `useOfflineResume(engine)` hook: on mount detects a save → offers resume; "fast-forward"
  deserializes, runs offline (with progress), then `engine.loadSerialized` adopts the
  evolved world (re-syncing the engine RNG); "skip" loads as-is; "start fresh" keeps the
  boot world.
- `OfflineReportModal`: offer (Fast-forward / Resume-skip / Start fresh) → progress bar →
  report (stat grid + notable-events list) → Continue.

**Files created (3)**
- `src/simulation/offlineEvolution.ts`, `src/hooks/useOfflineResume.ts`,
  `src/ui/OfflineReportModal.tsx`

**Files modified (2)**
- `App.tsx` (mount the resume hook + modal overlay), `global.css` (modal styles).
- `scripts/simCheck.ts` — offline tier + deterministic fast-forward test (top-level await).

**Verification**
- `npm run build` → 0 TS errors.
- Harness 48/48 PASS, incl.:
  - tiers map correctly (recent/medium/long) and long absences are capped;
  - a 3h absence fast-forwards 60,000 cycles, the world advances, deltas are sane;
  - **deterministic**: two restored copies given the same elapsed time produce identical
    fingerprints.
  - Sample report: "While you were away for 3 hours… 60,000 cycles passed. 3754 born, 3809
    died. 59 new tribes formed. 2 revolutions erupted. 25 groups collapsed. Population fell
    243→188. Inequality eased 0.30→0.22. (Long absence — compressed.)"
- `npm run dev` → serves app + transforms offlineEvolution/useOfflineResume/OfflineReportModal.

**Decisions / notes**
- Offline runs on a plain world object first, then `engine.loadSerialized` adopts it — so
  the engine's RNG/grid are synced to the post-evolution state in one place.
- Cycle caps (30k/60k/90k) keep the fast-forward to ~1–2s and prevent simulating literal
  weeks tick-by-tick; this compression is surfaced in the report ("Long absence — compressed").
- Options provided: Fast-forward / Skip / Start fresh. Spec's "detailed replay" is served
  by the existing Evolution Viewer scrubber on the resulting history (documented).

**Remaining (next stage)**
- Stage 11 — Hidden Council & God Mode: secret observer that tracks risk metrics and
  intervenes (spawn/remove energy, scarcity, protect leader, corrupt agent, plant rumors,
  prophet, crisis, glitch, secret agent), agent "discovery" of the simulation, Hidden
  Council panel, and a God Mode panel (with chronicle logging + agent reactions).

**The current stage is complete. Waiting for user approval to move to the next stage.**

---

## Stage 11 — Hidden Council & God Mode — 2026-06-14
**Status:** Complete

**What was done**
- `hiddenCouncil.ts`: `createCouncil()` + `updateHiddenCouncil(world, rng)` (runs each econ
  interval *only when enabled* — so default runs consume no RNG and stay byte-identical).
  Tracks manipulation + discovery risk (rises with collective curiosity×intelligence);
  `choose()` selects an intervention from world conditions; 9 interventions implemented
  (spawn_energy, create_scarcity, protect_leader, corrupt_agent, plant_rumor,
  create_prophet, system_glitch, secret_agent "Zazra", suppress_memory) with a capped
  secret log + watched agents.
- Discovery: `communication.ts` makes curious/intelligent agents voice `council_rumor`
  messages when risk is high or the council is revealed.
- `godMode.ts`: `applyGodAction` — 11 actions (add/remove energy, spawn/smite/prophet,
  scarcity, war/peace, reveal, glitch, miracle); each logs a chronicle event and triggers
  spoken agent reactions ("The sky gave us energy", "The creators are real").
- Engine: `setCouncilEnabled`, `godAction` (syncs rngState), council summary in snapshot.
- UI: `HiddenCouncilPanel` (toggle, manipulation/discovery bars, next-planned, secret log)
  + `GodModePanel` (grouped action buttons) as new right-panel tabs (Tribes/Cities/Council/
  God). Renderer: council/glitch pulses (violet).

**Files created (4)**
- `src/simulation/{hiddenCouncil,godMode}.ts`, `src/ui/{HiddenCouncilPanel,GodModePanel}.tsx`

**Files modified (8)**
- `config.ts` (COUNCIL), `types.ts` (council types + ConflictPulseKind 'council' + snapshot),
  `world.ts` (init + periodic update), `engine.ts` (god/council methods + summary),
  `saveSystem.ts` (default council on load), `communication.ts` (council rumors),
  `canvasRenderer.ts` (council pulse color), `RightPanel.tsx`/`App.tsx` (tabs + engine).
- `scripts/simCheck.ts` — council + god-mode tests (+ fixture council field).

**Verification**
- `npm run build` → 0 TS errors.
- Harness 57/57 PASS: council intervenes (25×) + logged + discovery rises; council-enabled
  determinism; God Mode add-energy/smite/reveal take effect + logged + reactions. Default
  (council-off) determinism unchanged.
- `npm run dev` → serves app + transforms hiddenCouncil/godMode/HiddenCouncilPanel/GodModePanel.

**Decisions / notes**
- Council disabled by default → zero RNG consumption → all prior determinism preserved.
- God actions intentionally use the sim RNG (creator alters the world), syncing rngState so
  a subsequent save is consistent.
- Implemented a representative-but-complete intervention/action set covering the spec's lists.

**Remaining (next stage)**
- Stage 12 — Polish, Performance & Final Deliverable: README (run/features/key files/next
  steps/limitations/save+offline explainer), perf notes, final error check.

**The current stage is complete. Proceeding to Stage 12 (final) per the user's instruction.**

---

## Stage 12 — Polish, Performance & Final Deliverable — 2026-06-14
**Status:** Complete — FINAL STAGE

**What was done**
- Agent Inspector + Follow (spec §18, the last feature gap): engine selection
  (`selectAgentAt` / `getSelectedAgent` / `getSelectedId` / `clearSelection`), Canvas
  click-to-select (click vs. drag detection) with smooth camera follow, a white selection
  ring in the renderer, and a floating `AgentInspector` overlay (name, tribe, gen/age,
  energy bar, state, all 10 trait bars, last words, relationship/memory counts).
- `README.md` — the spec's Final Deliverable: how to run, features, key files, controls, a
  save/load + offline-evolution explainer, performance notes, testing, next steps, and known
  limitations. (No external attribution per project policy.)
- Removed the now-superseded `Inspector.tsx` placeholder.
- Final production build + full headless harness.

**Files created (2)**
- `src/ui/AgentInspector.tsx`, `README.md`

**Files modified (5)**
- `types.ts` (AgentDetail), `engine.ts` (selection API), `canvasRenderer.ts` (selection
  ring + setSelected), `SimulationCanvas.tsx` (click-select + follow), `App.tsx`
  (AgentInspector overlay), `global.css` (inspector styles).
- `scripts/simCheck.ts` — agent-selection test (uses a DOM-free `Engine` instance).
- Removed `src/ui/Inspector.tsx`.

**Verification**
- `npm run build` → 0 TS errors (final).
- Headless harness **60/60 PASS** (adds: clicking near a being selects it; inspector detail
  populated; clicking empty space deselects). Determinism preserved throughout.
- `npm run dev` → serves app + transforms AgentInspector.

**Notes**
- Performance is by design (spatial grid, decision throttling, render culling, capped
  buffers, decoupled render/logic loops, tiered offline) — documented in the README.
- The headless harness is heavy (~200k ticks across all suites run back-to-back) and takes
  ~60–90s; the live app ticks per animation frame, not in bulk.

**🎉 PROJECT COMPLETE — all 12 stages done; all 20 spec sections functional.**
