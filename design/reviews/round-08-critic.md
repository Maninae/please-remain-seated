# Round 08 — Critic pass (data-visualization critic)

Reviewer: adversarial data-vis review, headless Chromium 1.58.2 at 1280x800, 1280x900, 1440x900, 1024x900 and 400x800 (the last with `hasTouch`).
Build: `index.html` at `9dcd4af`. Artifacts: `tests/e2e/artifacts/critic-round-08/`.
`npm run test:e2e`, three consecutive runs: **55/56, 56/56, 56/56**. One flaky test, named in the stability section.

**Review conditions.** The precompute is still running (PID 72479, ~750% CPU) and still the pre-fix binary: `data/rankings/index.json` advertises **62 cells with no `pending` key while 16 of them are not on disk**, all of them `b738-two-class` sensitivity cells. A Rankings visit to that preset costs **9 console 404s** in each mode. I reviewed on the live tree at 5197 and, for the partial-index path, on the same server with `index.json` replaced in-browser by a genuine `{cells: 44, pending: 18}` index built from what is actually on disk, with `index-preview.json` **passed through to the real committed file**, which is what production serves. I wrote nothing into `data/` and started no server.

---

## Verdict

This is the first round in four where the fixes did not manufacture a defect worse than the one they closed, and I want to say that plainly before I take the page apart again. Both blockers are genuinely dead. The partial-index path no longer throws: I served the real production shape, toggled Deplaning to Boarding on a preset whose board cell the primary index does not have, and got zero page errors, the Boarding button lit, the aircraft select still on A320, and — the part I did not expect — the lede and the footnote both switched from "10,000" to "**200 runs per strategy**", because the page fell through to the preview cell and said so in the two places a reader would look. The dishonest fixture is gone too; `fix-round-09.test.js:334` now has a `servePartialIndexWithRealPreview` helper and the test that 404s the preview file is no longer the one guarding this bug. The two compare panels now measure **7.961 px per minute each, a ratio of 1.0000**, on one shared 9m floor and one shared cap, with "Both panels share this scale." underneath. The caveat verdict is computed: I recomputed the back-to-front rate for all thirteen board presets off the cell files and the printed word matches the arithmetic on every one, including the two where the two rates land within half a passenger per minute and the clause is correctly dropped entirely. The Rankings tab writes `mode`, `preset` and the knobs to the URL, so the Boeing 777 deplaning chart is finally a link. The phone caveat cites only KLM, because KLM is the only anchor a phone draws. The three-tick ladder is gone: the worst tick coverage across 26 preset-mode pairs is now 81.5%, against the 59% I measured last round. Four of my seven minors and three of my ten nits closed. That is a clean round.

Now the sentence under the chart. It has been wrong for three rounds and every round fixed a different part of it. `index.js:719` reads `strategies.find(s => s.id === 'back-to-front')`, divides the passenger count by that row's median, and then prints the result under the words "**Front-to-back** runs slower here". Those are two different strategies and **both of them are rows on the chart six inches above the sentence**. On the default A320 the caveat says front-to-back runs at 5.9 pax/min; the row labelled "Front to back" on that chart is 40:06, which is 3.8 pax/min, and the row at 5.9 is the one labelled "Back to front, in zones" at 26:05. The page contradicts itself out loud, too: the About tab's own limitations list says "Front-to-back boarding runs slow at the tail (about **3.8** pax/min in the sim)". Two tabs, one named quantity, one default cabin, two numbers, and the tab with the smaller number is the one that matches the chart. Round 7 fixed the verdict word by computing it from a rate that belongs to a different row, so the word is now reliably correct about the wrong thing.

And two new things the round's own fixes created, both of which are the same failure the last three rounds had: verified where they fired, not where they landed. First, the shared axis is correct and it has flattened the thesis. The compare view now runs one 9m-to-60m scale across both panels because the cap is stretched to the slowest front-to-back run, so the lower panel — fourteen airlines, 530 px tall, under a heading that says "How airlines actually board" — has all fourteen medians inside **27.1 px of a 406 px plot band, 6.7% of the width, under two pixels per airline**, with no tick between 15m and 30m and no per-row values anywhere in the module. The textbook panel above it uses 50.5%. The off-scale machinery that would fix this was added this round for N7-m2 and **can never fire**: `niceCeiling` pads by 1.02 and rounds up, so `paddedMax` is always at or above the largest value drawn, and `rawValue > paddedMax` is dead code. Second, the anchor row assignment does not check whether two labels on the same row overlap. On the **default preset at every desktop width I tried**, "KLM 737 · 17 to 22 min" and "MythBusters · 24:29" share a row and collide, and on screen they read as one string: `17 to 22 minMythBusters · 24:29`. Round 7 certified N6-M3 fixed by measuring each label's bounding box against the viewBox. Containment is not collision.

---

## Re-verification of every round-07 finding

| id | Round-07 finding | Status | Evidence |
|---|---|---|---|
| **N7-B1** | Partial-index fallback dereferences null; e2e guard passes only because the fixture 404s `index-preview.json` | **FIXED** | `rankings-data.js:285` is now `const targetKnobs = (primary && primary.knobs) ? primary.knobs : knobs;` and the lookup is guarded on it. Repro on the production shape (genuine `{cells: 44, pending: 18}` index, real preview file served): `?tab=rankings&mode=deplane&preset=a320` then one click on Boarding → **zero page errors, zero console errors**. Boarding lit `aria-checked="true"`, aircraft select still **A320**, hero "11 of 14 airline procedures board A320 / 737 within a minute of random order", chart rows are the board rows, and both the lede and the footnote report "**200** runs per strategy" — the preview cell's real seed count, not the 10,000 the primary index would have claimed. Fixture demand met: `fix-round-09.test.js:334` `servePartialIndexWithRealPreview` serves the real preview index; the 404-ing helper no longer guards this path. |
| **N7-B2** | The two stacked compare panels drawn at a 1.82x scale ratio | **FIXED** | `computeSharedStripsAxis` over the union of both panels' seeds, passed to both `renderStrips` calls. Measured on board A320, 100 runs: panel 0 **7.961 px/min**, panel 1 **7.961 px/min**, **ratio 1.0000**; identical tick set `15m 30m 45m 60m`; identical floor note "axis starts at 9m"; caption "Both panels share this scale." present. Two consequences I am raising separately: **N8-M2** (the airline panel is now 6.7% of the band) and **N8-m2** (the caption is unstyled). Screenshot `strip-board-compare.png`. |
| **N7-M1** | "runs slower" is a literal, false on six of thirteen presets | **PARTIALLY FIXED** | The verdict word is computed (`b2fRate > mythbustersRate ? 'faster' : 'slower'`) with a `rateGap >= 0.5` drop. I recomputed all thirteen board headline cells: **13 of 13 verdicts correct**, including b717 (6.78) and a321neo-three-class (6.68) where the clause is correctly dropped. **Not fixed:** the sentence names the wrong strategy and cites the wrong row's rate. See **N8-B1**. |
| **N7-M2** | Nothing on the Rankings tab writes to the URL | **FIXED** | Measured round-trips: preset A320→Boeing 777 writes `preset=b777`; Boarding→Deplaning writes `mode=deplane`; a knob change writes `load=0.7`. All three land in `location.search` immediately. **Side effect raised separately:** the write goes through the shared store, so it also rewrites the Race tab. See **N8-M1**. |
| **N7-M3** | Phone caveat cites two anchors the phone never draws | **FIXED** | `renderRankingsChart` returns `drawnAnchors` and `composeChartCaveat` composes from it. At 400x800, board A320: chart draws exactly `KLM 737 · 17 to 22 min`; caveat reads "…about 5.9 pax/min in the sim" with **no MythBusters tick named** and "…lands at 20.7 min, against KLM's 17 to 22 min field range". Same on b738-hd. Desktop still names Spirit and MythBusters, which it draws. |
| **N7-m1** | `design/02-research.md` carries a fabricated figure and a wrong author | **STILL BROKEN, unchanged** | `:32` still reads "~30% average saving estimated at ~27M passenger-minutes or ~$2B per year"; `:8` still reads "Salari et al., arXiv:2007.16021". Byte-identical to round 7. I also found a **third** error in the same file: see **N8-m8**. |
| **N7-m2** | Strip chart has no cap treatment | **FIXED IN EFFECT** | `projectSeconds` still clamps, but the clamp is now unreachable: `niceCeiling` multiplies by 1.02 before rounding up to a step, and the cap is derived from the same values that get drawn, so no dot can pass `paddedMax`. Nothing is silently clamped. The `offScaleCount` branch added at `charts-strips.js:131/154` is therefore dead code, which matters because **N8-M2** needs exactly that mechanism. |
| **N7-m3** | Three deplane presets start at 0m with no floor note | **PARTIALLY FIXED** | `b737max8-lcc` now earns "axis starts at 3m". **CRJ-700** still `0m 1m 2m 3m 4m 5m`, no note, **25.3%** of the frame empty on the left (was 32.3%). **E175** still `0m 2m 4m 6m 8m 10m`, no note, **14.0%** empty left and **32.0%** empty right. See **N8-m3**. |
| **N7-m4** | Three board presets draw three ticks over 59% of the plot | **FIXED** | Swept 13 presets x 2 modes. `a321neo-three-class` now draws **7 ticks** (`15m…45m`) at 88.9% coverage; `b738-hd` 7 at 88.9%; `a321neo` 7 at 88.9%. Worst coverage across all 26 pairs is **81.5%** (b738-two-class board, 4 ticks). No row now sits in an unlabelled margin without an off-scale mark. |
| **N7-m5** | Board-mode canvas aria label says "from door open" | **FIXED** | At a finished board race: "Left cabin: finished at 9:13. Seats coloured by total time **from seatbelt sign off to seated**." Both lanes. The string "from door open" appears nowhere in board mode. |
| **N7-m6** | Last/Average segmented control carries no ARIA state | **FIXED** | Both buttons now `role="radio"` with `aria-checked` `true`/`false`, inside `#split-target`. The speed group carries the same treatment. |
| **N7-m7** | Race controls clipped 16 px below the fold at 1280x800 | **STILL BROKEN, fifth round** | `#race-controls` `top: 756, bottom: 816` in an 800 px viewport. Byte-identical to rounds 5, 6 and 7. [carried, round-02 NEW-M3] |
| **N7-n1** | Door-status slot empty and hidden | **STILL BROKEN** | Both `.door-status`: `textContent === ""`, `offsetParent === null`, at the start and at the finish, both lanes. |
| **N7-n2** | `m` and `t` do nothing | **STILL BROKEN** | Both leave `body.dataset.tab === 'race'` and the mode unchanged. |
| **N7-n3** | Loser's time prints 5x at the finish | **STILL BROKEN** | Board finish on CRJ-700: `9:55` **5x**, `9:13` **4x**, margin `0:42` **4x**. |
| **N7-n4** | "Source or assumption" holds seven first words | **STILL BROKEN** | 16 rows, first words: `Assumption`, `Derived`, `Estimate`, `Schultz`, `Wald`, `Steffen`, `MythBusters`. Seven, unchanged. |
| **N7-n5** | Six phone row labels ellipsize into `<title>` tooltips | **STILL BROKEN** | 400x800, board a320 and b738-hd: **6** ellipsized labels each, every one carrying a `<title>` a touch device cannot open. |
| **N7-n6** | Two or three shaded regions, one caption | **STILL BROKEN** | A320 board: **3** shaded regions (`fill-opacity` 0.045 h746 airline ground, 0.08 h54, 0.08 h324), one caption. CRJ-700 board: **2** regions at 0.08 (h114, h414), one caption. |
| **N7-n7** | MythBusters tagged `measured`, identical to Schultz's field data | **FIXED** | `about.js:96` now `kind: 'demonstration'` with its own rule at `css/about.css:128` (ink-soft, italic, dotted underline). Five treatments now exist with no key: see **N8-m7**. |
| **N7-n8** | `rankings-stats.js` docstring describes a "0.1" the code never prints | **FIXED** | The docstring now says the near-zero branch "prints as 0.0 person-years / day … without a direction word", which is what `fmtPersonYears(0)` does. |
| **N7-n9** | `void knobs;` — an unused parameter | **FIXED** | `void knobs;` is gone and `knobs` is genuinely load-bearing: it is the fallback for `targetKnobs` on the partial-index path, which is the N7-B1 fix itself. |
| **N7-n10** | Live `index.json` advertises 62 cells with 37 absent, no `pending` key | **STILL TRUE** | Now 62 advertised, **16 absent**, still no `pending` key. A Rankings visit to `b738-two-class` costs **9 console 404s** per mode. Old binary still in memory; will stay true until the run is replaced. Folded into **N8-m5**, which is about what the reader sees when it happens. |

**Round-07 scoreboard: 2 blockers fixed. Majors: 2 fixed, 1 partial. Minors: 3 fixed, 1 fixed-in-effect, 1 partial, 2 still broken. Nits: 3 fixed, 7 still open.**

---

## New findings

### BLOCKER

**N8-B1. The chart caveat names "Front-to-back" and prints the back-to-front row's number, on every preset where the clause appears, and the About tab prints the other number for the same sentence.**

`js/ui/rankings/index.js`:

```js
:695   const b2f = cellData.strategies.find((s) => s.id === 'back-to-front');
:706   const b2fRate = pax / (b2f.medianSeconds / 60);
:719   parts.push(`Front-to-back runs ${verdict} here than the MythBusters back-to-front field test: …`);
```

`back-to-front` and `front-to-back` are two separate entries in `js/engine/strategies/board.js` (`:67` "Back to front, in zones", `:83` "Front to back") and **both are drawn as rows on the chart immediately above this sentence**. Measured from the cell files, both rows, all thirteen board presets:

| preset | row labelled "Front to back" | rate | row labelled "Back to front, in zones" | rate | caveat prints |
|---|---|---|---|---|---|
| A320 / 737 | 40:06 | **3.8** | 26:05 | 5.9 | "Front-to-back … about **5.9**" |
| Boeing 777 | 38:45 | **7.9** | 25:06 | 12.2 | "Front-to-back … about **12.2**" |
| 787-9 three-class | 32:38 | **7.9** | 19:26 | 13.3 | "Front-to-back … about **13.3**" |
| 737 MAX 8 LCC | 47:18 | **3.1** | 27:08 | 5.5 | "Front-to-back … about **5.5**" |
| CRJ-700 | 15:52 | **3.7** | 7:14 | 8.0 | "Front-to-back … about **8.0**" |

The cited rate is 1.5x to 2.2x the rate of the row it names, on all eleven presets that print the clause. And the page settles the argument against itself: `js/ui/about.js:292` says "Front-to-back boarding runs slow at the tail (about **3.8** pax/min in the sim, against 7 pax/min in the MythBusters back-to-front test)". 3.8 is the A320's actual front-to-back rate. Two tabs, two numbers, one sentence, and a reader who clicks between them cannot tell which is the lie.

This is the third consecutive round on this one sentence. Round 6 fixed the cabin, round 7 fixed the verdict word, and the subject of the sentence has been wrong the whole time — which is why fixing the verdict word made it worse: the page is now confidently correct about a comparison it is not making.

**Fix:** the intended comparison is sound and should stay — MythBusters measured *back-to-front*, so comparing the sim's back-to-front row to it is the like-for-like reading. Change the words, not the lookup: "**Back to front, in zones** runs `${verdict}` here than the MythBusters back-to-front field test". Then check `about.js:292` separately; its 3.8 is right for front-to-back but is a hard-coded A320 figure on a preset-independent page.

Evidence: `rankings-board-a320-1280x800.png` (the two rows and the caveat are in one frame).

### MAJOR

**N8-M1. Browsing the Rankings tab silently rewrites the Race tab's aircraft, mode and both strategies.**

The N7-M2 fix routes `mode`, `preset` and the knobs through the shared store, which is also the Race tab's state. So exploring the rankings reconfigures the race the reader left behind, with no notice and no way back.

| | aircraft | mode | strategy A | strategy B |
|---|---|---|---|---|
| Race tab as the reader set it | A320 / 737 | board | Random order | United Airlines |
| after: Rankings → Boeing 777, → Deplaning, load knob → 70% | **Boeing 777** | **deplane** | **Free-for-all** | **Row by row** |

Four controls and one knob changed on a tab the reader never touched. The strategies changed because the mode changed and each mode has its own default matchup, so the reader loses their chosen matchup as a second-order effect of looking at a different chart. Merely *visiting* the Rankings tab is safe — I checked with an off-grid `load=0.93` and it survived untouched — so this fires only on an interaction, which makes it harder to notice and easier to disbelieve.

Sharing the aircraft across tabs is a defensible product decision. Silently replacing the reader's matchup and their load setting is not, and the Rankings knobs can only take three grid values, so the shared write also coarsens a continuous race control to a discrete one.

**Fix:** give the Rankings tab its own `rankingsMode` / `rankingsPreset` / `rankingsKnobs` slice and write those to the URL under their own keys. If the aircraft really is meant to be shared, share only the aircraft, and say so in the UI.

**N8-M2. The shared axis flattened the airline panel to 6.7% of its width, and the one mechanism that would fix it is dead code.**

Board compare, A320, 100 runs, 1280x900 (a second run from the one in the table above; the cap tracks that run's slowest seed, so the shared px/min is 7.81 here and 7.961 there — equal across both panels either way). Measured median-tick positions:

| panel | rows | medians span | as % of the 406 px plot band | ticks between the data |
|---|---|---|---|---|
| 0 (textbook) | 9 | 204.9 px (26.3 min) | **50.5%** | one, at 30m |
| 1 (airlines) | 14 | **27.1 px** (3.5 min) | **6.7%** | **none** |

Fourteen airline procedures, a panel 530 px tall, and under two pixels of horizontal separation per airline. The nearest tick labels are 15m and 30m, so there is no way to read a value off the axis, and `charts-strips.js` draws no per-row values at all — unlike the ranked chart three clicks away, which prints `20:43 … 23:44` on these same fourteen rows. The reader can see that the airlines are clustered, which is true and is part of the finding, but cannot see the order, the size of the spread, or where Lufthansa sits relative to Delta.

The cap is the cause: `computeSharedStripsAxis` takes `niceCeiling` of the union max, and the union max is the slowest front-to-back run, so one strategy's tail sets the resolution for twenty-three rows. The repo already owns the right answer — the ranked chart caps below the outliers and prints a break mark and "(off scale)" with the true value — and this round even added an off-scale branch to `charts-strips.js` for N7-m2. It cannot fire, because `niceCeiling` pads by 1.02 and rounds up, so `paddedMax >= max(values)` always.

**Fix:** set the shared cap from a high percentile across both panels (p95 of the union, say) rather than the max, and let the `offScaleCount` branch that already exists do its job on the dots beyond it. That is one changed line plus the code you already wrote.

Evidence: `strip-board-compare.png`.

**N8-M3. Two of the three measured anchors collide into one unreadable string, on the default preset, at every desktop width.**

Board A320, `getBBox()` on the anchor labels:

| label | x | width | right edge | row (y) |
|---|---|---|---|---|
| Spirit A320 · 20 min | 371.4 | 83.6 | 455.0 | 42 |
| KLM 737 · 17 to 22 min | 358.5 | 92.1 | **450.6** | **54** |
| MythBusters · 24:29 | **447.9** | 85.9 | 533.8 | **54** |

Same row, **2.7 px of overlap, 12 px of vertical overlap**, which is the whole glyph height. On screen it renders as `17 to 22 minMythBusters · 24:29` with no gap — I read the 2x crop to confirm, it is not a sub-pixel artefact. Swept 6 narrowbody presets x 4 widths: the collision is **A320-only and present at 1024, 1280 and 1440**; the other narrowbodies escape because their wider axis range gives a lower px/min and the labels separate. A320 is the default preset, so this is the first chart every reader sees.

`anchorRowOffsetsForWidth` assigns rows by width alone and never asks whether two labels already on a row overlap. Round 7 certified N6-M3 fixed by measuring each label against the viewBox — a containment test, which a collision passes.

**Fix:** after assigning rows, walk the labels left to right and push any label whose left edge is within a few pixels of the previous label's right edge onto the next row. Assert label-to-label separation in the e2e test, not just viewBox containment.

Evidence: `anchor-band-1280-2x.png`.

**N8-M4. On six presets the caveat makes a field comparison and then says, in the same paragraph, that no field comparison applies to this cabin.**

`rankings-anchors.js:22` restricts anchors to six narrowbody presets, and `glossary.js:456` states the reason to the reader: "They only appear on narrowbody presets, **where the comparison is fair**." The caveat ignores its own rule. Full text, Boeing 777:

> "This ranking is a 306-passenger cabin at these settings. Front-to-back runs **faster** here than the ~7 pax/min back-to-front field figure: about 12.2 pax/min in the sim. The fastest simulated airline procedure, Lufthansa, lands at 25.7 min. **No airline field anchor sits on the chart for this cabin.**"

The ~7 pax/min figure is MythBusters' 173-seat single-aisle mock. The 777 is a 3-4-3 twin-aisle at 306 seats; two aisles are most of why the number is higher. The sentence invites the reader to conclude the sim disagrees with the field test when the two are not measuring comparable cabins, and the page says so four words later. Same paragraph, on **crj700, e175, b767, b787, b777 and b789-three-class** — every preset where the anchor is withheld.

**Fix:** gate the whole MythBusters clause on `mythbustersAnchor` being drawn, the way the Spirit and KLM clauses already are. The `else` branch at `index.js:721` that re-phrases the comparison without naming the tick is the bug: on a phone it is right (the tick is dropped for space, the cabin still matches), on a widebody it is wrong (the cabin does not match). Those are two different reasons for an absent anchor and they need two different answers.

### MINOR

**N8-m1. Three copies of `niceCeiling`, and round 6's fix reached one of them.** `rankings-sensitivity.js:395` carries the fine ladder N6-m9 produced (`[1,2,3,5,8,10,12,15,18,20,22,25,28,30,35,40,45,50,60,75,90,120]`). `rankings-chart.js:754` and `charts-strips.js:287` still carry the coarse one (`[1,2,3,5,10,15,20,30,45,60,90,120]`). Same function name, same job, drifted. Visible cost: E175 deplane tops out at 6.8 min and the ranked chart caps at **10m**, leaving **32.0% of the frame empty on the right**; the fine ladder would cap at 8m.

**N8-m2. "Both panels share this scale." has no CSS rule.** `grep compare-shared-scale css/` returns nothing, so the `<p>` renders at the inherited **15px, full `--ink`, 15px block margins** — the same size as the panel titles and larger and darker than its own sibling `.compare-timing` (11px, `--ink-muted`) eight pixels below it. Axis chrome set at content weight. It is also appended after both panels, 530 px below the top one, while the code comment at `compare.js:212` says "A single caption **between** the two panels".

**N8-m3. CRJ-700 and E175 deplane still start at 0m with no floor note.** [carried, N7-m3] CRJ-700 `0m 1m 2m 3m 4m 5m`, **25.3%** empty left; E175 `0m 2m 4m 6m 8m 10m`, **14.0%** empty left plus the 32.0% empty right from N8-m1, so **46% of that frame carries no data**. `computeAxisFloor`'s `candidate < paddedMax * 0.25` gate is what stops both.

**N8-m4. "Tap outside to close" is a 40 px strip on a 400 px phone, and it is this suite's flaky test.** Drawer open at 400x800: `#settings-scrim` is 400x800, `#settings-panel` is 360x800 at `x: 40`. `document.elementFromPoint` at the scrim's centre (200, 400) returns `SPAN.knob-label` — the panel. Only the leftmost 10% of the screen dismisses the drawer, and it is the edge a thumb reaches last. This is the mechanism behind the run-1 failure in the stability section: Playwright clicks an element's centre, the centre is obstructed, and whether the retry finds the 40 px strip is timing-dependent.

**N8-m5. A missing sensitivity cell shows the reader a build command.** On `b738-two-class` (9 console 404s per visit, both modes) the sensitivity block prints: "Sensitivity cell files have not been generated yet. Run `npm run precompute` to fill them in." On `b777`, which has no sensitivity plan at all, the same region prints a reader-facing sentence: "No sensitivity data was precomputed for this preset. Choose the A320 or the 737-800 (first + economy) to see the knob sweeps." Two empty states, one written for the maintainer. The maintainer-facing one is the one a live partial precompute will actually show.

**N8-m6. The masthead mode control is a `tablist` whose tabs use `aria-pressed`.** `index.html:75-77`: `<div class="segmented" role="tablist">` containing two `<button role="tab" aria-pressed="…">`. `role="tab"` takes `aria-selected`; `aria-pressed` is not supported on it and is ignored, so a screen reader announces two tabs with neither selected. Neither carries `aria-controls`, and they switch the simulation mode rather than a panel — while the real tab rail is a separate, correct `tablist` 40 px to the left. Two tablists on one page, one of them not a tablist.

**N8-m7. Five encodings in the assumptions table, no key.** `assumption` (italic, tinted ground), `estimate` (italic, ink-soft), `derived` (upright, ink-soft), `measured` (upright, full ink), `demonstration` (italic, ink-soft, dotted underline). Nothing on the About tab explains the code. `estimate` and `demonstration` differ by a dotted underline alone, and a dotted underline is the web's tooltip affordance, so the one row it marks looks clickable and is not.

**N8-m8. `design/02-research.md` now carries three citation errors, including a new one.** [extends N7-m1] `:32`'s "~27M passenger-minutes or ~$2B per year" and `:8`'s "Salari et al." (the paper is Schultz & Soolaki) are unchanged from round 7. New: `:22` dates MythBusters episode 222 to **2012**, while `about.js:96`, `rankings-anchors.js:60`, `glossary.js:456`, `README.md:71` and `design/06-airline-research.md:225` all say **2014**. I checked the primary source: mythresults.com gives episode 222, aired **21 August 2014**, 173 seats, back-to-front 24:29. The code is right and the file `CLAUDE.md` names as the citation of record is wrong.

**N8-m9. Race controls still clipped 16 px below the fold at 1280x800.** [carried, round-02 NEW-M3, fifth round] `top: 756, bottom: 816` in an 800 px viewport.

### NIT

**N8-n1.** Door-status slot still empty and `display:none`, both lanes, both modes, start to finish. [N7-n1]
**N8-n2.** `m` and `t` still do nothing. [N7-n2]
**N8-n3.** At the finish the loser's time prints 5x, the winner's 4x, the margin 4x. [N7-n3]
**N8-n4.** "Source or assumption" still holds seven different first words. [N7-n4]
**N8-n5.** Six of the phone row labels ellipsize, each with a `<title>` a touch device cannot open. [N7-n5]
**N8-n6.** Three shaded regions on A320 board, two on CRJ-700, one caption either way. [N7-n6]
**N8-n7.** `charts-strips.js:131` `if (rawValue > paddedMax) offScaleCount += 1;` is unreachable for the reason given in N7-m2 above; it becomes live the moment N8-M2 is fixed, so leave it, but it is currently a branch no test can cover.
**N8-n8.** `compare.js:212`'s comment says the shared-scale caption sits "between the two panels"; `:217` appends it after both. [see N8-m2]
**N8-n9.** `about.js:292` hard-codes "about 3.8 pax/min" on a page that never names a cabin; it is the A320 figure and it moves with the preset the reader was last looking at.
**N8-n10.** A hand-edited `?load=0.93` leaves the visible slider thumb at 0.95 while the label and the simulation both use 0.93. Only reachable by editing the URL.

---

## Stability: three consecutive `npm run test:e2e` runs

| run | tests | pass | fail |
|---|---|---|---|
| 1 | 56 | **55** | **1** |
| 2 | 56 | 56 | 0 |
| 3 | 56 | 56 | 0 |

**Flaky test: `drawer opens and closes at 400 px with focus trapped`** (`tests/e2e/sidebar-popover.test.js:159`). It fails on `await page.click('#settings-scrim')` with a 30 s `TimeoutError`, the log repeating `<span class="knob-label">…</span> from <aside class="page-side" id="settings-panel"> subtree intercepts pointer events`. This is not test flake to be re-run away: it is **N8-m4**, a product defect surfacing intermittently. The scrim's centre is permanently covered by the drawer panel, and whether Playwright's retry finds the 40 px uncovered strip depends on timing. Fix the target, not the test. Runs 2 and 3 were clean, and the precompute was consuming ~750% CPU throughout all three.

---

## What would make me send it to a friend

1. **Rename the strategy in the caveat.** The sentence under the main chart has been wrong for three rounds, and it is currently wrong in the most embarrassing way available: it prints one row's number under another row's name while both rows are on screen, and the About tab prints the correct number for the same claim. Two words.
2. **Cap the compare axis at a percentile and let the off-scale mark fire.** The shared scale was the right call and it cost you the thesis panel: fourteen airlines inside 27 px. You already wrote the off-scale code this round; it just cannot reach. One changed line makes the bottom panel legible without giving up the shared scale.
3. **Stop the Rankings tab from editing the Race tab.** A reader who sets up Random vs United on an A320, goes to look at the 777 rankings, and comes back to a deplaning Free-for-all race will not file a bug, they will just stop trusting the controls.
4. **Separate the anchor labels.** Two of your three measured marks fuse into one string on the default chart at every desktop width. Those three ticks are what make the simulated rows believable; they should not look like a typo.
5. **The wager before the door opens.** Sixth round on this list. The thesis row now prints a signed, sometimes humiliating number and the compare chart now has one honest axis, so there is finally a result worth being wrong about. Two buttons, one guess, one reveal.

---

## Scores

**Truth: 8/10.** Held, and the composition of the 8 has improved a lot. Both round-7 blockers are genuinely dead and I verified each against the shape production actually serves rather than the shape the fixture prefers: the partial-index path throws nothing, keeps the aircraft the reader chose, and tells the truth twice over about falling back to a 200-seed cell. The verdict word is computed correctly on all thirteen presets including the two where the honest answer is to say nothing. The URL now reproduces the chart on screen. The phone caveat cites only what the phone draws. What holds it at 8 is one sentence and one paragraph: the caveat names "Front-to-back" while printing the back-to-front row's rate on all eleven presets that print it, contradicting the About tab by a factor of 1.5, and on six presets it makes a field comparison the page declares inapplicable in its own next breath. Both are the same defect the last three rounds kept half-fixing, and both are one conditional away from closed.

**Clarity: 8/10.** Held, with the ledger moving hard in both directions. The compare panels now share one measured scale, 7.961 px/min against 7.961, with a caption saying so. The tick ladder went from three ticks over 59% of the plot to a worst case of 81.5% across 26 preset-mode pairs. The board aria label stopped describing deplaning, the Last/Average control got real radio semantics, and a partial precompute now degrades to a readable page instead of a lie. Against that: the shared axis compressed fourteen airline rows into 6.7% of the plot band with no tick and no values, which is the single largest loss of information on the site; the two anchor labels on the default chart render as one string; the shared-scale caption is 15px full-ink axis chrome; two deplane charts still waste a quarter to a half of their frame; and the assumptions table now carries five visual encodings with no key.

**Delight: 7/10.** Held, and honestly this was not a delight round, which is the right call when two blockers are open. The one real gain is that the Rankings tab is now linkable, so the Boeing 777 deplaning chart is something you can send to someone — which is exactly what this page is for, and it has been impossible until now. Against that, nothing new was built and the same list is still standing: the countdown is dead air over an empty door-status slot, the margin prints five times at the finish, `m` and `t` still do nothing, the phone drawer only closes if you tap the left tenth of the screen, and the wager is unbuilt for a sixth round. The delight here is still entirely load-bearing utility with no play in it.

---

## End condition

Not yet, and I want to be precise about the distance, because it is short and it is all in one place. Every finding above nit except three is in the Rankings caveat, the compare axis, or the anchor row assignment. The blocker is a rename. Two of the four majors are one line each (a percentile instead of a max; gate the clause on the drawn anchor). The third is a row-packing loop. The fourth — the Rankings tab editing the Race tab — is the only one that needs a decision rather than a patch, and the decision is just whether the aircraft is shared or not.

**I would not run a ninth full adversarial round after these.** What this needs is a fix round against the blocker and the four majors, then a **targeted verification** on five things, because all five would be reintroduced the same way: the caveat's strategy name checked against the row label the chart actually drew (not against the cell id), the airline panel's median span measured as a fraction of the plot band, the anchor labels asserted non-overlapping **pairwise** rather than contained in the viewBox, the Race tab's aircraft and both strategies asserted unchanged after a Rankings interaction, and the caveat asserted to print no MythBusters clause on a widebody.

Three process notes.

First, and this is the good one: **the round-7 fixes held up under a hostile re-test, including the two I expected to break.** I served the real production index shape with the real preview file and could not make the fallback throw. I measured both compare panels rather than trusting the caption. That has not been true of a fix round in this project before, and the reason is visible in the diff: `fix-round-11.test.js` and the rewritten `fix-round-09.test.js:334` assert against measured geometry and real file shapes instead of against the absence of a file.

Second: **the two defects this round created are both "verified where it fired".** The shared axis was verified as a ratio and not as a resolution, so nobody looked at what 9-to-60 does to a 3-minute spread. The anchor headroom was verified as containment and not as separation, so nobody looked at what happens when two labels land on one row. Both are the previous rounds' pattern with a shorter shadow, and both have a cheap generic defence: after any layout fix, measure the thing the fix was *for* (can I read a value? can I read a label?), not only the thing the fix *changed*.

Third: **one of your 56 e2e tests is reporting a product defect as a flake.** The drawer test fails one run in three because the scrim it clicks is 90% covered by the panel. The temptation with a 55/56 is to re-run until it is green. The log names the covering element on every retry line.

REMAINING ABOVE NIT: 14
