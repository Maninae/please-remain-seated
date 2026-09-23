# CLAUDE.md: Please Remain Seated

Agent-based airplane deplaning and boarding simulator. Two cabins race the same passengers and seed through different exit or boarding strategies, so you can see where the time actually goes and whether any announced order survives real non-compliance. Static vanilla HTML/CSS/JS, ES modules, no build step, no framework.

**NOT YET PUBLISHED**: repo will be [github.com/Maninae/please-remain-seated](https://github.com/Maninae/please-remain-seated) → [maninae.github.io/please-remain-seated](https://maninae.github.io/please-remain-seated/) once it ships. Publishing is Owen's call.

## Architecture

```
index.html                    page shell (ES module entry); race cards, race controls, time-split, compare, explainer, sidebar
css/base.css                  design tokens (mirrors js/render/theme.js), type scale, page layout
css/race.css                  cabin cards, clocks, race controls (Restart, speed, worst-seats toggle)
css/charts.css                strip chart + time-split bar styles
css/sidebar.css               two-column grid, sticky sidebar, phone drawer, info popover styling
css/tabs.css                  left tab rail (desktop), bottom tab bar (phone), tab panel toggling
css/rankings.css              rankings tab layout, stat tiles, chart chrome, sensitivity grid
css/about.css                 about tab article layout, airline sources, docs list

js/main.js                    bootstrap only: reads the URL, mounts race/controls/compare/explainer/sound/finish-card, wires the store
js/batch.js                   headless Monte Carlo: run a sim to completion across many seeds, report median/p10/p90
js/worker.js                  compare-batch module worker; one worker handles one strategy at a time

js/engine/                    headless, deterministic per seed. No DOM, no Math.random.
  config.js                     every number the sim uses, with its source
  rng.js                        seeded PRNG; fork() derives an independent stream from the same seed
  distributions.js              weibull / lognormal / exponential / uniform samplers
  types.js                      shared enums and the state/passenger shape every module codes against
  cabin.js                      cabin geometry: seat blocks, per-aisle lattices, doors, bin index map, sections
  cabin-sections.js             per-section math: buildSections / buildRowIndex / buildBinIndex + computeColumnInfo
  cabin-presets.js              the 9 single-class + 4 multi-class aircraft presets (id, layout, rows, sections, bin era, note)
  cabin-presets-sections.js     the four multi-class presets (b738-two-class, a321neo-three-class, b737max8-lcc, b789-three-class)
  passengers.js                 population sampling: seats, bags, groups, per-passenger draws
  bins.js                       overhead bin capacity + the forward/aft overflow search
  aisle.js                      aisle cell claim/release + the shared door-server admission
  metrics.js                    time-bucket accounting and the series the charts draw
  sim-factory.js                one entry point that builds either sim from a seed
  deplane-sim.js                deplaning state machine (SEATED -> READY -> ... -> EXITED)
  deplane-rules.js              readiness, contested-cell arbitration, row-pair helpers
  deplane-walk.js               walker movement: swap arbitration, front-first update order, door exits
  board-sim.js                  boarding state machine (QUEUED -> WALKING -> STOWING -> ... -> SEATED)
  board-rules.js                strategy-order shuffles (non-compliance, group adjacency) + interference classifier
  strategies/index.js           strategy registry, looked up by id; tags each board strategy with a `family` field ('textbook' or 'airline') so the UI can group them
  strategies/deplane.js         the 7 deplaning strategies
  strategies/board.js           the 9 textbook boarding strategies (8 queue-order strategies + open-seating)
  strategies/airlines.js        the 14 airline boarding procedures (Alaska, American, Delta, United, Southwest, JetBlue, Frontier, Hawaiian, Ryanair, easyJet, Lufthansa, British Airways, Air Canada, ANA)
  strategies/group-order.js     turns an airline's ordered `groups` list into a boarding queue (pre-boarders first, then each group in order, within-group rule per group)
  strategies/open-seating.js    the open-seating picker: passengers choose their own seat, not a queue order

js/render/                    canvas + SVG drawing. Reads state, never mutates it.
  theme.js                       colour + type tokens (mirrors css/base.css) plus the heat-view ramp
  cabin-layout.js                pure geometry orchestrator: fuselage bounds, seat rects, door gaps, section-aware output
  cabin-layout-sections.js       per-section geometry: cross layouts (wider first-class seats), aisle lanes, seats, bin strips, row labels, dividers
  cabin-layout-bins.js           the bin-strip geometry pass, section-aware via binIndexOffset
  cabin-view.js                  canvas cabin renderer, any layout and aisle count, section dividers + labels, hitTest(), setHeat()
  charts.js                      barrel: re-exports renderStrips and renderTimeSplit
  charts-strips.js               strip chart: dots + p10-p90 band + median tick + finding title
  charts-time-split.js           stacked-bar time-split renderer with a shared scale
  charts-svg-dom.js              the small SVG DOM shim both charts modules share
  mock-state.js                  synthetic sim state for visual mocks, no engine dependency

js/ui/                        DOM, driven by the store.
  store.js                       tiny observable store (state / update / subscribe)
  race.js                        orchestrator: two sims, lockstep stepping, DOM wiring
  race-follow.js                 follow-a-passenger + hover tooltip + live-gap slot
  race-finish.js                 finish detection, result-card scroll, worst-seats heat view, heat toggle
  race-why.js                    "why" line composer (biggest average time-split gap between winner and loser)
  race-loop.js                   requestAnimationFrame stepping at the chosen speed multiplier
  race-sims.js                   builds the two race sims from a store snapshot
  race-helpers.js                orientation, lane-node lookup, hit-test radius
  snapshot.js                    annotates state for the renderer (the followed id) without mutating it
  controls.js                    every input widget, plus keyboard shortcuts and the bag-slider normalizer
  sim-config.js                  turns store state into engine cabinOverrides / passengerOverrides
  compare.js                     "run it N times": fires every strategy, draws the strips, computes the finding sentence
  compare-pool.js                worker pool sized to navigator.hardwareConcurrency
  time-split.js                  the two time-split bars, drawn on one shared scale
  finish-card.js                 shareable end-of-race summary: winner, margin, why, copy-link, PB
  personal-best.js               best MARGIN per (mode, preset, winner-vs-loser, key knobs) in localStorage
  explainer.js                   "how this works" copy
  sound.js                       seatbelt-chime WebAudio, off by default
  format.js                      shared formatters (clock, percent, finding sentence); formatClock rounds and carries so seconds never render as 60
  canvas-sizing.js               cabin canvas height derived from the layout, not a fixed constant
  glossary.js                    plain-language popover content, keyed by id (strategy id, preset id, or setting slug like "how-full")
  info-popover.js                round "i" button + anchored popover, keyboard-driven, one open at a time
  settings-drawer.js             phone-only settings drawer: open/close, focus trap, Escape and tap-outside close, body scroll lock
  tabs.js                        Race / Rankings / About tab rail; keyboard nav, ?tab= round-trip, fires prs:tab-changed
  about.js                       About tab content: thesis, model bullets, calibration, airlines, docs, generation date
  calibration-gates.js           the numeric bounds the About page prints, mirrored from the deplane calibration test so the page and the test hold the engine to the same numbers

js/ui/rankings/               Rankings tab (data viz core).
  index.js                       orchestrator: mounts scaffold, loads index lazily on tab activation, wires mode/preset/knob-snap re-render
  rankings-data.js               loads data/rankings/{index,index-preview}.json, snaps knobs to grid, selects cells
  rankings-stats.js              stat tiles: person-minutes best/worst/diff/scaled and average-idle sub-line
  rankings-chart.js              ranked dot-and-band SVG chart, textbook/airline groups, measured-anchor overlay, sparkline
  rankings-sensitivity.js        slope charts: one per knob, top 5 strategies as lines low/default/high, computed title
  rankings-anchors.js            measured airline / study anchors (KLM 17-22, Spirit 20, MythBusters 24:29, Schultz field median)

tools/simulate.mjs            CLI: headless Monte Carlo table (median / p10 / p90 / throughput per strategy)
tools/og-image.mjs            Playwright screenshotter: writes media/og.png from a finished race (npm run og)

tests/unit/*.test.js          node --test: engine invariants + the calibration gates; format.test.js guards the 0:60 formatter fix
tests/e2e/shot.js             desktop + phone screenshot capture, starts the dev server if needed
tests/e2e/smoke.test.js       Playwright smoke test
tests/e2e/sidebar-popover.test.js  Round-04 e2e: sidebar layout at 1280 px, phone drawer at 400 px with focus trap, strategy info popover, no ":60" labels

design/01-spec.md             the model, the thesis, the calibration gates
design/02-research.md         every measured parameter, with its source
design/03-engine-contract.md  binding engine contract: cabin layouts, sim surface, both rule sets
design/04-page.md             binding page and UI spec
design/reviews/               critic passes, referenced by finding id
```

## Non-negotiables

- The engine is headless and deterministic per seed. No `Math.random` anywhere in `js/engine/`; every draw goes through the `rng` the caller passed in.
- Every number the sim uses lives in `js/engine/config.js`, with a one-line source comment (a citation, or "assumption" when none exists). No bare literals in engine logic.
- The calibration gates in `tests/unit/calibration-deplane.test.js` and `tests/unit/calibration-board.test.js` must stay green. Change a gate's bound only with a source-based derivation, either a citation in `design/02-research.md` or a documented rationale in `config.js`. Never widen a gate just to make a test pass.
- The renderer (`js/render/`) reads state and never mutates it. `cabin-view.js`'s `draw(state)` is a pure read; anything the UI needs to overlay (like the followed-passenger ring) goes through `js/ui/snapshot.js` instead of a state write.
- `design/03-engine-contract.md` is binding for the engine surface. It overrides `design/01-spec.md` where they differ (it says so explicitly, and it reflects the generalized multi-aisle cabin model that the original spec's 3-3-only geometry predates).
- No monoliths: split any file approaching ~300 lines. One nameable responsibility per module.

## Rankings data

`data/rankings/` is committed output of `npm run precompute` (about 7 hours on an M4 at 8 workers, resumable, low priority; `npm run precompute:preview` gives a 200-seed set in minutes). `index.json` pins `engineVersion` to the git short sha of `js/engine/` at generation. A comment-only commit under `js/engine/` does not invalidate the data; any engine logic change does, and the tool refuses to mix versions, so rerun the plan after one. The page reads `index.json` and falls back to `index-preview.json` per cell.

## Dev loop

```sh
python3 -m http.server 5197                                         # serve the page
npm test                                                             # node --test tests/unit/*.test.js
npm run test:e2e                                                     # Playwright smoke test
node tests/e2e/shot.js tests/e2e/artifacts                           # desktop + phone screenshots
node tools/simulate.mjs --mode deplane --strategy all --seeds 30     # headless Monte Carlo table
node tools/simulate.mjs --help                                       # every strategy id + blurb, both modes
```

270 unit tests across 46 suites currently pass. `tests/e2e/artifacts/` is gitignored; screenshots there are throwaway verification, not committed evidence.

## Review-loop convention

Critic passes live in `design/reviews/`, one file per round (`round-01-critic.md`, `round-02-critic.md`, ...). Each finding gets an id: `B` for blocker, `M` for major, `m` for minor, `n` for nit, numbered within its round (`B1`, `M4`, `m9`). A fix references the finding id it closes, either in a module docstring (see `js/ui/canvas-sizing.js`'s "Fixes M2 and M3" or `js/ui/compare.js`'s "That is the fix for B1") or in the commit. A fix round's own screenshot set lives under `tests/e2e/artifacts/fix-round-NN/`, so a reviewer can check a specific finding against the evidence without re-running the repro.

## How to add

### A new deplaning or boarding strategy

1. Add the entry to `js/engine/strategies/deplane.js` (or `board.js`): `{ id, label, blurb, canLeaveSeat(passenger, state) }` for deplaning, `{ id, label, blurb, order(passengers, rng, cabin) }` for boarding. `blurb` is the one-line plain-language description the UI shows under the strategy picker; no equations, no jargon.
2. That's it to wire up: `strategies/index.js` indexes both arrays by id, and the UI selects, `tools/simulate.mjs --strategy all`, and `js/ui/compare.js`'s strip chart all read from there automatically.
3. If the strategy changes the cabin itself (the way `two-doors` forces a rear door), add a `cabinOverrides` field to the entry. `js/ui/sim-config.js` (the race) and `tools/simulate.mjs` (the CLI) both merge per-strategy overrides on top of the preset; `js/ui/compare.js` merges them too when building the batch task. Don't post a strategy's overrides straight to `js/worker.js` without going through one of those merge points, or the batch chart will simulate a different configuration than the race does.
4. If the strategy has an expected ordering claim against another strategy (like aisle-first beating free-for-all), add it to the relevant calibration test.

### A new aircraft preset

1. Add an entry to `js/engine/cabin-presets.js`: `{ id, label, layout, rows, binCapacityPerSeatRow, rowPitchMeters, note }`. `layout` is seat-block widths left to right (see `cabin.js` for the block/aisle-assignment rules: an outer block uses its one adjacent aisle, a middle block splits down the center). `note` carries the source for the seat count and bin era.
2. Nothing else to wire: `js/ui/sim-config.js` reads the preset by id, the canvas sizes itself from the layout (`js/ui/canvas-sizing.js`), and both modes run it as soon as it's picked from the aircraft select.
3. The unit suite already runs every preset in both modes to completion; a new preset is covered automatically.

### A new knob (a tunable passenger or cabin parameter)

1. Add the default to `js/engine/config.js`, under `CABIN_DEFAULTS` or `PASSENGER_DEFAULTS`, with a one-line source comment.
2. Wire the override path in `js/ui/sim-config.js`: it turns store state into the engine's `cabinOverrides` / `passengerOverrides`, and `js/ui/compare.js` reuses the same function so the batch chart matches what's on screen.
3. Add the control markup in `index.html` and its binding in `js/ui/controls.js`; round-trip it through the URL and localStorage in `js/main.js` (see the URL-param list in that file's docstring; a knob that isn't listed there breaks the share-link contract).
4. Re-run `npm test` before committing. A knob that shifts a default enough to flip a calibration gate needs the gate re-derived, not loosened.
