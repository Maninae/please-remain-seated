# Round 05 — Critic pass (data-visualization critic)

Reviewer: adversarial data-vis review, headless Chromium 1.58.2 at 1280x800, 1280x900, 1440x900 and 400x800.
Build: `index.html` served from `python3 -m http.server 5197`, repo at `866c59c`.
Artifacts: `tests/e2e/artifacts/critic-round-05/`. `npm test`: **424 pass / 0 fail** across 68 suites. Load 946 ms cold.

**Review conditions, stated up front because they shaped what I could see.** The 10,000-seed precompute was running throughout this pass (`node tools/precompute.mjs`, 420-750% CPU). It had written `data/rankings/index.json` — an index of all 62 planned cells — while only 7 of those 62 cell files existed on disk. The page prefers `index.json` over `index-preview.json`, so the live site was serving a plan, not a dataset. To review the Rankings tab as the fix round built it, I stood up a second read-only server on port 5296 from a scratch directory of symlinks that omits `index.json`, forcing the complete 200-seed preview set. Every Rankings finding below is measured on that complete data unless it says LIVE. I touched nothing in `data/`.

---

## Verdict

You fixed almost everything I asked for and you did it properly, and then one line of code quietly replaced a vague overstatement with a precise false one. Start with the good, because this round earned it. The knob strip now says "no run at 50%, showing 85%" and tints the chip when it falls back — that blocker is closed, verified on four URLs. The tiles reconcile because you round first and subtract second: 334 + 812 = 1146, 999 + 1885 = 2884, 904 + 1629 = 2533, and the invented "1150" is gone. The person-years tile is relabelled "That gap, across the country", carries "(difference)" in its unit, a secondary line reading "difference between two strategies, not a total; estimate", and its own popover citing BTS with the per-aircraft caveat spelled out. The assumptions table is a real three-column table with the 45-second staging window, the patient fraction and the prep distribution all present, politeness credited back to Milne and Salari, and MythBusters carrying "(n=1, TV volunteers)" inline. The About tab prints the gate from a constants module and then adds the sentence I asked for: "The model runs at the fast end of that band... The 45-second staging window is what puts it there." The bins panel draws two points instead of three. The axis is capped and Front to back sits off-scale with its value printed. The phone title wraps instead of truncating. The clocks came down from 54 px to 32 and the live gap went from 13 px to 24 px bold, so the number that differs is finally the one you can read.

And you printed the punchline. "11 of 14 airline procedures board A320 / 737 within a minute of random order. Reverse pyramid saves about 9:33 against random." Both halves check out against the data. That is the sentence people forward, and it is on the page.

Now the one that undoes it. On the live site the deck reads **"Every strategy, run 10,000 times per cell."** Nine inches below, the provenance footer for the very same cell reads **"200 runs per strategy."** The deck reads `seedTiers.headline` — a number from the precompute *plan* — instead of the `seeds` field on the cell it is actually showing, which the footer already has in hand. This is not a mid-run artifact that will heal when the job finishes: of the 62 cells in your own plan, **10 are 10,000 and 52 are 2,000**, so when the precompute completes the deck will overstate by 5x on 84% of cells. The About tab repeats it: "Each cell holds 10,000 runs per strategy." Round 4 asked you to read the count from the index; you read the wrong field, and the fix turned "thousands" (vague, defensible) into "10,000" (precise, wrong, and contradicted on screen). A page whose stated standard is that every number is honest cannot print a number that its own footer refutes.

Everything else above a nit is hierarchy and encoding, not truth. The Rankings tab still has four identical 40 px numbers and no accent colour anywhere, while the 15 px sentence underneath them is the only thing on the page worth remembering. Fix the run count, give the punchline the type size it earned, and this ships.

---

## Re-verification of every round-04 finding

| id | Round-04 finding | Status | Evidence |
|---|---|---|---|
| **N4-B1** | Knob strip asserts "nearest run: X" for an X you did not run | **FIXED** | Four URLs on complete data. `a320&compliance=0.5` (cell exists): strip "nearest run: 50%", cell `…comply=0.5…` ✓. `b777&compliance=0.5`: "**no run at 50%, showing 85%**", cell `comply=0.85`. `b777&load=0.7`: "no run at 70%, showing 85%". `e175` board `load=1&compliance=0.5`: both knobs report the fallback. Fallback chips carry `rankings-knob-note-fallback` and a tinted background (`rgb(236,229,214)` vs transparent). |
| **N4-M1** | "Thousands" over 200 runs | **PARTIALLY FIXED, new defect** | Deck is numeric now and correct on the preview index ("run 200 times per cell (preview build)"). On the real index it prints `seedTiers.headline` regardless of the cell shown: LIVE deck "run **10,000** times per cell" beside footer "**200** runs per strategy", same page load. `index.js:413-424` reads the plan tier, not `cellData.seeds`. Permanent: 10 of 62 cells are 10,000. See **N5-B1**. |
| **N4-M2** | Person-years tile mislabelled, wrong popover | **FIXED** | Tile 4: "That gap, across the country · 38.6 · person-years per day **(difference)**" + "Same gap × about 25,000 US domestic departures a day" + "difference between two strategies, not a total; estimate". `aria-label="About Person-years per day"`, `data-info-key="per-day-scaled"` — its own popover, citing BTS 2023 (9.2M domestic flights) and stating the fleet-mix caveat. `US_DAILY_DEPARTURES` at `rankings-stats.js:31` carries the source comment. Three honest comparison rows added below the tiles. |
| **N4-M3** | Three person-minute tiles do not sum | **FIXED** | Deplane a320: 334 / 1,146 / 812, and 334 + 812 = 1,146 exactly. Board a320: 999 / 2,884 / 1,885, sums. b738-two-class: 904 / 2,533 / 1,629, sums. `rankings-stats.js:87` subtracts rounded values, so the row reconciles at printed precision. Sub-label spells it: "Worst minus best (1,146 minus 334)". |
| **N4-M4** | Strict order asserted over statistically identical rows | **FIXED** | Tie bands drawn as full-width rects at `fill-opacity 0.08` grouping Frontier→easyJet (10 rows) and Steffen-in-blocks→Window-middle-aisle (2 rows), with the caption "These 10 airline procedures are within a minute of each other (49-second spread)." Title states the finding. `TIE_TOLERANCE_SECONDS = 60` sits at 4-8x the true SE of these medians (7-16 s at n=200), so the band is conservative. Residue: times still print to the second (Southwest and Delta both print 23:35 at different ranks), and the title's 11 and the caption's 10 use different rules with no explanation — see **N5-m3**. |
| **N4-M5** | About publishes a gate the code does not assert | **FIXED** | `calibration-gates.js:20-22` exports `wholeRunPaxPerMin {min:14,max:27}`; `about.js:255` renders "14 to 27 pax/min... 6 independent seed families (40 seeds each)"; `calibration-deplane.test.js:80` asserts `>=14 && <=27`. All three agree. The honesty line I demanded is at `about.js:257`: "The model runs at the fast end of that band. Whole-run throughput lands around 23 to 25 pax/min... The 45-second staging window is what puts it there." Residue: the test hard-codes the bounds rather than importing the module, and `config.js:33` still documents the old `[14, 24]`. |
| **N4-M6** | Axis 0-60m, 22 of 23 rows in a fifth of the frame | **PARTIALLY FIXED** | Board a320 axis now **0m-30m** with "40:08 (off scale)" and a break glyph; deplane **0m-10m** with two off-scale rows. That closes the outlier half. The zero baseline survives: the board plot spans x=240 to x=878 and the first dot is at x=537.6, so **47% of the frame is empty** before any data. Phone no longer collapses illegibly — the four clustered deplane rows now sit inside a tie band with a caption. Race-tab strip chart untouched: still 0m-20m with five strategies inside 21 seconds. See **N5-M4**. |
| **N4-M7** | Phone finding sentence truncated mid-word | **FIXED** | 400x800, deplane: two `<text>` lines, "Both doors deplanes A320 / 737 in 4.0" / "min; One row at a time takes 15.9 min." Measured bbox widths 247 and 244 inside a 342 viewBox. No ellipsis, no overflow. Page `scrollWidth` 400 = `clientWidth` 400 on both tabs. |
| **N4-M8** | Assumptions table omits the three biggest assumptions, miscredits politeness | **FIXED** | `about.js:38-135`. Headers `['Number','Value','Source or assumption']`, three plain cells per row. Door-open staging window 45 s, patient fraction 40%, prep distribution lognormal median 3 s sigma 1.0 — all present and marked Assumption. Politeness P=0.9 now `kind:'measured'`, sourced "Milne and Salari 2016". MythBusters row reads "(n=1, TV volunteers)" inline. Residue: `data-kind` is set on each `<tr>` but nothing styles it, so measured and assumed rows are visually identical. |
| **N4-M9** | Bins slope chart plots the same cell at both ends | **FIXED** | Panel 5 has two x-positions (x=60 "roomy bins (default)", x=350 "old-style bins") and **10 circles** against 15 in the three-point panels. No fabricated third point, and the axis no longer reads "legacy \| default \| legacy". |
| **N4-m1** | Band is p10-p90, hover says p25-p75, neither labelled | **FIXED** | Hover now returns "Reverse pyramid / n=200 · median 14.0 min · **band 12.3 to 15.8 min (p10 to p90)**". One interval, named, matching the drawn band. Residue: the naming only appears on hover, and there is still no touch equivalent. |
| **N4-m2** | Board mode says everyone is getting off | **PARTIALLY FIXED** | Captions are mode-aware: "The last passenger **seated**", "· average so far, **nobody seated yet**". But the bucket label is not: `charts-time-split.js:33` maps `seatedWait → 'seated waiting'` in both modes, and `board-sim.js:26` buckets **QUEUED** time into `seatedWait`. So the largest segment reads "seated waiting 1:11" directly beside "nobody seated yet". See **N5-m1**. |
| **N4-m3** | First-class label collides with the boarding-door arrow | **FIXED** | 1280x900, 737-800 two-class, board: "First", "Extra legroom", "Main Cabin" render clean; the green door arrow sits left of and clear of the "F". `14-board-midrace-sections-2x.png`. |
| **N4-m4** | Two 54 px clocks, 13 px live gap | **FIXED** | Clocks now **32px/600** (was 54/600); `.live-gap` **24px/700** (was 13px/400). Ratio 4.2x → 1.33x, and the gap carries the heavier weight. Mid-race it renders as a full-width bold sentence, "Random order is 3 passengers ahead of United Airlines", visibly the dominant element of the card. |
| **N4-m5** | Compare pool leaves five workers idle for half the wall clock | **STILL BROKEN** | 100 runs, 10 logical cores: 10% at 1.16 s, 52% at 5.04 s, 82% at 9.19 s, 92% at 13.44 s, done at **18.08 s**. The last 18% takes 8.88 s = **49% of the wall clock** (round 4: 53%). Unchanged. |
| **N4-m6** | Slope labels come off their lines; one axis runs backwards | **PARTIALLY FIXED** | Axis direction: Carry-ons now runs light → typical → heavy, so four of five panels put "worse" on the right. Follow-the-rules still runs 50% → 100%, where right means *better* — the inconsistency moved rather than left. Labels still detached and now measurably colliding: all five **deplane** panels place "Both doors" at its true endpoint while stacking the rest at 13 px, producing overlaps of **2.6, 5.3, 3.4, 9.2 and 7.1 px** on 14 px text. See **N5-M5**. |
| **N4-m7** | Anchors drawn in the same ink as the gridlines | **PARTIALLY FIXED** | Anchors are now `#1f2a33`, `stroke-width 1.2`, dashed `2 3`, opacity 0.55; gridlines are `#c9c2b4`, `stroke-width 0.5`. Distinguishable. Not done: KLM's published 17-22 min range is still **two separate ticks** ("KLM 737 · 17 min", "KLM 737 · 22 min") reading as two independent measurements, and the Schultz tick still reads "Schultz field · 6.7 min" for a source that measured 23 pax/min. |
| **N4-m8** | Rankings knobs are read-only | **STILL BROKEN** | The tab renders `.rankings-knob-note` spans; the settings sidebar stays hidden on Rankings. To change a knob you still go to Race, drag, and come back. The round-trip works (`?load=0.7` loads the right cell). |
| **N4-m9** | Two 404s on every Rankings visit | **FIXED** | `rankings-data.js:29-31` caches the in-flight index promise. Live: **zero** index 404s per visit. (The 9-10 404s I see on live are missing sensitivity *cells*, a different defect — **N5-M1**.) |
| **N4-m10** | Tap targets under 44 px on phone | **STILL BROKEN** | 400x800, identical numbers to round 4: Last 44x32, Average 64x32, speed pips 39/42/46/49 x 32, Runs select 66x35, every info button 22x22 (12 of them), chime checkbox 16x16, sliders 28 px tall. Hover histogram still has no touch equivalent. |
| **N4-m11** | Two heat ramps, never say they share a scale | **STILL BROKEN** | At the finish: two separate `.heat-ramp` elements, each reading "short ▬▬▬ long", each with its own caption. Left "Worst 28A 6:34; best 1D 0:45." Right "Worst 30A 16:17; best 1D 0:45." The shared maximum 16:17 appears on neither ramp, the endpoints are still adjectives rather than times, and "best 1D 0:45" printing identically under both cabins still reads as a copy-paste fault. |
| **N4-m12** | Front to back at 40:08 is the number an expert will challenge | **PARTIALLY FIXED** | `about.js:289` now says it outright: "Front-to-back boarding runs slow at the tail (about 3.8 pax/min in the sim, against 7 pax/min in the MythBusters back-to-front test). Treat the extremes of the ranking as extrapolation rather than result." Excellent sentence, wrong tab — it is not on the chart, in the tile popovers, or in the anchor popover, so the reader looking at the off-scale row never sees it. |
| **N4-n1** | Seed roll still base-36 | **STILL BROKEN** | Four presses: `plane-aonp`, `plane-6bvj`, `plane-jrg4`, `plane-i498`. Fourth round. |
| **N4-n2** | No keyboard shortcut for heat toggle or tab rail | **PARTIALLY FIXED** | `h` now toggles the worst-seats view (`aria-pressed` flips to true). `m` and `t` still do nothing; the tab rail has no shortcut. |
| **N4-n3** | Door-status slot empties from door open onward | **STILL BROKEN** | Reads "seatbelt sign off, door still closed" during the countdown, then `""` with `offsetParent === null` for the rest of the race, in both modes. |
| **N4-n4** | Finish card and aria-label disagree by a second | **STILL BROKEN** | On one screen: card "6:34, 9:43 ahead" (implies 16:17); right clock **16:16**; canvas aria "finished at **16:16**"; heat caption "Worst 30A **16:17**"; time-split "total **16:17**". `13-race-finish-heat-2x.png`. |
| **N4-n5** | Glossary still calls Steffen the theoretical fastest | **FIXED** | `glossary.js:76` now ends "...In theory it is the fastest possible order, though this model finds reverse pyramid slightly faster once bags are slow enough for the second-bag stow to bind on Steffen." |
| **N4-n6** | Cell provenance line is developer output | **STILL BROKEN** | "Cell: board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=200. 200 runs per strategy." Wraps to two lines of double underscores on phone. |
| **N4-n7** | Footer says "100 seeds", picker says "Runs" | **STILL BROKEN** | Strip footer: "7 strategies · **100 seeds** · 18.0s". Label above it: "Runs". |
| **N4-n8** | MythBusters in the same visual class as Schultz field data | **PARTIALLY FIXED** | "(n=1, TV volunteers)" is now inline in the source cell. Computed row styles for `data-kind="measured"` and `data-kind="assumption"` are identical (transparent background, no border, normal style), so the classes are data-only. |
| **N4-n9** | Sensitivity titles repeat the knob name; "makes or breaks" misused | **PARTIALLY FIXED** | Now "How full has the largest effect on Pick any seat; Steffen method barely moves." The phrase is correct. The knob name still repeats the panel heading directly above it. And see **N5-M3** for the second clause. |
| **N4-n10** | Family header sits on the axis baseline | **FIXED** | Axis labels at y=70, "TEXTBOOK METHODS" at y=114, "HOW AIRLINES ACTUALLY BOARD" at y=412 with its own separator rule at y=398. No longer reads as an axis title. |
| **N4-n11** | Four stat tiles at identical size; no emphasis anywhere | **STILL BROKEN** | All four numbers 40px/700, colour `rgb(31,42,51)`, background `rgb(244,239,230)`, identical 1px border. 23 identical dots, five identical lines per panel, no accent colour on the tab. See **N5-M2**. |

### Older carry-overs

| id | Finding | Status | Evidence |
|---|---|---|---|
| **round-02 NEW-M3** | Race controls below the fold at 1280x800 | **UNCHANGED (mostly fixed)** | `#race-controls` at `top: 756, bottom: 816` in an 800 px viewport. Restart and the speed pips are visible on load, clipped by about 16 px. |
| **round-03 NEW3-n5** | Strip chart axis runs to 20m | **STILL BROKEN, now inconsistent** | Race strip chart axis still `0m 5m 10m 15m 20m` with Both doors at 4:00 and five strategies inside 6:08-6:29 — 21 seconds, **1.75% of the axis**. The Rankings chart fixed exactly this defect; the Race chart did not, so the same project now draws the same quantity two different ways. |

**Round-04 scoreboard: 1 blocker fixed. Majors: 7 fixed, 2 partial. Minors: 4 fixed, 4 partial, 4 still open. Nits: 3 fixed, 3 partial, 5 still open.**

---

## New findings

### BLOCKER

**N5-B1. The deck says the data was run 10,000 times. The footer on the same page says 200. Both are printed by you.**

LIVE, `?tab=rankings&mode=board&preset=a320`, one page load:

| element | string |
|---|---|
| deck (`[data-rankings-lede]`) | "Every strategy, run **10,000** times per cell. Sorted by how long it takes at these settings." |
| provenance footer | "Cell: `board__a320__…__n=200`. **200** runs per strategy." |
| About tab | "Rankings data generated 2026-09-23 with engine 04a98e5. Each cell holds **10,000** runs per strategy." |

`index.js:413-424` (`updateLedeFromIndex`) reads `indexObject.seedTiers.headline` once, when the index loads, and never again. That field is a constant from the precompute *plan*. The cell actually on screen carries its own `seeds` field — `renderChart`'s footer at `index.js:348` already prints it correctly.

This will not heal when the precompute finishes. Counting the plan itself:

| seeds per cell | cells |
|---|---|
| 10,000 | 10 |
| 2,000 | 52 |

So the completed build will print "run 10,000 times per cell" on **52 of 62 cells**, a 5x overstatement, on the tab whose whole job is to be the analytical record. Today it is a 50x overstatement because the fallback is serving 200-seed preview cells behind it.

Round 4 asked for the count to come from the index so it "becomes true for free when the full precompute lands". It reads the index, but the wrong field, and the change made things worse: "thousands" was vague and survivable, "10,000" is a specific claim a reader can check against your own footer nine inches below and find false.

**Fix:** the deck reads `cellData.seeds`, the same value the footer uses, and re-renders per cell. If you want a single sentence for the whole tab, say the range ("2,000 to 10,000 runs per cell, printed under each chart"). Same for the About line. One field name.

### MAJOR

**N5-M1. `index.json` publishes 62 cells the moment the run starts, and 55 of them do not exist.**

`tools/precompute.mjs:607-608` writes the complete index before computing anything; cells land one at a time from line 621, and line 625 rewrites the index each time — always with the full planned cell list. `rankings-data.js:22-25` prefers `index.json` over `index-preview.json`. So from the first second of a multi-hour run, the page is reading a promise.

Measured now: `index.json` lists 62 cells, **7 exist**. Live console, one Rankings visit at 1280x800: **9 to 10 404s**, every one a cell file. The sensitivity section degrades to "Sensitivity cell files have not been generated yet. Run `npm run precompute` to fill them in." — developer instructions shown to a general reader. The headline chart survives only because `loadCellWithFallback` silently drops to the 200-seed preview cell, which is what makes N5-B1 visible.

The degradation is graceful, which is to your credit. The defect is that the index advertises what has not been built, so any deploy from a partial data directory ships a site that 404s ten times per visit and serves preview data under a headline claim.

**Fix:** write only completed cells into the index. The rewrite loop at line 625 already runs after every cell, so this is a filter, not new machinery. The page then shows fewer presets honestly instead of all of them brokenly.

**N5-M2. The Rankings tab has four first-things and its payload is the smallest text on the page.**

Measured on `?tab=rankings&mode=board&preset=a320`:

| element | size / weight |
|---|---|
| four stat tile numbers | 40px / 700, identical colour, background and border |
| the finding sentence | 15px |
| tie-band caption | 11px italic |

The sentence is "11 of 14 airline procedures board A320 / 737 within a minute of random order. Reverse pyramid saves about 9:33 against random." That is the best thing this project has produced and it is set smaller than every number above it, under four tiles that are styled so identically the eye has nowhere to land first. There is no accent colour anywhere on the tab: 23 dots in one ink, five lines per sensitivity panel in one ink, four tiles in one ink. The only differentiation you allow yourself is the tie band at `fill-opacity 0.08`.

You already know how to do this. The Race tab's strip chart greens exactly the two rows being raced, and it is the most readable chart in the project.

**Fix:** promote the finding sentence to the top of the tab at tile scale and demote the four tiles to one row of supporting numbers, or keep the tiles and give exactly one of them the accent. Pick the one thing the eye should hit first and make it the largest element, per the project's own design rule.

**N5-M3. "Barely moves" is false in half the sensitivity panels.**

`rankings-sensitivity.js:302-311` gates the title on `largest.delta >= 20` but applies no threshold to the *smallest* — it simply names whichever of the top five moved least. Measured swings against an SE of 7-13 s at n=200:

| panel | claim | actual swing of the "barely moves" strategy |
|---|---|---|
| board / how full | "Steffen method barely moves" | 319 s ≈ 43 SE |
| board / groups | "Steffen, in blocks barely moves" | 96 s ≈ 13 SE |
| board / carry-ons | "Reverse pyramid barely moves" | 243 s ≈ 33 SE |
| deplane / how full | "Both doors barely moves" | 127 s |
| deplane / carry-ons | "Both doors barely moves" | 140 s |

Five minutes of movement described as "barely". The other five panels (both compliance panels, both bins panels, deplane groups) are defensible — their smallest genuinely sits within a couple of standard errors of zero. A reader takes "barely moves" as "this strategy is robust to how full the plane is", which is the opposite of a 5-minute swing.

**Fix:** gate the second clause on an absolute threshold (`smallest.delta < 60` reads naturally as "under a minute") and drop the clause entirely when nothing qualifies. The first clause is correct in all ten panels and can stand alone.

**N5-M4. Every chart still starts at zero, and roughly half of each frame is empty.**

| chart | axis | first data | empty left margin |
|---|---|---|---|
| Rankings, board a320 | 0m-30m | 14:00 | **47% of the plot width** |
| Rankings, deplane a320 | 0m-10m | 4:00 | 40% |
| 5 sensitivity panels | 0m-30m | all lines 14-21m | bottom half empty in every panel |
| Race strip chart | 0m-20m | 4:00 | five strategies inside 21 s = 1.75% of the axis |

Boarding time has a hard floor around 14 minutes on this aircraft; nothing in the data approaches zero and nothing ever will. The axis cap fixed the right-hand waste and left the left-hand waste untouched, so the ranked chart still delivers its ordering through the printed times on the right rather than through position, which is the definition of a table with decoration. The five sensitivity panels are the worst case: near-flat lines compressed into the top third of each frame, repeated five times.

The Race strip chart is the one that now looks careless, because the Rankings chart proves you know the fix and it was not applied there.

**Fix:** start each axis near the data floor (the p10 of the fastest row, rounded down) and say so under the chart. Apply it to the strip chart and the sensitivity panels too, so the project draws one quantity one way.

**N5-M5. The sensitivity labels collide in all five deplane panels.**

The de-collision pass stacks labels at a fixed 13 px but exempts the lowest line, which is drawn at its true endpoint. "Both doors" is the lowest line in every deplane panel, so it overprints its neighbour. Measured gaps between adjacent label baselines, on 14 px text:

| panel | colliding pair | gap |
|---|---|---|
| How full | Aisle seats first / Both doors | **2.6 px** |
| Follow the rules | Free-for-all / Both doors | 5.3 px |
| Groups | No bags first / Both doors | **3.4 px** |
| Carry-ons | Free-for-all / Both doors | 9.2 px |
| Overhead bins | Free-for-all / Both doors | 7.1 px |

Board mode is clean (its lines spread further), which is why this reads as a layout bug rather than a density problem. At 400 px the same five panels are worse: the labels are the only way to tell five near-identical lines apart, and two of them are printed on top of each other. `24-phone-sensitivity-labels-4x.png`, `08-sensitivity-panels-2x.png`.

**Fix:** include the final label in the stacking pass, and draw a leader line from each label to its endpoint so the reader can follow it back through the convergence.

**N5-M6. The three comparison rows print ragged precision and omit the comparison that carries the finding.**

Under the tiles:

| row | value |
|---|---|
| Best textbook method vs random order | 26.6 person-years / day |
| Best airline vs random order | 8.79 person-years / day |
| Average airline vs best textbook method | 26.5 person-years / day |

Two problems. First, `26.6 / 8.79 / 26.5` in one column of three numbers a reader will compare: one carries two decimals and two carry one, because the formatter switches rule at 10. Within a column, consistent precision is the whole point.

Second, the row that states the finding is missing. The mean of the fourteen airline procedures differs from random order by **2.3 person-minutes per flight, about 0.1 person-years per day** — arithmetically indistinguishable from boarding at random. Using the median airline instead it is 1.07. The tab makes the reader derive it by noticing that 26.6 and 26.5 are nearly equal, which nobody will do. You print the sentence version in the chart title and then decline to print the number.

**Fix:** round all three to one decimal, and add "Average airline vs random order — about 0.1 person-years / day". That row is the entire thesis of the site expressed as a number.

### MINOR

**N5-m1. In board mode the largest bar segment says "seated waiting" for people who are not seated, beside a caption saying nobody is.**
`board-sim.js:26` buckets QUEUED time into `seatedWait`; `charts-time-split.js:32-34` has one static label map for both modes. On screen, mid-board: "· average so far, **nobody seated yet**" directly above "**seated waiting** 1:11", which is 94% of that bar. `14-board-midrace-sections-2x.png`. **Fix:** mode-aware bucket labels ("waiting to board" in board mode).

**N5-m2. KLM's published range is still drawn as two independent measurements.**
Two dashed verticals at x=601.5 and x=707.9, labelled "KLM 737 · 17 min" and "KLM 737 · 22 min", from one source reporting one range. A reader counts five anchors where there are four. **Fix:** one shaded band between them with a single label.

**N5-m3. The chart states two tie counts, three lines apart, under two different rules, and explains neither.**
Title: "**11** of 14 airline procedures... within a minute of **random order**." Caption: "These **10** airline procedures are within a minute of **each other** (49-second spread)." Both are arithmetically correct — 11 lie within 60 s of random's 23:32, and the longest run within a 60 s window is Frontier→easyJet — but the banded set and the counted set are different sets, and Alaska is in one and not the other. **Fix:** state one rule, or name both ("11 sit within a minute of random; the 10 shaded sit within a minute of each other").

**N5-m4. Compare pool still leaves most workers idle for half the run.** [carried, N4-m5] 82% at 9.19 s, done at 18.08 s; the last 18% is 49% of the wall clock on 10 cores. **Fix:** chunk by seed range, not by strategy.

**N5-m5. Tap targets unchanged on phone.** [carried, N4-m10] Twelve 22x22 info buttons, the reader's only route to the glossary; Last 44x32; Average 64x32; speed pips 32 px tall; Runs select 66x35; chime checkbox 16x16. Hover histogram still unreachable by touch.

**N5-m6. Two heat ramps, unlabelled endpoints, shared scale never stated.** [carried, N4-m11] "short ▬▬ long" twice, with 0:45 and 16:17 printed in prose captions instead of on the ramp, and "best 1D 0:45" identical under both cabins. **Fix:** one ramp between the cabins with its real endpoints on it.

**N5-m7. Rankings knobs are still read-only text.** [carried, N4-m8] The analytical tab has one interactive control (the preset select) and a caption. 36 sensitivity cells are reachable only via a detour to the Race tab.

**N5-m8. Two stale numbers in the README.**
`README.md:73` says the calibration tests take "median over 40 seeds each"; `calibration-board.test.js:70` uses 30 seeds and lines 81/96 use 20. `README.md:71` dates MythBusters episode 222 to **2012**; `about.js:96` says **2014**, and 2014 is correct. **Fix:** the README is the one calibration surface nobody re-reads; make the seed count a pointer rather than a number.

**N5-m9. Three stale or self-contradicting comments in the engine and chart code.**
`config.js:33` still documents the gate as `[14, 24]` after it moved to `[14, 27]` — the exact drift N4-M5 was about, surviving one layer down. `config.js:65` says 45 s "sits inside the one-to-three minute field range", which is arithmetically false and contradicted by `about.js:42`'s own honest "ops range 60 to 180 s field, tuned to Schultz median". `rankings-chart.js:13` and `:246` call `(p90-p10)/2.563` "the SE of the median"; that expression is sigma, and the SE is about 11x smaller — the working `seMedian()` at `:281-289` has the correct formula, so the comments contradict the code beside them. Output is unaffected in all three cases.

**N5-m10. The model's range-of-validity note is on the wrong tab.** [carried, N4-m12] `about.js:289` names it exactly right. The reader looking at "40:08 (off scale)" on the Rankings chart never sees it. Every one of the 14 simulated airline procedures also lands at or above your own Spirit anchor of 20 min, which the same note could cover in a clause. **Fix:** one line under the ranked chart.

### NIT

**N5-n1.** Seed roll still base-36: `plane-aonp`, `plane-6bvj`, `plane-jrg4`, `plane-i498`. (Fourth round.)
**N5-n2.** No keyboard shortcut for the tab rail; `m` and `t` do nothing. `h` now works.
**N5-n3.** Door-status slot still empties to `""` from door open to finish, so the line appears and vanishes.
**N5-n4.** Finish card implies 16:17, the clock and the canvas aria say 16:16, the heat caption and time-split say 16:17.
**N5-n5.** Cell provenance is still developer output: `board__a320__load=0.85__comply=0.85__…__n=200`, two lines of double underscores on phone.
**N5-n6.** Strip footer says "100 seeds"; the control above it says "Runs".
**N5-n7.** `data-kind` is set on every assumptions-table row and styled by nothing, so measured and assumed rows are visually identical; MythBusters (n=1) still sits in the same visual class as Schultz field data.
**N5-n8.** The "Source or assumption" column holds four vocabularies — a bare citation, "Assumption (…)", "Derived (…)", "Estimate (…)" — under a header promising two.
**N5-n9.** Every sensitivity title still repeats the knob name in the heading directly above it ("How full" / "How full has the largest effect on…").
**N5-n10.** Phone row labels ellipsize in the ranked chart: "Aisle seats fi…", "One row at a t…".
**N5-n11.** "9:43" prints four times at the finish: the winner's subtitle, the loser's subtitle, the card headline, and the PB line.
**N5-n12.** `about.js:66` and `:84` cite "Milne and Salari 2016, JATM 43" for the aisle-first deplaning claim and for politeness. The 2016 Milne and Salari paper in that journal is volume 54 and is about assigning passengers to seats by carry-on luggage. Worth chasing before publication; I could not confirm either way without the paper.

---

## What would make me send it to a friend

1. **Make the deck say what the data says.** One field name. Until then the analytical tab contradicts itself on screen, and everything else on this list is decoration on a page that misstates its own sample size.
2. **Give the punchline the type size it earned.** "11 of 14 airline procedures board within a minute of random order" is the reason to send this to anyone. It is currently 15 px under four 40 px numbers that nobody will quote. Swap them.
3. **Print the missing row: average airline vs random order, about 0.1 person-years per day.** You have the sentence. Add the number. That is the whole argument in one line.
4. **Start the axes where the data starts.** Half of every frame is currently empty, five times over in the sensitivity grid. This is the single change that turns the ranked chart from a table into an argument.
5. **The wager before the door opens.** Still unbuilt, still the best idea on the table, and now that the default matchup is a 2.5x knockout the guess is actually interesting.

---

## Scores

**Truth: 7/10.** A large, real improvement. The blocker is gone and gone properly, with a fallback string that names the value you did not run and a tinted chip to match. The tiles reconcile. The person-years tile is relabelled, caveated twice, and wired to its own sourced popover. The assumptions table is complete, politeness is credited back to its source, and the About tab now volunteers that the model runs at the fast end of the literature and names the parameter responsible — that is the single most creditable paragraph on the site, because you had every incentive not to write it. The tie bands and the off-scale marking mean the chart no longer asserts orderings it cannot defend. What holds it at 7 is that the fix for the sample-size claim replaced a vague overstatement with a precise falsehood that the page's own footer refutes nine inches below, and it will stay wrong on 84% of cells after the precompute finishes. Behind it: "barely moves" attached to five-minute swings in half the sensitivity panels, the comparison row that carries the thesis left unprinted, a validity caveat filed on the tab the reader will not open, and three stale comments including the old `[14, 24]` gate surviving one layer below the page that was fixed.

**Clarity: 7/10.** The copy is still the best thing here, and it got better: mode-aware captions, a hover that names its own interval, a chart title that states a finding with two computed numbers in it, a three-column assumptions table you can scan down instead of read through. The Race tab's hierarchy is fixed — the clocks shrank, the gap grew and went bold, and the number that differs is now the one you see. The finish is genuinely good. The Rankings tab is where clarity stalls: four identical 40 px numbers so the eye has no first stop, no accent colour anywhere on the tab, the payload sentence set smaller than everything above it, a zero baseline eating 47% of the flagship chart and the bottom half of all five sensitivity panels, and labels overprinting each other in every deplane panel. The charts are drawn carefully and still encoded without a decision about what matters most.

**Delight: 7/10.** The punchline landed. "11 of 14 airline procedures board within a minute of random order" is on the page, computed, correct, and forwardable, and that was the biggest thing missing last round. The off-scale marker with its value printed, the tie band that shows you the ten rows nobody can separate, the two-point bins panel that no longer invents a data point, the worst-seat pill, the personal best that remembers which strategy earned it: all good, all small, all deliberate. What keeps it off an 8 is that the moment of victory still shows two different totals a second apart, the countdown is still dead air, the wager is still unbuilt, the seed roll still produces `plane-6bvj`, and the best sentence in the project is set in the smallest type on its page.

---

## End condition

This is close. The one blocker is a field name. Of the six majors, two are single strings (**N5-M3** threshold, **N5-M6** rounding plus one row), two are layout passes on code that already exists (**N5-M4** axis floor, **N5-M5** label stacking), one is a filter in the precompute (**N5-M1**), and one is a type-scale decision (**N5-M2**). None requires new machinery or new data.

I do not think this needs another full adversarial round after those are closed. What it needs is a fix round against this list and a short verification pass on the blocker and the six majors specifically — the remaining minors and nits are the accumulated long tail (tap targets, seed names, the compare pool, the heat ramp), and every one of them is a judgement call about polish rather than a defect that misleads a reader. The truth surface is sound once the run count matches the data. Ship after the majors.

REMAINING ABOVE NIT: 17
