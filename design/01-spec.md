# Please Remain Seated: design spec

An agent-based airplane deplaning and boarding simulator. Individual passengers, stochastic bag handling, a one-lane aisle. Hero is a race: two cabins with the same 180 people and the same seed, different exit orders, side by side.

## 1. Thesis

Deplaning is slow because the aisle is a single-lane road and every overhead-bin retrieval is a stopped car in that lane. Nothing behind a stopped person moves. The sim makes that visible, then tests whether any exit order survives realistic non-compliance (families, people who ignore the announcement).

## 2. Model

### 2.1 Cabin
- Narrowbody 3-3, default 30 rows x 6 = 180 seats (A320 / 737-800 class). Seat letters A B C | D E F; A and F window, B and E middle, C and D aisle.
- Row pitch 0.79 m (31 in). Aisle is a 1D lattice of 0.4 m cells (Schultz's cellular-automaton cell size): 2 cells per row, plus 4 galley cells between row 1 and the forward door. Rear door optional at the aft galley.
- One person per aisle cell, no passing. A passenger retrieving a bag occupies the cell beside their seat row for the whole retrieval.
- Overhead bins: one bin per two rows per side, capacity 6 bags (Space Bin era; legacy 4 is a config option). Bin state is a plain array so a boarding run can hand its final bin layout to a deplaning run.
- Load factor default 0.85; empty seats are sampled uniformly.

### 2.2 Passenger attributes (all sampled per seed from config distributions)

| Attribute | Default | Basis |
|---|---|---|
| Bin bags | 0 / 1 / 2 with p = 0.20 / 0.60 / 0.20 | Schultz field mix |
| Bag location | own bin; overflow goes to nearest bin with space, searching forward first, then aft | Bin capacity model |
| Free walking speed | 0.8 m/s (0.5 s per cell); per-passenger lognormal jitter sigma 0.15 | Schultz 2018 |
| Prep time (seatbelt-off to ready) | lognormal median 2 s, sigma 0.8; a distracted 10% add uniform 10-30 s | Assumption (behavioural; 1-2 s stand-and-collect is folklore in the deplaning literature, unverified against a primary source; the phone-checker tail is our assumption, low confidence) |
| Bag retrieval per bag | Weibull k=1.7, lambda=10 s (mean 9 s); second bag +60% | Derived from Schultz stow Weibull(1.7, 16 s) scaled by measured deplane/board outflow ratio |
| Bag stow per bag (boarding) | Weibull k=1.7, lambda=16 s (mean 14.3 s); second bag +8 s | Schultz 2018, 323 events |
| Seat egress (deplane) | 2 s per seat position crossed (aisle 2 s, middle 4 s, window 6 s) | Our assumption, calibrated |
| Seat interference (boarding) | 5 s per movement; movements 1 / 4 / 5 / 9 by blocking case | Schultz 2018 |
| Politeness | P(walker yields an empty cell to a row-mate stepping out) = 0.9 | Assumption (behavioural; the yielding parameter is not verified against a primary source) |
| Compliance | P(passenger obeys the announced strategy) = 0.85 | Schultz conformance |
| Group | 25% of passengers travel in groups of 2-4 in adjacent seats; groups move together and ignore strategy order | Known Steffen killer; assumption |
| Door arrivals (boarding) | exponential inter-arrival, mean 3.7 s | Schultz baseline |

### 2.3 Deplaning state machine (per passenger)
SEATED (prep timer) -> READY (needs every row-mate between them and the aisle to be out, plus strategy permission, plus an empty aisle cell at their row) -> STEPPING_OUT (egress timer) -> IN_AISLE -> RETRIEVING (walk to the bag's cell if elsewhere; a bag aft of the seat means moving against the flow, which needs empty cells behind) -> WALKING (follow-the-leader toward the door) -> EXITED.
Contested empty cell: a walker behind it and a row-mate beside it both want it. Politeness draw decides.

### 2.4 Boarding state machine
QUEUED (at door, exponential arrivals in strategy order) -> WALKING aft -> STOWING (blocks cell; if own bin is full, continue to the next bin with space, then walk back) -> SEAT_INTERFERENCE (seated row-mates step into the aisle, occupying cells, then reseat; movement count per Schultz) -> SEATED.

### 2.5 Strategies

Deplaning (all take compliance and group fraction; non-compliant passengers behave free-for-all):
1. Free-for-all (baseline, reality)
2. Row-by-row front to back (row r waits until row r-1 has left its seats)
3. Aisle seats first, then middle, then window (Wald, Harmon & Klabjan 2014 one-column; their >40% claim is the thing to test)
4. Alternating rows (even rows first, then odd) so retrievals happen in parallel one row apart
5. Two doors (rows past the split exit aft)
6. Bagless first
7. Back to front (walkers only stop at the back; instructive)

Boarding:
1. Random  2. Back-to-front, 5 zones  3. Front-to-back  4. WILMA (outside-in)  5. Steffen optimal  6. Steffen modified (block alternating)  7. Reverse pyramid  8. Rotating zone  9. Open seating (front-first with window preference)

### 2.6 Metrics
- Total time (seatbelt sign off, or door open, to last passenger clear).
- Per-passenger time split: seated waiting / aisle blocked / retrieving or stowing / walking. The last passenger off is the headline: nearly all of it is waiting.
- Aisle occupancy vs aisle movement over time (full but not moving is the pathology).
- Door throughput over time (pax/min).
- Monte Carlo: N seeds per strategy, report median, p10, p90, and delta vs free-for-all.

### 2.7 Calibration gates (permanent tests)
- Free-for-all deplane, 180 seats at 0.85 load, default params, median over 40 seeds: whole-run door throughput (passengerCount / total minutes from door open) 14 to 27 pax/min (Wald, Harmon & Klabjan 2014 low end at 15 pax/min to comfortably above Schultz 2018 median 23), and total minutes (from door open) 5 to 13 as a sanity bound. The clock starts at door open, not at seatbelt-sign off: the sim stages the first 45 s while people stand and pull bags, matching how Schultz's "23 pax/min" was measured on the first minute of OUTFLOW rather than the first minute after the sign went off.
- Door outflow over the first 2 min AFTER DOOR OPEN of free-for-all deplaning: 15 to 30 pax/min (Schultz median 23).
- Random boarding, same cabin: 15 to 30 min (MythBusters random 17:15; Nyquist & McFadden 30 min).
- Back-to-front boarding slower than random; Steffen faster than WILMA faster than random at compliance 1.0 (ordering from Steffen 2008 and MythBusters).
- Widebody sanity: the 777 (3-4-3) whole-run pax/min sits at or below the door-service ceiling (60 / doorServiceSeconds), and its total minutes exceeds the A320's at defaults. Two aisles merging at one shared front-door server means twice the passengers cannot deplane faster than half.

## 3. Engine contract (fixed before fan-out; DOM-free, deterministic per seed)
- `createDeplaneSim({ cabin, passengers, bins, strategyId, params, seed })` and `createBoardSim({ cabin, passengers, strategyId, params, seed })` both return `{ step(dtSeconds), state, done, metrics }`.
- `state` = `{ t, passengers, aisleCells, bins, doors, exitedCount, boardedCount }`. Passenger = `{ id, row, col, phase, aisleCell, bags: [{ binIndex }], groupId, compliant, timers, timeSplit }`.
- Deplane strategy = `{ id, label, canLeaveSeat(passenger, state) }`. Board strategy = `{ id, label, order(passengers, rng), assignSeat? }`.
- `batch.js` runs headless Monte Carlo; used by `tools/simulate.mjs` (CLI) and by the page through a module Web Worker.
- The renderer reads state and never mutates it. Fixed dt = 0.1 s; the UI runs k steps per frame for speed multipliers.

## 4. Page
- Hero: Race. Two cabins stacked on desktop (nose left), two cabins side by side vertical on phone (nose top). Big elapsed clock per cabin. Below: play / speed / strategy pickers, compliance and families sliders, the time-split bar, and Monte Carlo strips (worker).
- Mode toggle: Deplane / Board. A "deplane this plane" button carries the boarded bin layout into a deplaning race.
- Visual signature: airline safety-card pictogram style. Paper background, flat outlined cabin, passengers as pictogram dots. Color is state only: walking = exit-sign green, retrieving or stowing = seatbelt amber, seated = paper gray. One typeface family (Barlow), single-color title. No legend: states are labeled once inline under the first cabin.
- Eye lands on: the two aisles. Then the two clocks. Everything else is gray.

## 5. Repo
`~/Developer/please-remain-seated`, public on GitHub as Maninae/please-remain-seated, GitHub Pages from main. Vanilla ES modules, no build step. `node --test tests/unit/*.test.js`, Playwright 1.58.2 e2e, `python3 -m http.server`. MIT, Owen Wang. CLAUDE.md, README, design/ folder holding this spec and the research report.

```
index.html
css/base.css  css/cabin.css  css/controls.css
js/engine/config.js        every number above, with its source
js/engine/rng.js           seeded PRNG
js/engine/distributions.js lognormal, weibull, exponential, uniform samplers
js/engine/cabin.js         geometry: rows, seats, aisle cells, doors, bins
js/engine/passengers.js    population sampling (seats, bags, groups, per-pax draws)
js/engine/bins.js          bin capacity + placement search
js/engine/deplane-sim.js   deplaning state machine
js/engine/board-sim.js     boarding state machine
js/engine/aisle.js         lattice moves, contested-cell rule (shared by both sims)
js/engine/metrics.js       time split, throughput, occupancy series
js/engine/strategies/deplane.js  js/engine/strategies/board.js
js/batch.js  js/worker.js
js/render/cabin-view.js    canvas cabin
js/render/charts.js        code-drawn SVG strips + time-split bar
js/ui/race.js  js/ui/controls.js  js/ui/compare.js
js/main.js
tools/simulate.mjs
tests/unit/*.test.js  tests/e2e/*.test.js
design/01-spec.md  design/02-research.md
```
