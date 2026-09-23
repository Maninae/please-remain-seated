# Round 07 — Critic pass (data-visualization critic)

Reviewer: adversarial data-vis review, headless Chromium 1.58.2 at 1280x800, 1280x900, 1440x900 and 400x800 (and 400x800 with `hasTouch`, which turned out to matter).
Build: `index.html` at `c30ae4e`. Artifacts: `tests/e2e/artifacts/critic-round-07/`.
`npm test`: **426 pass / 0 fail** across 68 suites. `tests/e2e/fix-round-09.test.js` + `fix-round-10.test.js`: **13 pass / 0 fail**.

**Review conditions.** The full precompute is still running (PID 72479, 745% CPU, 89 cell files on disk). It is still the pre-fix binary: `data/rankings/index.json` was rewritten two minutes before I started, and it still advertises all **62 cells with no `pending` key while 37 of them do not exist on disk**. So the live tree throws **9 cell 404s** on a Rankings visit and recovers through the preview fallback. I reviewed on three trees, writing nothing into `data/`:

| port | tree | what it shows |
|---|---|---|
| 5197 | the repo as served | the live state: 10,000-seed headline cells, 9 sensitivity 404s per visit |
| 5296 | scratch symlinks with `index.json` omitted | the complete 200-seed preview set, all 13 presets |
| 5297 | scratch tree with a real `{cells: 25, pending: 37}` index | what the **fixed** precompute will write mid-run |

---

## Verdict

The fix round did the hard half and then tripped over the same wire twice. Take the good first, because it is substantial and it is the expensive kind. The clamp is gone and the thesis row now prints the truth with a direction word: the 737-800 two-class says "Average airline vs random order — **19.2 person-years / day worse**", and I recomputed all thirteen presets from the cell files and every signed value matches to a tenth. The hero sentence on the losing presets has grown a spine: "Every one of 14 airline procedures boards A321neo three-class slower than random order (mean airline 6:07 worse)." The citation is not merely patched, it verifies: Wald, Harmon and Klabjan 2014, JATM 36:101-109, DOI and ScienceDirect PII both resolve to that paper, the 15-to-17 pax/min line is verbatim in it, and the 8.5-to-9.6 minute figure is now labelled derived, which is exactly what it is. Politeness is re-tagged `assumption` and says out loud that the yielding parameter is unverified. The anchors have their headroom back: zero clipped glyphs at 1280, 1440 and 400. The break mark fires on `> paddedMax` now, and I checked every row on 26 preset-mode pairs: 29 rows sit in the old dead band and 29 carry the mark. Board mode finally finds a last passenger, so "Where the time goes" reads "Random order · last seated" instead of averaging under a caption that said the plane was empty. The finish card's arithmetic closes: 6:48 plus 8:20 is 15:08, and the clock, the canvas aria label and the time-split all say 15:08. The compare pool's tail went from 53% of the wall clock to 32%, and the whole run from 16.9 s to 12.1 s. The info buttons are 58x58 on a touch device, which I only found because I stopped trusting `getBoundingClientRect` and asked the browser what it would actually hit. Ten sensitivity panels, zero label collisions, and the finer ceiling ladder took the worst board panel from 39% of its frame to 60%. That is a real round.

Now the wire. **The N6-B1 fix throws.** `rankings-data.js:271` carefully guards `if (primary && primary.file)` and writes a comment explaining that primary may be null on a partial index; eleven lines later, `rankings-data.js:282` reads `primary.knobs` unconditionally. On the partial tree, switching from a preset the index has for deplaning to a mode it does not have, the page raises an uncaught TypeError, `rerender` dies mid-flight, and the reader is left with a Boarding toggle lit over a 30 px headline reading "Both doors deplanes 787-9 three-class in 6.0 min", deplaning tiles, a "10,000 runs per strategy" footnote, a deplaning chart, an aircraft menu that has silently reset itself to CRJ-700, and no status line at all. Round 6 at least got told "No precomputed cell for board on a320." This is three lies in three controls and one crash. And there is an e2e test named `N6-B1: partial-index board a320 clears every part of the tab on mode toggle` that passes — because `fix-round-09.test.js:120` routes `index-preview.json` to a **404**, so `loadPreviewIndex()` returns null, the `if (previewIndex)` block never runs, and the crashing line is never reached. The real site ships that file and always will; it is the whole basis of the fallback. The test guards the bug by deleting the condition that causes it.

The second wire is the one I did not expect. The strip-chart floor from N6-m1 landed, and it landed on **one of the two stacked panels**. Board compare draws textbook methods on a 0m-to-60m axis at 6.77 px per minute, and directly underneath, under a heading that says "How airlines actually board", it draws the airline procedures on a 12m-to-45m axis at **12.30 px per minute**. Same quantity, same cabin, same seeds, same dot styling, same width, stacked, and the lower half is drawn at **1.82 times** the scale of the upper half. Nothing says so except two rows of tick labels and a 10 px italic note. This is the site's central comparison — textbook versus airline is the entire thesis — and a reader's eye does that comparison whether or not it is invited to. Round 5 already solved this exact problem for the two heat ramps and made them print "Both cabins share this scale." The lesson did not travel one tab.

And a smaller one, which is the same bug round 6 named and the fix half-caught. The caveat is genuinely computed now: it reads the cell's passenger count, its own front-to-back rate, its own fastest airline, and it drops the anchor clause on cabins that draw no anchors. All correct. But the comparison **word** is still a literal at `index.js:682`: "Front-to-back runs **slower** here than the MythBusters back-to-front field test: about 13.2 pax/min in the sim, against ~7 pax/min measured on TV." Thirteen point two is not slower than seven. That sentence is false on **six of thirteen presets**, including the Boeing 777 that round 6 pointed at by name.

The truth surface is much better than it was. It is still not sound, and two of the three remaining defects were manufactured by this round's fixes, which is now the pattern three rounds running.

---

## Re-verification of every round-06 finding

| id | Round-06 finding | Status | Evidence |
|---|---|---|---|
| **N6-B1** | Partial index prints a deplaning finding under a lit Boarding toggle | **STILL BROKEN — NOW A CRASH** | `rankings-data.js:282` reads `primary.knobs` after `:271` established primary may be null. Repro on 5297, `?tab=rankings&mode=deplane&preset=b789-three-class` then one click on Boarding: `[PAGEERROR] Cannot read properties of null (reading 'knobs')`. After the click the hero still reads "Both doors deplanes 787-9 three-class in 6.0 min; One row at a time takes 12.2 min.", tiles 705 / 1,409 / 704 / 33.5 labelled "Best · deplaning", footnote "10,000 runs per strategy", chart still the 7 deplane rows. **New damage vs round 6:** the aircraft select silently reset to **CRJ-700** (a third control now disagrees), and the "No precomputed cell" status line is **gone**. Fixed sub-part: `aria-checked` is now correctly `true`/`false`. Escalated as **N7-B1**. Screenshot `b1-02-partial-after-board-click.png`. |
| **N6-B2** | Four board presets print 0.0 for a non-zero, unfavourable difference | **FIXED** | `Math.max(0, …)` gone; `buildSignedComparisonRow` carries the direction in a word. Verified against my own arithmetic over the cell files, all four rows, five presets: 737-800 two-class **19.2 worse** (computed −19.2), A321neo three-class **31.4 worse** (−31.5), 737 MAX 8 LCC **15.7 worse** (−15.7), A320 **1.6 better** (+1.6), CRJ-700 **0.2 better** (+0.2). Hero sentences on losing presets now say so outright. |
| **N6-M1** | Milne and Salari citation wrong three ways | **FIXED** | Verified against primary sources. `about.js:84` and `README.md:69` both credit "Wald, Harmon and Klabjan 2014, JATM 36:101-109, doi 10.1016/j.jairtraman.2014.01.001"; the DOI and PII S0969699714000027 both resolve to that paper; ">40% reduction on a full aircraft" is verbatim in it; the 15-17 pax/min line is verbatim. Politeness re-tagged `assumption` with an honest source string. The 8.5-9.6 min figure now says "a derived figure rather than one they measure directly". README no longer contradicts itself on the year. Two *different* citation errors surfaced in `design/02-research.md`: see **N7-m1**. |
| **N6-M2** | Hard-coded A320 caveat printed on all thirteen presets | **PARTIALLY FIXED** | `composeChartCaveat` now reads `passengerCount`, the cell's own back-to-front rate, its own fastest airline, and calls `anchorsFor()` so the Spirit clause is dropped where no anchor is drawn. CRJ-700 now reads "58-passenger cabin … about 8.0 pax/min … The fastest simulated airline procedure, Lufthansa, lands at 8.5 min. No airline field anchor sits on the chart for this cabin." Correct. **Not fixed:** the word "slower" at `index.js:682` is still a literal and is false on six presets. See **N7-M1**. |
| **N6-M3** | Anchor labels clipped, one of three at desktop, two of three on phone | **FIXED** | `anchorRowOffsetsForWidth` + padding derived from `max(rowOffsets)`. Measured `getBBox()` against the viewBox on four presets at three widths: every anchor `bboxTop` between 30 and 54, **zero clipped pixels, zero fully-above labels**. Phone drops to one row and draws only KLM. That introduces **N7-M3**. |
| **N6-M4** | Rows past the cap but under 1.25x drawn at the edge with no break mark | **FIXED** | `rankings-chart.js:122` `outlierThreshold = paddedMax`. Swept 13 presets x 2 modes x 2 trees: **29 rows land in the old 1.0-1.25x dead band and all 29 carry the break mark and the "(off scale)" value** (E175 15:48, B717 31:44, B787 32:58, B767 23:18, …). The one row I first flagged (A321neo three-class 44:02) sits inside `paddedMax`; the tick ladder just stops short of it, which is **N7-m4**, not this. |
| **N6-M5** | Board-mode time-split can never find a last passenger | **FIXED** | `time-split.js:69` uses a mode-aware predicate (`phase === 'seated'` for board). At a finished board race: "Random order · **last seated** total 18:59 | waiting to board 14:37 …". The string "nobody seated yet" appears nowhere in the page text at any point I sampled. |
| **N6-m1** | Race strip chart has no floor and no cap | **PARTIALLY FIXED, AND IT INTRODUCED A DEFECT** | `computeStripsFloor` exists and fires on the **airline** panel ("axis starts at 12m", 12.30 px/min) but not on the **textbook** panel above it (0m-60m, 6.77 px/min), because the 25%-of-cap gate fails there. Two stacked panels of the same quantity at a 1.82x scale ratio: **N7-B2**. The cap half is untouched: `charts-strips.js:73` still silently clamps with `Math.min(1, …)` and there is no off-scale mark anywhere in the module: **N7-m2**. |
| **N6-m2** | Deplane ranked chart still starts at zero | **PARTIALLY FIXED** | The 4-minute gate relaxed to 2 minutes. A320 deplane now "axis starts at 2m", empty-left **34.2% → 25.6%**. Still starting at 0m with no floor note: **CRJ-700 (32.3% empty), E175 (17.9%), 737 MAX 8 LCC (28.5%)**. See **N7-m3**. |
| **N6-m3** | Tie caption names a rule that does not exist in that mode | **FIXED** | The "a different set: airlines within a minute of random" clause is now conditional. Present on A320 and CRJ-700 (where the finding does count that set), absent in deplane mode and absent on 737-800 two-class / A321neo three-class / 737 MAX 8 where `composeFinding` returns the negative sentence. |
| **N6-m4** | "axis from Nm" note overlaps the first x-axis label | **FIXED** | Measured every text-pair bbox intersection in all ten sensitivity panels, both modes: **zero overlaps**. Round 6's 16.0 px, 13.2 px, 1.9 px and 1.7 px collisions are gone. |
| **N6-m5** | Compare pool leaves the tail on one core | **FIXED** | `worker.js` now takes a `shardId` and a seed chunk; the pool fans strategy-x-chunk shards. 10 cores, 100 runs, deplane a320: deciles at 1.32 / 2.49 / 3.78 / 4.98 / 6.00 / 6.69 / 7.29 / 8.28 / 9.51 s, done at **12.09 s**. Last 20% = 3.82 s = **32%** of wall clock (round 6: 53%). Total run 16.9 s → 12.1 s. |
| **N6-m6** | Tap targets under 44 px on phone | **FIXED** | `css/sidebar.css:307` `.info-btn::after { inset: -11px }` under `(hover: none) and (pointer: coarse)`. Probed with `elementFromPoint` on a real touch context after scrolling each control into view: info buttons hit **58x58**. Census of every visible interactive control at 400x800 with touch: **rankings 0 of 21 under 44 px**, race 3 of 56, about 22 of 25 — and every one of those 25 is an inline prose link inside a sentence, 34-37 px tall and full-bleed wide, which is the documented exception. Closed. |
| **N6-m7** | Rankings knobs read-only | **FIXED** | `rankings-settings.js` mounts six `<select>` elements inside `#tab-panel-rankings`, visible at 400 px, each stepping through grid values with a "grid values only" popover. Changing one re-renders the cell. |
| **N6-m8** | `config.js` documents a gate that moved and arithmetic that does not hold | **FIXED** | `:33` now reads `[14, 27]`, matching `calibration-deplane.test.js:21`. `:65` now reads "45 s is **below the low end** of the one-to-three minute field range", which is true, instead of claiming it sits inside it. |
| **N6-m9** | Sensitivity ceilings snap to a coarse ladder | **FIXED** | `niceCeiling`'s step list is now `[1,2,3,5,8,10,12,15,18,20,22,25,28,30,…]`. Series extent against the 122 px plot band (200 minus 44 top minus 34 bottom): board **75 / 61 / 65 / 65 / 60%** (round 6: 69 / 59 / 49 / 46 / 39%). Worst panel nearly doubled. Deplane runs 46-79%. |
| **N6-n1** | Door-status slot empty and hidden | **STILL BROKEN** | Both `.door-status`: `textContent === ""`, `offsetParent === null`, at the finish, both lanes, both modes. |
| **N6-n2** | `m` and `t` do nothing | **STILL BROKEN** | `m` and `t` both leave `body.dataset.tab === 'race'` and the mode unchanged. |
| **N6-n3** | Finish card and clock disagree by a second | **FIXED** | Deplane: card "6:48, 8:20 ahead" → 15:08; clocks 6:48 / **15:08**; canvas aria **15:08**; time-split total 15:08. Board: 18:12 + 3:22 = **21:34**, matching all three. Exact in both modes. |
| **N6-n4** | The margin prints four times at the finish | **STILL BROKEN, slightly worse** | Deplane finish: `15:08` **5x**, `6:48` **4x**, `8:20` **4x**. Board finish: `21:34` 5x, `3:22` 4x, `18:12` 4x. |
| **N6-n5** | `data-kind` styled by nothing | **FIXED** | Four distinct computed treatments on `td:last-child`: assumption = italic on a tinted ground, estimate = italic at 0.72 ink, derived = upright at 0.72 ink, measured = upright at full ink. Measured and assumed are now visually separable. MythBusters is still tagged `measured`, but its source cell now reads "(n=1, TV volunteers)". |
| **N6-n6** | Four vocabularies under a two-word header | **STILL BROKEN** | First words in the "Source or assumption" column across 16 rows: `Assumption`, `Derived`, `Estimate`, `Schultz`, `Wald`, `Steffen`, `MythBusters`. |
| **N6-n7** | Phone row labels ellipsize | **STILL BROKEN** | 400 px, board a320: the same six of 23 — `Steffen, in bl…`, `Window, middle…`, `Back to front,…`, `Southwest (202…`, `American Airli…`, `Hawaiian Airli…`. Each carries a `<title>` with the full string, which is a hover affordance on a device that cannot hover. |
| **N6-n8** | Two shaded tie bands, one caption | **STILL BROKEN** | CRJ-700 board: **2** shaded rects at `fill-opacity 0.08`, one caption ("The 14 shaded airline procedures…"). A320 board: **3** shaded rects (the 0.045 airline-family ground plus two 0.08 tie bands), one caption. |
| **N6-n9** | Upward relaxation pass unreachable | **FIXED** | `rankings-sensitivity.js:229` adds an explicit `plotBottomLimit` clamp on the last label before the upward pass, so the pass has a reachable trigger and the comment now describes what the code does. |
| **N6-n10** | `void headlineCellData;` sits after `return` | **FIXED** | `index.js:243` now precedes `return result;` at `:244`. |
| **N6-n11** | Desktop hover panel reserves a 1000x66 dashed empty box | **FIXED** | The hover slot is now a single 708x17 line of text, "Hover a row to see its histogram." No dashed box, no reserved block. |
| **N6-n12** | Preset menu built across both modes | **FIXED** | `populatePresetSelect(indexObject, mode)` is called on load and whenever the mode changes, so the menu only lists presets the current mode can answer. |

### Older carry-overs

| id | Finding | Status | Evidence |
|---|---|---|---|
| **round-02 NEW-M3** | Race controls below the fold at 1280x800 | **UNCHANGED, fourth round** | `#race-controls` `top: 756, bottom: 816` in an 800 px viewport. Clipped by **16 px**, byte-identical to rounds 5 and 6. |
| **round-03 NEW3-n5** | Strip chart axis runs past the data | **PARTIALLY FIXED** | Folded into **N7-B2** / **N7-m2**: the airline panel earned a floor, the textbook panel did not, and neither has a cap. |

**Round-06 scoreboard: 1 blocker fixed, 1 still broken and now throwing. Majors: 3 fixed, 1 partial, 1 fixed-with-new-defect. Minors: 6 fixed, 2 partial, 1 of those introducing a new blocker. Nits: 6 fixed, 6 still open.**

---

## New findings

### BLOCKER

**N7-B1. The N6-B1 fix dereferences the null it was written to handle, and its e2e guard passes only because the fixture deletes the file that triggers it.**

`js/ui/rankings/rankings-data.js`:

```js
:271   if (primary && primary.file) {        // guard: primary may be null
:281   if (previewIndex) {
:282     const previewSamePrimary = findExactCell(previewIndex, mode, preset, primary.knobs);
```

Line 271 establishes that `primary` can be null and the comment above it says so explicitly ("primary may be null when the caller finds no exact match in the index"). Line 282 then reads `primary.knobs` with no guard. The only thing standing between those two lines is `if (previewIndex)` — and `index-preview.json` is a committed file that the real site always serves, so the branch always runs.

Repro on the partial tree (5297, a genuine `{cells: 25, pending: 37}` index built from what is actually on disk). `b789-three-class` has a deplane cell and no board cell, which is exactly the mid-run state:

```
?tab=rankings&mode=deplane&preset=b789-three-class   →   click Boarding
[PAGEERROR] Cannot read properties of null (reading 'knobs')
```

| element | what it says after the click |
|---|---|
| mode toggle | **Boarding**, lit, `aria-checked="true"` |
| aircraft select | **CRJ-700** (silently reset; the reader never chose it) |
| status line | **absent** — round 6 at least printed "No precomputed cell for board on a320" |
| hero sentence, 30 px | "**Both doors deplanes 787-9 three-class in 6.0 min; One row at a time takes 12.2 min.**" |
| deck | "Every strategy, run **10,000** times for this cell" |
| four tiles | 705 / 1,409 / 704 / 33.5, labelled "Best · **deplaning**", "Worst · **deplaning**" |
| footnote | "**10,000 runs per strategy**, load 85%, …" |
| ranked chart | the seven **deplane** rows, Both doors through One row at a time |

Three controls now disagree with the content instead of two, and the accessibility tree confidently asserts the wrong one. `rerender()` is `async`, so the throw becomes an unhandled rejection: `renderNoCell`, `renderTop`, `renderHeroFinding`, `renderStats` and `renderChartCaveat` never run, and everything from the previous mode survives untouched.

The part that should worry you more than the crash: **`tests/e2e/fix-round-09.test.js:276` is a test named after this exact finding, it asserts every one of the right things, and it passes.** At `:120` the fixture does this:

```js
await context.route(/\/data\/rankings\/index-preview\.json$/, (route) => route.fulfill({ status: 404, body: '' }));
```

With the preview index 404ing, `loadPreviewIndex()` returns null, the `if (previewIndex)` block is skipped, and line 282 is never evaluated. The test exercises a world in which the bug cannot happen. Round 6's closing process note asked you to add tests so this class of regression stops; the test got added and it certifies the crash as fixed.

**Fix:** three things, in this order. (1) `const previewSamePrimary = primary ? findExactCell(previewIndex, mode, preset, primary.knobs) : null;`. (2) Change the fixture to serve a real preview index, because that is what production does — a fixture that removes a shipped file is not a partial-index fixture, it is a different bug's fixture. (3) On the genuine no-cell path, clear the hero, tiles, comparison rows, sub-line and footnote, restore the status line, and leave the aircraft select showing the preset the reader actually picked.

**N7-B2. The board compare chart draws its two stacked panels at different scales, and the two panels are the two halves of the site's thesis.**

`Run it 100 times`, board mode, A320, 1280x900. The result is two strip panels, stacked, identical row layout, identical dot styling, identical width, the lower one headed "How airlines actually board":

| panel | rows | axis ticks | floor note | scale |
|---|---|---|---|---|
| 0 (textbook) | 9 | `0m 15m 30m 45m 60m` | **none** | **6.77 px per minute** |
| 1 (airlines) | 14 | `20m 30m 40m` | "axis starts at 12m" | **12.30 px per minute** |

**Scale ratio 0.550.** The lower panel is drawn at 1.82x the horizontal scale of the upper one. A dot 60 px right of its neighbour means 8.9 minutes on top and 4.9 minutes below.

Both panels are the same measurement — minutes to board the same 153-passenger cabin over the same 100 seeds — and the page stacks them under a heading that explicitly invites the comparison. Position is the entire encoding in a strip chart. The only disclosure is two rows of 10 px tick labels and one 10 px italic note, against a layout that shouts "same axis" in every other respect.

This was manufactured by the N6-m1 fix. `computeStripsFloor` gates on `minVal >= paddedMax * 0.25`. The textbook panel's slowest runs push `paddedMax` to 60 minutes, so its fastest value (11.5 min) fails the gate and the floor silently returns 0; the airline panel's tighter spread clears it. One shared helper, two different answers, no code aware that the two answers sit 400 px apart on one page.

Round 5 already fixed this exact failure for the two heat ramps (N5-m6) and made each caption say "**Both cabins share this scale.**" The standard exists in this repo. It did not travel one tab.

**Fix:** compute one `{paddedMin, paddedMax}` across every series in the whole compare view and pass it to both panels; the family split is a grouping, not a rescaling. If you ever genuinely want per-panel scales, say so in the caption the way the heat ramps do.

Evidence: `strip-board-crop.png`.

### MAJOR

**N7-M1. "Front-to-back runs slower here than the MythBusters field test" is a literal, and it is false on six of thirteen presets.**

`index.js:682` computes the rate and hard-codes the verdict:

```js
parts.push(`Front-to-back runs slower here than the MythBusters back-to-front field test: about ${b2fRate.toFixed(1)} pax/min in the sim, against ~7 pax/min measured on TV.`);
```

Computed from each preset's own cell, board mode, defaults:

| preset | pax | back-to-front median | sim rate | vs ~7 pax/min | sentence says |
|---|---|---|---|---|---|
| 787-9 three-class | 258 | 19:35 | **13.2** | faster | slower ✗ |
| Boeing 777 | 306 | 25:06 | **12.2** | faster | slower ✗ |
| Boeing 767 | 167 | 14:10 | **11.8** | faster | slower ✗ |
| Boeing 787 | 230 | 20:45 | **11.1** | faster | slower ✗ |
| E175 | 65 | 8:04 | **8.1** | faster | slower ✗ |
| CRJ-700 | 58 | 7:14 | **8.0** | faster | slower ✗ |
| A320 / 737 | 153 | 26:05 | 5.9 | slower | slower ✓ |
| 737-800 two-class | 146 | 23:40 | 6.2 | slower | slower ✓ |
| (the other 5) | | | 5.5-6.8 | slower | ✓ |

On the 787-9 the page prints "runs **slower** … about **13.2** pax/min in the sim, against **~7** pax/min measured on TV" in one sentence. The reader does not need the chart to catch this one; the two numbers are four words apart.

This is round 6's N6-M2 with the arithmetic fixed and the claim left behind. Everything else in that sentence now reads the cell. This clause reads a constant.

**Fix:** `const verdict = b2fRate > 7 ? 'faster' : 'slower';` and drop the clause entirely when the two rates are within a rounding width of each other.

**N7-M2. Nothing on the Rankings tab writes to the URL, so the share link points at a different chart than the one on screen.**

| action | URL before | URL after |
|---|---|---|
| aircraft A320 → Boeing 777 (chart updates, finding updates) | `?tab=rankings&mode=board&preset=a320` | `?tab=rankings&mode=board&preset=a320` |
| Boarding → Deplaning (chart updates, finding updates) | `?tab=rankings&mode=board&preset=a320` | `?tab=rankings&mode=board&preset=a320` |
| then click the About tab | — | `?tab=about&mode=board&preset=a320` |

The Race tab does this correctly: its mode toggle rewrites the query string in full, down to `bag0`/`bag1`/`bag2`. The Rankings tab reads `?mode=` and `?preset=` on load and then never writes them again. So a reader who lands on the default A320 board chart, explores to the Boeing 777 deplaning ranking — a genuinely different and more interesting chart — and copies the address bar, hands their friend the A320 board chart. Worse, the stale values are laundered into the URL by the *next* tab click, so they look deliberate.

Six knob selects were added to this tab this round, and none of them round-trip either. `js/main.js`'s own docstring says a knob that is not in the URL list breaks the share-link contract.

**Fix:** have the Rankings rerender push `mode`, `preset` and the five knobs through the same URL writer the Race tab already uses.

**N7-M3. On phone the caveat cites two measured anchors the phone never draws.**

At 400x800, board A320, the chart draws exactly one anchor: `KLM 737 · 17 to 22 min`. Underneath it the caveat reads, in full:

> "… Front-to-back runs slower here than the **MythBusters** back-to-front field test: about 5.9 pax/min in the sim, against ~7 pax/min measured on TV. Every simulated airline procedure lands at or above the **Spirit 20-minute anchor**; the fastest, Lufthansa, sits at 20.7 min."

Neither the Spirit tick nor the MythBusters tick exists on a phone. `composeChartCaveat` asks `anchorsFor({ mode, preset, passengerCount })`, which is viewport-blind, while `anchorRowOffsetsForWidth(width)` drops the phone to a single row. Round 6's N6-M2 fix correctly taught the caveat to drop the anchor clause on presets that draw no anchors; the N6-M3 fix then created a second way for an anchor to be absent, and the caveat does not know about it.

This is the same defect class as the round-5 blocker and round 6's N6-M2: a sentence the reader can refute against the chart directly above it. It is a MAJOR rather than a BLOCKER only because it is 12 px and phone-only.

**Fix:** pass the anchors actually drawn back out of `renderRankingsChart` and compose the caveat from those, not from a second independent call to `anchorsFor()`.

### MINOR

**N7-m1. `design/02-research.md` carries one fabricated figure and one wrong author, on the file the repo treats as its source of record.** Verified against primary sources. `:32` attributes to Wald, Harmon & Klabjan 2014 a "~30% average saving estimated at ~**27M passenger-minutes** or ~**$2B per year** in the US". Neither number is in that paper; its only dollar figure is ATA's $6.1 B total 2009 delay cost, which is not deplaning-specific. Its headline gains are ">40% on a full aircraft" and ">35% for narrow-body"; 30% appears only as one CRJ-200 result. `:8` and `:15` attribute arXiv:2007.16021 to "**Salari et al.**"; that paper is by **Schultz & Soolaki**. Neither error is reader-facing — I grepped `js/`, `README.md` and `index.html` and found nothing — but `CLAUDE.md` makes this file the citation of record for every engine constant, and the 0.4 m cell size and the 3.7 s door-arrival mean both trace to the mis-attributed one.

**N7-m2. The strip chart has no cap treatment at all.** `charts-strips.js:73` is `Math.min(1, Math.max(0, …))` and the module contains no "off scale", no break mark, no outlier gutter — grep returns nothing. Any run past `paddedMax` is drawn on the frame edge as an ordinary dot. The ranked chart three clicks away has a zigzag, an "(off scale)" label and the true value in the gutter, and this round made that mechanism fire correctly on 29 rows. One project, one quantity, two standards.

**N7-m3. Three deplane presets still start at 0m with no floor note.** CRJ-700 (`0m 1m 2m 3m 4m 5m`, **32.3%** of the frame empty before the first dot), 737 MAX 8 LCC (**28.5%**), E175 (**17.9%**). `computeAxisFloor`'s second gate, `candidate < paddedMax * 0.25`, is what stops them. A320 deplane improved from 34.2% to 25.6% and did earn its note, so the relaxation worked where it fired.

**N7-m4. On three board presets the tick ladder covers 59% of the plot, and rows land outside it.** A321neo three-class, 737-800 high-density and A321neo all draw exactly three ticks (`20m 30m 40m`) spanning x=324→534 inside an axis rule that runs x=232→586. Twenty-six percent of the drawing area sits left of the first tick and fifteen percent right of the last. On the A321neo three-class the slowest row prints **44:02** and its dot sits in that unlabelled right margin — inside `paddedMax`, so correctly not marked off-scale, but with no tick to read it against. `niceMinuteStep` picks its step from the floored range and then `Math.ceil`s the first tick past the floor, so a 12m-to-45m axis gets three marks.

**N7-m5. The board-mode canvas aria label describes deplaning.** At a finished board race both canvases announce "… finished at 21:34. Seats coloured by total time aboard **from door open**." In board mode there is no door open and nobody is aboard at t=0. Same vocabulary leak N5-m1 fixed in the visible label, still live in the accessibility label next to it.

**N7-m6. The Last/Average segmented control carries no ARIA state.** Both buttons report `aria-pressed: null` and `aria-checked: null`; the only signal is `class="seg on"`. The Rankings mode toggle got proper `aria-checked` this round; this one sits three sections below it on the default tab.

**N7-m7. Race controls still clipped 16 px below the fold at 1280x800.** [carried, round-02 NEW-M3, fourth round] `top: 756, bottom: 816` in an 800 px viewport.

### NIT

**N7-n1.** Door-status slot still empty and `display:none` from before the countdown to the finish, both lanes, both modes. [N6-n1]
**N7-n2.** `m` and `t` still do nothing; the tab rail still has no shortcut. [N6-n2]
**N7-n3.** At the finish the loser's time prints **5x**, the winner's **4x**, the margin **4x**. [N6-n4, marginally worse]
**N7-n4.** "Source or assumption" still holds seven different first words. [N6-n6]
**N7-n5.** Six of 23 phone row labels ellipsize, each with a `<title>` tooltip a touch device cannot open. [N6-n7]
**N7-n6.** Two (CRJ-700) or three (A320) shaded regions, one caption. [N6-n8]
**N7-n7.** MythBusters is still `kind: 'measured'`, visually identical to Schultz's field data, though its source cell now discloses "(n=1, TV volunteers)".
**N7-n8.** `rankings-stats.js:243` documents the near-zero branch as printing "0.1 person-years / day" and the code prints `fmtPersonYears(0)`, which is "0.0". The comment is wrong, not the code.
**N7-n9.** `rankings-data.js:301` `void knobs;` — the parameter is genuinely unused now that the preview lookup keys off `primary.knobs`; take it out of the signature instead.
**N7-n10.** The live `index.json` still advertises 62 cells with 37 absent and no `pending` key, so a Rankings visit costs 9 console 404s. That is the old precompute binary still in memory, not a code defect, but it will stay true until this run is replaced.

---

## What would make me send it to a friend

1. **One axis across the compare chart.** The two strip panels are the thesis — textbook on top, airlines underneath, the whole argument in one screen — and right now the bottom half is drawn 82% wider per minute than the top half. Compute the scale once across both. This is the single cheapest change on the list and the one that most changes what a reader concludes.
2. **Make the crash impossible and the test honest.** `primary ? … : null` is one ternary. Then serve a real `index-preview.json` in the fixture, because the version that 404s it is testing a site you do not ship. Three of the last three rounds produced a defect that the round's own verification could not see; this is the first time the verification actively concealed one.
3. **Let the caveat say "faster" when it is faster.** Six of thirteen presets currently print a sentence whose two numbers refute each other four words apart. One ternary, same as above.
4. **Put the Rankings view in the URL.** You built six new knobs on that tab this round and a "Copy link" button on the next tab over. A reader who finds the Boeing 777 deplaning ranking should be able to send it to someone.
5. **The wager before the door opens.** Fifth round on this list, and the case is stronger now than when it was first made: the thesis row prints a real, signed, sometimes humiliating number, so there is finally something worth being wrong about. Two buttons, one guess, one reveal.

---

## Scores

**Truth: 8/10.** Up a point, and earned in the places that cost the most. The one-sided clamp is gone and I verified every signed value against my own arithmetic over the cell files; the row that carries the thesis now says "19.2 person-years / day worse" on the aircraft where the airlines lose, and the hero sentence above it says so in English. The citation does not merely look fixed, it resolves: DOI, PII, volume, pages, authors and the verbatim 15-17 pax/min line all check against the primary source, the politeness parameter is honestly re-tagged as an assumption, and the derived 8.5-9.6 minute figure says it is derived. The break mark now fires on every one of 29 rows past the cap. Board mode finally reports a last passenger instead of an average under a false caption. What holds it at 8: a partial-index path that throws an uncaught error and leaves three controls lying about what is on screen, guarded by a test that passes only because its fixture removes a shipped file; a compare chart whose two stacked panels encode the same minutes at a 1.82x scale ratio with no statement; and a caveat clause that calls 13.2 pax/min slower than 7 on six of thirteen presets.

**Clarity: 8/10.** Held, with the ledger moving in both directions. The anchors have their headroom back at every width I measured, which restores the three measured marks that make the simulated rows believable. Ten sensitivity panels with zero label collisions, and the finer ceiling ladder took the worst board panel from 39% of its frame to 60%. The dashed 1000x66 hover box is now one line of text. The assumptions table finally distinguishes measured from assumed at a glance. The finish card's arithmetic closes against the clock, the aria label and the time-split. Six knobs on the Rankings tab turned a read-only page into something you can interrogate. What keeps it off a 9: two panels of one chart on two scales, three board presets whose tick ladder covers 59% of the plot with rows outside it, three deplane charts still starting at zero, the same six phone labels ellipsized into tooltips a phone cannot open, a phone caveat naming anchors the phone does not draw, and a Rankings tab you cannot link to.

**Delight: 7/10.** Held, and the reasons have shifted from ornament to responsiveness. The compare run is a third faster and its progress bar no longer stalls at 80% — the deciles now arrive roughly evenly, which is the kind of thing nobody praises and everybody feels. The knobs turning live on the Rankings tab is the first genuinely new interactive pleasure in several rounds. The signed thesis row is better theatre than the clamped one ever was, because a page willing to print a result against itself is more fun to read. Against that: the countdown is still dead air over an empty door-status slot, the margin still prints four times at the finish, `m` and `t` still do nothing, and the wager is still unbuilt for a fifth round. The delight is still maintenance plus one new control.

---

## End condition

Not yet, but the remaining distance is small and unusually well-shaped. Of the two blockers, one is a ternary plus a one-line fixture change, and the other is hoisting a scale computation out of a per-panel helper into the compare view — no new machinery, no new data, no design decision. Of the three majors, one is a ternary, one is wiring the Rankings rerender into the URL writer the Race tab already owns, and one is returning the anchor list the chart actually drew instead of recomputing it viewport-blind. The seven minors are polish and one bibliography correction in a design doc.

I would not run an eighth full adversarial round after these. What this needs is a fix round against the two blockers and the three majors, then a **targeted verification** on four things, because all four would be reintroduced the same way: the partial-index mode toggle **with a real preview index served**, the two compare panels' px-per-minute measured and asserted equal, the caveat verdict word on the 787-9 and the CRJ-700, and the URL after a Rankings preset change.

Two process notes, because the pattern is now three rounds old and this round sharpened it.

First: every defect this round introduced came from a fix verified in isolation. The strip-chart floor was verified on the panel where it fired. The phone anchor reduction was verified against the viewBox and not against the sentence underneath. The caveat was verified on A320, where "slower" happens to be true.

Second, and new: **a test can be worse than no test.** The N6-B1 guard asserts all the right things and passes because its fixture 404s `index-preview.json`. Before trusting a regression test that guards a data-shape bug, check that the fixture's data shape is the one production has. A fixture that omits a file the site always ships is not a pessimistic fixture, it is a different universe.

REMAINING ABOVE NIT: 12
