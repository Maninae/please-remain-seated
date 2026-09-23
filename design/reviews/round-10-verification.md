# Round 10 — Final targeted verification (data-visualization critic)

Reviewer: targeted re-test of the five round-09 items above nit, plus a new-defect sweep on each fix. Headless Chromium 1.58.2 at 1280x800, 1280x900, 1440x900, 1512x982 and 400x800 (the last with `hasTouch` + `isMobile`), plus eleven viewports for the fold check.
Build: `index.html` at `e71ac58`, clean tree. Artifacts: `tests/e2e/artifacts/critic-round-10/`.
`npm run test:e2e`, two consecutive runs: **67/67, 67/67**. No failures, no flake.

**Review conditions.** The precompute is complete and committed; I read the 10,000-seed and 2,000-seed cells directly for every true-median cross-reference rather than trusting the chart. I wrote nothing into `data/`. I stood up one extra server on port 5198 serving `git archive c479db7` (the build the round-09 review measured) so the phone-label and cap-clamping claims below rest on a measured before/after; that server is stopped. 5197 was already running and is left running.

---

## Verdict

Four of the five round-09 items are genuinely closed, and two of them are the best work in this project's fix history. The controls fix is complete and then some: I measured eleven viewports from 1280x720 to 1920x1080 and **all eleven put Restart, speed and the seed row fully inside the fold**, including the two the round-09 table flagged and the awkward 1011 px boundary where the compaction media query hands back off. The truth note is the rarest kind of fix, a site publishing the number that embarrasses its own citation: the assumptions table, the glossary, the README and `design/02-research.md` all now carry the paper's ">40%" next to this model's own figure, and the About Limits bullet **computes it live** from the A320 deplane headline cell and renders "about 3.9%", which matches the committed cell's 3.94% to the decimal. The span test's denominator is fixed properly, from `STRIPS_PADDING_LEFT` to `width - STRIPS_PADDING_RIGHT` rather than from tick text, and the airline panel measures **31.0%** of the plot band on a320 against the 24.6% round 09 recorded.

The floor half of the round-09 blocker is dead, and dead everywhere. I recomputed the axis rule against the committed medians for all thirteen board presets: **0 of 299 medians now fall below the floor, against 20 before.** The new left-edge mark works and reads correctly on desktop ("37 below · axis starts at 13m"). Dots outside the window are now dropped rather than piled on the edge, which is the honest choice.

Then the other half of the same axis. Round 09's blocker had two demands, and the second one was "never clamp a **median**: if a row's median falls outside the window, draw it in the gutter with a break mark and print its true time, the way `rankings-chart.js` already does." That was not done, and moving the cap from p85 to p75 made the unfixed half worse. On the default A320 board compare, **three textbook medians are drawn at the identical pixel x=606.0**: Rotating zones (true median 26:02), Back to front in zones (26:05) and Front to back (40:06). Fourteen minutes of true spread collapse onto one mark, under a chart whose own caveat elsewhere on the page names "Back to front, in zones" and quotes its rate. Round 09 called a **74-second** fabricated tie a blocker; this build's worst is **16:45** on a321neo. Across the thirteen presets the count of medians drawn at a value that is not theirs falls from 34 to 19 (the floor fix more than pays for the cap regression in raw count), but the presets carrying a multi-row fabricated tie go from **1 to 3**, and every single preset still has at least one clamped median.

The reason this shipped green is the two new guards. Neither can fail. The no-edge assertion reads `svgs[1]` and only ever checks the airline panel; I applied **the test's own assertion** to the textbook panel and it fails on all three presets. The tie assertion derives each median's seconds from its own x position, so `dx < 2 px` mechanically implies `ds < 3.55 s` against a 5 s tolerance at a320's 33.8 px/min. It is a tautology. It ran on a320, looked directly at three medians sharing one pixel across a 14-minute spread, and reported pass. That is round 09's process note landing for the third round running: the test asserts the property that was broken, not the property that had to stay true.

---

## Re-verification of the five round-09 items above nit

| id | Round-09 finding | Status | Evidence |
|---|---|---|---|
| **N9-B1** | Compare chart draws medians at a time neither strategy ran, as a tie, with no mark | **PARTIALLY FIXED** (floor closed, cap regressed) | **Floor: fixed everywhere.** Recomputed the shipped axis rule against the committed medians for all 13 board presets: **0 medians below the floor, was 20**. `floorSourceValues = [min(minMedian, p10OfMedians)]` then a breather of `max(15, (cap-min)*0.05)` and a floor-snap, so the smallest median is strictly inside by construction. Live a320: floor 13:00, Reverse pyramid drawn at x=222.8 = **13:40**, and the title's "Reverse pyramid still wins on paper at 13:40" now matches its own mark. The left-edge count is live and correct ("37 below · axis starts at 13m"). Dots outside the window are dropped, not piled. **Cap: not fixed, and worse than round 09.** 19 medians clamped at the cap across 13 presets, was 14. See **N10-B1**. |
| **N9-M1** | Span test divides by the first-to-last tick distance, passing below its own stated threshold | **FIXED as to the denominator; the two new guards are inert** | `fix-round-12.test.js:225` now computes `plotBandPx = svgWidth - padR - padL` from the axis geometry. Measured live: a320 airline span **125.7 / 406 px = 31.0%** (round 09 measured 24.6% on the old build); b738-two-class **101.1 / 406 px = 24.9%**. A second preset was added as asked. But the two assertions bolted on to guard N9-B1 cannot fail: see **N10-M1**. |
| **N9-m1** | Race controls clipped below the fold at 1440x900, 1512x982, 1600x900 | **FIXED, and beyond the four viewports claimed** | Media-query ceiling raised to `max-height: 1010px` and the canvas height derived from viewport height (`clamp(130px, (100vh - 620px)/2, 190px)`). Measured cold-load bottom edge of Restart / speed / `#race-controls` at eleven viewports: 1280x720 **inside** (38 px spare), 1280x800 **inside** (52), 1366x768 **inside** (20), 1280x860 **inside** (112), 1440x900 **inside** (132), 1600x900 **inside** (132), 1512x982 **inside** (132), 1280x1000 **inside** (132), 1440x1010 **inside** (142), 1440x1011 **inside** (7), 1920x1080 **inside** (76). **11/11.** The handoff at 1011 px, where the compaction rule stops applying and the canvas jumps 190 → 213 px, still clears the fold; it is the tightest point in the range (see **N10-n4**). |
| **N9-m2** | The page cites ">40% reduction" and its own sim delivers ~4%, and never says so | **FIXED in all four places, and computed live** | `js/ui/about.js:92` assumptions row now carries the paper's figure and "This model finds ~4% at default settings on the A320 deplane headline cell" with the one-clause reason. `buildLimitsSection` adds `[data-about-aisle-first]`, and `refreshAisleFirstBullet` recomputes it from the loaded cell: rendered live it reads "**about 3.9%** (aisle-first 6:09 vs free-for-all 6:24)". Against the committed 10,000-seed cell: free-for-all 384.1 s, aisle-first 369.0 s, **3.94%**. Matches. Same fact in `js/ui/glossary.js` (`aisle-first`), `README.md:69` and `design/02-research.md:32`. Screenshot `about-aisle-first-bullet.png`. |
| **N9-m3** | `design/02-research.md:15` credits the 3.7 s door-arrival mean to the wrong authors | **NOT FIXED** | Line 15 still reads "(Salari et al. 2020, Schultz baseline)". Round 07 traced that attribution to arXiv:2007.16021, Schultz & Soolaki. Untouched by `e71ac58`. Carried as **N10-m2**. |

**Round-09 scoreboard: blocker partially fixed (one half closed, the other regressed). Majors: 1 fixed as to the defect named, with two inert new guards. Minors: 2 fixed, 1 untouched.**

Round-09 nits, checked because they were in the fix set: **N9-n1 fixed** ("base" → "back" on `02-research.md:32`). **N9-n2 fixed**: the ladder gained 4, 6, 7, 9, so the E175 deplane cap drops 8:00 → 7:00 and dead frame falls to **2.9%**. **N9-n3 fixed**: `finish-card.js` strips the seven `r*` keys before copying the share link. **N9-n7** is superseded by **N10-B1**.

---

## Threshold verdict: is 18% on b738-two-class honest?

**No. The physical argument is wrong, and the no-edge assertion does not make the threshold moot.** Three separate numbers say so.

**1. The measured span is 24.9%, not the 22.4% the fix claims.** Live at 1280x900, 100 runs: easyJet's median at x=472.1, British Airways' at x=573.2, so the airline span is 101.1 px against a 406 px plot band = **24.90%**. The gate sits **6.9 points below** what the chart actually achieves, so a regression could compress the band by 28% relative and still pass. The fixer's own claimed figure understates their own build.

**2. "Cannot reach 25% with every median on scale" is false; the cause is the tick ladder, not the cabin.** The b738-two-class airline cluster is 269 s wide and the plot band is 18 minutes (12:00 to 30:00), which is where 24.9% comes from. But the band is 18 minutes only because `niceCeiling` snaps the cap to 30:00, and it does that by a hair:

| step | value |
|---|---|
| p75 of the 23 medians | 27:41 |
| after the 2% breathing pad | 28.24 min |
| next rung on `NICE_MINUTE_STEPS` (…22, 25, 28, 30, 35…) | **30** |

28.24 clears the 28 rung by fourteen hundredths of a minute and lands on 30, spending **two extra minutes of band** (11% of it) on empty frame. The same span against a 28:00 cap is **28.0%**; against 29:00 it is **26.4%**. Both clear 25% with every median still on scale. This fix round densified the ladder at the low end for exactly this reason (adding 4, 6, 7, 9 so E175 would stop jumping 6.5 → 8), and left the 25 / 28 / 30 gap at the high end alone, then wrote a physical justification for the shortfall it caused. **Adding 26, 27, 29 to the ladder retires the carve-out.**

**3. The no-edge assertion cannot substitute for a span threshold, and in this suite it does not even look at the right panel.** The two guard different properties: "no median on the edge" bounds *truncation*, a span threshold bounds *compression*. A band squeezed to 5% can have every median strictly interior. And as written the assertion reads `svgs[1]` only, so it never sees the panel where the clamping actually happens (**N10-M1**).

**Verdict: a loosened gate resting on a false premise.** Not hiding a compressed band today (24.9% is a real, legible span), but the recorded rationale will mislead the next fixer into accepting a lower number as physics. Raise the threshold to 24% and fix the ladder, or fix the ladder and raise it to 25% on both presets.

---

## New findings

### BLOCKER

**N10-B1. The compare chart still draws medians at values that are not theirs, now at the cap, and the p75 change tripled the fabricated ties on the default board.**

`charts-strips.js:151` projects the median through `projectSeconds`, which clamps with `Math.min(1, Math.max(0, …))`. The floor side is now unreachable by construction, but nothing stops the cap side, and `computeSharedStripsAxis` sets the cap to the **p75 of the medians**, which guarantees roughly a quarter of the rows sit above it.

Live, A320 board, 100 runs, 1280x900. Floor 13:00, cap 25:00, plot band x=200 to x=606.

| row | median drawn at | true median (10,000-seed cell) | dots drawn | band |
|---|---|---|---|---|
| Rotating zones | x=606.0 = **25:00** | **26:02** | partial | ends clamped at 606.0 |
| Back to front, in zones | x=606.0 = **25:00** | **26:05** | partial | ends clamped at 606.0 |
| Front to back | x=606.0 = **25:00** | **40:06** | **zero** | 606.0..607.0, a 1 px stub |

Three failures, the same three round 09 named:

- **Three medians, one pixel, fourteen minutes apart.** Round 09 called a 74 s fabricated tie a blocker. This is **14:03** on the default preset, **16:45** on a321neo (Back to front 29:31, Rotating zones 30:30, Front to back 46:16) and **10:11** on b777 (Rotating zones 28:34, Pick any seat 29:32, Front to back 38:45).
- **The slowest row renders as an empty row.** Front to back has every one of its 100 dots past the cap, so after the drop-don't-clamp change it draws as a bare tick plus a 1 px band stub and **no data at all**. A reader sees a strategy that appears to have no spread and to tie with Rotating zones. Its true median is 40:06. Visible in `compare-a320-1280-strips.png`.
- **Nothing prints the true value.** "259 off scale" at the right edge counts dots, not rows, and names neither the rows nor their times.

Not preset-specific, and not a tail case. Recomputing the shipped rule against the committed medians for every board preset:

| | round-09 build `c479db7` | this build `e71ac58` |
|---|---|---|
| medians clamped at the cap | 14 | **19** |
| medians clamped at the floor | 20 | **0** |
| total medians drawn at a value that is not theirs | 34 | **19** |
| presets with >1 median stacked on one pixel | 1 | **3** |
| worst fabricated tie | 74 s | **16:45** |
| presets with at least one clamped median | 13 of 13 | **13 of 13** |

The raw count improved, which is real and worth saying. The failure mode round 09 called a blocker, a chart manufacturing a tie between strategies its own data separates, got three times as common and thirteen times as wide.

**Fix:** copy the treatment `rankings-chart.js` already implements on the same page. `rankings-chart.js:702` draws a row whose median exceeds the cap as a **broken bar in the right gutter with its true value printed** (`:727` even shortens "(off scale)" to a dagger on phone). The strip chart should do the same on both edges: never move a median; when it falls outside the window, draw it in the gutter with a break mark and print `formatClock(median)` beside it. Keep the dot-count marks as they are.

Evidence: `compare-a320-1280-strips.png`, `compare-b738-two-class-1280-strips.png`, `compare-a320-1280-full.png`.

### MAJOR

**N10-M1. Both assertions added to certify N9-B1 are incapable of failing, and one of them is currently looking straight at the defect.**

*(a) The no-edge assertion never sees the panel that clamps.* `measureAirlinePanel` (`fix-round-12.test.js:221`) takes `const airlineSvg = svgs[1]` and returns only its `medianXs`. Both callers then loop `for (const mx of m.medianXs)`, so the textbook panel is never tested. I applied **the test's own predicate** (`mx > chartX0 + 2 && mx < chartX1 - 2`) to `svgs[0]`:

| preset | panel 0 (textbook, untested) | panel 1 (airline, the only one tested) |
|---|---|---|
| a320 | **FAIL, 3**: Rotating zones, Back to front in zones, Front to back, all at x=606 | pass |
| a321neo | **FAIL, 3**: Back to front in zones, Rotating zones, Front to back, all at x=606 | pass |
| b777 | **FAIL, 3**: Rotating zones, Pick any seat, Front to back, all at x=606 | pass |

*(b) The tie assertion is a tautology.* `fix-round-12.test.js:292-358` recovers each median's seconds by interpolating **from that median's own x** between the first and last labelled tick, then asserts that two medians within 2 px differ by less than 5 s. Since the value is derived from the position, `dx < 2` forces `ds = dx * 60 / pxPerMin`. On a320, `pxPerMin = 33.83`, so `ds < 3.55 s` always, against a 5 s tolerance. The assertion can never fire. It ran on a320, saw three median ticks at `dx = 0.00 px` whose true medians span 26:02 to 40:06, and passed.

This is the mechanism that let the blocker ship green twice. **Fix:** (1) measure both panels, not `svgs[1]`; (2) compare each median tick's x against the **row's own median computed from the series data**, not against its own pixel position, which means the chart has to expose the value (a `data-median-seconds` attribute on the tick, or a `<title>`) so the test can read ground truth instead of re-deriving it from the mark it is meant to audit.

**N10-M2. On phone the two axis notes print on top of each other, and this fix widened the collision 3.1x.**

400x800, A320 board compare. `STRIPS_PADDING_LEFT` is a fixed 200 px against a 330 px SVG, so the plot band is only 106 px and the two italic 10 px notes, one anchored `start` at x=200 and one anchored `end` at x=306, cannot both fit. Measured `getBBox()` overlap, A/B against `c479db7` on port 5198:

| panel | before (`c479db7`) | after (`e71ac58`) |
|---|---|---|
| textbook | "axis starts at 16m" + "156 off scale", overlap **22.0 px** | "**28 below · axis starts at 13m**" + "275 off scale", overlap **67.6 px** |
| airline | "axis starts at 16m" + "48 off scale", overlap **19.0 px** | "axis starts at 13m" + "302 off scale", overlap **24.4 px** |

The collision pre-existed; lengthening the left label from 75.0 px to 119.1 px to carry the below-scale count widened the textbook panel's from 22 to 68 px. The result is unreadable: `phone-axis-notes-crop.png` shows the airline panel rendering as "axis starts a**302m**off scale". Both labels are data-bearing, one is the count this fix round added, and neither survives. Same severity bar as N8-M3, the anchor-label collision.

**Fix:** on narrow SVGs put the two notes on their own line above the ticks (the chart already reserves `floorNoteHeight` for exactly this), or drop the left note to a second row when `chartX1 - chartX0 < 200`. Shortening the count to "28 below" without the axis clause would also clear it.

### MINOR

**N10-m1. Band endpoints are clamped silently, the same defect as the median with no mark at all.** `bandStartX` / `bandEndX` run through the same clamping `projectSeconds`. On the a320 airline panel, **11 of 14 rows** draw their p10-p90 band ending at exactly x=606.0 (Frontier, Ryanair, American, Delta, Southwest, easyJet, Hawaiian, Alaska, British Airways, Air Canada, JetBlue); only Lufthansa, ANA and United end inside. The band is the chart's spread encoding, and eleven identical right edges are an artifact, not a finding. On the textbook panel, Reverse pyramid's band starts at exactly x=200.0, its p10 clamped to the floor. Fold this into the N10-B1 gutter treatment: a clamped band endpoint gets the break mark too.

**N10-m2. `design/02-research.md:15` still credits an engine constant to the wrong authors.** [N9-m3 carried, untouched] The 3.7 s exponential door-arrival mean reads "(Salari et al. 2020, Schultz baseline)"; round 07 traced it to Schultz & Soolaki, arXiv:2007.16021. `CLAUDE.md` makes this file the record for every engine number, so a wrong author here is the one place it matters.

**N10-m3. The 18% carve-out is justified in a test comment by a physical claim that is false.** `fix-round-12.test.js:271-273` records "its airline cluster is genuinely 255 s wide … so the honest achievable span at defaults is ~22% rather than 25%". The cluster is 269 s, the measured span is 24.9%, and the shortfall is the `niceCeiling` 2% pad clearing the ladder's 28 rung and snapping to 30. See the threshold section. A false rationale in a test comment is how the next round gets talked into a lower bound.

### NIT

**N10-n1.** The floor guarantee rests on two different definitions of "median". `computeSharedStripsAxis` takes `rowValues[Math.floor(n/2)]`; `renderStrips` draws `quantile(sorted, 0.5)`, which interpolates. For even `n` the drawn median is the lower of the two, so it can sit slightly below the value the floor was derived from. The `max(15, …)` breather and the floor-snap cover the gap comfortably (measured 0 violations across 13 presets), but the invariant is accidental rather than proven. One line using the same quantile in both places would make it exact.

**N10-n2.** "~4%" is hardcoded in the assumptions row, the glossary, the README and `02-research.md`, while the Limits bullet computes "3.9%" live. They agree today; a precompute rerun moves one and not the other four.

**N10-n3.** On the a320 textbook panel, 259 of 900 dots are off scale and 37 below, so the chart drops **33% of the marks it was asked to draw** on that panel. Honest per dot, but it is worth a look at whether the p75 cap is the right trade once the gutter treatment exists.

**N10-n4.** The fold has 7 px of spare at 1440x1011, the point where the compaction media query hands back and the canvas jumps 190 → 213 px. Clears at every height I measured, but it is the tightest seam in the range.

**N10-n5.** Carried from round 09, outside this fix set and unchecked: "Source or assumption" holds seven different first words [N9-n4], `demonstration` keeps a dotted underline on a non-interactive row [N9-n5], door-status slot empty and hidden, `m` and `t` do nothing, the loser's time prints five times at the finish, six phone row labels ellipsize into `<title>` tooltips, hand-edited `?load=0.93` leaves the thumb at 0.95 [N9-n6].

---

## `npm run test:e2e`

| run | tests | pass | fail | duration |
|---|---|---|---|---|
| 1 | 67 | **67** | 0 | 160.8 s |
| 2 | 67 | **67** | 0 | 156.7 s |

67 tests, up from 64; `fix-round-12.test.js` gained three (the b738-two-class span, the tie check, and the widened fold check). No failing test in either run and no flake, including the round-08 drawer test that was this suite's flaky one.

The suite's authority is the problem, not its stability. Three tests carry N9-B1 or N9-M1 in their names and all three pass on builds that exhibit the defect:

| test | passes | what it does not catch |
|---|---|---|
| `N8-M2 / N9-M1: airline medians span >= 25% … a320` | yes | textbook panel medians at x=606 |
| `N9-M1: airline medians span >= 18% … b738-two-class` | yes | same, plus an 18% bound against a 24.9% reality |
| `N9-B1: compare medians never share an x within 2 px unless within 5 s` | yes | three medians at `dx = 0.00 px` spanning 26:02 to 40:06, on the preset it runs |

---

## Scores

**Truth: 8/10.** Held, and the composition moved in both directions. The gain is real and unusual: the site now prints the number that undercuts its own citation, in four places, with the figure recomputed live from the committed cell rather than typed in, and it matches to the decimal. The floor half of the standing blocker is closed everywhere, verified against all thirteen presets rather than the one the report named, and the chart's title finally agrees with the mark beneath it. Against that, the flagship chart still draws nineteen medians at values that are not theirs, on every preset, and the specific failure round 09 called a blocker, a chart inventing a tie between strategies its own data separates, went from one preset to three and from 74 seconds to sixteen minutes of collapsed spread. Total misplaced marks fell from 34 to 19, which is why this is not a downgrade; the worst case got much worse, which is why it is not an upgrade. The Salari attribution is still wrong.

**Clarity: 8/10.** Held. Real gains: the airline panel reads at 31% of the band on a320, the best it has been; the below-scale count closes the one-sided truncation that made the left edge mute; dropping out-of-window dots instead of piling them removes a fabricated cluster; the controls sit inside the fold at all eleven viewports I measured, which is three more than the fix claimed; the E175 cap ladder trims dead frame to 2.9%. Against that, two losses of the same size: on the default A320 the slowest strategy in the model renders as an empty row with no dots and no value, and on phone the two axis notes overprint into literal nonsense, a collision this fix widened from 22 px to 68 px on the panel that carries the new count.

**Delight: 7/10.** Held, and for the eighth round running nothing new was built. The share link is half as long now that the seven `r*` keys are stripped, which is a genuine if small courtesy to the person pasting it. Everything else on the delight ledger is where round 05 left it: the countdown is still dead air over an empty door-status slot, the margin still prints five times at the finish, `m` and `t` still do nothing, and the wager before the door opens is still unbuilt. Eight rounds of load-bearing utility and no play.

---

## End condition

**Not met.** One blocker, two majors and three minors stand.

The distance is short and the code to copy is already in the repo. `rankings-chart.js` solved this exact problem at `:702` and `:727`, round 09 pointed at it by name, and the strip chart still does not do it. Everything else above nit is small: scope one test to both panels, stop deriving a mark's value from the mark's own position, move two phone labels onto their own line, fix one author name, and either densify the tick ladder between 25 and 30 or stop justifying an 18% bound with physics that is not physics.

One process note, and it is the same one for the third round running. Round 09 wrote: "None asserts the property that had to stay **true** while the fix landed." This round the fixer added two assertions explicitly aimed at that gap, and both are inert, one because it measures the wrong panel and one because it audits a mark against itself. The generic defence has not changed: a layout test must compare the drawn position against the **data**, not against another property of the drawing. Until a median tick carries its own value into the DOM, no test in this suite can tell a correct chart from a clamped one.

REMAINING ABOVE NIT: 6
