# Engine contract (binding for every builder)

Read design/01-spec.md first. This file overrides it where they differ. The files in js/engine/ written before fan-out (config, rng, distributions, types, cabin, bins, passengers, metrics, strategies/index, sim-factory) and js/batch.js are the starting point; the engine-core builder generalizes cabin geometry as described here and every other builder codes against the result.

## Cabin layouts (generalized; replaces the 3-3-only geometry)

- A cabin has `layout: number[]`, the seat-block widths left to right. Aisles sit between adjacent blocks, so `aisleCount = layout.length - 1`. Examples: `[2,2]` CRJ / E175, `[2,3]` 717 / MD-80 / E-jet E2, `[3,3]` A320 / 737, `[2,3,2]` 767, `[2,4,2]` A330, `[3,3,3]` 787 / A350, `[3,4,3]` 777 / A380 lower deck.
- Every seat column maps to `blockIndex`, `aisleIndex` (the aisle it steps into), `side` (0 = the aisle is to its right, 1 = to its left), `seatDepth` (seats between it and that aisle, 0 for an aisle seat). Outer blocks use their only adjacent aisle. A middle block splits in half: the left half uses the left aisle, the right half the right aisle; an odd middle seat goes left.
- Every aisle is an identical lattice (front galley cells, `rows * aisleCellsPerRow` row cells, optional rear galley cells), numbered from the front. `state.aisles[k]` is one Int32Array per aisle. Passenger gains `aisleIndex`; `aisleCell` indexes into that aisle.
- Doors: one forward door shared by every aisle (a widebody's aisles merge in the forward galley), modeled as a server that admits one passenger per `doorServiceSeconds` (default 1.0; a person exiting cell 0 must also win the door). `rearDoor` adds an identical server at the aft end. Boarding arrivals enter at the front door and take the aisle their seat maps to.
- Bins: one bin group per seat block (outboard bins over outer blocks, center bins over middle blocks), `binRowsPerBin` rows per bin, capacity `round(binCapacityPerSeatRow * blockWidth * binRowsPerBin)`. Defaults: `binCapacityPerSeatRow` 1.0 (a 3-wide block over 2 rows holds 6, the Space Bin figure), legacy 0.67 (holds 4), regional 0.5. A passenger stows in their own block's bins; overflow searches their block's bins forward first, then aft, as bins.js already does.
- Presets live in `js/engine/cabin-presets.js` as `{ id, label, layout, rows, binCapacityPerSeatRow, rowPitchMeters, note }`. Ship at least: CRJ-700 (2-2, 17 rows), E175 (2-2, 19 rows), 717 (2-3, 26 rows), A320 / 737-800 (3-3, 30 rows, default), 737 high-density (3-3, 33 rows, legacy bins), A321neo (3-3, 37 rows), 767 (2-3-2, 28 rows), 787 (3-3-3, 30 rows), 777 (3-4-3, 36 rows). Load factor, rear door, and bin era stay independent toggles.

## Sim surface (both modes identical)

`createDeplaneSim({ cabin, passengers, bins, strategyId, params, rng, seed })` and `createBoardSim({ cabin, passengers, strategyId, params, rng, seed })` return:
- `step(dtSeconds)`: advance one fixed step (SIM_DT_SECONDS). Returns `state.done`.
- `state`: `{ mode, t, cabin, passengers, aisles, bins, doneCount, done, seed, strategyId }`.
- `metrics`: from metrics.js, sampled inside step.
- `summary()`: `summarizeMetrics(metrics, state)` plus `{ mode, strategyId, seed }`.
- Deterministic: same inputs, same trajectory. No `Math.random` anywhere in js/engine.

## Deplaning rules (deplane-sim.js)

- Prep timer runs from t = 0 for everyone. When it ends the passenger is READY.
- A READY passenger may claim the empty cell beside their row (`rowToCell`) when: every row-mate between them and the aisle has left the seat (phase not SEATED / READY), the strategy allows it (`canLeaveSeat`, only consulted for compliant non-group passengers; group members go when the first member of their group is allowed), and the cell is empty.
- Contested cell: if the walker directly behind that cell is also ready to advance into it this step, the walker's `yields` trait decides. Yielding walker waits; otherwise the walker takes the cell.
- STEPPING_OUT lasts `seatEgressSecondsPerPosition * (seatDepth + 1)`; the cell is held during it.
- Bags: each bag is at `bagBins[i]`; the access cell is `rowToCell(binAccessRow(...))`. If it is the passenger's own cell they retrieve in place. Otherwise they walk there (forward moves with the flow; aft moves need the cell behind to be empty, and the walker pays `counterflowExtraSecondsPerRow` per row on the way back). Retrieval holds the cell for `retrievalSeconds[i]`.
- WALKING: follow-the-leader toward the nearest open door; a move needs the next cell empty and the walk timer (`walkSecondsPerCell`) elapsed. Update order each step: walkers nearest the door first, so a gap propagates one cell per step.
- Time buckets per step: SEATED / READY -> seatedWait; STEPPING_OUT, RETRIEVING -> bags (egress counts as bags, it is bag-and-body shuffling); WALKING moved -> walking; WALKING blocked -> aisleBlocked. Vis per types.js.
- Done when every passenger is EXITED, or at MAX_SIM_SECONDS (then `done` is true and `summary().timedOut` is true).

## Deplaning strategies (strategies/deplane.js)

`free-for-all`, `row-by-row`, `aisle-first` (aisle column front to back, then middle, then window), `alternating-rows` (even rows then odd), `two-doors` (forces cabin.rearDoor on; the UI copies that into the cabin), `bagless-first`, `back-to-front`. Each `{ id, label, blurb, canLeaveSeat(passenger, state), cabinOverrides? }`. `canLeaveSeat` for `free-for-all` returns true.

## Boarding rules (board-sim.js)

- Queue order from `strategy.order(passengers, rng)`; then non-compliant passengers swap into a random nearby position (within 10 places) and group members are pulled adjacent to their first member.
- Arrivals: the next queued passenger enters cell 0 of their aisle when it is empty and `doorGapSeconds` has elapsed since the previous entry through that door.
- Walk aft to the access cell of their first bag's target bin (`placeBag` on arrival at the seat row decides the bin; if the own bin is full they continue aft or turn back to the bin `placeBag` chose, paying counterflow). STOWING holds the cell for `stowSeconds[i]`.
- Seat interference at the row: movements from `seatInterferenceMovements` by which row-mates are already seated (`none`, `aisleBlocked`, `middleBlocked`, `bothBlocked`; for 2-wide blocks only `none` / `aisleBlocked` apply, for 4-wide center blocks treat depth 2+ like a window). Displaced row-mates occupy the cell behind the arriving passenger if it is empty (DISPLACED); if it is not, the interference still takes its time but nobody moves cells. Total time `seatInterferenceSecondsPerMovement * movements`.
- Buckets: QUEUED -> seatedWait (waiting at the gate counts as waiting), WALKING moved -> walking, blocked -> aisleBlocked, STOWING and SEAT_INTERFERENCE and DISPLACED -> bags.
- Done when everyone is SEATED. The sim exposes `state.bins` so the UI can deplane the boarded plane.

## Boarding strategies (strategies/board.js)

`random`, `back-to-front` (5 zones), `front-to-back`, `wilma` (window, middle, aisle), `steffen` (window seats first, alternating rows, one side then the other, then middle, then aisle), `steffen-modified` (blocks of alternating rows, outside-in inside each block), `reverse-pyramid`, `rotating-zone`, `open-seating` (no assigned seats: each passenger in queue order takes the front-most row with a free window, else middle, else aisle, with a 20% chance of skipping ahead 1-5 rows). Each `{ id, label, blurb, order(passengers, rng) }`.

## Renderer (render/cabin-view.js, render/charts.js)

- `createCabinView(canvas, { orientation: 'horizontal' | 'vertical' })` returns `{ draw(state), setCabin(cabin), resize() }`. Horizontal: nose at the left; vertical: nose at the top. Handles any `layout` and any aisle count. Bins as thin strips beside each block with fill fraction. Doors drawn as gaps in the fuselage outline. Passenger dots at seats or at aisle cells, styled by `passengerStyle(vis)` from render/theme.js. Never mutates state. Device-pixel-ratio aware. Must draw a 37-row cabin readably at 900 px wide and a 17-row cabin without stretching dots.
- `renderStrips(svgElement, series, options)` where `series = [{ id, label, values: seconds[], highlight? }]`: one row per strategy, dots jittered, median tick, p10 to p90 band, minutes axis, the title states the finding (options.title). `renderTimeSplit(element, split)` draws a single stacked bar with inline labels (seated waiting, aisle blocked, bags, walking). Code-drawn SVG, no libraries, honours THEME.

## Tests

- `node --test tests/unit/*.test.js`. Engine tests: determinism (same seed, same summary), every passenger finishes, no two passengers in one cell at any step, aisle counts match phases, bins never exceed capacity, each preset runs both modes to completion.
- Calibration (tests/unit/calibration.test.js): A320 default, free-for-all deplane median over 30 seeds in 8 to 13 min and first-two-minute door throughput in 15 to 30 pax/min; random boarding median in 15 to 30 min; at compliance 1.0 and no groups: back-to-front boarding slower than random, steffen faster than wilma faster than random; aisle-first deplaning faster than free-for-all.
- No builder commits. Report back with the list of files and the test output; the lead commits per package.
