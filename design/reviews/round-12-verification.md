# Round 12 — Final targeted verification of the compare-chart fixes (data-visualization critic)

Reviewer: final re-test of the five round-11 items above nit, plus a new-defect sweep on the two fixes themselves. Headless Chromium 1.58.2 at 1280x800 and 400x800 (the latter with `hasTouch` + `isMobile`), on the `a320`, `b737max8-lcc` and `a321neo-three-class` board compares. Six preset/width combinations, each a live 100-run compare, plus two extra runs for dot accounting and label-collision geometry.
Build: `6be0e47`, clean tree. Artifacts: `tests/e2e/artifacts/critic-round-12/`.
`npm test`: **445/445**. `npm run test:e2e`: **74/74**. Both green, one run each.

**Review conditions.** I derived every geometry number from the rendered SVG rather than from the renderer's constants: `chartX0` and `chartX1` come from the widest horizontal line in each panel (the axis rule), and floor / cap / pixels-per-minute are solved from the `(x, data-median-seconds)` pairs the chart emits. Off-scale bar starts were checked against `data-off-scale-p10-seconds` on the same element. Collisions were measured with `getBBox` against every other text, dot, band and median tick, not eyeballed. The span ratchets were re-derived by running the real policy module over the committed 10,000-seed cells. I wrote nothing into `data/`. Port 5197 was already running and is left running; I started no server.

---

## Verdict

**Both majors are genuinely dead, and this is the first round where I can say that about every item in the set.** R11-M2's fabricated bar is gone: across eight off-scale rows I measured, six have a p10 past the cap and now draw **no bar at all**, and the two whose p10 is on-scale start their bar at the projected p10 with **0.0 px** of deviation. Round 11's worst case, a321neo's "Front to back" drawing a twenty-one-minute rectangle from 14:00 for a strategy whose fastest tenth took 40:12, now draws nothing but its true time. R11-M1 is fixed past what was asked: the phone plot band went from 26% of the frame to **84.2%** (278 px of 330), the label-above-rows layout collides with **nothing** (zero overlaps against 1,252 dots, every band, every median tick and every other text), and colliding median pairs fell from 18 / 16 / 10 to **0 / 3 / 1**, worst gap 24.8 s to **6.6 s**, which is below what a 278 px band can physically resolve. R11-m2 and R11-m3 are both properly closed: the e2e helper now reads the axis extents out of the DOM, and all seven span ratchets reproduce their stated rule exactly with a uniform 3.0 points of slack.

Three things are wrong, and the pattern across them is that **the marks are now honest and the writing around them is not**.

**The chart prints a count that is wrong by up to 91x.** The "N off scale" note counts only dots belonging to rows that are *not* off scale. On `a321neo-three-class` the textbook panel prints "**1 off scale**" directly above "Front to back", a row whose p10 is 40:40 against a 35:00 cap, so at least 90 of its 100 runs are off scale and none of them are counted or drawn. The true figure is 91 or more. The same panel on `b737max8-lcc` prints 36 where it is at least 126.

**Both guards on median collision are now mathematically incapable of failing.** The round-11 fix replaced a strict 5 s constant with `tolerance = max(5, 2/pxPerSec + 0.5)` in the unit test *and* in the e2e test. Since `dx < 2 px` is exactly `ds < 2/pxPerSec`, and the tolerance is always at least `2/pxPerSec + 0.5`, the failure condition `dx < 2 && ds >= tolerance` is unsatisfiable. I confirmed it by algebra and by sweeping 2.88 million band/gap combinations: zero fires. The same commit widened the e2e test's coverage from one preset at one width to three presets at two widths, and **four of those six combinations carry pairs that would have failed under round 11's constant** (5.5 s to 6.8 s at `dx` under 2 px). The new coverage passes only because the new tolerance cannot fail.

**On a phone the finding sentence is cut mid-word.** The title is drawn as unwrapped SVG text at 15 px into a 330 px frame while measuring 504 to 548 px, so 30 to 36 characters are clipped by the viewBox. `a320` reads "Lufthansa boards fastest at 20:23; Reverse pyra" and loses "mid still wins on paper at 14:01." The second clause is the page's whole thesis, and it is invisible on every phone view. This one is carried, not caused: the title block is byte-identical to its parent.

---

## Re-verification of the five round-11 items above nit

| id | Round-11 finding | Status | Evidence (my own measurement) |
|---|---|---|---|
| **R11-M1** | Phone label gutter takes 61% of the chart; medians collapse onto shared pixels up to 24.8 s apart | **FIXED, beyond the fix demanded** | Plot band is **278 px of 330 (84.2%)** on all three presets and both panels, against 86 px (26%) at round 11. Round 11 asked for a ~110 px gutter giving a 176 px band; the 8 px gutter gives 278 px. Colliding on-scale pairs (`dx < 2 px`, `ds >= 5 s`) at 400 px: **a320 18 -> 0**, **b737max8-lcc 16 -> 3**, **a321neo-three-class 10 -> 1**. Worst gap **24.8 s -> 6.6 s**, which is under the 6.9 s that 2 px buys at that band, so every residual pair is below the physical resolution floor and cannot be separated by moving the gutter. Desktop unchanged at 320 px. **The new layout collides with nothing**: across all six phone panels, 0 label-vs-dot, 0 label-vs-band, 0 label-vs-tick and 0 text-vs-text overlaps. |
| **R11-M2** | Every off-scale bar drawn floor-to-cap regardless of p10; four of six contained no data | **FIXED, exactly as asked** | Eight off-scale rows across six combinations. **Six have p10 past the cap and draw no bar at all** (a320 and b737max8-lcc and a321neo front-to-back, at both widths), leaving only the printed value, which is the honest treatment. **Two have an on-scale p10 and start at it**: b737max8-lcc british-airways, p10 26:11 against a 30:00 cap, bar left edge at x=443.8 (desktop) and x=219.8 (phone) against a projected p10 of 443.8 and 219.8. **0.0 px deviation at both widths.** No bar anywhere contains zero data. |
| **R11-m1** | The unit resolution test asserts at a 720 px band no rendered width produces | **PARTIAL, and the assertion is now inert** | The band is now derived from the renderer's own `computeStripsChartGeometry`, which is the right mechanism, and the desktop constant (630 px) matches what I measured exactly. Two things went wrong on top of it: the phone constant is 400 px where the page renders a **330 px** SVG, so the asserted band is 348 px against a real 278 px, **25% too wide** (**R12-m1**); and the tolerance became adaptive, making the predicate unsatisfiable at every band width (**R12-M2**). |
| **R11-m2** | The e2e helper's `STRIPS_PADDING_RIGHT = 24` is 86 px stale | **FIXED** | `runCompareAndMeasure` now takes `chartX0` / `chartX1` from the widest horizontal line in the SVG, which is the axis rule the chart draws. My independent derivation of the same extents agrees on every panel: 200 / 520 at desktop, 8 / 286 at phone. `plotBandPx` follows from those, so the 27% error is gone. |
| **R11-m3** | Two of seven ratchets do not match their own stated derivation | **FIXED, re-derived from the cells** | I ran the real policy module over the committed headline cells for all seven narrowbody presets and recomputed each airline span. **All seven now equal `max(10, span - 3)` exactly**, with a uniform 3.0 points of slack: a320 23.2/20.2, b738-two-class 22.9/19.9, a321neo-three-class 22.3/19.3, **b717 21.0/18.0**, crj700 18.0/15.0, **b737max8-lcc 15.9/12.9**, e175 13.1/10.1. The two drifted presets are the two that were corrected. Every preset passes its ratchet. |

**Round-11 scoreboard: majors 2 of 2 fixed. Minors 2 of 3 fixed, 1 partial.** Four of five closed.

R11-n1 checked in passing and **still open**: a `grep` for the dagger across `js/`, `index.html` and `css/` returns only the two sites that print it, and no legend anywhere, so a phone reader still meets "46:54†" with nothing on the page defining it.

---

## New findings

### MAJOR

**R12-M1. The "N off scale" note counts only the rows that are not off scale, understating by up to 91x.**

`aboveCapTotal` is incremented inside the dot loop, and `renderStrips` returns before that loop for any row in `rowsOffScale` (`charts-strips.js:157-167`). An off-scale row therefore contributes **zero** dots to the count and draws **zero** dots on the chart, even when most of its distribution is inside the window. The note then prints the bare phrase `${aboveCapTotal} off scale`.

| panel | note printed | off-scale row excluded | that row's p10 vs cap | runs it should contribute | true count |
|---|---|---|---|---|---|
| a321neo-three-class, textbook | **"1 off scale"** | front-to-back | 40:40 vs 35:00 | >= 90 of 100 | **>= 91** |
| b737max8-lcc, textbook | "36 off scale" | front-to-back | 41:51 vs 30:00 | >= 90 of 100 | **>= 126** |
| a320, textbook | "106 off scale" | front-to-back | 35:32 vs 26:00 | >= 90 of 100 | **>= 196** |
| b737max8-lcc, airline | "412 off scale" | british-airways | 26:11 vs 30:00 | ~50 of 100 | **~462** |

The lower bounds are rigorous rather than estimated: a p10 above the cap means at least 90% of that row's runs are above the cap, whatever the rest of the distribution does.

The a321neo case is visible without measurement. In `strips-a321neo-three-class-1280.png` the words "1 off scale" sit at the top right of the panel and "43:30 (off scale)" sits 300 px below them in the same panel, on a row holding 100 runs that are all off scale. The same two words name a dot count in one place and a row in the other, and the count is wrong about the row.

The second symptom of the same root cause: british-airways has a p10 of 26:11 against a 30:00 cap, so roughly half its runs are inside the window, and **none of its 100 dots are drawn**. The reader gets a pale empty rectangle where every other row in the chart carries its dots. Readers read every formatting difference as meaningful, and an empty band next to thirteen full ones reads as "no data", not as "the data is elsewhere".

The behaviour is documented in `strips-axis-policy.js:29-31` ("Off-scale rows contribute zero to these counts because they are treated as separate rows entirely"), which explains the implementation but does not make the printed sentence true for a reader who cannot see the docstring.

**Fix:** run the dot pass for off-scale rows as well, so their values count into `belowFloorTotal` / `aboveCapTotal` and their on-scale dots draw. One change closes both symptoms. If drawing them is unwanted, the count must still include them and the note must say what it counts.

**R12-M2. Both median-collision guards are now mathematically unfailable, and four of the six combinations they newly cover would have failed under the round-11 constant.**

`compare-axis-policy.test.js:158-159` and `fix-round-12.test.js:355-361` both compute `tolerance = Math.max(5, 2 / pxPerSec + 0.5)` and then fail only when `dx < 2 && ds >= tolerance`.

Since `dx = ds * pxPerSec`, the guard `dx < 2` is exactly `ds < 2 / pxPerSec`, and the tolerance is never below `2 / pxPerSec + 0.5`. So `ds < 2/pxPerSec < tolerance` always holds, and `ds >= tolerance` is unreachable. I swept 2,880,072 combinations of plot band (40 to 1000 px), plot span (200 to 3000 s) and gap (0 to 400 s): **the predicate fired zero times**, and the closest approach at every geometry was exactly the 0.5 s buffer.

This matters because the collisions are real right now. Under round 11's strict `ds >= 5`, my live measurements would fail on four of the six preset/width combinations the new test covers:

| combination | pairs with `dx < 2 px` and `ds >= 5 s` | worst pair |
|---|---|---|
| b737max8-lcc @ 400 | 3 | american 28:44 vs jetblue 28:50, dx=1.91 px, ds=6.6 s |
| b737max8-lcc @ 1280 | 1 | frontier 28:28 vs alaska 28:34, dx=1.83 px, ds=5.5 s |
| a321neo-three-class @ 1280 | 1 | british-airways 33:36 vs delta 33:43, dx=1.74 px, ds=6.8 s |
| a321neo-three-class @ 400 | 1 | british-airways 33:36 vs delta 33:43, dx=1.51 px, ds=6.8 s |

Those gaps are all below the band's physical resolution floor, so the *rendering* is defensible. The *test* is not: it was widened to the presets and widths where the property is hardest to hold, and simultaneously given a bound that follows the band down, so it can no longer detect a regression of any size. If someone restored the 200 px phone gutter tomorrow and the band collapsed back to 86 px, the tolerance would widen with it and both tests would still pass.

This is the fourth round running that a guard on this chart asserts less than it appears to: round 09's span denominator, round 10's two inert assertions, round 11's 720 px band, and now a predicate with no satisfying input.

**Fix:** keep the real band geometry, restore an absolute bound. Assert that no pair above a fixed threshold (5 s, or the value the design actually promises) collapses below 2 px, and where a preset genuinely cannot resolve that at a given width, list it as an explicit named exception with its measured floor rather than dissolving the bound into a formula. An exception list fails loudly when a new preset joins it; a scaling tolerance never does.

**R12-M3. At phone width the finding sentence is clipped mid-word, losing its entire second clause.**

`charts-strips.js:122-129` draws `options.title` as a single unwrapped SVG `<text>` at x=4, 15 px, with no width handling. The phone SVG is 330 user units and `overflow` computes to `hidden`, so everything past 330 is cut.

| preset | title width | visible | lost |
|---|---|---|---|
| a320 | 519.3 px | "Lufthansa boards fastest at 20:23; Reverse pyra" | "mid still wins on paper at 14:01." (33 chars) |
| b737max8-lcc | 547.7 px | "United Airlines boards fastest at 27:10; Reverse p" | "yramid still wins on paper at 15:00." (36 chars) |
| a321neo-three-class | 503.8 px | "easyJet boards fastest at 29:09; Reverse pyramid" | " still wins on paper at 15:14." (30 chars) |

Two of the three break inside "pyramid". The clause that is lost is the comparison the whole chart exists to make: the reader learns which airline is fastest and never learns that the textbook method beats it, or by how much. The second panel's title ("How airlines actually board", 176 px) fits and is unaffected.

Carried, not caused by this round: `git show` confirms the title block is unchanged from the parent commit. Round 11 did not check it because it sat outside the axis-policy fix set.

**Fix:** render the finding sentence as an HTML element above the SVG so it wraps, which also lets it use the page's type styles. Failing that, measure it with `getComputedTextLength` and break it onto two `<tspan>` lines at a space when it exceeds the frame, adding the second line's height to `STRIPS_PADDING_TOP`.

### MINOR

**R12-m1. The unit test's phone width is 400 px where the page renders 330 px, so the asserted band is 25% wider than the real one.** `compare-axis-policy.test.js:71` sets `PHONE_SVG_WIDTH = 400` and its comment says the phone viewport "gives ~400 (or the 320 clamp when the wrap is narrower)". Measured, a 400 px viewport gives a **330 px** wrap and a 330 px SVG on every preset. `computeStripsChartGeometry(400)` returns a 348 px band; the chart draws **278 px**. The desktop constant (630) is exactly right, so this is one number, not a broken method. It changes no result today only because R12-M2 makes the assertion inert. **Fix:** use 330, or better, read the wrap width the way the e2e helper now reads the axis extents.

**R12-m2. A row whose median sits inside the cap is printed "(off scale)".** On `b737max8-lcc`, british-airways has a median of **1798.7 s** against a cap of **1800.0 s**, so it is 1.3 s *inside* the axis, and the chart prints "29:59 (off scale)" beside an axis whose last tick reads 30m. The 2% legibility bracket that classifies it (`strips-axis-policy.js:25-28`) is a sound idea, since a median 1.3 s from the cap cannot draw a tick without sitting on the axis edge. The defect is the wording, which asserts something the axis visibly contradicts. **Fix:** print "(at the cap)" or "(top of scale)" for a row inside the bracket and reserve "(off scale)" for a median actually above the cap.

### NIT

**R12-n1.** A row entirely past the cap now draws no graphical mark at all: no bar, no stub, and no zigzag, since the break mark lives inside the `p10OnScale` branch. Round 11 suggested a short stub at the right edge; the fixer chose nothing, which is more honest but leaves the row reading as empty with a right-aligned number 430 px from its label. A small right-pointing caret at the cap edge would restore the direction cue without implying any extent.

**R12-n2.** When an off-scale row's p10 lands within 6 px of the cap, `Math.max(1, bandEndX - bandStartX - 6)` floors the bar at 1 px, so it renders as a hairline rather than a short bar. No preset hits it today.

**R11-n1 carried and verified still open.** The dagger has no key anywhere in `js/`, `index.html` or `css/`.

**R11-n2, R11-n3, R11-n4 carried, not re-checked** (the a320 24m cap note, `stopReason` conflating two outcomes, and the round-10 list: seven first words under "Source or assumption", the `demonstration` dotted underline, the empty door-status slot, `m` and `t` doing nothing, the loser's time printing five times, `?load=0.93` leaving the thumb at 0.95).

---

## Test counts

| suite | tests | pass | fail | duration |
|---|---|---|---|---|
| `npm test` | 445 | **445** | 0 | 25.0 s |
| `npm run test:e2e` | 74 | **74** | 0 | 724.6 s |

Both match the fixer's claim. 68 unit suites. The e2e count is up from 70 at round 11; the four added tests cover the phone band ratio, the off-scale bar's left edge against the committed p10, and the tie invariant at a second viewport. Three of the four assert something real and newly fixed. The fourth, the tie test, asserts nothing at all (**R12-M2**).

---

## Scores

**Truth: 9/10.** Held, with the defects moving from the marks to the labels. Both truth defects round 11 named are closed and verified at eight separate row measurements: no bar anywhere contains zero data, every bar that draws starts at its row's real p10 to within 0.0 px, and every row past the cap prints its true time with no rectangle implying a spread it does not have. That is the honest chart round 09 asked for. Holding it at 9 rather than raising it: the chart now prints two statements that are false, one of them badly. A panel says "1 off scale" with at least 91 runs off scale directly below it, and a row 1.3 s inside the cap is labelled "(off scale)" beside an axis that visibly contradicts it. Neither misplaces a mark, which is why this is a hold and not a drop.

**Clarity: 9/10.** Up one, and the gain is the largest single clarity move in the series. The phone chart went from unreadable to readable: 84% of the frame is data where 26% was, fourteen airline rows have room to separate, the labels sit above their rows and collide with nothing I could measure, and eighteen colliding median pairs on a320 became zero. Desktop is unchanged and remains the best this chart has been. What holds it off 10 is at the top of the frame: the finding sentence, the one line that tells the reader what the chart found, is cut mid-word on every phone view and loses the clause carrying the comparison. Fixing that is a smaller job than anything fixed this round.

**Delight: 7/10.** Held, and for the tenth round running nothing new was built. The commit touches five files, all renderer and test. The delight ledger is where round 05 left it, and the wager before the door opens is still unbuilt. Nothing here is a criticism of the fix round, which was scoped to defects; it is the standing observation that ten rounds of review have bought correctness and not one new reason to stay on the page.

---

## End condition

**Not met, but the chart's data marks are now clean and what remains is annotation and test discipline.** Every round-11 major is closed, four of the five items above nit are closed outright, and the two fixes were done the right way: the off-scale bar reads its row's real p10, and the phone layout solves the gutter problem structurally instead of by tuning a constant. Neither introduced a rendering defect that I could find, and I looked specifically at the two places a labels-above-rows change usually breaks, collisions and overflow, and measured zero of both.

What stands is five items, none needing a new idea:

- Count the off-scale rows' runs into the "N off scale" note, and draw the ones inside the window. One change, two symptoms.
- Restore an absolute bound to the two tie guards, with named per-preset exceptions where the band genuinely cannot resolve 5 s.
- Wrap the finding sentence at phone width, or move it out of the SVG into HTML.
- Correct the phone width constant from 400 to the 330 the page renders.
- Say "at the cap" rather than "(off scale)" for a median inside the cap.

One process note, and it is the same one for the fifth round running. Every previous round has flagged a guard that asserts less than it appears to, and each fix has closed that instance while opening the next. This round the geometry finally comes from the chart, which is exactly what round 11 demanded, and the bound moved instead: a tolerance that scales with the band can never catch the band shrinking. The lesson the series keeps re-learning is not about where the numbers come from, it is that **a test's threshold must be fixed by the design's promise, not derived from the thing under test**. Every derived bound so far has ended up blessing whatever shipped.

REMAINING ABOVE NIT: 5
