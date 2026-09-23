# Round 04 — Critic pass (data-visualization critic)

Reviewer: adversarial data-vis review, headless Chromium 1.58.2 at 1280x800, 1280x900, 1440x900 and 400x800.
Build: `index.html` served from `python3 -m http.server 5197`, repo at `1cc019b`.
Artifacts: `tests/e2e/artifacts/critic-round-04/` (31 files). `npm test`: **424 pass / 0 fail** across 68 suites (was 276/50). Load 912 ms cold. Console is clean on the Race tab across every race I ran; the Rankings tab logs **two 404s on every single visit**. Rankings data completed generating mid-session: `ls data/rankings | wc -l` = **63** (62 cells + `index-preview.json`), every cell present, every cell `n=200`.

---

## Verdict

The engine got honest and the picture got beautiful, and then you built an analytical tab that says things the data does not support. Start with the good, because it is very good: the 777 is fair now — aisle 0 and aisle 1 come in at 365 s and 339 s against last round's 236 s versus 477 s, and the guard test finally runs on the 767, 787 and 777 instead of the one plane where the bug was absent. Two doors no longer inverts on tight bins; the E175 went from a 10% loss to a 41% win and the high-density 737 from -10% to +54%, because `doorCell` now asks where the bag ended up. The worst-seat label is a paper pill with a leader line and I can read "30A 16:17" at a glance. Both cabins and the result card are on screen together at 1280x800, which is the layout your shared heat scale was built for. And you did not take my advice on the default matchup — you did better than my advice, opening on Free-for-all versus One row at a time, a 9:43 knockout that is the finding the site is named after instead of the 2:20 I suggested. The Race tab's strip chart is the best chart in the project: a hundred real dots per strategy, a median tick, and green on exactly the two rows you are racing. It shows the overlap instead of hiding it.

Now the Rankings tab. Its deck says "Every strategy, run **thousands** of times." Every cell on disk is `n=200`. Its knob strip says "nearest run: 50%" while loading the 85% cell on eleven of your thirteen presets — I can reproduce that in one URL. Its biggest number, 89.6 person-years per day, is labelled "IF EVERY US DOMESTIC FLIGHT USED THE WORST" but is arithmetically the *difference* between worst and best, and its info button opens a popover about measured anchors. Its three person-minute tiles do not reconcile: 334 and 812 are printed beside 1150, and 334 + 812 = 1146. Its Overhead-bins slope chart plots the same cell at both ends of an axis labelled "legacy | default | legacy". And the flagship chart prints eleven real, named airlines in a strict rank order spanning 64 seconds when each median carries a 12-second standard error — it tells the world Southwest boards faster than Delta on a 4-second gap, which is a fifth of one error bar. Meanwhile the About tab, the page whose whole job is to be audited, publishes a calibration gate of "14 to 24 pax/min" when the code asserts 14 to 27, and its measured-versus-assumed table omits the 45-second staging window, the patient fraction and the prep distribution — three assumptions that set the size and shape of every deplaning number on the site.

Fix the knob label, fix the sample-size claim, fix the person-years label, and stop asserting an order you cannot defend, and this becomes the thing it is trying to be. You are one honest pass away. And there is a gift sitting unopened in your own data: **eleven of fourteen airline procedures are statistically tied with boarding at random.** That is the sentence people forward to their group chat, and it is nowhere on the page.

---

## Re-verification of every round-03 finding

| id | Round-03 finding | Status | Evidence |
|---|---|---|---|
| **NEW3-B1** | Twin-aisle door starvation, aisle 0 always served first | **FIXED** | 10 seeds, free-for-all, defaults, mean total time aboard: 767 **222 s / 204 s**, 787 **303 s / 246 s**, 777 **365 s / 339 s** (was 236/477, +102%). 777 per column: `A=424 B=367 C=339 D=314 E=381 ‖ F=348 G=305 H=301 I=338 J=405` — a symmetric U per aisle, no seam. `types.js` adds `doorWaitStartT`; `deplane-walk.js` admits through a fair `admitAtDoors` pass ranked by wait time. The 787/767 residual is structural: the odd middle block gives aisle 0 25-33% more seats (n=1278 vs 1022). `side-fairness.test.js` now guards 767/787/777 (<30%, <30%, <10%) and all four cases pass. |
| **NEW3-M1** | Two doors is a net loss on E175 and 737-HD | **FIXED** | 40 seeds, CLI, defaults: E175 free-for-all **3.27m** → two-doors **1.93m** (+41%, was -10%). 737-HD **10.45m → 4.84m** (+54%, was -10%). CRJ-700 **3.03m → 1.67m**. The inversion is gone on every preset I tried. |
| **NEW3-M2** | Worst-seat label is paper stroked on paper | **FIXED** | `08-both-finished-heat.png` at dsf 3: "28A 6:34" and "30A 16:17" render as a white pill with a dark border and a leader line down to the seat. Legible at 1:1 on both the pale winning lane and the near-black losing lane. |
| **NEW3-M3** | One cabin on screen at the finish on every laptop viewport | **FIXED** | Raced to finish at 1280x800, never scrolled: canvas A **100%** visible, canvas B **100%**, result card **100%**, `scrollY 147`. The finish now collapses to a block that fits. |
| **NEW3-M4** | Default matchup is a 3-second coin flip | **FIXED, better than asked** | Default is now Free-for-all vs **One row at a time**. First default race: 6:34 vs 16:16, margin **9:43**. Ranked data agrees: 6.37 min vs 15.93 min, a 2.5x knockout with no overlap between the p10-p90 bands. This is a better opening than the Two doors I asked for, because it is the policy the site is named after. |
| **NEW3-M5** | Steffen blurb claims "fastest at full compliance and no groups"; CLI falsifies it | **FIXED (claim deleted)** | `board.js:117` is now "Windows first, spaced two rows apart so neighbours never wait for the same bin." The false clause is gone. The numbers are unchanged — 60 seeds, compliance 1, groups 0: steffen **13.18m**, reverse-pyramid **11.92m** — so deletion, not reconciliation, was the fix. Residue in `glossary.js:76`: "In theory it is the fastest possible order," sitting one tab away from a chart that ranks it second. Downgraded to NIT. |
| **NEW3-m1** | Amber swatch drawn on the word "bag" | **FIXED** | Computed style on `.swatch.bag::after`: `position: absolute`, `margin-left: 0px`, `width: 5px`, `background rgb(224,161,0)`. The margin hack is gone; the square is inside the ring. |
| **NEW3-m2** | Time-split bars print identical numbers and claim "last off" mid-race | **PARTIALLY FIXED** | The caption is honest now: mid-race both rows read "· **slowest off so far**", and at the finish "· last off". But the totals are still twins for most of the race: sampled `total 2:22 \| 2:24` at clock 1:39, `4:24 \| 4:23` at 3:39, `4:46 \| 4:46` on another run. The section is still a duplicated clock; only the label stopped lying. |
| **NEW3-m3** | Board mode throws away the deck line | **PARTIALLY FIXED** | Board deck is now "A real airline procedure races the baseline every airline still falls back to. Same people, same bags, two ways on." It has a thesis. It still has **no number**, where the deplane deck lands "six minutes… twenty seconds". Your own data offers 21:55 in seat 29C. |
| **NEW3-m4** | Thirty-five dead seconds at 1x before the door opens | **PARTIALLY FIXED** | Measured at 1x: the countdown runs from about -0:25, not -0:45, and the cabin is not frozen (people stand through it). Green pixel fraction across the window: 0.112% → 0.063% → 0.063% → 0.063%. Shorter and not static, but still 25 seconds with no reason to watch. The wager is still unbuilt. |
| **NEW3-m5** | Compare pool: 7 strategies in 2 waves, 5 workers idle | **STILL BROKEN** | Progress bar polled every 50 ms, 100 runs: 10% at 1.91 s, 50% at 5.08 s, 80% at **7.58 s**, 90% at 10.88 s, done at **16.13 s**. The last 20% takes 8.55 s = **53% of the wall clock** (round 3: 51%). `compare-pool.js` `WORKER_CAP = 6`, one strategy per task, unchanged. |
| **NEW3-n1** | `tput/min` column is really first-two-minute throughput | **FIXED** | CLI header now reads `first2min pax/min`. |
| **NEW3-n2** | No keyboard shortcut for heat toggle or mode tabs | **STILL OPEN** | Pressed `h`, `H`, `m`, `M`, `t`: active tab stayed "Race", heat state unchanged. `Space` paused (-0:07 held across 900 ms) and `2` switched 15x → 4x, so the existing bindings work. |
| **NEW3-n3** | Heat toggle reads "Heat map" in both states | **FIXED** | The control is now "Worst-seats view" carrying a live gradient swatch that fills when active; `aria-pressed` flips. |
| **NEW3-n4** | Seed names unpronounceable | **STILL BROKEN** | Four presses of New plane: `plane-2you`, `plane-9vlo`, `plane-23pe`, `plane-j94f`. The default `plane-001` is lovely; the roll is still base-36. |
| **NEW3-n5** | Strip chart x-axis runs to 20m, compressing the interesting five | **STILL BROKEN** | Compare strips still axis 0m–20m with Both doors at 4:00 and One row at a time at 15:56. Now duplicated on the Rankings chart at a worse ratio — see N4-M6. |

### Round-01 / round-02 carry-overs that round 03 left open

| id | Finding | Status | Evidence |
|---|---|---|---|
| **round-01 M5** | Calibration gate passes only on its own seed family | **FIXED as a test; new problem created** | `calibration-deplane.test.js` now runs six prefixes and asserts each. Measured across eight families, 40 seeds each: `calib` 22.60, `stagger` 23.50, `critic2` 23.74, `critic3` 25.09, `family-a` 23.63, `family-b` 24.63, plus two fresh families `critic4` 23.72 and `zzz` 24.19. All inside [14, 27] with 1.9 pax/min of headroom. No longer a coin on its edge. **But** the ceiling moved 24 → 27 and the About tab still publishes 24 — see N4-M5. |
| **round-01 m1** | Two identical 54 px clocks; the gap that differs is 13 px | **STILL BROKEN** | Computed styles mid-race: both `.clock` **54px/600**, both printing `2:11`. `.live-gap` **13px**, reading "Free-for-all is 15 passengers ahead of One row at a time". The duplicated number is 4.2x the size of the one that carries information. Four rounds. |
| **round-02 NEW-M3** | Race controls entirely below the fold at 1280x800 | **MOSTLY FIXED** | `#race-controls` now at `top: 756, bottom: 816` in an 800 px viewport (was `top: 930`). Restart and the speed pips are visible on first load, clipped by about 16 px at the bottom edge. `01-race-first-load-1280x800.png`. |
| **round-02 NEW-m3** | Strict ranking printed over rows within noise | **STILL BROKEN, and now much worse** | Promoted to the flagship chart with 23 rows and eleven named airlines. See N4-M4. |
| **round-02 NEW-m4** | Tap targets under 44 px; door-status slot empties | **PARTIALLY FIXED** | At 400x800, still under spec: Last/Average **44x32** and **64x32**, mirrored speed pips **39-49 x 32**, Runs select **66x35**, every info button **22x22**, chime checkbox **16x16**. Door-status slot still empties: reads "seatbelt sign off, door still closed" during the countdown, then `""` from door open onward. |
| **round-02 NEW-m5 / round-01 n3** | Last/Average toggle lies while following | **FIXED** | Followed seat 25D: follow line "Seat 25D · 2 bags (0 left) · waited 1:57 · walked 0:29"; subtitle "**Following seat 25D on the left cabin.** Click the dot again to unfollow."; toggle reports `Last: on=false, Average: on=false`. Three surfaces, all truthful, with the third state expressed as "neither lit". |

**Round-03 scoreboard: 8 fixed, 4 partial, 4 still open. Carry-overs: 3 fixed, 2 partial, 2 still open.**

---

## New findings

### BLOCKER

**N4-B1. The Rankings knob strip tells the reader which settings the numbers came from, and on eleven of thirteen presets it is wrong.**

The strip under the deck reads "How full — nearest run: 85%", "Follow the rules — nearest run: 50%", and so on. The words "nearest run" are a promise: *the chart below was run at this value.* Sensitivity cells exist only for `a320` and `b738-two-class`. On every other preset the loader silently falls back to the default cell and the strip keeps asserting the snapped value.

Load these URLs and compare the strip against the cell id in the page footer:

| URL | Strip says | Cell actually loaded |
|---|---|---|
| `?tab=rankings&mode=deplane&preset=a320&compliance=0.5` | nearest run: 50% | `…a320__…comply=0.5…` ✓ |
| `?tab=rankings&mode=deplane&preset=b777&compliance=0.5` | nearest run: **50%** | `…b777__…comply=**0.85**…` ✗ |
| `?tab=rankings&mode=deplane&preset=b777&load=0.7` | nearest run: **70%** | `…b777__load=**0.85**…` ✗ |
| `?tab=rankings&mode=board&preset=e175&load=1&compliance=0.5` | nearest run: **100%** / **50%** | `…e175__load=**0.85**__comply=**0.85**…` ✗ |

`19-snap-mismatch-b777.png`. The only contradicting evidence on screen is an 11 px gray line of developer-ese at the very bottom of the page. A reader drags How full to 100%, switches to Rankings, reads "nearest run: 100%", and takes away a ranking computed at 85%.

The Sensitivity popover already admits the underlying fact ("Only the A320 and the 737-800 have sensitivity runs today; the other presets show one cell each"), so the author knows. The label does not.

**Fix:** when the nearest cell does not match the requested knob, say so in the strip — "no run at 50%, showing 85%" — and gray the knob. Never print "nearest run: X" for an X you did not run. This is the project's own stated standard and it is one string away.

### MAJOR

**N4-M1. "Every strategy, run thousands of times." Every cell is 200 runs.**

`js/ui/rankings/index.js:210` (the Rankings deck) and `js/ui/glossary.js:417` (the compare popover, "thousands of pre-run planes"). On disk: `index-preview.json` carries `"preview": true` and `seedTiers {"headline":200,"small":200,"sensitivity":200,"preview":200}`; all 62 cells are `n=200`. `design/07-rankings.md` specifies 10,000 for headline presets and 2,000 elsewhere, so this is a preview build — which is fine, and the cell footer is honest about it ("200 runs per strategy"). The deck is not.

Two hundred is not thousands, and the gap matters: it is the difference between an SE of 12 s and an SE of 2.5 s on every median in the chart, which is exactly what N4-M4 turns on.

**Fix:** the deck reads the seed count from the index. "Every strategy, run 200 times" today; it becomes true for free when the full precompute lands. And put the run count on the About tab, which currently never mentions it.

**N4-M2. The biggest number on the page is mislabelled, and its info button opens the wrong popover.**

Tile 4, deplaning: "**IF EVERY US DOMESTIC FLIGHT USED THE WORST** — 38.6 person-years per day — About 25,000 departures a day."

Check the arithmetic. Worst (One row at a time) idle = 1146.4 person-min. Scaled: 1146.4 × 25,000 ÷ (60 × 24 × 365.25) = **54.5** person-years/day. The *difference* (1146.4 − 334.2 = 812.2) scales to **38.6**. The tile is the marginal cost and the label says total. Boarding reproduces it: 2884.4 − 999.1 = 1885.3 → **89.6**, matching the tile.

Then click its "i". It opens "**Measured anchors**" — the popover belonging to the chart's dotted ticks. The tile's own aria-label is `About Measured anchors`. So the page's most quotable number has a wrong title and no explanation at all, and the BTS citation `design/07-rankings.md:28` requires for the 25,000 figure appears nowhere.

And the counterfactual is a strawman. No airline deplanes row by row, and none boards strictly front to back. Your own data holds the honest version: the **median airline procedure** costs 1579.7 person-min against reverse pyramid's 999.1, which scales to **27.6 person-years per day** — smaller, real, and about companies the reader has flown.

**Fix:** relabel to "avoidable every day if the worst switched to the best", wire the tile its own popover with the BTS source and the per-aircraft caveat (25,000 departures are not all 153-seat A320s), and add or substitute the airline-versus-best comparison.

**N4-M3. The three person-minute tiles do not add up on screen.**

Deplaning: 334 (best) and 812 (cost of worst over best) sit beside 1150 (worst). 334 + 812 = **1146**. Boarding: 999 + 1890 = 2889 against a printed **2880**. The two-class 737: 904 + 1630 = 2534 against **2530**.

Cause: each tile is rounded independently to three significant figures from the raw data (`idlePersonMinutesMedian`: 334.2, 1146.4, diff 812.2). The rule is defensible per tile and indefensible across a row of tiles a reader will subtract. Worse, 1146 rendered as "1150" *invents* a trailing zero — it reads as eleven-fifty and is less accurate than the underlying value for no gain.

**Fix:** round all three to the same absolute place (330 / 1150 / 820, or 334 / 1146 / 812) so the row reconciles, and drop the significant-figure rule when the numbers are meant to be compared. Cite: VISUAL_DESIGN's consistent-precision-within-a-column rule applies across a tile row too.

**N4-M4. The ranked chart asserts a strict order over rows that are statistically identical, and eleven of them are real companies.**

Boarding, A320, defaults, n=200. Medians and, from `(p90−p10)/2.563`, the standard error of each median:

| strategy | median | SE of median |
|---|---|---|
| Frontier | 23:10 | 12.3 s |
| Ryanair | 23:27 | 12.8 s |
| **Random order** | **23:32** | 12.2 s |
| Southwest | 23:35 | 12.7 s |
| Delta | 23:35 | 12.4 s |
| American | 23:39 | 14.1 s |
| British Airways | 23:44 | 11.7 s |
| Air Canada | 23:48 | 10.9 s |
| JetBlue | 23:49 | 12.2 s |
| Hawaiian | 23:55 | 11.4 s |
| easyJet | 23:59 | 12.0 s |
| Alaska | 24:13 | 12.5 s |

Eleven airlines inside **64 seconds**, each median carrying a ~12 s error bar. Delta and American are 4.2 s apart — **0.22 of one standard error of the difference**. Southwest and Delta print the *same string*, 23:35, and occupy different ranks. The chart draws one dot per row, sorts them, and prints a time to the second, so it states: Southwest boards faster than Delta, Alaska is the slowest airline in the world. Neither claim survives its own error bar. Deplaning does the same at smaller scale: Free-for-all 6:22, Every other row 6:27, No bags first 6:29, with an SE of about 4 s — three rows, one standard error, three ranks.

You already know how to draw this. The Race tab's strip chart shows a hundred real dots per strategy and the overlap is unmissable (`16-compare-strips.png`). The analytical tab throws that away and keeps only the dot.

**Fix:** group the ties. A light rule or shared band around every row whose interval overlaps the leader's, one label for the group ("eleven airline procedures, statistically tied at about 23:30"), and round the printed times to the resolution the sample supports (`23.6 min`, not `23:35`). Then say the finding out loud, because it is the best one you have.

**N4-M5. The About tab publishes a calibration gate that is not the gate the code asserts.**

`js/ui/about.js:92`: "Therefore the whole-run gate spans **14 to 24 pax/min** (Milne and Salari low end to Schultz median), 5 to 13 minutes from door open, medians of 40 seeds."

`tests/unit/calibration-deplane.test.js:80`: `assert.ok(rateMedian >= 14 && rateMedian <= 27, …)`.

The ceiling moved from 24 to 27 in commit `23e218e` with a source-based justification in the docstring (Schultz Q3 is 29), which is the right way to move a bound. The published page kept the old number. So the one section that exists to let a skeptic audit the model states a tighter gate than the model is actually held to — and 24 is precisely the bound round 3 caught the model failing.

There is a second-order problem. The gate now spans 14–27, a 1.93x range, while the two sources it derives from report 15–17 (Milne & Salari, whole-run) and 23 (Schultz, first-minute median). Measured across eight seed families the model lands at 22.6–25.1, i.e. clustered near the *top* of the band and above Milne & Salari's entire range. A gate that wide cannot fail for any plausible model, and the About tab's "derived, not tuned" is a claim about the gate that a reader will hear as a claim about the model — `config.js:65` is candid that the 45 s staging window was chosen partly to keep throughput near Schultz's median.

**Fix:** print the gate from the constants, not from prose. Then add one line of honesty: the model runs at the fast end of the literature, and here is why.

**N4-M6. One outlier owns four fifths of the flagship chart.**

Boarding, A320: 22 of 23 strategies fall between 14:00 and 26:16. Front to back is 40:08. The axis runs **0m to 60m**. The entire population except one row therefore lives between 23% and 44% of the plot width — **one fifth of the frame** — while 57% of it, from 26 min to 60 min, is empty except for a single dot. Add the zero baseline nothing comes near and the geometry contributes nothing at all: the reader gets the ranking from the right-hand numbers, which means the chart is a table with decoration.

On phone it collapses completely (`23-phone-rank-chart-vp.png`): the deplaning rows Aisle seats first (6:08), Free-for-all (6:22), Every other row (6:27) and No bags first (6:29) render as four dots inside roughly 10 horizontal pixels, overlapping each other and the Schultz anchor line.

Same defect on the Race tab's strip chart (axis to 20m for a 4:00–6:29 cluster) — that is round-03 NEW3-n5, unfixed and now duplicated.

**Fix:** clip the axis to the band that holds the mass and break the outlier out — a row that runs to the edge with its value printed and a break mark, or a caption ("Front to back, 40:08, off the scale"). Drop the zero baseline for a quantity with a hard floor at 14 minutes. That single change makes 22 rows readable.

**N4-M7. On a phone the chart's finding sentence is cut off mid-sentence.**

400x800, Rankings, deplaning. Title renders as "**Both doors deplanes A320 / 737 in 4.0 min; One row at a tim…**". Measured: the `<text>` element is 400 px wide inside a 342 px SVG (`viewBox "0 0 342 336"`), so it ellipsizes. The reader on a phone learns what the best strategy does and never learns the comparison, which is the entire point of the sentence. Reproduced on both modes.

**Fix:** wrap the title to two or three lines at narrow widths. It is the most important string in the chart; it should be the last thing you truncate.

**N4-M8. The measured-versus-assumed table omits the assumptions that matter most, and miscredits one.**

The table lists six rows, five citing sources and one reading "Distracted-passenger tail, politeness, group size — Assumption". Against `js/engine/config.js`, which marks its own assumptions honestly:

- **`doorOpenDelaySeconds: 45`** — "Ops assumption", and the comment says outright it was picked to keep whole-run throughput near Schultz's median. It is 45 seconds of every deplaning run, about 11% of the default 6:34. **Not in the table.**
- **`patientFraction: 0.4`** — "Behavior assumption", and it is what produces the bimodal stand-up stagger round 3 measured. It changes the shape of every deplaning curve. **Not in the table.**
- **`prepMedianSeconds: 3` / `prepLogSigma: 1.0`** — "Assumption; the calibration gates keep the throughputs inside the field-measured ranges." **Not in the table.**
- **`politeness: 0.9`** — config cites "Milne & Salari". The table calls it an assumption. **Miscredited, in the direction that understates your sourcing.**

So the honesty table both over-credits a cited value and hides three tuned behavioural parameters. It is also shaped as prose-in-cells: the distinguishing property (measured or assumed) has to be read out of each sentence rather than scanned down a column.

**Fix:** three columns — Number, Value, Source *or* "Assumption" as its own scannable column — and one row per assumption in `config.js`, not a summary of three of them.

**N4-M9. The Overhead-bins sensitivity chart plots the same cell at both ends of its axis.**

`02b-rankings-board-full.png`, `03d-sensitivity-crop.png`. The x-axis reads **"legacy | default | legacy"**. The bins grid is `["roomy", "legacy"]` with default `roomy`, so there is no "high" value and the low cell is drawn twice. The five lines are consequently flat with a dip in the middle, a perfectly symmetric shape that exists only because the endpoints are identical. The computed title, "Overhead bins barely moves any of the top strategies," is derived from that degenerate comparison. The Sensitivity popover meanwhile explains the panels as "one knob moves from low to default to high", which this panel cannot do.

A chart that invents a third data point is worse than no chart. It also teaches the reader to misread the other four panels, which *are* real.

**Fix:** for a two-valued knob draw two points, not three, and label them "Roomy (default)" and "Old-style". Or drop the panel and put the one honest number in a sentence.

### MINOR

**N4-m1. The gray band is p10–p90; the hover says p25–p75; neither is labelled anywhere.**
`rankings-chart.js:292` draws p10–p90. Hovering a row produces "Both doors — n=200 · median 4.0 min · **p25 3.6 · p75 4.4**". Two different intervals for the same row, and the chart carries no caption, legend or axis note saying what the band is. A reader will assume the hover explains the band. **Fix:** one interval, named in a caption under the chart.

**N4-m2. In Board mode the time-split section says everyone is getting off.**
Board race, mid-flight: heading caption "The last passenger **off**. Click a dot on either cabin to follow one person."; each bar "· average so far, **nobody off yet**"; the largest segment labelled "**seated waiting** 3:09" for people standing in a jet bridge. `11-board-midrace-sections.png`. The honest-caption fix from NEW3-m2 was applied without mode awareness. **Fix:** mode-specific strings ("last passenger seated", "nobody seated yet", "waiting to board").

**N4-m3. The first-class section label collides with the boarding-door arrow.**
`13-section-label-collision-2x.png`, Board mode, 737-800 two-class, 1280x900. The green door arrow is drawn through the "r" of "First"; it reads "Fiıst". Reproducible on every sectioned preset in both modes. **Fix:** offset the first section's label past the door glyph, or measure the arrow's extent before placing the label.

**N4-m4. Two 54 px clocks print the same string while the 13 px line is the one that differs.** [carried, round-01 m1] Evidence in the carry-over table. On the current Deplane default the clocks are identical for 6:34 of a 16:16 race and the live gap is the only differing number on screen. **Fix:** swap them. The gap is the finding.

**N4-m5. The compare pool still leaves five workers idle for half the wall clock.** [carried, NEW3-m5] 53% of 16.13 s spent on the last 20%. **Fix:** chunk by seed range, not by strategy.

**N4-m6. The sensitivity slope labels come off their lines exactly where the lines converge, and one panel runs its axis backwards.**
In every panel the bottom two or three labels are pushed below their endpoints and no longer touch a line — in the Carry-ons panel four lines converge at "light" and five labels stack beneath, so you cannot tell which line is Reverse pyramid (`03d-sensitivity-crop.png`). Direct labelling fails precisely at the crossing, which is the interesting part. Separately, Carry-ons runs **heavy → default → light** while its three neighbours run low → high, so an upward slope means "worse" in three panels and "better" in the fourth. **Fix:** leader lines from label to endpoint, and run every axis in the same direction.

**N4-m7. The measured anchors are drawn in the same ink as the gridlines.**
`design/07-rankings.md:27` asks for anchors "styled unmistakably as measured, not simulated". On screen they are thin dashed gray verticals with italic gray labels stacked four deep above the axis, indistinguishable from chart furniture, and on phone the Schultz line passes straight through four simulated dots. Two further problems: KLM's published **range** 17–22 min is drawn as *two separate ticks* from one Forbes article, reading as two independent measurements; and the deplane tick is labelled "Schultz field · 6.7 min" when Schultz measured a **rate** (23 pax/min) and 6.7 is `passengerCount / 23` computed by `rankings-anchors.js:70`. The popover is excellent and says all of this; the ticks do not. **Fix:** give anchors their own visual class (a solid rule, a different weight, a small "measured" flag), draw KLM as one shaded band, and label the Schultz tick "Schultz 23 pax/min → 6.7 min here".

**N4-m8. The Rankings knobs are read-only.**
The tab renders a text strip, not controls; the settings sidebar is hidden on Rankings. `design/07-rankings.md:8` says "Settings column (right) stays; on the Rankings tab it shows the same knobs but each snaps to the nearest precomputed grid value". To change a knob a reader must go to Race, open the sidebar, drag a slider, and come back — the round-trip does work (load=1 correctly loads the `load=1` cell), so this is discoverability, not plumbing. 36 of your 62 cells are reachable only by accident. **Fix:** put the real sliders on the tab with snap-to-grid ticks.

**N4-m9. Every visit to the Rankings tab logs two 404s.**
`404 http://localhost:5197/data/rankings/index.json`, twice, on every load, at every viewport. The loader asks for `index.json`, falls back to `index-preview.json`, and does it twice. Graceful, but it is the only console noise in the project and it costs two round-trips before the tab can paint. **Fix:** have the preview build write `index.json` (with `preview: true` inside), or probe once.

**N4-m10. Tap targets under 44 px on phone.** [carried, round-02 NEW-m4] Last/Average 44x32 and 64x32, mirrored speed pips 32 px tall, Runs select 66x35, every info button 22x22, chime checkbox 16x16. The 22 px "i" buttons are the ones that matter — there are a dozen of them and they are the reader's only route to the glossary. Also: the hover histogram has **no touch equivalent**, so on a phone the histogram, n, p25 and p75 are unreachable entirely.

**N4-m11. The two heat ramps are drawn identically and never say they share a scale.**
`08-both-finished-heat.png`: under each cabin, "short ▬▬▬ long · Darker = longer aboard. Worst 28A 6:34; best 1D 0:45." Two identical unlabelled ramps under two cabins reads as per-cabin scaling, which is the opposite of what `applyHeatToBothLanes()` does and the opposite of the comparison you built. The shared maximum (16:17) appears nowhere on the ramp. Separately, "best 1D 0:45" prints identically under both cabins, which looks like a copy-paste fault. **Fix:** one ramp between the two cabins, with the real endpoints printed on it — `0:45` to `16:17`.

**N4-m12. Front to back at 40:08 is the number a domain expert will challenge, and nothing flags it.**
153 passengers in 40.1 min is **3.8 pax/min**, against a jet-bridge service ceiling of roughly 9–14 and a measured MythBusters back-to-front of 7.1 pax/min on 173 seats. It is 1.70x random, where Steffen 2008 and the boarding literature put the worst block orders nearer 1.3–1.5x. It is also 64% beyond the slowest anchor on the chart, and it is the value that sets the 60-minute axis (N4-M6). Your own anchors show the systematic version of this: **every one of the fourteen simulated airline procedures lands at or above Spirit's measured 20 min and mostly above KLM's 17–22 band.** The model runs slow at the tail and fast at the gate, and the page never says so. **Fix:** a line under the chart naming the model's range of validity, and treat the extremes as extrapolation rather than result.

### NIT

**N4-n1.** Seed roll is still base-36: `plane-2you`, `plane-9vlo`, `plane-23pe`, `plane-j94f`. (NEW3-n4, third round.)
**N4-n2.** No keyboard shortcut for the heat toggle or the tab rail; `h`, `m`, `t` do nothing. (NEW3-n2.)
**N4-n3.** The door-status slot still empties from door open to finish (`""`), so the line appears and vanishes.
**N4-n4.** The finish card's arithmetic and the aria-label disagree by a second: card "6:34, 9:43 ahead" implies 16:17; canvas aria says "finished at **16:16**"; the time-split says 16:17.
**N4-n5.** `glossary.js:76` still tells the reader Steffen is "in theory the fastest possible order" one tab away from a chart that ranks Reverse pyramid 1:18 ahead of it. One clause ("…though this model finds reverse pyramid faster once bags are slow") closes it.
**N4-n6.** The cell provenance line is developer output shown to a general reader: `Cell: deplane__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=200.` On phone it wraps to two lines of double underscores.
**N4-n7.** The site's own rename map says "Seeds → Runs", but the strip chart footer reads "7 strategies · **100 seeds** · 16.0s" while the picker above it says "Runs".
**N4-n8.** MythBusters (n=1, TV volunteers) sits in the measured-vs-assumed table in the same visual class as Schultz 2018 field data. The anchor popover is careful about this; the table is not.
**N4-n9.** Every sensitivity title repeats the knob name already in the panel heading directly above it ("How full" / "How full makes or breaks…"), and "makes or breaks" is doing duty for "has the largest effect on", which is not what the phrase means.
**N4-n10.** The family header sits on the axis baseline. Measured at 1280x900, boarding: axis labels `0m…40m` at `y=489`, "TEXTBOOK METHODS" at `y=496` ending about 10 px left of "0m". Same visual line, so the group label reads as an axis title.
**N4-n11.** Four stat tiles at identical size and weight means the page has four first-things. Nothing on the Rankings tab is emphasized — 23 identical dots, 5 identical lines per panel, no accent colour anywhere. The Race tab's strip chart, which greens exactly the two rows you are racing, is the model to copy.

---

## What would make me send it to a friend

1. **Print the punchline that is already in your data.** Eleven of fourteen airline procedures finish within 64 seconds of each other, and Random order finishes *inside* that band at 23:32. Scaled honestly, the entire global apparatus of zones, groups and cards buys about **1.0 person-year per day** over boarding at random, while switching to the best textbook method would buy **27.6**. "Your airline's boarding groups perform the same as boarding at random" is the sentence that gets forwarded. It costs one computed string. Highest value, lowest effort on this list.
2. **Fix the axis and the ties together.** Clip the chart to where the data lives, break the outlier out, and band the rows that cannot be separated. Those two changes turn a decorated table into a chart that argues, and they close N4-M4 and N4-M6 at once.
3. **Make the gap the big number.** Two 54 px clocks printing `2:11 / 2:11` while "26 passengers ahead" sits at 13 px is the hierarchy exactly inverted. Swap the type sizes and the Race tab suddenly has a payload instead of a stopwatch. One CSS change, four rounds overdue.
4. **The wager before the door opens.** Still unbuilt, still the best idea on the table. Twenty-five seconds of countdown, one click on "which plane empties first?", and a demo becomes something people finish.
5. **Let the Rankings tab be operated.** Real sliders with grid ticks, a click to lock a row's histogram instead of hover-only, and touch support. Right now the analytical core has one interactive control and a read-only caption, and 36 of its 62 cells are unreachable without a detour through another tab.

---

## Scores

**Truth: 6/10.** The engine is in much better shape than it was: the twin-aisle bias is gone and guarded on three widebodies, two doors no longer inverts, the false Steffen claim is deleted, the mid-race captions stopped lying, the config comments are genuinely exemplary, and the anchor popover names every source with a year and a link. What holds it at 6 is that the new analytical surface carries more honesty debt than the old one had: a knob label that misstates the data's provenance on eleven presets, a deck that says thousands over 200, a headline number whose label describes a different quantity than the arithmetic, three tiles that do not sum, a slope chart with a fabricated endpoint, a published calibration gate that is not the enforced one, and an assumptions table missing the three assumptions with the largest effect. Every one of those is a string or a rounding rule. None of them is hard. All of them are the kind of thing that, on a page whose stated standard is "every number honest", a reader only has to catch once.

**Clarity: 6/10.** The copy is the best part: plain, short, no jargon in a label, popovers a high-schooler can read, findings stated as sentences with computed numbers in them. The Race tab's finish is a genuinely good piece of design — two heat maps, a legible pill on the worst seat, a direct-labelled ramp, both cabins and the verdict in one frame. The Rankings tab undoes much of it: four equal-weight numbers so the eye has no first stop, an axis that renders 22 of 23 rows in a fifth of the frame, no emphasis anywhere, slope labels detached from their lines, group headers sitting on the axis baseline, and a finding sentence truncated mid-word on a phone. The charts are drawn with care and encoded without a decision.

**Delight: 7/10.** The default matchup is a knockout now and it is the right knockout — the policy the site is named after losing by two and a half to one. Following one passenger to the door, the personal-best margin that remembers which strategy earned it, the provisional finish card while the loser is still going, the green-highlighted racers in the strip chart, "Deplane this plane" carrying the boarded bins forward: these are all small and all good. What keeps it off an 8 is that the moment of victory is still narrated by the wrong number, the countdown is still dead air, and the single most shareable fact in the project — that fourteen airlines have collectively engineered their way to a tie with randomness — is sitting in a JSON file nobody will open.

REMAINING ABOVE NIT: 22
