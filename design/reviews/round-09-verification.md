# Round 09 — Targeted verification (data-visualization critic)

Reviewer: targeted re-test, not a full adversarial round. Headless Chromium 1.58.2 at 1024x768, 1280x800, 1280x720, 1440x900, 1512x982, 1600x900 and 400x800 (the last with `hasTouch`).
Build: `index.html` at `c479db7`, clean tree. Artifacts: `tests/e2e/artifacts/critic-round-09/`.
`npm run test:e2e`, two consecutive runs: **64/64, 64/64**. No failures, no flake.

**Review conditions.** The precompute is finished and committed. `data/rankings/index.json` advertises **62 cells, 0 absent, no `pending` key**, engine `04a98e5`. I swept all 13 presets in both modes (26 Rankings views) and logged **zero HTTP 4xx and zero console or page errors**. The round-8 404 storm is gone. I wrote nothing into `data/`. I stood up one extra server on port 5198 serving `git archive 643eca3` (the commit before the fixes) so two claims below rest on a measured before/after rather than on memory; that server is stopped. 5197 was already running and is left running.

---

## Verdict

The blocker is dead, all four majors are addressed, and eleven of the twelve minors closed. That is the best fix round this project has had, and the two hardest ones are properly dead rather than papered over. The caveat now names the row it quotes: on the default A320 it reads "**Back to front, in zones** runs slower here… about **5.9** pax/min" and the row labelled "Back to front, in zones" on the chart above reads **26:05**, which is 153 / 26.08 = 5.87. The row labelled "Front to back" is a separate row at 40:06, correctly not named. I checked the named string against the **drawn row label** on all thirteen board presets, not against the cell id, and it matches every time. The About tab now computes its number from the same cell and prints 5.9 with the cabin named, so the two tabs agree instead of differing by a factor of 1.5. The MythBusters clause is withheld on all six presets where the anchor is withheld. The three anchor labels sit on three clean rows with **zero pairwise overlap across 28 preset-width pairs** and nothing clipped at the top. A full Rankings sweep (preset, mode and all five knobs) leaves **all fifteen Race URL parameters byte-identical**, and the race still runs, finishes and produces a share link that round-trips.

Then the compare axis. The p85 cap did what it was asked to do: the airline panel went from **6.7% of the plot band to 24.6%**, a 4.2x gain I confirmed by A/B against the pre-fix build, and the off-scale branch that was dead code last round now fires and prints "143 off scale". But the same change also raised the axis **floor** to the p10 of the medians, and nothing marks what falls below a floor. On the default A320 board compare, **192 of 900 dots and two median ticks are clamped onto the left edge with no mark and no count**. The two clamped medians are "Reverse pyramid" and "Steffen method" — the two fastest strategies in the panel, and the ones the chart's own title names: "Reverse pyramid still wins on paper at **13:45**", printed directly above a median tick drawn at the **16m** position. On screen they are two identical black slabs pinned to the axis start, so the chart shows a tie between two strategies the committed cell puts 74 seconds apart, and puts both at a time neither of them ran. `computeSharedStripsAxis`'s docstring asserts the opposite — "Rows past the cap **or below the floor** surface as broken bars through the existing offScaleCount path" — and the code counts only `rawValue > paddedMax`.

This is round 8's process note happening once more: the fix was verified where it fired (the airline panel got wider) and not where it landed (the textbook panel lost two true values). The tell is in the new test. `fix-round-12.test.js:195` asserts the airline span is "at least 25% of the plot band" and computes the band as the distance between the first and last **tick label** (304 px) rather than the plot band (406 px). It passes at 32.8%. The real figure is **24.6%**, which is below the threshold the test's own message states, and on `b738-two-class` it is **18.1%**. The guard only trips once the true span falls under 18.7%.

---

## Re-verification of every round-08 finding above nit

| id | Round-08 finding | Status | Evidence |
|---|---|---|---|
| **N8-B1** | Caveat names "Front-to-back" and prints the back-to-front row's rate; About prints a different number | **FIXED** | `index.js:731` now reads `backToFront?.label`. Swept all 13 board presets and compared the named string to the **drawn row label** in the SVG. A320: caveat "Back to front, in zones runs slower… about **5.9** pax/min"; chart row "Back to front, in zones" = **26:05**; 153/26.08 = 5.87. "Front to back" is a separate row at 40:06 and is never named. Same match on b738-hd (5.7 / 26:47), a321neo (6.4), b738-two-class (6.2), b737max8-lcc (5.5). About tab now reads "Back to front, in zones, runs about **5.9** pax/min in the sim **on the A320 board default**" — same number, same cell, and the cabin is now named, which also closes N8-n9. |
| **N8-M1** | Browsing Rankings silently rewrites the Race tab | **FIXED** | Loaded a race with all fifteen params explicitly non-default (`preset=b777&a=random&b=united&seed=zz-9&load=0.93&compliance=0.42&families=0.55&politeness=0.7&distracted=0.33&prep=4.5&bag0=0.11&bag1=0.44&bag2=0.45&bins=legacy`), then swept Rankings: preset → crj700, mode → deplane, and every one of the five knobs to a non-default grid value. **All 15 race params survived byte-identical.** Writes went only to `rmode=deplane rpreset=crj700 rload=0.7 rcomply=0.5 rgroups=0 rbags=light rbins=legacy`. The Race tab's widgets still read b777 / random / united afterwards. A fresh load of the copied URL reproduces the Rankings chart. |
| **N8-M2** | Shared axis flattened the airline panel to 6.7%; the off-scale mechanism is dead code | **PARTIALLY FIXED** | A/B measured, board A320, 100 runs, 1280x900. **Before (`643eca3`):** airline panel span **5.8%** of the band, ticks `15m,30m,45m,60m`, nothing clamped. **After (`c479db7`):** span **24.6%**, ticks `18m,21m,24m,27m`, and the off-scale branch is live ("46 off scale" on the airline panel, "143 off scale" on the textbook panel). The panel is genuinely readable now — Lufthansa is visibly fastest and the cluster spreads. **Not fixed:** 24.6% misses the 25% the fix claims, `b738-two-class` is **18.1%**, and the new floor introduced a worse defect at the other end of the same axis. See **N9-B1** and **N9-M1**. |
| **N8-M3** | Two of three anchors collide into one string at every desktop width | **FIXED** | `getBBox()` pairwise on every anchor label, 7 presets x 4 widths = **28 pairs, 0 collisions**. A320 at 1280: KLM `y=54, x=377-469`, Spirit `y=42, x=391-474`, MythBusters `y=30, x=476-562` — three separate rows. Nothing clipped: the topmost label's top edge is `y=30` against a viewBox top of 0, at every width, and no label's right edge passes the viewBox width. Screenshot `anchor-band-1280-3x.png` reads cleanly. |
| **N8-M4** | Caveat makes a field comparison the page declares inapplicable four words later | **FIXED** | The MythBusters clause is now gated on the anchor being drawn. **No clause** on crj700, e175, b767, b787, b777, b789-three-class — all six presets where the anchor is withheld. Also correctly absent on b717 and a321neo-three-class, where the two rates land within the 0.5 pax/min drop threshold. Present and correct on the five narrowbodies that draw the anchor. The self-contradicting "No airline field anchor sits on the chart for this cabin" sentence no longer shares a paragraph with a field comparison. |
| **N8-m1** | Three copies of `niceCeiling`, drifted | **FIXED** | `js/render/axis-scale.js` is the single definition; `NICE_MINUTE_STEPS` and `NICE_TICK_CANDIDATES` appear nowhere else in `js/`. The fine ladder is the one that survived: E175 deplane now caps at **8m** (was 10m), cutting dead frame on that chart from ~46% to 22.9%. |
| **N8-m2** | "Both panels share this scale." has no CSS rule | **FIXED** | `.compare-shared-scale` renders at **11px, `rgba(31,42,51,0.55)`, 6px block margins** — identical to its `.compare-timing` sibling, no longer competing with the panel titles. It also now sits **between** the two panels (DOM order: svg, caption, rule, svg, timing), which closes N8-n8 as well. |
| **N8-m3** | CRJ-700 and E175 deplane start at 0m with no floor note | **FIXED** | CRJ-700 deplane now `ticks 1,2,3,4,5m` with "**axis starts at 1m**"; dead frame **6.6%** (was 25.3%). E175 now `ticks 1..8m` with "axis starts at 1m"; dead frame **22.9%** (was 46%). b737max8-lcc 5.5%, a320 deplane 7.6%. Residual right-side slack on E175 only; nit. |
| **N8-m4** | "Tap outside to close" is a 40 px strip, and it is this suite's flaky test | **FIXED** | Drawer capped at 85vw: at 400x800 the panel is now **340 px at x=60**, so the uncovered scrim strip is **60 px** (was 40). `elementFromPoint(20,400)` and `(35,400)` both return `DIV.settings-scrim`. The test now clicks `page.mouse.click(10, 400)` instead of the scrim's centre, so it targets the strip deterministically. **Both e2e runs passed that test**, against one failure in three last round. |
| **N8-m5** | A missing sensitivity cell shows the reader a build command | **FIXED** | `grep` for "npm run precompute" in `js/` returns nothing. Both remaining empty states are reader-facing: "No sensitivity data was precomputed for this preset. Choose the A320 or the 737-800…" on b777, and "No sensitivity data for this preset. The knobs snap to their defaults for this cell." Moot in practice now that the data is complete, but correct if it recurs. |
| **N8-m6** | Masthead is a `tablist` whose tabs use `aria-pressed` | **FIXED** | `<div class="segmented" role="radiogroup">` with two `<button role="radio">` carrying `aria-checked` `true`/`false` and no stray `aria-pressed`. There is now one tablist on the page, and it is the tab rail. |
| **N8-m7** | Five encodings in the assumptions table, no key | **FIXED** | `.about-assumptions-key` prints each of the five as an inline swatch **rendered in its own style**, each with a gloss: measured = peer-reviewed field figure, derived = arithmetic on measured inputs, estimate = range from trade press or practice, demonstration = controlled but non-peer-reviewed trial (n=1 TV), assumption = modelling choice. Screenshot `about-assumptions-key.png`. The estimate/demonstration ambiguity is now resolved by the key rather than by the dotted underline alone. |
| **N8-m8 / N7-m1** | `design/02-research.md` carries three citation errors | **PARTIALLY FIXED** | `:32`'s fabricated "~27M passenger-minutes or ~$2B per year" is **gone**, replaced with an honest note that the primary source does not quantify industry-wide totals. `:22` now reads "aired **21 August 2014**", matching the five other places in the repo and the primary source. The arXiv id wrongly attributed to Salari is gone from `:8`, now correctly "Schultz 2018, aerospace5010027, section 2.1". **Residue:** `:15` still credits the 3.7 s door-arrival mean to "**Salari et al. 2020**", an engine constant resting on an attribution round 7 traced to Schultz & Soolaki. See **N9-m3**. |
| **N8-m9 / N7-m7** | Race controls clipped 16 px below the fold at 1280x800 | **FIXED at the two widths specified** | A/B measured. **1280x800:** before `bottom=816` (16 px clipped) → after `bottom=768`, **inside the fold**. **1280x720:** before `bottom=806` (86 px clipped) → after `bottom=682`, **inside**. Also inside at 1366x768 and 1024x768. The compaction media query stops at `max-height: 850px`, so heights 851-1003 are untouched; see **N9-m1**, which I verified is **not** a regression. |
| **N7-n10** | Live index advertises cells that are absent; 9 console 404s per visit | **FIXED** | 62 advertised, **0 absent**. Swept 13 presets x 2 modes: **0 HTTP 4xx, 0 console errors, 0 page errors**. |

**Round-08 scoreboard: 1 blocker fixed. Majors: 3 fixed, 1 partial. Minors: 7 fixed, 1 partial, 1 fixed-as-scoped.**

---

## The five targeted verifications from round 08

| # | What round 08 asked for | Result |
|---|---|---|
| 1 | Caveat's strategy name checked against the **row label the chart drew**, not the cell id | **PASS.** 13/13 board presets. The named string is the drawn label, and the printed rate is that row's own arithmetic to within 0.05 pax/min. |
| 2 | Airline panel's median span as a **fraction of the plot band** | **24.6%** on a320 (was 5.8%), **18.1%** on b738-two-class. A real 4.2x gain, but under the 25% the fix claims, and the guard that asserts it uses the wrong denominator. See **N9-M1**. |
| 3 | Anchor labels asserted non-overlapping **pairwise**, not contained in the viewBox | **PASS.** 28 preset-width pairs, 0 pairwise collisions, 0 clipped. The new e2e test at `fix-round-12.test.js:248` asserts pairwise intersection at three widths, which is the right test. |
| 4 | Race tab's aircraft and both strategies asserted **unchanged** after a Rankings interaction | **PASS.** 15/15 race URL params and all race widgets unchanged after a preset + mode + five-knob sweep. |
| 5 | Caveat asserted to print **no MythBusters clause on a widebody** | **PASS.** 6/6 withheld-anchor presets print no clause. |

---

## New findings

### BLOCKER

**N9-B1. The compare chart draws two strategies' medians at a time neither of them ran, as a tie, with no mark — and the fastest one is the strategy its own title names.**

Board compare, A320, 100 runs, 1280x900. The shared axis floor is **16m**; the cap is 28m.

| row | median drawn at | what the row's median actually is | dots clamped onto the left edge |
|---|---|---|---|
| Reverse pyramid | x=200.0 = **16.00m** | **13:45** (the panel title prints this) | 87 of 100 |
| Steffen method | x=200.0 = **16.00m** | below 16m | 63 of 100 |
| Steffen, in blocks | x=249.9 = 17.47m | 17:28 (drawn in range, so the mark is true) | 14 of 100 |
| Window, middle, aisle | x=258.7 = 17.74m | 17:44 (drawn in range) | 8 of 100 |
| Front to back | x=606.0 = **28.00m** (cap) | past the cap, value not printed anywhere | 94 of 100 |

Three things fail at once:

- **Two medians are drawn at a value that is not theirs, at the same pixel.** Reverse pyramid and Steffen method render as one identical black slab pinned to the axis start; on the same settings the committed 10,000-seed cell puts them **74 seconds apart** (13:54 vs 15:08). The chart manufactures a tie between the two fastest textbook methods, and the panel prints no per-row value that would let a reader catch it.
- **The panel's own title contradicts the panel.** It reads "Lufthansa boards fastest at 21:01; **Reverse pyramid still wins on paper at 13:45**", printed four pixels above a median tick sitting at the 16m position. This is the same shape of defect as round 8's blocker: a true number in the prose, a different number in the mark, both in one frame.
- **192 of 900 dots are below the floor and nothing counts them.** The chart prints "143 off scale" for the right-hand truncation and has no left-hand equivalent. The `if (rawValue > paddedMax) offScaleCount += 1` at `charts-strips.js:131` is the only accounting, and `projectSeconds` clamps the low side with `Math.max(0, …)` silently. The "axis starts at 16m" note tells the reader the axis is truncated; it does not tell them that the marks they are looking at have been moved.

`computeSharedStripsAxis`'s own docstring states the opposite of what the code does: "Rows past the cap **or below the floor** surface as broken bars through the existing offScaleCount path". The below-floor half was never written.

Not preset-specific. `b738-two-class`: floor 14m, **Reverse pyramid's median clamped**, 122 dots below the floor, note reads "axis starts at 14m / 83 off scale". Confined to the two-panel shared-axis board path; single-panel deplane compare derives its floor from raw seeds and never clamps.

The repo already owns the right answer twice over. The ranked chart on the Rankings tab prints `40:06 (off scale)` with the true value beside a break mark, and on deplane A320 it does the same for two rows. The strip chart prints no per-row value at all, so a clamped mark is undetectable.

**Fix:** count below-floor values into a second counter and print "N below scale" at the left edge, mirroring the right. Separately, never clamp a **median**: if a row's median falls outside the window, draw it in the gutter with a break mark and print its true time, the way `rankings-chart.js` already does. A floor derived from p10 of the medians guarantees roughly a tenth of the rows will be outside it, so this is not an edge case.

Evidence: `compare-panel0-crop.png` (the two black slabs under the title that names 13:45), `strip-board-compare-1280.png` (full page).

### MAJOR

**N9-M1. The test that certifies N8-M2 measures the span against the wrong denominator, and passes at a number that fails its own stated threshold.**

`tests/e2e/fix-round-12.test.js:195-241`:

```js
// Plot band width: distance between the first and last tick.
const plotBandPx = textTicks.length >= 2 ? textTicks[textTicks.length - 1].x - textTicks[0].x : 0;
…
assert.ok(spanRatio >= 0.25, `airline medians should span at least 25% of the plot band, …`);
```

The first and last tick are 18m at x=268 and 27m at x=572. The plot band is x=200 to x=606.

| denominator | px | ratio | assertion |
|---|---|---|---|
| first-to-last tick (what the test uses) | 304 | **32.8%** | passes |
| chartX0 to chartX1 (the plot band) | 406 | **24.6%** | would fail |

The guard is 25% too loose by construction, so it only trips once the true span falls below **18.7%**. `b738-two-class` already sits at **18.1%** and is not covered by the test, which only runs a320. A regression back toward round 8's 6.7% would have to travel two thirds of the way there before this test noticed.

**Fix:** compute the denominator from the axis geometry (`STRIPS_PADDING_LEFT` to `width - STRIPS_PADDING_RIGHT`), not from tick text positions, and add a second preset. While you are in there, the same test should assert that no median tick sits on either edge of the band, which is the assertion that would have caught **N9-B1**.

### MINOR

**N9-m1. Race controls are clipped below the fold at 1440x900, 1512x982 and 1600x900.** Not a regression — I served `643eca3` on 5198 and measured identical numbers before and after — but it is the same defect the fix round closed at 1280, still open on two of the most common laptop viewports.

| viewport | before | after |
|---|---|---|
| 1280x800 | clipped 16 px | **inside** |
| 1280x720 | clipped 86 px | **inside** |
| 1440x900 | clipped 104 px | clipped 104 px |
| 1512x982 (MacBook Pro 14") | clipped 22 px | clipped 22 px |
| 1600x900 | clipped 104 px | clipped 104 px |

The cause is visible in the canvas height: 130-140 px at the covered widths, **213 px** at ≥1440. The compaction block is `@media (min-width: 900px) and (max-height: 850px)`, so heights 851-1003 get the roomy layout and the taller canvas pushes `#race-controls` to `bottom: 1004`. Raising the media query's ceiling to about 1010 px, or deriving the canvas height from available height rather than width, closes all three.

**N9-m2. The page cites a ">40% reduction" for structured deplaning and its own simulation delivers 4.2%, and the page never says so.** `about.js:87-89` puts the assumptions-table row "One-column (aisle-first) deplaning claim / aisle-first faster than free-for-all" next to the source "Wald, Harmon and Klabjan 2014… (structured deplaning >40% reduction)". On the A320 deplane headline cell (10,000 seeds): free-for-all **6:24**, aisle seats first **6:08** — a **4.2%** reduction, an order of magnitude below the cited figure. `design/01-spec.md:47` is explicit that "their >40% claim is the thing to test". The site tests it and does not report the answer, on the tab whose whole credential is "a bound is never widened to make a test pass". The row's literal words are not false, which is exactly why it survives: a reader takes away that the model reproduces the source. One bullet in the Limits list, in the register of the existing back-to-front bullet, settles it.

**N9-m3. `design/02-research.md:15` still credits an engine constant to the wrong authors.** [residue of N7-m1 / N8-m8] The 3.7 s exponential door-arrival mean reads "(Salari et al. 2020, Schultz baseline)". Round 7 traced that attribution to arXiv:2007.16021, which is **Schultz & Soolaki**. The arXiv id was removed from this line and from `:8`, so the citation is now unverifiable rather than verifiably misattributed — which is the weaker failure but still a wrong author on a number `CLAUDE.md` makes this file the record for.

### NIT

**N9-n1.** `design/02-research.md:32` now reads "one-column (aisle column front to **base**, then middle, then window)". The fix round's own edit turned "back" into "base" on the line it rewrote.
**N9-n2.** E175 deplane leaves **17.2%** of the plot band empty on the right (cap 8m, data to ~6.5m). Down from 46% total dead frame to 22.9%; the last slice is the cap ladder having no step between 8 and 10.
**N9-n3.** Every Race share link now carries seven `r*` keys it does not need: `finish-card.js:212` copies `window.location.href`, and `main.js:408-414` writes the whole Rankings slice unconditionally. The link works; it is just twice as long as the thing it describes.
**N9-n4.** "Source or assumption" still holds seven different first words (`Assumption`, `Derived`, `Estimate`, `Schultz`, `Wald`, `Steffen`, `MythBusters`). [N8-n4, carried]
**N9-n5.** `demonstration` still differs from `estimate` by a dotted underline, the web's tooltip affordance, on a non-interactive row. The new key defuses it, so this is now cosmetic. [N8-m7 residue]
**N9-n6.** Carried from round 08, unchecked this round because they are outside the fix set: door-status slot empty and hidden [N8-n1], `m` and `t` do nothing [N8-n2], loser's time prints 5x at the finish [N8-n3], six phone row labels ellipsize into `<title>` tooltips [N8-n5], two or three shaded regions with one caption [N8-n6], hand-edited `?load=0.93` leaves the thumb at 0.95 [N8-n10, re-observed this round].
**N9-n7.** N8-n7 is closed: the `offScaleCount` branch is live and prints "143 off scale" / "46 off scale". It is now the left-hand half that is missing, which is **N9-B1**.

---

## `npm run test:e2e`

| run | tests | pass | fail |
|---|---|---|---|
| 1 | 64 | **64** | 0 |
| 2 | 64 | **64** | 0 |

64 tests, up from 56; `fix-round-12.test.js` adds eight, one per round-08 finding above nit. No failing test in either run. **The round-08 flake is gone**: `drawer opens and closes at 400 px with focus trapped` passed both runs, and the fix was made at the product level (85vw drawer cap giving a 60 px scrim strip) as well as in the test (`page.mouse.click(10, 400)` instead of the scrim's obstructed centre). That is the right order of operations and worth saying.

One caveat on the suite's authority: the N8-M2 test passes on a miscomputed denominator (**N9-M1**), and no test asserts that a median tick never lands on an axis edge, which is why **N9-B1** shipped green.

---

## Sanity-read: the A320 headline numbers, both modes, full 10,000 seeds

Read off `board__a320__…__n=10000.json` and `deplane__a320__…__n=10000.json`, 153 passengers.

**Three numbers a domain expert would stop on.**

1. **Front to back at 40:05 (3.8 pax/min).** This is 1.64x the slowest thing ever measured in the field — MythBusters' back-to-front at 24:29 on 173 seats — and no airline has ever taken 40 minutes to board a single-aisle. It is the pathological case by construction and the page handles it honestly: the ranked chart marks it "(off scale)" with the true value, and the About Limits bullet calls the extremes "extrapolation rather than result". Believable as a model output, correctly fenced. No action.

2. **Ten airline procedures inside 14 seconds, and eleven inside 40 seconds.** Delta 23:29, Southwest 23:31, Ryanair 23:32, easyJet 23:33, British Airways 23:33, American 23:34, Alaska 23:40, JetBlue 23:41, Air Canada 23:43, Hawaiian 23:43 — a **1% spread across ten structurally different boarding procedures**, with Random order at 23:35 sitting in the middle of them. At 10,000 seeds this is not sampling noise, so the model is asserting that ten distinct group schemes are statistically indistinguishable from no scheme at all. That is the site's thesis and the literature supports the direction, but 14 seconds is tighter than procedural differences alone would predict, and it is worth confirming that the group-order machinery is still producing distinguishable queues after the 0.85-compliance shuffle rather than collapsing to near-random. Lufthansa (20:42) and ANA/United (21:48/21:49) do separate, which is evidence the machinery works; the question is only whether the other ten are genuinely that similar. I would run one diagnostic on queue-order distance before publication, not change anything.

3. **Aisle seats first 6:08 vs free-for-all 6:24: a 4.2% reduction where the cited source claims >40%.** Raised as **N9-m2** above. This is the number I would most expect a reviewer from the field to challenge, because the page puts the >40% citation in the assumptions table and never reports its own answer.

Everything else reconciles. Deplane free-for-all at **23.9 pax/min** sits right on Schultz's measured median of 23 and matches the About tab's stated "23 to 25 pax/min at defaults". Both doors at **4:02 / 37.8 pax/min** is below the ~46 pax/min two-door ceiling implied by Schultz's single-door median, as it should be. Reverse pyramid at **11.0 pax/min** is fast but inside the range Van den Briel's America West trial implies. Board medians span 13:54 to 40:05 and the airline band sits at 20:42-23:43, which brackets the KLM 17-22 min field range and the Spirit 20-minute anchor sensibly on the slow side, consistent with the page saying so.

---

## Scores

**Truth: 8/10.** Unchanged, but the composition moved a long way. The blocker that stood for three rounds is genuinely dead, and I verified it the way round 8 asked — against the row label the chart drew, on all thirteen presets, with the arithmetic recomputed from the committed 10,000-seed cells. The About tab and the caveat now quote the same cell and agree to the decimal. The MythBusters clause is withheld on exactly the six cabins where the anchor is withheld. The Rankings tab no longer edits state the reader set on another tab, confirmed across fifteen parameters. What holds it at 8 is one chart: the compare panel now draws two strategies' medians at a value neither of them ran, as a tie, under a title that prints the correct number for one of them, with a mark on the right-hand truncation and none on the left. That is the same class of self-contradiction the round-8 blocker was, moved from a sentence into a mark.

**Clarity: 8/10.** Held, with real gains and one real loss. The airline panel went from 6.7% to 24.6% of the band and is legible for the first time; the shared-scale caption is axis chrome instead of content; the three anchor labels sit on three clean rows at every desktop width; the assumptions table has a key that renders each encoding in its own style; the masthead is a radiogroup instead of a malformed tablist; two deplane charts stopped wasting a quarter to a half of their frame; and the race controls finally sit above the fold at 1280. Against that: 192 dots and two medians on the default compare chart are drawn somewhere they are not, which costs more clarity than the airline panel gained, and the controls are still below the fold on a 1440x900 laptop.

**Delight: 7/10.** Held, and again not a delight round, which remains the right call with a blocker open. The page is materially nicer to use — the data is complete so every preset loads clean with zero 404s, the Rankings tab is linkable and now survives the trip without taking the race with it, and the phone drawer closes on a 60 px strip instead of a 40 px one. But nothing new was built for the seventh round running: the countdown is still dead air over an empty door-status slot, the margin still prints five times at the finish, `m` and `t` still do nothing, and the wager before the door opens is still unbuilt. The delight is still entirely load-bearing utility.

---

## End condition

Not yet, and the distance is one chart. Four of the five things standing are small: a test denominator, a media-query ceiling, a Limits bullet and an author name. The blocker is the compare strip chart's low end, and it needs the same treatment the ranked chart already gives its high end — count what falls outside the window, mark it, and never move a median without printing its true value. The code to copy is `rankings-chart.js`, three clicks away on the same page.

Two process notes, both short.

First, **the round-8 fixes held up under hostile re-test, including the three I most expected to slip.** I checked the caveat against the drawn label rather than the cell id, measured anchor labels pairwise rather than for containment, and swept fifteen race parameters rather than the four round 8 named. Nothing gave. That is two rounds in a row where the fixes are real.

Second, **the pattern that produced this round's blocker is now visible in the test file, which makes it cheap to prevent.** `fix-round-12.test.js` has one test per round-08 finding, and each asserts the property that was **broken** — the span got wider, the labels stopped overlapping, the race params stopped moving. None asserts the property that had to stay **true** while the fix landed. The compare test measures how far apart the airline medians are and never asks whether any median is still where its data says it should be. The generic defence is one line per layout test: after asserting the fix, assert that every mark still projects to its own value.

REMAINING ABOVE NIT: 5
