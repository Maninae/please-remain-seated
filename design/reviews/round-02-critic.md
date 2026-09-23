# Round 02 — Critic pass (snooty gamer)

Reviewer: adversarial play-test, headless Chromium 1.58.2 at 1280x800, 1280x1000, 1440x900 and 400x800.
Build: `index.html` served from `python3 -m http.server 5197`, repo at `e00d848`.
Artifacts: `tests/e2e/artifacts/critic-round-02/`. Console clean on every single run — zero errors, zero pageerrors, zero failed requests, across roughly forty races, nine presets, two modes, three compare batches and a `localStorage`-throws context. Load is 383 ms over 47 requests. Frame times at 60x hold a 10.4 ms median with **zero** frames over 33 ms, *including* on the 777 with 306 passengers and two aisles. That is real engineering and I am not going to pretend otherwise.

---

## Verdict

You fixed almost everything I yelled about and I am genuinely annoyed about how hard that makes my job. Two doors is now first on the chart saving 2:32 instead of a rounding error, the split bars finally draw a 6:15 shorter than a 6:43, the sliders are ink instead of Fisher-Price blue, the 777 is 344 px tall and takes 10.6 minutes like a 777 should, the share link round-trips *every* knob and reproduced my 777 race to the second in a cold browser, clicking a passenger works 199 times out of 216 and lands on the exact seat under the cursor, and there is a result card with a winner, a margin, a reason, a seed and a personal best that actually tracks across runs. Eleven of my fourteen headline findings are genuinely, verifiably dead. And then — and I want you to sit with this — **you put that beautiful result card 76 pixels below the fold at 1280x800, so at the instant the race ends what the player actually sees is two grids of three hundred and sixty empty beige rectangles, a legend explaining four passenger states in a cabin containing no passengers, and a 54 px clock.** I measured it: `pctVisible: 0`. The payoff you built to answer my last review is unreachable without scrolling, and nothing scrolls. Meanwhile the one hex value that carries your entire thesis is sabotaging you — `moving: '#1f8a4c'` and `blocked: '#1f8a4c'` are the *same colour*, hollow versus filled at six pixels, so a 777 aisle where exactly one person out of seventy is moving renders as two cheerful unbroken green chains and the "single-lane road" story dies on the screen it is supposed to live on. Your own theme docstring says "moving passengers are the only saturated green on the page" two lines above the line that makes that false. Add a `media/og.png` that 404s — every share you are designing for unfurls broken — a left half of the cabin that systematically beats the right half by 13-23 seconds because ties break on ascending passenger id and ids run in column order, a follow line that still tells me a man with a bag had "0 bags" because the engine overwrites `bagCount` at `deplane-sim.js:185`, and bag sliders that slide out from under my finger, and you have a toy that is four bugs from excellent and currently lands on "impressive". I ran it forty times. I'd run it twice more if the finish card were on screen.

---

## Re-verification of every round-01 finding

| id | Round-01 finding | Status | Evidence |
|---|---|---|---|
| **B1** | "Two doors" benchmarked with one door, saving shown as 0:00 | **FIXED** | Compare, 100 seeds, A320 defaults: Two doors ranks **1st**, title reads "Two doors saves **2:32** over Free-for-all". At 500 seeds: 2:19. CLI ground truth over 60 seeds: 6.35 → 3.98 min = **2.37 min (37%)**. Race on the same settings: "Two doors deplaned in 4:45, 3:19 ahead". Three surfaces, one answer. `13-compare-100.png` |
| **B2** | Split bars normalized per row, unequal times drew equal | **FIXED** | One shared 768-unit scale. Lane A rects sum **715.62**/768 at total 6:15; lane B **768**/768 at 6:43. Length ratio 0.932 vs time ratio 0.930. Short bar carries a dashed remainder outline. `10-time-split.png` |
| **B3** | Phone legend `display:none` | **FIXED** | At 400x800 `.race-legend` computes `display:flex`, box 162x37, text "moving/blocked/bag/seated". `20-phone-midrace.png` |
| **M1** | Default iOS-blue sliders and checkbox | **FIXED** | All nine `input[type=range]` plus `#sound-toggle` report `accentColor: rgb(31, 42, 51)`. Track and thumb restyled to paper. |
| **M2** | 73 px dead void in the hero card | **FIXED** | Card 376, canvas 213, canvas→legend gap 8 px, follow-line→card-bottom 13 px. Void is gone. |
| **M3** | Canvas hard-coded 180 px for every aircraft | **FIXED** | Swept all nine: 190 px (2-2 CRJ/E175), 213 (3-3), 272 (2-3-2 767), 320 (3-3-3 787), **344** (3-4-3 777). Card grows with it, 353→507. `24-b777-race.png` |
| **M4** | 777 deplaned faster than an A320 | **FIXED** | 20 seeds, load 0.85: CRJ 2.81 min / 20.6 pax·min⁻¹, A320 6.17 / 24.8, **777 10.61 / 28.8**. Under the 30 pax·min⁻¹ door ceiling and inside Schultz's Q1–Q3. |
| **M5** | Sim misses its own calibration gate; spec and tests disagree | **PARTIALLY FIXED — goalposts moved** | `git diff 29683d9 HEAD -- design/01-spec.md`: gate 1 was **rewritten**, not met. Lower bound 8 → **5** min, sample 50 → **40** seeds, primary gate swapped from minutes to pax/min. Spec and test now match verbatim. First-2-min gate now passes on all four seed families (20.4–21.7, was 14.6 on one). But the new whole-run [14,24] pax/min gate **fails on 2 of 4 families**, including `a320-deplane-*`, the CLI's own default (24.06). `npm test` 270/270. |
| **M6** | Follow line reports bags *remaining*, not bags carried | **STILL BROKEN** | Same passenger, one run: start `Seat 17A · 1 bag (1 left) · waited 1:00`, exit `Seat 17A · **0 bags** · waited 3:27`. `race-helpers.js:45` correctly reads `passenger.bagCount` as the total — but `js/engine/deplane-sim.js:185` does `passenger.bagCount = passenger.bagBins.length`, so the field is 0 by exit. Proved headless: `at t=0 bagCount = 1` → `at exit bagCount = 0`. `board-sim.js:217` does the same with `-= 1`. |
| **M7** | 50% of cabin clicks hit nothing | **FIXED** | 24x9 grid, mid-race: **199/216 = 92%**. All 17 misses are outside the fuselage (nose and tail corners). Precise, not just generous: same x, nine y's returns `14A 14A 14A 14B 14B 14D 14E 14F 14F`. |
| **M8** | Board mode reuses deplane copy | **FIXED** | Board: deck "two ways **on**", legend "moving / blocked / **stowing** / **waiting**", count "of 153 **on**", caption "· last **on**", heading "RUN IT 100 TIMES". |
| **M9** | Compare 33.7 s / 100.9 s single-threaded | **PARTIALLY FIXED** | Now 11.7 s / 58.0 s (2.9x, 1.7x). Self-reported footer is honest (page says 58.0, I measured 58.1). But progress reaches **83% in 6.3 s and the last 17% takes 5.4 s** — 46% of the wall clock is the tail. `compare-pool.js` caps at `WORKER_CAP = 6` on a 10-core machine and dispatches **one strategy per task**, so 7 strategies run in two waves and the second wave is one worker with five idle. |
| **M10** | Share link drops every More knob | **FIXED** | URL now carries `politeness, distracted, prep, bag0, bag1, bag2, bins` on top of the original eight. Built a 777 / load 100% / legacy-bins / distracted-34% scenario, copied the link, opened it in a **fresh context**, re-raced: headline identical to the character — "Two doors deplaned in 10:42, 2:19 ahead of Free-for-all." |
| **M11** | Finish is an empty room; loser gets no number | **PARTIALLY FIXED** | Card exists and is good: winner in green, margin, a *why* line that picks the real differentiator (seated / bags / aisle-blocked vary by run), preset, load, compliance, families, seed, Copy link, Restart, PB. Loser now reads "finished 0:09 later". **But the cabins are still empty and the card is 100% below the fold** — see NEW-B1. |
| **m1** | Two clocks are identical twins for ~95% of the race | **STILL BROKEN** | Sampled: 1:40/1:40, 3:41/3:41, 5:43/5:43 on A320; **2:12/2:12** on the 777; **0:47/0:47** on phone at 36 px. The differing number (62 vs 67 off) renders at 13 px. |
| **m2** | "Run it 200 times" defaults to 100 | **FIXED** | Heading reads "RUN IT 100 TIMES" and live-updates to "RUN IT 500 TIMES". |
| **m3** | Eight letterspaced all-caps micro-labels | **PARTIALLY FIXED** | Seven remain: AIRCRAFT, LOAD FACTOR, COMPLIANCE, FAMILIES, BINS at 11 px, and WHERE THE TIME GOES / RUN IT 100 TIMES at 12 px. The last two are *section titles* set smaller than the 19 px finding sentence they head. |
| **m4** | `Weibull(1.7, 10 s)` in the explainer | **FIXED** | Now "Bag retrieval is usually about 9 seconds; stowing is longer." |
| **m5** | "Two doors… two aisles instead of one" | **FIXED** | Now "each half of the plane drains through its own exit instead of queueing behind the front door." Correct mechanism. |
| **m6** | "prep 1-2 s" understated config | **FIXED** | "Prep is usually 2-3 seconds, with a long tail of distracted passengers who take much longer to notice the aisle." |
| **m7** | Everyone stands up at once; instantaneous uniform ramp | **STILL BROKEN — and the staging window made it worse** | Engine trace, A320 free-for-all: t=2 s → **36 of 64** aisle cells occupied, 35 people `stepping_out` simultaneously. t=5 s → 59/64 with **35 retrieving bags at once**. t=20 s through t=45 s → pinned at **61-64/64, frozen**. The door does not open until 45 s, so the opening act is 5 s of a mass stand followed by 40 s of a still image. |
| **m8** | Amber is not scarce | **STILL BROKEN — quantified** | Canvas pixel census at t=5 s: amber **4.22%** of the cabin, green **0.26%**. Amber outweighs your one accent **16 to 1**, and the bag glyph is a filled suitcase carrying roughly twice the ink of a dot. `28-t5s-amber.png` is a solid amber stripe. |
| **m9** | Reverse pyramid beats Steffen optimal | **STILL BROKEN** | 30 seeds, A320: reverse-pyramid **14.40** vs steffen 16.01 at defaults; **11.86** vs 12.91 at compliance 1.0 / groups 0. Unchanged from round 1. No boarding code was touched this round, and the calibration test only asserts steffen < wilma < random, so the ordering is unguarded. Steffen & Hotchkiss 2012 (arXiv 1108.5211) measured Steffen fastest on a narrowbody; reverse pyramid was never experimentally tested against it. |
| **m10** | og:description contradicted the product | **FIXED (text) — but see NEW-B2** | Now "Race two deplaning strategies on the same plane. See where the time goes and why the aisle is a single-lane road." |
| **n1** | Doubled spaces in the split caption | **FIXED** | Renders as "Free-for-all / · last off / total 6:15" on three clean lines. |
| **n2** | `passenger #67` exposed an array index | **FIXED** | `formatSplitTitle` is now dead code — defined in `format.js:13` and imported by nothing. |
| **n3** | Subtitle contradicts the followed passenger | **PARTIALLY FIXED** | Caption correctly becomes "· seat 17A". But `#time-split-subtitle` still reads "The last passenger. Click a dot…" and the Last/Average toggle still reports `last:true` while showing neither. |
| **n4** | Canvas `aria-label` is a bare "Left cabin" | **STILL BROKEN** | Mid-race, 153 passengers moving: `aria-label="Left cabin"`. Unchanged. |
| **n5** | Families slider half-width, ragged | **FIXED** | Load factor, Compliance, Families all 215 px. |
| **n6** | `0.6` from URL becomes `0.60` after a change | **FIXED** | Stays `load=0.6` after changing an unrelated slider. |
| **n7** | Forward galley is a blank box with no door | **PARTIALLY FIXED** | A door gap is now cut into the fuselage outline with two ink sill pips, front and (for two-doors) rear. But the galley is still an empty beige rectangle, there is no exit mark, arrow or jet-bridge, and at 1:1 the gap is a hairline — see NEW-m2. `23-laneA-fwd.png`, `23-laneB-aft.png` |

**Round-01 scoreboard: 17 fixed, 5 partially fixed, 6 still broken.**

---

## New findings

### BLOCKER

**NEW-B1. The result card is 100% below the fold at 1280x800. The finish is two grids of empty rectangles.**

Load at 1280x800, never scroll, drive the race with keyboard so nothing steals focus, wait for the finish:

```
{"scrollY":0,"finishTop":876,"finishBottom":1035,"vh":800,"visible":false,"pctVisible":0}
```

The page does not scroll to it. What is on screen instead (`30-finish-1280x800-nofold-scroll.png`): 413,220 CSS px² of empty cabin, **32% of the entire viewport**, plus a legend patiently explaining "moving / blocked / bag / seated" for a cabin containing none of them. The largest type on screen at the moment of maximum attention is a clock at 54 px. The card carrying the winner, the margin, the reason, the seed, the Copy link and the personal best is 159,531 px² of content sitting 76 px past the bottom edge.

You built exactly what I asked for last round and then hid it.

**Fix:** the result belongs *in* the cabins, not under them. Draw it over the emptied cabin of the winning lane, or promote it into the card headers, or at minimum scroll it into view on finish. Do not make me find my own trophy. See the heat-view recommendation below, which solves this and NEW-M1 in one stroke.

**NEW-B2. `og:image` is a 404. Every share unfurls broken.**

```
$ ls -la media/          # total 0 — the directory is empty
$ curl -o /dev/null -w "%{http_code}" http://localhost:5197/media/og.png
404
```

`index.html:14` points `og:image` at `https://maninae.github.io/please-remain-seated/media/og.png`. The file has never existed. You fixed the og *description* last round (m10) and shipped the card with no picture. For a toy whose entire distribution model is a link in a group chat, the unfurl **is** the product. Slack, iMessage, Twitter and LinkedIn will all render a naked text card.

**Fix:** render an actual 1200x630 — the two cabins mid-race with the clocks and a margin, which is the most legible frame this thing produces. Better: generate it per-share from the finished race so the unfurl shows *your* result.

### MAJOR

**NEW-M1. `moving` and `blocked` are the same hex. The thesis of the entire toy is invisible.**

`js/render/theme.js`:

```js
moving:  '#1f8a4c',   // exit-sign green
blocked: '#1f8a4c',  // same hue, drawn hollow: wants to move, cannot
```

The only difference is fill versus a 1.5 px stroke, on a ~6 px dot at desktop and ~5 px on phone. The consequence, from `24-b777-race.png`: at t=2:12 the 777's two aisles are unbroken chains of roughly seventy green circles each, of which **exactly one** is moving. The picture says "the plane is full of green activity." The truth is "one person in seventy is making progress." That is the single most important fact your simulation produces and the palette erases it.

The docstring four lines above the offending value says "moving passengers are the only saturated green on the page." Your own file disagrees with itself.

**Fix:** blocked goes gray — you already have `ready: '#6f685c'` sitting right there. Then the green fraction of the aisle *is* the throughput, readable at a glance, and the jam becomes self-evident without a legend. This also finally makes amber scarce by comparison (m8) and gives the cabin a reason to look different between a good strategy and a bad one.

**NEW-M2. The left half of the cabin systematically beats the right half. Root cause is a tie-break on passenger id.**

Mean per-passenger total time by aisle side, 12 seeds x 153 passengers = 1,836 passengers per strategy:

| Strategy | side 0 (A/B/C) | side 1 (D/E/F) | penalty |
|---|---|---|---|
| free-for-all | 248.7 s | 267.4 s | **+18.7 s** |
| aisle-first | 250.8 s | 263.7 s | +12.8 s |
| row-by-row | 470.1 s | 485.0 s | +14.8 s |
| back-to-front | 421.4 s | 444.7 s | **+23.3 s** |

Every strategy, every seed family, same direction. It is visible on screen on a cold load: the three seat rows above the aisle are noticeably emptier than the three below (`01-first-load-1280x800.png`). By t=240 s on seed `critic2-a`, side 0 is **completely empty** while side 1 still holds 22 seated passengers.

Root cause: `js/engine/deplane-rules.js:120` resolves contested aisle cells with `sortedReady.sort((a, b) => a.id - b.id)` — its docstring says so plainly, "Ties within a single cell are still resolved by ascending id." And `js/engine/passengers.js:45-46` builds seats row-major with `col` ascending, assigning `id: index`. So within any row, seat A's id is always lower than seat F's, and A always wins the contest. Forever. Seat F pays a permanent 5-9% tax for existing.

**Fix:** break the tie on a draw from the step's rng, not on id. It is one line and it is the difference between a simulation and a lookup table. (Bonus: this is exactly the kind of defect a worst-seats heat map would have screamed about on day one.)

**NEW-M3. At 1280x800 the entire control bar is below the fold and cabin B is cut off.**

Measured on first load, nothing scrolled:

| element | top | bottom | at 1280x800 |
|---|---|---|---|
| cabin B canvas | 611 | 824 | cut off, 189 of 213 px shown |
| `#controls` | 876 | 1144 | **entirely below fold** |
| speed buttons | 891 | 931 | **entirely below fold** |

At 1440x900 the speed buttons still show 9 px of 40. The race auto-starts, so a first-time visitor at the most common laptop size watches a race begin with no visible Restart, no speed control, no New plane, no seed, and a second cabin with its bottom row of seats sliced off. Every affordance that makes this a toy rather than a GIF is out of sight.

**Fix:** the speed and Restart controls belong in the race section, beside the clocks, not in a block under both cards. Everything else (aircraft, sliders, More knobs) can stay below.

**NEW-M4. The explainer describes the new staging window backwards.**

`js/ui/explainer.js`: *"Deplaning today: prep timer runs from door-open…"*

It does not. `js/engine/types.js` says `t` is "seconds since the start (seatbelt-sign off for deplane)" and that during the pre-open era "prep, standing, contested cells, retrieval, walking up to the door" all proceed. The engine trace agrees: at t=5 s, with `doorOpenAtSeconds = 45`, there are already 35 people retrieving bags and 59 of 64 aisle cells full. Prep runs from seatbelt-sign-off and finishes long before the door opens.

The one sentence explaining this round's headline feature states the opposite of what the feature does.

**NEW-M5. The three bag-probability sliders do not hold their value, and the label disagrees with the thumb.**

```
default                        : b0=0.20 b1=0.60 b2=0.20   labels 20% / 60% / 20%
drag P(two bags) to 0.90       : b0=0.10 b1=0.35 b2=0.55   labels 12% / 35% / 53%
drag P(no bag)   to 1.00       : b0=0.55 b1=0.20 b2=0.30   labels 53% / 18% / 29%
```

Two defects in one. First, the slider you are holding lands nowhere near where you put it — drag to 90%, get 55%. Second, the raw values sum to 1.05 while the labels are renormalized to 100, so **the number printed under the thumb is 2 points off from where the thumb physically sits**, on all three, permanently. A reader who trusts either one is wrong.

**Fix:** renormalize the *other two* and pin the one being dragged, and drive the thumb from the same normalized number the label prints.

### MINOR

**NEW-m1. The personal best is a seed lottery, and it does not know which strategy set it.**

The localStorage key is `deplane::a320::aisle-first|free-for-all::space::0.85::0.85::0.25` — mode, preset, strategy pair, bins, load, compliance, families. **The seed is not in the key.** Everything in the key is a thing the player chose; the only free variable is the seed. So "personal best" means "the luckiest plane I have rolled so far", and the way to improve it is to mash New plane. There is no skill, no read, no decision.

Worse, across three runs it stored 7:53 (set by free-for-all) then replaced it with 6:41 (set by aisle-first) and displayed only "New PB · was 7:53". The two numbers come from different strategies and are silently pooled.

**Fix:** make the PB something you can actually earn. Best margin, not best time. "Your biggest win with Two doors: 3:19" is a number a player owns; "the fastest plane the RNG has handed me" is not.

**NEW-m2. The rear door is drawn, and invisible.**

The renderer does cut a gap with two sill pips when `cabin.rearDoor` is set (27.9% of aft-region pixels differ between a one-door and a two-door lane). But at 1:1 it is a hairline break in a 1 px outline. In `20-phone-midrace.png`, racing free-for-all against two-doors side by side, I cannot tell which plane has two doors — the only cue is that one counter says 43 and the other 19. The mechanism behind your best result is not on screen, and nothing indicates that half the aisle is now walking *backwards*.

**Fix:** mark both exits properly — a gap plus a sill plus an arrow pointing out, sized to be seen. Ten pixels of ink on the one element that explains a 2:32 saving.

**NEW-m3. The strip chart prints a strict ranking over rows that are within noise.**

At 100 seeds: Two doors, Aisle first, Alternating rows, **Bagless first, Free-for-all**, Back-to-front, Row-by-row.
At 500 seeds: Two doors, Aisle first, Alternating rows, **Free-for-all, Bagless first**, Back-to-front, Row-by-row.

Rows 4 and 5 swap. Their p10–p90 bands overlap almost completely and the dot clouds are indistinguishable. A ranked vertical list is a strong claim of ordering; four of your seven rows cannot support one.

**Fix:** you already compute p10 and p90. Group the statistically tied rows, or say so in the finding sentence. "These four are the same plane" is a more interesting result than a fake 4th place.

**NEW-m4. Small stuff that adds up on phone.**
- Tap targets: mode tabs 32 px, strategy selects 34 px, speed buttons 32 px, Restart 39 px. Spec asks 44. Still under, everywhere.
- The door-status slot goes blank the instant the door opens, leaving a permanent empty line in the card header for the rest of the race.
- Lane A's card carries the legend and lane B's does not, so the two cards are different heights and the live gap readout lands in a different place in each.

**NEW-m5. The Last/Average toggle lies while you are following someone.** Caption reads "· seat 17A", the toggle reports `last: true`, and the subtitle still says "The last passenger." Three surfaces, two of them wrong. There is no third segment lit for the state the UI is actually in.

### NIT

**NEW-n1.** "New plane" produces seeds like `plane-ihkb`. Unpronounceable and unmemorable, in a toy whose whole share mechanic is "try seed X".
**NEW-n2.** `formatSplitTitle` in `js/ui/format.js:13` is dead code, imported by nothing.
**NEW-n3.** Two buttons labelled "Restart" are visible at once at the finish — one in the result card, one in the controls.
**NEW-n4.** The live gap readout ("24 passengers ahead of Free-for-all") shares a DOM slot with the follow line, so following someone silently destroys the gap readout and there is no way to have both.

---

## What would make me come back

1. **Put the finish somewhere I can see it, and fill the empty cabin with a worst-seats heat view.** *(Endorsed, and it is the top ask.)* At the finish you are handing me 413,220 px² — a third of the viewport — of blank seat rectangles, while the card that explains what just happened sits at `pctVisible: 0`. Colour every seat by how long that passenger waited and the dead space becomes the single most shareable artifact this project can produce: a map of where not to sit, with the row-number ruler you already draw along the bottom. It is the only screenshot here that survives being posted without a caption. Two warnings: it will immediately expose NEW-M2's left/right bias as a visible seam down the middle of the plane, which is a reason to fix that first, not a reason to skip the heat map; and the scale must be shared across both lanes or you will reintroduce B2 in a new medium.
2. **Fix the green.** Make `blocked` gray. One hex value stands between your aisle looking like a busy street and looking like the parking lot your simulation says it is.
3. **Rewrite the deck to the number the sim actually produces.** *(Endorsed, and here is the line.)* "Why getting off a plane takes forever" over a clock reading 6:26 is a promise the screen refuses to keep — six minutes is not forever and every viewer can count. But the honest number is *better* than the vague one: your own engine says the last passenger off an A320 spends **412 s on board, of which 386 s is standing still and 21 s is walking** — an 18-to-1 ratio. So say that:

   > **The last person off spends six minutes on a plane they could walk out of in twenty seconds.**
   > *One aisle. One lane. No overtaking.*

   Specific, checkable against the clock on screen, and it reframes 6:26 from "that's not so long" into "that's twenty seconds of walking". If you want one line rather than two, the second one is the keeper — it is the thesis in six words and it is what the heat map, the strip chart and the time-split are all independently proving.
4. **Give me one shared clock and a live gap instead of two identical ones.** You already wrote the good version — "24 passengers ahead of Free-for-all" — and then set it in 14 px under the legend while two 54 px clocks show the same number for 95% of the race. Swap their sizes. The gap is the race; the elapsed time is a footnote.
5. **A wager before the door opens.** You now have a 45-second staging window where, by your own engine trace, absolutely nothing changes between t=20 and t=45. That is a free, physically-motivated betting window you are currently spending on a still image. "Which side gets off first?" — one click, then watch. It converts a demo into a game and it costs you no new simulation.
6. **Chunk the compare by seed range, not by strategy.** 83% of the progress bar in 6.3 s and the last 17% in 5.4 s, with a `WORKER_CAP` of 6 on a 10-core machine and one strategy per task. Split each strategy's seeds across the pool and the whole thing lands near 6 s, which is the difference between "I ran it a few times" and "I ran it once."

---

## Scores

**Fun: 7/10.** Up from 5. There is a loop now, and it is a real one: the two-door result is genuinely startling, the strip chart rewards poking at sliders, following one person to the door is still the best idea in the project, the share link reproduces a race exactly so an argument with a friend is actually settleable, and personal bests give New plane a pulse. What holds it at 7 is that the moment of victory is off-screen, the winning cabin at the finish is 360 empty rectangles, the personal best rewards rerolling rather than thinking, and nothing on screen ever makes me *gasp* — because the one image that would (an aisle where one dot in seventy is moving) is drawn in a colour that says the opposite.

**Polish: 7.5/10.** Up from 6. This is now a well-made thing: zero console noise across forty runs, 383 ms load, a 10.4 ms frame median at 60x on a 306-passenger widebody with no frame over 33 ms, ink-coloured controls, layout-driven canvas heights across nine airframes, honest self-reported compute times, a phone layout that remains better than the desktop one, and a share link that round-trips fourteen parameters to the second. It is dragged off a 9 by a social card that 404s, a result card below the fold, a palette whose two most important states are the same hex, three sliders that jump out from under the cursor and disagree with their own labels, seven letterspaced micro-labels of which two are section titles set smaller than their body copy, and an `aria-label` that still says "Left cabin" while a hundred and fifty-three people fight their way out of it.
