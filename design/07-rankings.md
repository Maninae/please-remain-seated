# Rankings tab and precomputed Monte Carlo (binding)

The project is a data visualization, not a game. The race stays as the intuitive view; the Rankings tab is the analytical core: every boarding procedure (textbook and airline) and every deplaning order, ranked from thousands of pre-run simulations, with honest uncertainty and the human cost in person-minutes.

## Navigation

- A left vertical rail of tabs (icon + short label), fixed on desktop: Race, Rankings, About. Phone: the same tabs as a bottom bar; the settings drawer stays as is.
- Settings column (right) stays; on the Rankings tab it shows the same knobs but each snaps to the nearest precomputed grid value and says so ("nearest run: 85%").
- URL round-trips the tab (`?tab=rankings`).

## Precompute (tools/precompute.mjs, output under data/rankings/)

- Worker pool over `os.cpus().length - 2` node worker_threads, each running js/batch.js on a chunk of seeds; resumable (skips cells whose file exists and matches the engine version); writes one JSON per cell; `npm run precompute` runs the whole plan, `--only <cellId>` and `--dry-run` supported; prints an ETA. Runs at low priority (`os.setPriority`).
- Seeds: `rank-<mode>-<preset>-<cellHash>-<i>`.
- Plan:
  - Headline cells (all knobs at defaults) for both modes: presets `a320`, `b738-two-class`, `a321neo-three-class`, `b737max8-lcc`, `b789-three-class` at 10,000 seeds per strategy; the other eight presets at 2,000.
  - Sensitivity cells, one factor at a time from defaults, for presets `a320` and `b738-two-class`, both modes, 2,000 seeds per strategy: load factor {0.70, 1.00}, compliance {0.50, 1.00}, groups {0, 0.50}, bag mix {light = 0.40/0.50/0.10, heavy = 0.10/0.50/0.40}, bins {legacy}.
- Per cell file: `data/rankings/<mode>__<preset>__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=10000.json` holding `{ cell: { mode, preset, knobs, seeds, engineVersion, generatedAt }, passengerCount, strategies: [ { id, label, family, n, medianSeconds, meanSeconds, p10, p25, p75, p90, histogram: { binSeconds, start, counts }, idlePersonMinutesMedian, idlePersonMinutesPerPassenger, meanSplit, byClass } ] }`.
  - `idlePersonMinutes` for a run = sum over passengers of (seatedWait + aisleBlocked) / 60, i.e. person-minutes spent going nowhere; `meanSplit` and `byClass` as in metrics.js, averaged across seeds.
- `data/rankings/index.json` lists every cell with its knobs and file, the defaults, the grid values, the engine version, and the seed counts. Files are committed (they are small: a histogram, not raw values).
- Engine version = the git short sha of js/engine at generation; the tool refuses to mix versions in one index.

## Rankings tab (js/ui/rankings/)

- Mode toggle (Boarding | Deplaning) and preset select as in the race; knobs snap to the grid.
- Main chart: a ranked dot-and-band chart, one row per strategy sorted by median, the median as a dot with p10 to p90 as a band, airline rows and textbook rows in two labelled groups with a light rule between, the strategy label at the left and the median in minutes at the right, no legend. The title states the finding, computed ("Reverse pyramid boards a full 737 in 13.8 min; Delta's zones take 24.1"). Hover a row for its histogram as a small inline sparkline plus n.
- Real-world anchors drawn as thin labelled ticks where a measured number exists (design/06: KLM 17 to 22 min 737-800, Spirit ~20 min A320, MythBusters back-to-front 24:29 on 173 seats, Schultz deplane median 23 pax/min), each with its source in a popover, styled unmistakably as "measured, not simulated".
- Stat tiles above the chart, big numbers, consistent precision: person-minutes wasted per flight for the selected best and worst strategy, the difference, and the scaled version: per day across US domestic departures (about 25,000 per day, cite BTS in the popover) as person-years per day. Plus "the average passenger sits going nowhere for m:ss".
- Sensitivity strip: a slope chart per knob (from the one-factor cells): how the top five strategies' medians move as the knob goes low, default, high, so the reader sees which rankings are robust. Available only for presets that have sensitivity cells; say so otherwise.
- Every chart is code-drawn SVG with the theme; the same palette as the race; no chart library. Charts must read at phone width (rows stack, bands still visible).

## About tab

- The thesis, how the model works (six plain bullets), what is measured versus assumed, the calibration gates with their arithmetic, the airline procedure sources with as-of months, what the model does not capture, links to the design docs, and the generation date of the rankings data.

## Tests

- Precompute: a `--dry-run` plan test (cell count and seed counts), a tiny end-to-end run (2 seeds, 2 strategies, one preset) validating the JSON shape and the idle person-minutes arithmetic against summarizeMetrics.
- Rankings UI: renders from a fixture cell file; sorts by median; groups families; the finding sentence names the right strategies; knob snapping picks the nearest grid value; anchors render with their labels.
