# Cabin sections and airline procedures (binding contract, extends 03-engine-contract.md)

Adds multi-class cabins (first, business, premium, economy sections with their own layout and pitch) and real airline boarding procedures as strategies. Everything in 03 still holds; this file says how it generalizes.

## Sections

- `cabin.sections: [{ id, label, cabinClass, layout, rows, rowPitchMeters, binCapacityPerSeatRow }]`, front to back. `cabinClass` is one of `first`, `business`, `premium`, `economy`. Every section has the same `layout.length` (same aisle count); createCabin throws otherwise.
- Backward compatibility: a preset or override with top-level `layout` / `rows` / `rowPitchMeters` / `binCapacityPerSeatRow` and no `sections` becomes one economy section. Every existing preset keeps working unchanged.
- Rows are numbered continuously from 1 across sections. Per-row lookups: `rowSection(cabin, row)`, `rowLayout(cabin, row)`, `seatsInRow(cabin, row)`, `seatColumnInfo(cabin, row, col)` (now row-aware; the old `(cabin, col)` signature stays valid for single-section cabins and for the economy section otherwise), `colAt(cabin, row, blockIndex, depth, aisleSide)`.
- Aisle lattice: a section's rows each own `max(1, round(rowPitchMeters / aisleCellMeters))` cells (economy 31 in gives 2, first class 37 in gives 2, a 60 in lie-flat business row gives 4). `rowToCell(cabin, row)` is the first cell of the row's run, `rowCellCount(cabin, row)` its length; the either-cell rule from 03 applies to every cell in the run. `cellToRow` uses a precomputed cell-to-row table. Galley cells and doors as before.
- Bins: per (section, block), `binRowsPerBin` rows per bin, capacity `round(section.binCapacityPerSeatRow * blockWidth * rowsInThisBin)`; a bin never spans two sections. Global bin indices stay contiguous per block within a section; `binIndex(cabin, row, blockIndex)`, `binFirstRow`, `binBlock`, `binSection` all exist.
- Rendering: each section drawn with its own seat width (block width in seats fills the same fuselage width, so a 2-2 first-class row draws wider seats than a 3-3 row) and its own pitch; a thin light divider between sections; the section label in light gray at the divider. Row numbers continue across sections.

## Passenger attributes (added)

- `cabinClass` from the seat's section.
- `status`: `none` | `silver` | `gold` | `top`, sampled from `statusFractions` in config (research supplies defaults; placeholders 0.68 / 0.20 / 0.08 / 0.04 until then).
- `fare`: `basic` | `main` | `premium` for economy seats (`basicFareFraction` of economy, `premiumFareFraction` for extra-legroom rows flagged by a section `premium` or by the preset's `premiumRows`), `first` / `business` for those cabins.
- `preboard`: true for `preboardFraction` of passengers (families with small children, assistance); pre-boarders board first regardless of strategy and their group-mates go with them.
- `groupId` as before. Group members share status and fare.

## Airline strategies

- Live in `js/engine/strategies/airlines.js`, exported as `AIRLINE_STRATEGIES`, and are appended to `BOARD_STRATEGIES` in the registry under a `family: 'airline'` field so the UI can group them ("Textbook methods" / "How airlines actually board").
- Shape: `{ id, label, blurb, family: 'airline', groups: [{ id, label, member(passenger, cabin) -> boolean, within?: 'random' | 'back-to-front' | 'window-first' }], asOf: 'YYYY-MM', source }`. A passenger belongs to the first group whose `member` returns true; a helper `orderByGroups(passengers, rng, strategy)` in `strategies/group-order.js` builds the queue: pre-boarders first (random), then each group in order, within-group order per `within` (default random). Non-compliance and group adjacency from 03 still apply afterwards.
- One strategy per airline the research report covers (Alaska, American, Delta, United, Southwest as of its 2026 assigned-seat model, JetBlue, Spirit, Frontier, Hawaiian, Ryanair, easyJet, Lufthansa, British Airways, Air Canada, one Asian carrier), each with `asOf` and `source` from design/06-airline-research.md. Membership rules use only the attributes above plus seat geometry (row, seatDepth, section).
- The CLI and compare chart treat them like any other boarding strategy. The strips chart groups the two families visually (a light rule between them) and the finding sentence names the fastest airline.

## Presets (added; the nine single-section presets stay)

- `b738-two-class`: 737-800 US mainline: first 2-2 x 4 rows at 37 in, extra-legroom 3-3 x 6 rows at 34 in (premium), economy 3-3 x 20 rows at 31 in.
- `a321neo-three-class`: first 2-2 x 5 rows at 37 in, premium 3-3 x 9 rows at 34 in, economy 3-3 x 24 rows at 30 in.
- `b737max8-lcc`: all economy 3-3 x 29 rows at 30 in, first 5 rows flagged premium (extra legroom), legacy bins.
- `b789-three-class`: business 1-2-1 x 12 rows at 44 in (lie-flat, counts 3 cells per row), premium 2-3-2 x 3 rows at 38 in, economy 3-3-3 x 26 rows at 31 in.
- Each preset lists `sections` explicitly with `note` and source (airline seat maps, cite in cabin-presets.js).

## Metrics (added)

- `summary().byClass`: per cabinClass mean time split and mean total, so the page can say "first class off in 0:48, economy 6:10".

## Tests

- Every sectioned preset runs both modes to completion; row/cell/bin maps round-trip across section boundaries; a lie-flat row owns more cells than an economy row; airline strategies produce a permutation with pre-boarders first and group order respected; the existing calibration gates are unchanged (they run on the single-section A320 preset).
