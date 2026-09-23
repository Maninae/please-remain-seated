# Round 11 — Targeted verification of the compare-chart axis policy (data-visualization critic)

Reviewer: targeted re-test of the six round-10 items above nit, plus a new-defect sweep on the axis policy itself. Headless Chromium 1.58.2 at 1280x800 and 400x800 (the latter with `hasTouch` + `isMobile`), on the `a320`, `b717`, `b737max8-lcc` and `a321neo-three-class` board compares. Eight preset/width combinations, each a live 100-run compare.
Build: `a09f178`, clean tree. Artifacts: `tests/e2e/artifacts/critic-round-11/`.
`npm test`: **443/443**. `npm run test:e2e`: **70/70**. Both green, one run each.

**Review conditions.** I measured the rendered SVG geometry myself rather than reusing the suite's constants: `chartX0` and `chartX1` come from the axis baseline element in each panel, and floor/cap/px-per-minute are solved from the `(x, data-median-seconds)` pairs the chart now emits. I wrote nothing into `data/`. Port 5197 was already running and is left running; I started no server. For the citation check I pulled the primary source and read its text, rather than trusting the reference list.

---

## Verdict

**The blocker is dead.** Round 10's N10-B1 was a chart drawing medians at values that are not theirs: three a320 rows stacked on one pixel across fourteen minutes of true spread, the slowest row rendering as an empty stub, and nothing anywhere printing the true value. All three are gone, and gone on every preset and width I measured. Across eight preset/width combinations there is **not one on-scale median on the floor line or the cap line**, the rows above the cap now draw as broken bars carrying their real time ("26:23 (off scale)", "40:15 (off scale)", "46:57 (off scale)", "43:31 (off scale)"), every one of those labels sits fully inside the SVG, and both panels share one axis to **0.000%** in pixels-per-minute with floor and cap identical to the second. The phone note collision that made round 10's airline panel read as "axis starts a**302m**off scale" is fixed properly: at 400 px the panel draws no in-SVG notes at all and the two counts move to external captions 619 px apart. The Salari attribution is not merely edited, it is **correct**: the replacement cites Schultz & Soolaki arXiv:2007.16021, and that paper's own text reads "a seat load factor of 85%, a conformance rate of 85%, and an inter-arrival time of 3.7 s (exponential distributed)". Six of six round-10 items above nit are closed.

The policy module is also the right shape. It is pure, it takes the cell rows and returns the axis, and it is tested against the committed cells rather than fixtures, which is what three rounds of ad-hoc tuning were missing.

Two things are wrong with it, and both are about the parts of the chart that are not the median.

**The broken bar lies about where the data is.** `drawOffScaleRow` draws every off-scale row's bar from `chartX0` to `chartX1`, the full plot band, without ever looking at the row's p10. On `a321neo-three-class`, "Front to back" draws a twenty-one-minute bar starting at 14:00 for a strategy whose 10th percentile is **40:12**. Not one seed in that row falls anywhere inside the bar. Four of the six off-scale rows across these presets draw a bar **100% of whose extent contains no data**; the other two are 78% empty. The module docstring says this treatment was "copied from `js/ui/rankings/rankings-chart.js` so the two charts agree", and `rankings-chart.js:703` starts its bar at `projectSeconds(clamp(p10))`. It was not copied. The printed value is honest and the rectangle beside it is not, in the same visual language as the p10-p90 band one row above.

**On a phone the airline panel cannot be read.** `STRIPS_PADDING_LEFT` is a fixed 200 px. At 400 px the SVG is 330 px wide, so the label gutter takes **61% of the frame and the data gets 26%**: an 86 px plot band for fourteen airline rows. Measured live, 18 pairs of a320 medians draw within 2 px of each other while differing by up to 17.7 s; `b737max8-lcc` has 16 such pairs with a worst gap of **24.8 s**. These are not clamped and not dishonest in projection, but a reader cannot tell 28:37 from 29:02 when both ticks land on the same pixel, which is the same thing the round-9 blocker punished at 74 s. It ships green because the round-14 tie and no-edge tests both run only at 1280x900.

---

## Re-verification of the six round-10 items above nit

| id | Round-10 finding | Status | Evidence (my own measurement) |
|---|---|---|---|
| **N10-B1** | Compare chart draws medians at the cap; three a320 rows on one pixel; slowest row empty; nothing prints the true value | **FIXED** | **No median on either edge, 8/8 combos.** Checked `x <= chartX0 + 2 or x >= chartX1 - 2` against the real axis extents: zero violations on a320, b717, b737max8-lcc, a321neo-three-class at 1280 and 400. **The three-way a320 stack is gone**: rotating zones is now on-scale at x=511.5 = 25:39, back-to-front prints "26:23 (off scale)", front-to-back prints "40:15 (off scale)". **Desktop ties: one marginal pair**, b737max8-lcc alaska 28:55 vs american 29:02, dx=1.91 px, ds=6.4 s. Every other preset is clean at 1280. **Values printed in full**: all six off-scale labels carry an `M:SS` clock and sit inside the SVG (worst right edge 626.0 against svgWidth 630; phone 326.0 against 330). Phone resolution is a separate new defect, **R11-M1**. |
| **N10-M1** | Both guards inert: no-edge read `svgs[1]` only; the tie assertion derived seconds from the mark's own x | **FIXED** | The chart now emits `data-median-seconds` and `data-row-id` on every median tick (`charts-strips.js:185-186`), and `fix-round-12.test.js:275-299` compares each tick's x against **that attribute**, not against an interpolation of its own position. The tautology is broken: I re-ran the predicate by hand and it separates a 6.4 s pair from a 0.5 s pair correctly. Both panels are iterated via the `panels` array rather than `svgs[1]`. Two residual gaps, both new: the tests never run at phone width (**R11-M1**) and the helper's padding constant is stale (**R11-m2**). |
| **N10-M2** | On phone the two axis notes overprint, widened 22 px to 68 px by the below-scale count | **FIXED** | At 400 px both panels render **zero** in-SVG italic notes (`omitAxisNotes`), so the collision has no way to occur. The counts move to two external `p.compare-axis-notes` captions, measured at y=827 and y=1446 on a320, **619 px apart**, no overlap on any of the four presets. Desktop keeps the in-SVG notes and they do not touch: a320 textbook left note ends at x=318.9, right note starts at x=470.1, a **151 px** gap. |
| **N10-m1** | Band endpoints clamped silently with no mark | **FIXED for on-scale rows, replaced by a worse defect on off-scale rows** | `charts-strips.js:156-157` now draws a dashed break tick whenever `p10 < floor` or `p90 > cap`, so a clipped band end reads as clipped. That is the fix as asked. But the off-scale rows, which round 10 asked to fold into the same treatment, got a bar with **no honest start at all**. See **R11-M2**. |
| **N10-m2** | `design/02-research.md:15` credits the 3.7 s door-arrival mean to Salari et al. | **FIXED, and verified against the source** | `grep -rn "Salari\|Milne"` over `*.md` and `*.js`, excluding `node_modules` and `design/reviews`, returns **one** line, and it is not Salari. Line 15 now reads "(Schultz & Soolaki, ... arXiv:2007.16021, 2020)". I pulled the paper and read it: section 2.3 states "a seat load factor of 85%, a conformance rate of 85%, and an inter-arrival time of 3.7 s (exponential distributed)". Exact match, including the two other defaults this model uses. |
| **N10-m3** | The 18% carve-out is justified in a test comment by a false physical claim | **FIXED, with new drift in the replacement** | The 18% and 25% thresholds and the "genuinely 255 s wide" claim are gone, replaced by per-preset ratchets. The false physics is not restated anywhere. The new comment has its own derivation drift on two presets: **R11-m3**. |

**Round-10 scoreboard: blocker fixed. Majors: 2 of 2 fixed. Minors: 3 of 3 fixed.** All six closed.

Round-10 nits checked in passing: **N10-n1 fixed** (the policy and the renderer now both use the same interpolating `quantile`, so the floor guarantee is exact rather than accidental). **N10-n3 improved**: the a320 textbook panel drops 33 below and 64 off scale out of 900 dots, against 259 + 37 at round 10, because the three worst rows became off-scale rows instead of dot piles.

---

## The ratchet decision, judged

**Legitimate guard, not a loosened gate.** I tested the lead's premise directly by sweeping every rung of the ladder on every narrowbody preset: with the floor rule fixed, a 25% airline span is **unreachable at any cap on six of the seven presets**, so the old target could only ever have been met by moving a median off its true position, and the structural assertions now carry the truth claim the span number was wrongly being asked to carry (every on-scale median strictly inside the window, the off-scale set derived from the cell threshold, off-scale rows printed and never clamped).

The weakness is that a bound set at "whatever we measured, minus three" blesses the current build by construction, so it catches a collapse back toward round 8's 6.7% but not a slow drift, and on two presets the stated derivation no longer reproduces the committed number (**R11-m3**).

| preset | measured span | ratchet | slack | cap | off-scale rows | 25% reachable at any cap? |
|---|---|---|---|---|---|---|
| a320 | 23.2% | 20.2 | 3.0 | 26m | 3 | yes, at 24m (27.4%) |
| b738-two-class | 22.9% | 19.9 | 3.0 | 29m | 1 | no |
| a321neo-three-class | 22.3% | 19.3 | 3.0 | 35m | 1 | no |
| b717 | 21.0% | 17.7 | 3.3 | 19m | 1 | no |
| crj700 | 18.0% | 15.0 | 3.0 | 9.5m | 1 | no |
| b737max8-lcc | 15.9% | 10.4 | **5.5** | 32m | 1 | no |
| e175 | 13.1% | 10.1 | 3.0 | 11m | 1 | no |

---

## New findings

### MAJOR

**R11-M1. At phone width the label gutter takes 61% of the chart and the airline medians collapse onto shared pixels, up to 24.8 s apart.**

`STRIPS_PADDING_LEFT` is a fixed 200 px with no phone branch. At 400 px the SVG is 330 px wide and the right gutter is 44 px, so the plot band is **86 px**, against 320 px on desktop. Fourteen airline rows whose medians span two to three minutes are projected into it.

Measured live at 400x800, on-scale medians drawn within 2 px of each other while differing by 5 s or more:

| preset | colliding pairs at 400 px | worst pair | colliding pairs at 1280 px |
|---|---|---|---|
| a320 | **18** | alaska 23:19 vs southwest 23:36, dx=1.96 px, ds=17.7 s | 0 |
| b737max8-lcc | **16** | hawaiian 28:37 vs american 29:02, dx=1.98 px, ds=**24.8 s** | 1 |
| a321neo-three-class | **10** | lufthansa 31:15 vs air-canada 31:39, dx=1.66 px, ds=24.2 s | 0 |
| b717 | **8** | ryanair 17:35 vs southwest 17:45, dx=1.94 px, ds=10.8 s | 0 |

The widest row label in any of these panels measures **170 px**, so the 200 px gutter is not even tight; it is 30 px larger than the longest thing it holds, while the data it exists to label gets a quarter of the frame. `strips-a320-400.png` shows the result: fourteen dot blobs in a narrow column with the median ticks indistinguishable inside them.

This ships green because **the two tests that guard median placement run only at 1280x900**. `runCompareAndMeasure` defaults to `{ width: 1280, height: 900 }` and the no-edge test (`fix-round-12.test.js:258`) and the tie test (`:275`) both take the default. Only the clipping test (`:326`) iterates 400 px, and it checks label bboxes, not median separation.

**Fix:** (1) branch `STRIPS_PADDING_LEFT` on the phone threshold the module already has (`STRIPS_PHONE_WIDTH_THRESHOLD`), to roughly 110 px, which more than doubles the plot band to 176 px and clears every pair above 10 s on all four presets; or put the row label on its own line above each row at phone width and give the band the full width. (2) Run the tie and no-edge tests at 400 px as well as 1280, so the invariant is asserted where it actually fails.

**R11-M2. Every off-scale broken bar is drawn from the floor to the cap regardless of the row's p10, so its extent is fabricated; four of six contain no data at all.**

`charts-strips.js:227-228` sets `bandStartX = chartX0` and `bandEndX = chartX1` unconditionally. The row's p10 is computed six lines earlier and never consulted. `rankings-chart.js:703`, the treatment the docstring says this was copied from, sets `bandLow = max(paddedMin, min(p10, paddedMax))` and starts the bar there.

| preset | row | true p10 | drawn bar | where rankings-chart would start it | share of drawn bar with no data |
|---|---|---|---|---|---|
| a321neo-three-class | front-to-back | 40:12 | 14:00 to 35:00 | 35:00 (a stub) | **100%** |
| b737max8-lcc | front-to-back | 41:48 | 14:00 to 32:00 | 32:00 (a stub) | **100%** |
| b717 | front-to-back | 27:47 | 10:00 to 19:00 | 19:00 (a stub) | **100%** |
| a320 | front-to-back | 36:16 | 13:00 to 26:00 | 26:00 (a stub) | **100%** |
| a320 | back-to-front | 23:11 | 13:00 to 26:00 | 23:11 | 78% |
| a320 | rotating-zone | 23:09 | 13:00 to 26:00 | 23:09 | 78% |

The table is computed from the committed 10,000-seed cells, because the chart does not emit p10 for an off-scale row. A live 100-run compare moves the medians a little, which can shift the cap one rung and move a row in or out of the off-scale set: b717 renders a 18:00 cap and two off-scale rows live against 19:00 and one from the cell. The defect is invariant to that, because the bar starts at the floor whatever the cap and whatever the row.

The consequence is visible without measurement. In `strips-a321neo-three-class-1280.png`, "Front to back" is a twenty-one-minute bar beginning at 14:00 for a strategy whose fastest tenth of runs took 40:12. It sits directly below "Rotating zones", whose bar of the same height and nearly the same shade **is** a p10-p90 band. Two adjacent rectangles in one chart, one encoding spread and one encoding nothing, with no formatting difference to separate them. Readers treat every formatting difference as meaningful and every sameness as sameness, so this one reads as "front to back has enormous spread starting at 14 minutes".

It also makes the off-scale rows indistinguishable from each other: a320's back-to-front (26:23, 23 s past the cap) and front-to-back (40:15, fourteen minutes past it) draw **identical** bars. Round 10 killed a fabricated tie between median ticks; this is the same fabricated tie moved into the band.

**Fix:** use the same `bandLow` as `rankings-chart.js:703` and start the bar at `projectSeconds(max(floor, min(p10, cap)))`. A row entirely beyond the cap then correctly draws as a short stub against the right edge with its value printed, which is both honest and a stronger signal than a full-width rail.

### MINOR

**R11-m1. The unit resolution test asserts at a 720 px band, which no rendered width produces.** `compare-axis-policy.test.js:58` sets `BAND_PX = 720`; the real plot band is **320 px** at 1280 and **86 px** at 400. I ran the test's own predicate at all three widths against the committed cells:

| band | total colliding pairs across the 7 narrowbody presets | worst |
|---|---|---|
| 720 px (asserted) | **0** | none |
| 320 px (real desktop) | **5** | 7 s, a321neo-three-class delta vs british-airways |
| 86 px (real phone) | **85** | 28 s, a321neo-three-class united vs lufthansa |

The test proves a resolution guarantee at a band 2.25x wider than the widest the chart ever draws. This is the third round running where a guard is calibrated against something other than what ships: round 09's span denominator, round 10's two inert assertions, now this constant. **Fix:** parameterize the test over the real bands (320 and 86, or better, derive them from `STRIPS_PADDING_LEFT` and the two right-gutter constants) instead of a round number.

**R11-m2. The e2e helper's `STRIPS_PADDING_RIGHT = 24` no longer matches the renderer, so the no-edge test's right bound is 86 px too permissive.** `fix-round-12.test.js:204` hardcodes 24, but `charts-strips.js:41-42` uses **110** on desktop and **44** on phone whenever any row is off scale, which is every preset I measured. The test therefore computes `chartX1 = 606` where the real edge is **520**, and asserts medians sit below 604. It passes, but only because the policy makes on-scale medians structurally interior; the assertion never touches the real right edge. `plotBandPx` is computed from the same wrong constant and is off by 27%, so any future span measurement built on it starts wrong. **Fix:** read the axis extents from the DOM, the way the chart draws them, rather than re-deriving from copied constants.

**R11-m3. Two of the seven span ratchets do not match the derivation their own comment states.** The comment at `compare-axis-policy.test.js:153-159` says each bound is "its own measured span minus three points at round-14, floored at 10". That reproduces five of seven exactly (a320 23.2 to 20.2, b738-two-class 22.9 to 19.9, a321neo-three-class 22.3 to 19.3, crj700 18.0 to 15.0, e175 13.1 to 10.1). It fails on **b717** (measured 21.0, bound 17.7, rule gives 18.0) and **b737max8-lcc** (measured 15.9, bound 10.4, rule gives 12.9, so the bound carries 5.5 points of slack where every other preset carries 3.0). Those two are exactly the presets where `capStepInfo.raisedForOffScaleCap` is true, so the lead's three-row follow-up moved their caps after the ratchets were written and nobody re-derived them. This is the same shape as round 10's N10-m3: a test comment stating a rule the numbers no longer follow is how the next round gets talked into a lower bound. **Fix:** recompute both from the current spans, or state the real rule.

### NIT

**R11-n1.** The dagger has no key. At phone width an off-scale row prints "40:15†" and nothing on the page says what the dagger means; desktop spells out "(off scale)". The nearby caption says "64 off scale", but that is a **dot** count for a different set of rows, so the obvious bridge is also the wrong one. `rankings-chart.js:727` has the same gap.

**R11-n2.** a320 is the one preset that could reach the old 25% target honestly: cap 24m gives a 27.4% airline span with the same three off-scale rows. Not worth taking, because at that cap "Random order" (23:44) lands 3 s from the off-scale threshold and would flip in and out between runs. Worth a line in the policy docstring so the next reader does not rediscover it.

**R11-n3.** The policy's `stopReason` is recorded as `reachedSpan` when the step-down never ran because the initial cap already cleared the threshold, and also when it ran and succeeded. Only `capStepInfo.stepped` separates them. Harmless today; the test log prints `stopReason` as if it were diagnostic.

**R11-n4.** Carried from round 10, outside this fix set and unchecked: "Source or assumption" holds seven different first words, `demonstration` keeps a dotted underline on a non-interactive row, the door-status slot is empty and hidden, `m` and `t` do nothing, the loser's time prints five times at the finish, hand-edited `?load=0.93` leaves the thumb at 0.95.

---

## Test counts

| suite | tests | pass | fail | duration |
|---|---|---|---|---|
| `npm test` | 443 | **443** | 0 | 32.6 s |
| `npm run test:e2e` | 70 | **70** | 0 | 371.6 s |

Both match the fixer's claim. 68 unit suites. The e2e count is up from 67 at round 10; the three added tests are the round-14 no-edge, tie, and off-scale-clipping checks, and all three test a property that was genuinely broken and is now genuinely fixed, which is the first time in four rounds that is true of the new tests. Their remaining weakness is coverage, not construction: they run at one viewport (**R11-M1**) off one stale constant (**R11-m2**).

---

## Scores

**Truth: 9/10.** Up one. The standing blocker is closed rather than half-closed: across eight preset/width combinations no median is drawn at a value that is not its own, no median sits on the floor or the cap, and every row past the cap prints its real time inside the frame. The citation fix is the good kind, not an edit but a verification, and the replacement is confirmed word-for-word in the primary source's own text. Against that, two truth defects remain and both are about the marks around the median rather than the median: an off-scale bar whose extent is fabricated, four of six containing no data anywhere, and a phone panel where honest values land on pixels a reader cannot separate. Neither puts a wrong number on screen, which is why this is a step up and not a full one.

**Clarity: 8/10.** Held, with the two halves moving hard in opposite directions. Desktop is the best this chart has been: distinct medians on every preset, the three-way a320 stack gone, off-scale rows carrying their value in the gutter instead of collapsing into a 1 px stub, the floor note honest on both sides, and both panels provably on one scale. Phone went from unreadable-by-collision to unreadable-by-compression: the overprinted notes are properly fixed, and underneath them sits a chart giving 61% of its width to labels and 26% to data, with fourteen airline rows in 86 px. Fixing the second is a smaller job than fixing the first was.

**Delight: 7/10.** Held, and for the ninth round running nothing new was built. The one gain is a real if small courtesy: a reader who wants to know how slow "Front to back" actually is can now read 40:15 off the chart instead of being told 259 dots are off scale. The delight ledger is otherwise where round 05 left it, and the wager before the door opens is still unbuilt.

---

## End condition

**Not met, but close, and the remaining work is smaller than any round before it.** Every round-10 item above nit is closed, including the blocker that had stood for three rounds. What stands is two majors and three minors, none of which requires a new idea:

- Start the off-scale bar at the row's p10, which is one expression already written correctly sixty lines away in `rankings-chart.js`.
- Branch the label gutter at phone width, using the threshold constant the module already defines.
- Run the two median tests at 400 px as well as 1280, and read the axis extents from the DOM instead of two copied padding constants, one of which is already stale.
- Recompute the two ratchets that no longer match their own comment.

One process note, and it is the same one for the fourth round running, though for the first time it is a coverage gap rather than a tautology. The round-14 tests are correctly constructed: they read ground truth out of the DOM and compare the drawn position against the data, which is exactly what round 10 demanded. They still certified a build whose phone rendering violates the property they assert, because they run at one viewport and derive the plot band from a constant the renderer stopped using in the same commit. A test that measures the right thing at the wrong width is the next version of the same failure, and the defence is the same: the test's geometry must come from the chart, not from a copy of the chart's constants.

REMAINING ABOVE NIT: 5
