# Round 06 — Critic pass (data-visualization critic)

Reviewer: adversarial data-vis review, headless Chromium 1.58.2 at 1280x800, 1280x900, 1440x900 and 400x800.
Build: `index.html` at `e260d1a`. Artifacts: `tests/e2e/artifacts/critic-round-06/`.
`npm test`: **426 pass / 0 fail** across 68 suites. `tests/e2e/sidebar-popover.test.js`: 5 pass. `tests/e2e/fix-round-08.test.js`: 4 pass.

**Review conditions, stated up front because they shaped what I could see.** The full precompute is still running (PID 72479, started 23:28:03, 739% CPU). It was launched **before** the `e8de605` commit that taught the tool to write a truthful partial index, so the process in memory is the pre-fix binary: `data/rankings/index.json` still advertises all 62 planned cells while **12 exist on disk**. I therefore reviewed on three trees, touching nothing in `data/`:

| port | tree | what it shows |
|---|---|---|
| 5197 | the repo as served | what a reader gets right now: 10 cell 404s per Rankings visit, preview fallback under the headline |
| 5296 | scratch symlinks with `index.json` omitted | the complete 200-seed preview set: every chart, every sensitivity panel, all 13 presets |
| 5297 | scratch tree with a synthesized `{cells: 12, pending: 50}` index | exactly what the **fixed** precompute writes mid-run |

Rankings findings are measured on 5296 unless they say LIVE or PARTIAL.

---

## Verdict

This is the round where the fixes worked and the fixes bit back. Take the good first, because there is a lot of it and it is not cosmetic. The blocker is dead and dead properly: the deck reads the cell that actually loaded, so on the live tree the boarding deck says "run 200 times for this cell" over a 200-seed fallback and the deplaning deck says "10,000" over the real 10,000-seed cell, each matching its own footer, with a console line naming the fallback and an e2e test pinning all three tiers. The finding sentence is now 30 px and the tiles are 18 px, so for the first time the eye lands on the sentence instead of on four numbers nobody would quote. "Barely moves" is gated at 60 seconds and I checked all ten panels against the data: the five five-minute swings that were called barely are gone, the five that remain move 0 to 15 seconds. The label collisions are gone, all ten panels, minimum gap 14.0 px on 11 px text. The axis floor took the flagship chart's empty left margin from 47% to **11.5%** and printed "axis starts at 10m" under the truncation. KLM is one band. The heat ramps carry real endpoints and say they share a scale. The seeds read `plane-copper-yaw`. That is a real round of work.

Now the bite. Three of the new defects were **created by the fixes**. Moving the finding sentence out of the SVG removed the padding the anchor labels were sized against, so "Spirit A320 · 20 min" now loses two thirds of its glyph box off the top of the chart frame at 1280, and at 400 px "MythBusters · 24:29" is drawn entirely above the viewBox and never appears at all. You clipped your own measured anchors to make room for the sentence. Writing only finished cells into the index closed the 404s and opened something worse: on a partial index the Boarding tab renders "No precomputed cell for board on a320" while leaving the **deplaning** hero sentence, the deplaning tiles and a "10,000 runs per strategy" footnote on screen. The largest text on the page, at 30 px, reads "Both doors deplanes A320 / 737 in 4.0 min" under a lit Boarding toggle. And the comparison row you added to carry the thesis clamps at zero: on the 737-800 two-class, where every one of the fourteen airline procedures is slower than random order and the chart above shows it plainly, the page prints "Best airline vs random order — **0.0** person-years / day". The true figure is 8.5 the wrong way. On the A321neo three-class the row billed as "the whole thesis, as a number" prints 0.0 against a true −32.2. A page that flatters its own thesis by one-sided clamping is doing the thing it accuses the airlines of.

Two more, found by looking where nobody had. The static caveat under the ranked chart prints A320 numbers on all thirteen presets: on the CRJ-700 it claims "every simulated airline procedure lands at or above the Spirit 20-minute anchor" while the chart directly above shows all fourteen between 8:34 and 8:59 and draws no Spirit anchor at all. And I chased N5-n12 to the bottom: "Milne and Salari 2016, JATM 43" is wrong three ways, and the URL behind it points at a paper by three different authors.

The truth surface is better than it was and it is still not sound. Fix the clamp, fix the partial-index render, un-clip the anchors, and make the caveat read the cell.

---

## Re-verification of every round-05 finding

| id | Round-05 finding | Status | Evidence |
|---|---|---|---|
| **N5-B1** | Deck says 10,000, footer says 200 | **FIXED** | `index.js:455-462` reads `cellData.seeds` (falling through to `cellData.cell.seeds`, which is where the cell files actually carry it) and `rerender` calls it before every other render. Three trees, one page load each: 5296 board a320 deck "run **200** times for this cell" / footer "**200** runs per strategy"; LIVE deplane a320 (the real 10,000-seed file exists) deck "**10,000**" / footer "**10,000**"; LIVE board a320 falls back and prints **200** on both, with `info: Rankings: primary cell …n=10000.json unavailable; using preview fallback …n=200.json`. About: "Every cell holds 200 runs per strategy across 62 cells", computed from the index cells by `computeSeedTierSummary`. Pinned by `fix-round-08.test.js` on three tiers. |
| **N5-M1** | Index publishes 62 cells, 55 missing | **FIXED IN CODE, NOT ON DISK, AND IT OPENED N6-B1** | `precompute.mjs:305-313` `partitionCellsByDisk`, `:632-640` rebuilds `{cells: present, pending}` after every cell. Verified on the synthesized partial index (12 present, 50 pending): **zero 404s**, zero console errors. LIVE is still the old shape because the running job predates the commit: `index.json` lists 62, 12 files exist, and one Rankings visit throws **10 cell 404s** and the developer string "Sensitivity cell files have not been generated yet. Run \`npm run precompute\`". That heals when this run is replaced. What does not heal is what the fixed index does to the page: **N6-B1**. |
| **N5-M2** | Four first-things; the payload is the smallest text | **FIXED** | Hero `[data-rankings-finding]` **30px / 600** at 1280, 20px at 400; four `.rankings-stat-number` demoted **40px → 18px**; `renderChart` passes `findingSentence: ''` so the sentence is drawn once, in HTML, not twice. Residue: still no accent hue anywhere on the tab. 23 dots in one ink, five lines per panel in one ink, four tiles in one ink; the only differentiation you allow is the emphasized comparison row's `rgb(236,229,214)` fill and the 0.08 tie band. |
| **N5-M3** | "Barely moves" false in half the panels | **FIXED** | `SMALL_MOVE_SECONDS = 60` at `rankings-sensitivity.js:335`, gated at `:359`. I recomputed all ten panels from the cell files. The five offenders now print no second clause (board/how full 319 s, board/groups 96 s, board/carry-ons 243 s, deplane/how full 127 s, deplane/carry-ons 140 s). The five clauses that survive are **12, 2, 0, 3 and 15 seconds**. Every one is defensible. |
| **N5-M4** | Every chart starts at zero, half of each frame empty | **PARTIALLY FIXED** | Board a320: axis **10m–30m**, first band edge x=313.4 in a plot spanning 240→878, so **11.5% empty** (was 47%), with an italic "axis starts at 10m" under a dashed floor tick. Sensitivity panels floored where the data sit above 4 min. Not fixed: deplane a320 ranked chart still starts at **0m** with **34.2% empty** (the `< 4 min` gate at `rankings-chart.js:272` turns the floor off), and the **Race strip chart is untouched** — board compare draws 0m/15m/30m/45m/60m with every dot between x=269.7 and x=311.8, i.e. 10.3 to 16.5 minutes, **10% of the axis**, no floor note. See **N6-m1**, **N6-m2**. |
| **N5-M5** | Labels collide in all five deplane panels | **FIXED** | Two-pass relaxation at `rankings-sensitivity.js:204-240` plus leader lines. Measured adjacent label baselines in all ten panels: minimum gap **14.0 px** on 11 px text, every panel; zero labels outside the 200 px frame. The five deplane collisions (2.6, 5.3, 3.4, 9.2, 7.1 px) are gone. (The upward pass at `:221-224` is unreachable — the downward pass guarantees its condition is always false — but the output is correct.) |
| **N5-M6** | Ragged precision; the thesis row missing | **FIXED, THEN UNDONE BY A CLAMP** | `fmtPersonYears` is one decimal below 1000 everywhere: a320 prints 0.1 / 26.6 / 8.8 / 26.5 in one column. The "Average airline vs random order" row exists, sits first, and is emphasized. Its a320 value matches my own arithmetic (mean airline idle 1557.08 vs random 1559.36 person-minutes → 0.108 person-years/day). But `rankings-stats.js:135-142` wraps every one of these in `Math.max(0, …)`. See **N6-B2**. |
| **N5-m1** | "Seated waiting" in board mode | **FIXED (label), still false beside it** | `charts-time-split.js:39-47` splits the label maps; board mode renders "**waiting to board** 4:33". The caption next to it still reads "average so far, nobody seated yet" at every moment of a board race including the finish — a separate defect, **N6-M5**. |
| **N5-m2** | KLM drawn as two measurements | **FIXED** | `rankings-anchors.js:39-47` emits one `kind:'range'` anchor; `rankings-chart.js:490-511` draws one shaded band from 17 to 22 min with a single top rule and one label, "KLM 737 · 17 to 22 min". Four anchors are now four things. |
| **N5-m3** | Two tie counts, two rules, no explanation | **FIXED on the board tab** | Caption: "The 10 shaded airline procedures land within a minute of one another (49-second spread); the finding above counts a different set: airlines within a minute of random." I verified both numbers: 11 airlines lie within 60 s of random's 23:32, and the longest 60 s window over the 14 airline medians is 10 rows spanning 1390→1439 s = **49 s**. The same string misfires in deplane mode: **N6-m3**. |
| **N5-m4** | Compare pool leaves workers idle | **STILL BROKEN** | 10 logical cores, 100 runs, 7 deplane strategies. Deciles first reached at 1.33 / 2.02 / 2.89 / 3.60 / 4.49 / 5.43 / 6.62 / 7.98 / 11.64 s, done at **16.93 s**. The last 20% takes 8.95 s = **53% of the wall clock** (round 5: 49%). Declared not-done by choice. |
| **N5-m5** | Tap targets under 44 px on phone | **PARTIALLY FIXED** | Speed pips are now **43x44, 46x44, 50x44** (were 32 px tall). Unchanged: 15 info buttons at **22x22**, Last **44x32**, Average **64x32**, Runs select, chime checkbox. Declared not-done by choice. |
| **N5-m6** | Two heat ramps, unlabelled endpoints, shared scale unstated | **FIXED** | At a two-lane finish both `.heat-ramp` elements read "**0:00 … 17:09**" — the same shared maximum on both — and each caption states it: "Darker = more time aboard from door open. **Both cabins share this scale.** Worst 26F 6:59; best 1C 0:45." / "… Worst 30A 17:09; best 1C 0:45." The identical "best 1C 0:45" now reads as the shared floor it is. |
| **N5-m7** | Rankings knobs read-only | **STILL BROKEN** | Interactive controls inside `#tab-panel-rankings` at 400 px: two mode segments, one preset select, info buttons. `#settings-panel` `offsetParent` null. Declared not-done by choice. |
| **N5-m8** | Two stale numbers in the README | **FIXED** | `README.md:74` now points at the test files instead of naming a seed count. MythBusters is **2014**, matching `about.js`. (A different README citation is wrong: **N6-M1**.) |
| **N5-m9** | Three stale or self-contradicting comments | **PARTIALLY FIXED (1 of 3)** | `rankings-chart.js:322-336` now correctly names `(p90-p10)/2.563` as sigma and derives SE = 1.253·sigma/√n ≈ 11 s at n=200, matching `seMedian()` beside it. Still open: `config.js:33` documents the gate as **[14, 24]** when it is [14, 27] — the exact drift N4-M5 was about, still alive one layer down; `config.js:65` still says 45 s "sits inside the one-to-three minute field range", which is arithmetically false and contradicted by `about.js`'s own honest "ops range 60 to 180 s". |
| **N5-m10** | Validity note on the wrong tab | **PLACEMENT FIXED, CONTENT BROKEN** | `renderChartCaveat` prints it under the ranked chart in board mode, 12 px. But it is one hard-coded string on all thirteen presets. See **N6-M2**. |
| **N5-n1** | Base-36 seed roll | **FIXED** | Four presses of `#btn-new-plane`: `plane-mist-seat`, `plane-copper-yaw`, `plane-olive-tower`, `plane-onyx-hangar`. Fifth round, closed. |
| **N5-n2** | No shortcut for the tab rail; `m` and `t` dead | **STILL BROKEN** | `m` leaves the mode unchanged; `t` leaves `body.dataset.tab === 'race'`. |
| **N5-n3** | Door-status slot empties | **STILL BROKEN** | Both `.door-status` elements: `textContent === ""` and `offsetParent === null` before the race, at t≈2.5 s, and at the finish, in both lanes. |
| **N5-n4** | Finish card and clock disagree by a second | **STILL BROKEN** | One screen, deplane, seed `plane-crit-06`: card "Free-for-all deplaned in **6:59**, **10:09** ahead of One row at a time"; 6:59 + 10:09 = **17:08**. Right clock: **17:09**. Canvas aria: "finished at **17:09**". Time-split total: **17:09**. |
| **N5-n5** | Cell provenance is developer output | **FIXED** | Footnote: "200 runs per strategy, load 85%, compliance 85%, groups 25%, typical bags, roomy bins." The id survives in `data-cell-id` for debugging. One line on phone. |
| **N5-n6** | Footer "100 seeds", control "Runs" | **FIXED** | Strip footer: "7 strategies · **100 runs** · 16.1s". Control label: "Runs". One vocabulary. |
| **N5-n7** | `data-kind` styled by nothing | **STILL BROKEN** | Computed `<tr>` styles for `measured`, `assumption`, `derived` and `estimate` are byte-identical: `rgba(0, 0, 0, 0)` background, `normal` font-style, `0px` border-left. MythBusters (n=1, TV volunteers) still renders in the same visual class as Schultz field data. |
| **N5-n8** | Four vocabularies under a two-word header | **STILL BROKEN** | First words in the "Source or assumption" column: `Assumption`, `Derived`, `Estimate`, and four bare citations (`Milne`, `Schultz`, `Steffen`, `MythBusters`). |
| **N5-n9** | Sensitivity title repeats the knob name | **FIXED** | Titles now lead with the strategy: "Largest effect on Pick any seat (10.5 minutes)." under the heading "How full". |
| **N5-n10** | Phone row labels ellipsize | **STILL BROKEN** | 400 px, board a320: `Steffen, in bl…`, `Window, middle…`, `Back to front,…`, `Southwest (202…`, `American Airli…`, `Hawaiian Airli…`. Six of 23. |
| **N5-n11** | The margin prints four times at the finish | **STILL BROKEN** | `10:09` appears **4×** in the page text at the finish; `6:59` 3×. |
| **N5-n12** | Milne and Salari citation unverified | **RESOLVED — THE CITATION IS WRONG** | Chased to primary sources. Escalated to **N6-M1**. |

### Older carry-overs

| id | Finding | Status | Evidence |
|---|---|---|---|
| **round-02 NEW-M3** | Race controls below the fold at 1280x800 | **UNCHANGED** | `#race-controls` `top: 756, bottom: 816` in an 800 px viewport. Clipped by **16 px**, same as round 5. |
| **round-03 NEW3-n5** | Strip chart axis runs past the data | **STILL BROKEN, now worse** | Board compare with all 23 strategies: axis 0m–60m, data 10.3–16.5 min. Folded into **N6-m1**. |

**Round-05 scoreboard: 1 blocker fixed. Majors: 4 fixed, 2 partial. Minors: 5 fixed, 3 partial, 2 still open. Nits: 5 fixed, 6 still open, 1 resolved as a major.**

---

## New findings

### BLOCKER

**N6-B1. On a partial index the Boarding tab prints a deplaning finding, deplaning tiles and a deplaning footnote under a lit Boarding toggle.**

This is the state the N5-M1 fix creates and the state the repo is in right now (12 of 62 cells written, all of them deplaning headlines). PARTIAL tree, `?tab=rankings&mode=deplane&preset=a320`, then one click on Boarding:

| element | what it says after the click |
|---|---|
| mode toggle | **Boarding**, lit dark |
| status line | "No precomputed cell for board on a320." |
| hero sentence, 30 px | "**Both doors deplanes A320 / 737 in 4.0 min; One row at a time takes 15.8 min.**" |
| four tiles | 335 / 1,135 / 800 / 38.0, labelled "BEST · DEPLANING", "WORST · DEPLANING" |
| footnote | "**10,000 runs per strategy**, load 85%, …" |
| sub-line | "The average passenger on Both doors sits going nowhere for 2:11." |
| ranked chart | empty frame, 0 rows |
| `aria-checked` on the Boarding button | **null** |

`index.js:97-101`: when `selectCellForRequest` returns null, `renderNoCell` clears **only the chart** and returns before `renderTop`, `renderHeroFinding`, `renderStats` and `renderChartCaveat` ever run. So every number from the previous mode survives, and the accessibility tree never learns the toggle moved. `loadCellWithFallback` — the machinery built for exactly this — is never reached, because the guard fires first: the fallback rescues a cell that is *listed and 404s*, never a cell that is *absent from the index*. The 200-seed board cell is sitting on disk, unused, three lines away in `index-preview.json`.

Screenshot: `18-PARTIAL-stale-after-board-toggle.png`.

Round 4 asked you to make the count true. Round 5 asked you to make the index true. Both landed. The combination now produces a page whose largest element states a result about the wrong simulation.

**Fix:** on the no-cell path, clear what you cannot vouch for — hide the hero, the tiles, the comparison rows, the sub-line and the footnote — and run `renderTop` so the toggle's `aria-checked` matches the click. Better: move the guard after the fallback so an absent cell falls to the preview cell the same way a 404 does, and say which. Best: do not offer a mode or a preset the index cannot answer.

**N6-B2. Four of thirteen board presets print "0.0 person-years / day" for a difference that is not zero and not in your favour.**

`rankings-stats.js:135-142` wraps all four comparison values in `Math.max(0, …)`. Where the airlines beat random the row is honest. Where they lose, the row prints parity. Computed from the cell files, all thirteen board presets at defaults:

| preset | average airline vs random (true) | printed | best airline vs random (true) | printed |
|---|---|---|---|---|
| A321neo three-class | **−32.2** py/day | **0.0** | **−16.9** | **0.0** |
| 737-800 two-class | **−18.3** | **0.0** | **−8.5** | **0.0** |
| 737 MAX 8 (low-cost) | **−14.4** | **0.0** | **−3.9** | **0.0** |
| 787-9 three-class | **−5.8** | **0.0** | +0.6 | 0.6 |
| A320 / 737 | +0.1 | 0.1 | +8.8 | 8.8 |
| (the other 8) | positive | correct | positive | correct |

On the 737-800 two-class the ranked chart directly above prints Random order at **22:17** and then lists all fourteen airline procedures below it, Ryanair fastest at **24:35**. Every airline loses to random on that aircraft, visibly, by more than two minutes. Underneath, the row you emphasized and captioned "**the whole thesis, as a number**" prints 0.0, and so does "Best airline vs random order". The comment at `:139-140` even says "The delta can be positive or negative depending on which direction the mean airline lies" — and then the next line clamps it.

These are not rounding artifacts. −32.2 and −18.3 person-years per day are far outside anything n=200 noise can produce, so they will survive the full precompute unchanged.

A one-sided clamp on the site's own thesis metric is the most expensive kind of error you can make here, because it only ever errs toward the story you are telling. Round 5 killed a number the footer refuted; this one is refuted by the chart nine inches above it.

**Fix:** drop `Math.max(0, …)`, print the sign, and say which direction it runs — "Average airline vs random order: **18.3 person-years / day worse**". The finding is more interesting when the airlines lose than when they tie.

### MAJOR

**N6-M1. "Milne and Salari 2016, JATM 43" is wrong three ways, and the URL under it is a different paper by different authors.**

Round 5 flagged this as unverifiable without the paper. I chased it to primary sources.

| where | what the site says | what is true |
|---|---|---|
| `about.js` assumptions table, politeness row, `kind: 'measured'` | "P = 0.9 … **Milne and Salari 2016**" | The 2016 Milne & Salari JATM paper is **volume 54**, pp. 104-110, "Optimization of assigning passengers to seats on airplanes based on their carry-on luggage", doi 10.1016/j.jairtraman.2016.03.022. It is a **boarding** seat-assignment MIP. It contains no politeness parameter. |
| same table, one-column deplaning row | "aisle-first faster than free-for-all … **Milne and Salari 2016, JATM 43**" | JATM volume 43 contains no Milne/Salari paper. |
| `README.md:69` | "Milne & Salari, **JATM 43**, **2015**" linking `…/pii/S0969699714000027` | That PII is **Wald, Harmon & Klabjan, "Structured deplaning via simulation and optimization", JATM 36:101-109, 2014**. That paper *is* the right source for the one-column deplaning claim. The site links it and credits someone else. |
| `about.js` calibration paragraph | "Milne and Salari 2016 report A320 deplaning at 15 to 17 pax/min whole-run door rate, 8.5 to 9.6 minutes" | Untraceable to any Milne & Salari paper. This figure is **half of the lower bound of your published calibration gate** ([14, 27] pax/min), so an unsourced number is load-bearing on the gate the About tab prints as its honesty credential. |

The README also contradicts itself on the same authors: 2015 at line 69, 2016 at line 78.

This is the one finding that hurts most, because the assumptions table is the page's argument that it can be trusted, and the politeness row is tagged `measured` specifically to distinguish it from the rows tagged `assumption`. A `measured` tag pointing at a paper that does not contain the measurement is worse than an honest `assumption`.

**Fix:** re-credit the deplaning claim to Wald, Harmon & Klabjan 2014, JATM 36:101-109 (you are already linking it). Correct the Milne & Salari volume to 54 wherever it is genuinely the source, and re-tag politeness and the 8.5-9.6 minute figure as `assumption` unless you can produce the page number. One line in `design/02-research.md` per row.

**N6-M2. The under-chart caveat and the comparison note are hard-coded A320 strings printed on all thirteen presets.**

`index.js:595` and `rankings-stats.js:170` are literals. Measured on 5296, board mode, one string per preset:

| claim in the string | A320 | CRJ-700 | E175 | Boeing 717 | Boeing 777 |
|---|---|---|---|---|---|
| "about **3.8 pax/min** in the sim" | 3.81 ✓ | 3.67 | 3.55 | 3.50 | **7.91** |
| "**slower** than the 7 pax/min MythBusters test" | true | true | true | true | **false — it is faster** |
| "every simulated airline procedure lands at or above the **Spirit 20-minute anchor**" | true (fastest 20:58) | **false — all 14 sit between 8:34 and 8:59** | **false — 9:25** | **false — 16:06** | true |
| is a Spirit anchor even drawn? | yes | **no** | **no** | **no** | **no** |
| "the sim runs at **153 pax on an A320**" | true | 58 pax | 65 pax | 111 pax | **306 pax** |

The CRJ-700 case is the one a reader will catch: `21-crj-caveat-crop.png` shows a chart whose axis runs 4m to 15m, fourteen airline rows clustered at 8:34-8:59, and below it a sentence asserting they are all at or above twenty minutes. Nine of thirteen presets draw no anchors at all (`rankings-anchors.js:22-25` restricts them to narrowbodies), so on those the caveat cites a tick that is not on the page.

This is the same class of defect as round 5's blocker: a sentence that a reader can refute against the chart beside it. It is a MAJOR and not a BLOCKER only because the sentence is 12 px and hedged, where the deck was a headline claim.

**Fix:** compute it. You already have `cellData.strategies` and `passengerCount` at the call site: print the cell's own front-to-back rate, its own fastest airline, and its own passenger count, and drop the anchor clause on presets that draw no anchors.

**N6-M3. Measured anchor labels are clipped off the top of the chart frame — one of three at desktop, two of three on phone.**

Measured `getBBox()` against the SVG viewBox (`0 0 width height`; inline SVG clips at the frame by UA default):

| viewport | anchor | baseline y | bbox top | clipped |
|---|---|---|---|---|
| 1280 | KLM 737 · 17 to 22 min | 14 | 4.0 | none |
| 1280 | **Spirit A320 · 20 min** | 2 | **−8.0** | **8 of 12 px, two thirds of the glyph box** |
| 1280 | MythBusters · 24:29 | 14 | 4.0 | none |
| 400 | **Spirit A320 · 20 min** | 2 | **−8.0** | 8 px |
| 400 | **MythBusters · 24:29** | −10 | **−20.0** | **entirely — the label never renders** |

`02-anchor-clip-crop.png` shows the desktop case: the descenders of "Spirit A320 · 20 min" hanging over "KLM 737 · 17 to 22 min" with the x-heights sheared off.

The arithmetic is deterministic, not a race. `rankings-chart.js:88-89`: `anchorBand = 3 * 12 + 10 = 46` and `paddingTop = 12 + titleHeight + 14 + anchorBand + 12`, so `axisY = paddingTop - anchorBand - 2 = 36 + titleHeight`. `ROW_OFFSETS = [22, 34, 46]` at `:469` places labels at `axisY - offset`. With `titleHeight = 0` those are y = 14, 2, −10. Only row 0 fits. **When the finding sentence was still drawn inside the SVG, `titleHeight` was 40 and every row cleared the frame.** N5-M2's fix removed the title and took the anchors' headroom with it.

Two of three rows are unusable, and the 82 px minimum label gap forces the Spirit label into row 1 on every narrowbody board cell, so this fires on the flagship preset every time.

**Fix:** derive `anchorBand` from `ROW_OFFSETS` (max offset + the label's ascent + a margin) instead of `rows * 12 + 10`, so the padding and the offsets cannot drift apart again. On phone, drop to one row and stagger by x instead.

**N6-M4. Rows past the axis cap but under 1.25× it are silently drawn at the axis edge with no break mark.**

`rankings-chart.js:188` marks a row an outlier only above `paddedMax * OUTLIER_MULT` (1.25). Below that, `projectSeconds` at `:561` clamps to `paddedMax` and the row draws as an ordinary dot and band at the frame's right edge. Measured dot positions against the last axis tick:

| preset | axis cap | slowest row prints | dot drawn at | break mark |
|---|---|---|---|---|
| E175 | 15m | **18:20** | x=878, the axis edge | **none** |
| Boeing 717 | 30m | **31:44** | x=878, on the 30m tick | **none** |
| CRJ-700 | 15m | **15:48** | x=878, on the 15m tick | **none** |
| A320 / 737 | 30m | 40:08 | past the edge, with "(off scale)" | 1 ✓ |

On the E175 a row nearly three minutes beyond the scale sits at the same x as the scale's end, with its p10-p90 band silently truncated to match. The reader's only signal is the printed time in the right gutter — which is exactly the "table with decoration" reading the axis-floor work was meant to end, except here position is not merely uninformative, it is wrong.

You built the honest mechanism (zigzag, "(off scale)", the value printed) and then left a 25% dead band where it does not fire.

**Fix:** trigger the break-bar treatment on `median > paddedMax`, not on `median > 1.25 * paddedMax`. The 1.25 multiplier has no job once the break mark exists.

**N6-M5. In board mode the "Where the time goes" panel can never find a last passenger, so it shows the running average under the caption "nobody seated yet" — including after the cabin has finished boarding.**

`time-split.js:68` selects `passengers.filter(p => p.vis === 'done')`. `types.js:111` documents that `DONE` is deplane-only: "*exited (deplane); seated for good (board) uses SEATED*", and `board-sim.js` sets `Vis.SEATED` at `:290` and `:299` and never sets `Vis.DONE`. So in board mode `doneOnly.length` is always 0 and the function always takes the fallback branch at `:70-72`.

Observed, board, seed `plane-fixed-a`, left cabin finished at 18:57 with all 146 passengers seated:

```
Random order   · average so far, nobody seated yet
               total 9:29 | waiting to board 6:52 | aisle blocked 1:48 | bags 0:30 | walking 0:19
```

Three things are wrong at once. The "Last" control is the default and it is showing the Average. The caption asserts nobody is seated on a plane that is full. And the panel's own section subtitle two lines above reads "The last passenger **seated**." The same code path in deplane mode works correctly — I measured "· last off" and "· slowest off so far" — which is what makes this a plain bug rather than a design choice.

Board is the default mode of the page. This is the second-largest chart on the Race tab and it has been showing the wrong statistic under a false caption the whole time; N5-m1's label fix made it legible enough to notice.

**Fix:** `time-split.js` should treat `Vis.SEATED` as terminal in board mode — one mode-aware predicate, the same shape as the label map you just added next door.

### MINOR

**N6-m1. The Race strip chart still has no floor and no cap.** [carried, N5-M4 / round-03 NEW3-n5] Board compare over all 23 strategies: axis `0m 15m 30m 45m 60m`, every dot between x=269.7 and x=311.8 on a 200→606 scale, i.e. **10.3 to 16.5 minutes occupying 10% of the axis**. Deplane compare: axis 0m–20m, dots 2.9 to 18.5 min, left 29% empty. No "axis starts at" note. `charts-strips.js:53-54` computes `niceCeiling(max)` and nothing else. The Rankings chart proves you have the code; the same project draws the same quantity two ways on two tabs.

**N6-m2. The deplane ranked chart still starts at zero.** [carried, N5-M4] `rankings-chart.js:272` switches the floor off when the fastest p10 is under 4 minutes, which is every deplane cell. A320 deplane: axis 0m–10m, first band edge at x=458.1 on a 240→878 plot, **34.2% of the frame empty** before any data (round 5: 40%). The rule is defensible for the CRJ; on a 153-seat cabin whose fastest strategy has a 3.5-minute floor it costs a third of the chart.

**N6-m3. The tie caption's second clause names a rule that does not exist in the mode it prints in.** Deplane, A320: "The 4 shaded strategies land within a minute of one another (21-second spread); **the finding above counts a different set: airlines within a minute of random.**" There are no airline strategies in deplane mode and the finding above is "Both doors deplanes A320 / 737 in 4.0 min". The clause is appended unconditionally at `rankings-chart.js:356`. It also misfires on board presets where `composeFinding` falls back to fastest-vs-slowest: on the 737-800 two-class the caption points at a "finding above" that counts nothing.

**N6-m4. The "axis from Nm" note overlaps the first x-axis label in four of five board sensitivity panels.** Both are drawn at `plotY1 + 13/14` with the note anchored `end` at `plotX0 - 8` and the value anchored `middle` at `plotX0`. Measured bbox overlaps: Overhead bins **16.0 px** ("axis from 10m" over "roomy bins"), Carry-ons **13.2 px**, Follow the rules 1.9 px, How full 1.7 px; Groups clears by 0.7 px. Visible in `01-preview-board-a320-1280.png` as "axis from 10mroomy bins".

**N6-m5. Compare pool still leaves the tail on one core.** [carried, N5-m4] 53% of the wall clock in the last 20%, on 10 cores. Declared not-done.

**N6-m6. Tap targets.** [carried, N5-m5] Speed pips fixed at 44 px tall; 15 info buttons still 22x22, Last 44x32, Average 64x32. The info buttons are the reader's only route into a 39-entry glossary. Declared not-done.

**N6-m7. Rankings knobs still read-only.** [carried, N5-m7] Declared not-done.

**N6-m8. `config.js` still documents a gate that moved and an arithmetic that does not hold.** [carried, N5-m9] `:33` says `[14, 24]` against a live `[14, 27]`; `:65` says 45 s "sits inside the one-to-three minute field range". Output unaffected; both are the first thing a new contributor reads.

**N6-m9. Sensitivity ceilings still snap to a coarse ladder, so the floor fix only bought back half the frame.** `niceCeiling`'s step list jumps 20 → 30, so a panel whose slowest line is 21 minutes gets a 30-minute ceiling. Measured series extent against the 122 px plot: How full 69%, Carry-ons 59%, Groups 49%, Follow the rules 46%, **Overhead bins 39%**. Five panels with a third to a half of the frame empty above the data, five times down the page.

### NIT

**N6-n1.** Door-status slot still empty and `display:none` from before the countdown to the finish, both lanes.
**N6-n2.** `m` and `t` still do nothing; the tab rail still has no shortcut.
**N6-n3.** Finish card implies 17:08 (6:59 + 10:09); the clock, the canvas aria, the heat caption and the time-split all say 17:09.
**N6-n4.** `10:09` prints four times at the finish.
**N6-n5.** `data-kind` set on every assumptions row, styled by nothing; measured and assumed are visually identical.
**N6-n6.** "Source or assumption" still holds four vocabularies.
**N6-n7.** Six of 23 phone row labels ellipsize (`Southwest (202…`, `Hawaiian Airli…`).
**N6-n8.** The board chart draws **two** shaded tie bands (six textbook rows and ten airline rows on the CRJ-700) and captions only one; a reader sees two kinds of emphasis and one explanation.
**N6-n9.** `rankings-sensitivity.js:221-224` — the upward relaxation pass is unreachable: the downward pass guarantees `labelY[i] <= labelY[i+1] - GAP`, so its condition is always false. The comment describes a bottom clamp that is not implemented; labels are simply never pushed low enough to need it today.
**N6-n10.** `index.js:222` — `void headlineCellData;` sits after `return result;`, so the parameter it exists to silence is never touched.
**N6-n11.** The desktop hover panel reserves a 1000x66 dashed empty box holding one italic line of instructions, directly between the chart and the tiles.
**N6-n12.** `populatePresetSelect` builds the aircraft list from `indexObject.cells` across both modes, so during a run the menu grows as cells land (12 entries on the partial index, 13 on the full one) and can list a preset the current mode cannot answer.

---

## What would make me send it to a friend

1. **Print the sign.** "Average airline vs random order: 18.3 person-years / day **worse**" on the two-class 737 is a better story than 0.1 on the A320, and you currently round it to zero. The clamp is one `Math.max` and it is the only thing on the page that lies in your favour.
2. **Give the anchors back their headroom.** Spirit and MythBusters are the only measured marks on the whole chart and two of three are clipped on a phone. They are the reason a reader believes the simulated rows.
3. **Make the caveat read the cell.** You have `strategies` and `passengerCount` in the same function. A caveat that says "on this aircraft front-to-back runs at 3.7 pax/min and the fastest airline lands at 8:34" is worth reading; one that says 3.8 and twenty minutes on a 58-seat regional jet destroys the credibility of every other careful sentence on the page.
4. **One axis rule, drawn everywhere.** The ranked chart floors and caps and labels its truncation. The Race strip chart next door draws 60 minutes of axis for 6 minutes of data. Pick the good one and use it twice.
5. **The wager before the door opens.** Fourth round on the list. Two buttons, one guess, one reveal. It is still the cheapest delight on the table and the default matchup now has a real answer to be wrong about.

---

## Scores

**Truth: 7/10.** Held, for different reasons than last round. The blocker is genuinely closed and closed at the right layer: the deck reads the cell, the fallback names itself in the console, the About tier sentence is computed from the index instead of asserted, and an e2e test pins all three. "Barely moves" is gated and I verified every one of the ten panels against the raw cells — that fix is exactly right. The person-minute tiles still reconcile, the tie band and its caption now name both rules and both numbers check out, the heat ramps carry their shared maximum, and the sensitivity titles no longer claim robustness the data refuse. What holds it at 7 is that the same round introduced a one-sided clamp that prints 0.0 where the true figure is −32.2 person-years per day on the metric the page bills as its whole thesis, left a hard-coded A320 caveat that is flatly false on four presets and cites an anchor that nine presets never draw, and — chased to primary sources — rests its one `measured` behavioural parameter and its calibration lower bound on a citation that is wrong in volume, in content, and in authorship. Plus a board-mode time-split that has been averaging under a "nobody seated yet" caption since it was written.

**Clarity: 8/10.** Up a point, earned. The hierarchy question is settled: the finding sentence is 30 px, the tiles are 18, the sentence renders once instead of twice, and on the A320 board tab your eye now goes exactly where it should. The axis floor turned the flagship chart from a table with decoration into something where position carries the ordering — 47% empty down to 11.5% is the single biggest visual improvement in six rounds, and printing "axis starts at 10m" under a dashed tick is the honest way to do it. Labels no longer overprint in any panel. KLM is one measurement. The footnote reads like English. What keeps it off a 9: two of three measured anchors clipped, the "axis from 10m" note colliding with "roomy bins", five sensitivity panels still using under half their frame, a caption that names airlines on the tab that has none, and a Race tab whose strip chart is drawn to a completely different standard than the Rankings chart three clicks away.

**Delight: 7/10.** Held. `plane-copper-yaw` is a real improvement over `plane-6bvj` and costs nothing. The heat ramp finally prints the numbers it was always implying. The off-scale break mark with its value in the gutter is a genuinely well-made object, which is why the silent clamp on the rows just below the threshold is a shame. The two-point bins panel, the tie bracket, the worst-seat pill, the personal best that remembers the strategy: all still good. What keeps it at 7 is the same list as last round and it is getting old — the victory moment still shows two totals a second apart, the margin still prints four times, the countdown is still dead air with an empty door-status slot, and the wager is still unbuilt. Nothing here is delightful in the new sense; the delight is maintenance.

---

## End condition

Closer than the finding count suggests, and further than the last round's end condition assumed. Of the two blockers, one is a deleted `Math.max` plus a sign in a template string, and the other is moving a guard three lines down so the no-cell path clears what it cannot vouch for. Of the five majors: one is a padding formula (`anchorBand` from `ROW_OFFSETS`), one is a comparison operator (drop `OUTLIER_MULT`), one is a mode-aware predicate in `time-split.js` shaped exactly like the label map you shipped this round, one is reading three values you already hold at the call site instead of a literal, and one is a bibliography correction in three files. None needs new machinery, new data, or a design decision.

I would not run a seventh full adversarial round after these. What this needs is a fix round against the two blockers and the five majors, then a **targeted verification** on four things specifically, because all four were introduced by fixes and would be introduced again the same way: the comparison-row signs on the 737-800 two-class and the A321neo three-class, the anchor bboxes at 1280 and 400, the caveat string on the CRJ-700, and the Boarding toggle on a partial index. The minors and nits are the accumulated long tail and every one of them is polish; none of them misleads a reader.

One process note, since it caused three of this round's findings: every defect introduced this round came from a fix that was verified in isolation. The title moved out of the SVG and nobody re-measured the anchors. The index got honest and nobody re-clicked the mode toggle. The thesis row got added and nobody checked a preset where the thesis loses. The e2e suite you added is good — add the two-class preset and the 400 px anchor bbox to it and this class of regression stops.

REMAINING ABOVE NIT: 16
