# Round 01 — Critic pass (snooty gamer)

Reviewer: adversarial play-test, headless Chromium 1.58.2 at 1280x800 / 1280x900 / 400x800.
Build: `index.html` served from `python3 -m http.server 5197`, repo state 2026-09-22.
Artifacts: `tests/e2e/artifacts/critic-round-01/`. Console was clean on every run (zero errors, zero failed requests) — credit where it is due.

---

## Verdict

Fine. It's *fine*. You have built a beautiful, well-behaved little physics toy with a safety-card palette I actually like, a beeswarm strip chart that is the best-designed thing on the page, and a phone layout that is unironically better than the desktop one. And then you shipped it with three electric-blue iOS sliders sitting on your warm paper like a Fisher-Price sticker on a Dieter Rams radio, a hero card that is 19% empty void, a "where the time goes" chart that normalizes both bars to the same length so a 6:09 passenger and a 5:02 passenger draw *identical rectangles*, and — this is the one that actually made me laugh — a compare chart where "Two doors" is silently run with one door, so the single most counterintuitive, most screenshot-worthy, most "wait, WHAT" result in your entire simulation (open the back door, save two minutes) renders as **saving exactly 0.00 minutes**. Your own code comment admits it and calls the rear door a "door drawing." It is not a door drawing. It is the strategy. Meanwhile the race finishes with two identical grids of empty seats, no winner card, no personal best, no "no way" stat, and nothing whatsoever to send to a friend, which is a shame because the underlying sim is smart enough to deserve an audience. I ran it fifteen times because you paid me to. I would have run it twice otherwise.

---

## Findings

### BLOCKER

**B1. "Two doors" in the compare chart runs with one door. The saving is reported as 0:00 instead of 2:05.**

`js/ui/compare.js` posts a single flat `cabinOverrides` to the worker and never folds in the per-strategy override. Its own comment concedes it:

> `// the worker layer would need per-strategy overrides for two-doors to draw its rear door. Keep the API tight: batch users care about medians, not door drawings.`

`js/ui/race-sims.js:26-27` *does* merge it (`...(strategyCabinOverridesFor(state.mode, strategyId) || {})`), and so does `tools/simulate.mjs:88-91`. So the page contradicts itself in two clicks.

Reproduced, same 100 seeds, same settings:

| Path | two-doors median | saving vs free-for-all |
|---|---|---|
| `js/ui/compare.js` (what the chart shows) | 6.79 min | **0.00 min** |
| `js/ui/race-sims.js` / CLI (correct) | 4.74 min | 2.05 min |

From the UI: set lane B to Two doors, race at 60x → lane A 6:09, lane B 3:47, **"2:21 ahead"** (`11-two-doors-race.png`). Now scroll down and hit Run → the chart puts Two doors *fifth*, tied with free-for-all (`10-compare-strips.png`). The explainer meanwhile states "Two doors halve deplaning time." Three surfaces, three different answers.

**Fix:** send per-strategy `cabinOverrides` through `worker.js` → `batch.js`. This is not an API-tightness question; a strategy whose entire mechanism is a second door cannot be benchmarked without one.

**B2. The time-split bars are normalized per-row, so unequal times draw as equal bars.**

Both `<svg data-split-svg>` rect sets sum to exactly 1000 user units at the finish, when lane A's last passenger took 6:09 and lane B's took 5:02:

```
rectsA: 839.38 + 96.97 + 63.65        = 1000.00   (total 6:09)
rectsB: 691.80 + 204.03 + 21.83 + 82.34 = 1000.00 (total 5:02)
```

Two bars, stacked vertically, touching, same length, 67 seconds apart. The section is called "Where the time goes" and it erases where the time went. Visible plainly at phone width in `19-phone-controls.png`: "seated waiting 0:27" fills the full width and so does the other bar.

**Fix:** one shared scale across both lanes, pinned to the slower lane. The faster bar must be visibly shorter. Put the total on the right end of each bar.

**B3. On phone, nothing explains the colors — the only legend is `display: none`.**

`.race-legend` computes to `display:none` at 400px (measured; `text` is still "moving blocked bag seated", `height: 0`). Phone is where this gets shared, and a phone visitor sees filled-green, hollow-green, and amber dots with zero explanation anywhere on the page. The narrow time-split segments also drop their labels when there is no room, so you get unlabeled gray/amber blocks with no legend to decode them.

**Fix:** keep the four state labels on phone. They are four words.

### MAJOR

**M1. Default browser sliders and checkbox. iOS blue is the loudest thing on the page.**

`getComputedStyle(#load-slider).accentColor === "auto"` — nobody styled them. Three saturated-blue bars for Load factor / Compliance / Families, plus a blue checkbox for "Chime on finish". Your own spec says color is state only: green = moving, amber = bag, everything else gray on paper. Blue is not in the system, and it out-shouts the aisle it is supposed to be subordinate to. `19-phone-controls.png` is the damning one — on a 400px screen the blue bars are the visual center of gravity.

**Fix:** `accent-color` token plus a styled track/thumb in the paper palette. The filled portion can be the one place you reuse ink-gray.

**M2. 73px of dead void in the hero card, every card, every preset.**

Measured at 1280x900: `cardH: 391`, `canvasH: 180`, `emptyPxBelowLegend: 73`. The cabin — the payload, the thing the spec says my eye must land on first — is 46% of its own card, and 19% of the card is nothing at all. The `.follow-line` placeholder reserves only 14.4px of that; the rest is padding. Same story on every preset (`09-preset-b777.png`).

**Fix:** grow the canvas into the void or shrink the card. On a 777 the extra height is desperately needed anyway (see M3).

**M3. The canvas is a hard 180px tall for every aircraft, from a CRJ-700 to a 777.**

Swept all nine presets; every one reported `966x180`:

| Preset | Layout | Seat rows in 180px |
|---|---|---|
| CRJ-700 | 2-2 | 4 |
| A320 | 3-3 | 6 |
| Boeing 777 | 3-4-3 | 10 + 2 aisles |

Your page spec says "height from the layout (a 3-4-3 needs more rows of seats than a 2-2)." It doesn't. The 777 crams ten seat rows and two aisles into the same strip the CRJ uses for four, giving ~13px per row and ~5px dots (`09-preset-b777.png`), while the CRJ wastes half its box.

**M4. A Boeing 777 deplanes faster than an A320. Twice the people, less time.**

20-seed medians via `tools/simulate.mjs`:

| Preset | Passengers | Median | Door throughput |
|---|---|---|---|
| CRJ-700 | 58 | 3.52 min | 17.4 pax/min |
| A320 | 153 | 6.71 min | 22.8 pax/min |
| Boeing 777 | 306 | **6.41 min** | **34.5 pax/min** |

Doubling the aeroplane is free. Root cause: `config.js:36` sets `doorServiceSeconds: 1.0`, a 60 pax/min ceiling the widebody never reaches, so the two aisles drain in parallel through a door that never binds. 34.5 pax/min is 50% above Schultz's measured field median of 23 and above his Q3 of 29. The thesis of the whole toy is "the aisle is a single-lane road"; here the road has no toll booth.

**M5. The sim misses its own headline calibration gate, and spec and tests now disagree.**

`design/01-spec.md` §2.7 gate 1: free-for-all, A320, 0.85 load, median over 50 seeds must be **8–13 min**. Measured across four independent seed families: 6.52, 6.62, 6.71, 6.97 min. Fails every time. `tests/unit/calibration-deplane.test.js` quietly re-derives the bound to 5–13 "sanity" with a documented rationale, so the suite is green (267/267) while the spec it implements says otherwise.

The first-two-minute throughput gate rides the floor and is seed-dependent:

| Seed family | first-2-min median | Gate 15–30 |
|---|---|---|
| `calib-*` (the unit test's own) | 15.4 | PASS |
| `a320-deplane-*` (the CLI's own default) | 14.6 | **FAIL** |
| `plane-*` | 15.1 | PASS |
| `seed-*` | 15.4 | PASS |

Your own CLI, at its own default seeds, fails your own gate. And the deck says "Why getting off a plane takes forever" over a clock that reads 6:43. That is not forever. That is a brisk deplaning.

**M6. The follow-a-passenger line reports bags remaining, not bags carried, so it lies about the person exactly when you read it.**

Followed seat 16F: at t≈0:02 the line read `Seat 16F · 1 bag · waited 0:02 · walked 0:00`. After they exited: `Seat 16F · 0 bags · waited 4:44 · walked 0:20`. Same human. The bag that caused the wait has been erased from the description of the wait. A reader concludes this person travelled light and still waited 4:44, which is the opposite of the lesson.

**Fix:** report the static `bagCount`. If you want the countdown, say "1 bag · 0 left".

**M7. Half of all clicks on the cabin hit nothing.**

120-point grid across the canvas (966x180 CSS): **60 hit, 60 miss, 50%**. Hit targets are the ~6px dots, not the seat cells. Spec demands ≥44px tap targets; on touch this is a coin flip on a 5px target. Follow-a-passenger is the most delightful thing you built and it works half the time.

**Fix:** hit-test to the nearest passenger within a generous radius, or make the seat rectangle the target.

**M8. Board mode reuses deplane copy verbatim, and it is wrong there.**

In Board mode: the legend still reads "moving / blocked / **bag** / **seated**" (should be stowing; and "seated" is the *finish* state when boarding, not the start state — same word, same gray, opposite meaning across modes). The time-split subtitle still reads "The last passenger **off**." The compare heading still reads "Run it 200 times" with the selector defaulting to 100.

**M9. Compare takes 33.7s at the default and 100.9s at 500 seeds, in one worker.**

Timed in-browser: 100 seeds = **33.7s**, 500 seeds = **100.9s**. The CLI does 350 runs in 14.8s, so this is a single-threaded worker, not an algorithmic limit. Nobody in a browser watches a progress bar for 34 seconds on a toy. `navigator.hardwareConcurrency` workers would cut it to roughly 5s.

**M10. The share link drops every knob that would make the link worth sharing.**

Round-trips fine: `mode, a, b, seed, preset, load, compliance, families` (verified loading `?mode=board&a=steffen&b=wilma&seed=zztest&preset=b787&load=0.6&compliance=0.35&families=0.5` — all eight applied, and the URL updates live on change). Carries **nothing** from More knobs: politeness, distracted fraction, prep median, the three bag probabilities, and the bins selector are all absent. So you build the pathological scenario that flips the winner, send the link, and your friend opens defaults.

**M11. The finish is an empty room, and the loser never gets a number.**

`06-finish-hero.png`: at the moment of maximum attention, both cabins are identical grids of empty seats — roughly 800px of the most important real estate on the page showing nothing. The winner turns green with "1:06 ahead" (nice). The loser's `[data-margin]` is **empty string** — confirmed in both deplane and board runs. No "1:06 behind", no red, no live-growing deficit while it grinds on. And while one lane is still going, the loser's margin slot holds the placeholder text "finished" on the *winner*, which is the wrong word for a race.

### MINOR

**m1. The two clocks are identical twins for ~95% of the race.** They are the largest type on the page (54px vs a 30px title) and during the race they show the same number in both cards (0:32/0:32, 1:19/1:19, 0:41/0:41 on phone). The thing that actually differs is the count — 19 vs 37 off — rendered at 13px in the middle. The biggest element carries the least information until the last second. Consider a single shared clock and a large, live **gap** figure per lane.

**m2. "Run it 200 times" defaults to 100 seeds.** Heading and control disagree on the page's own claim.

**m3. Eight letterspaced all-caps micro-labels** (AIRCRAFT, LOAD FACTOR, COMPLIANCE, FAMILIES, BINS, WHERE THE TIME GOES, RUN IT 200 TIMES...) are scaffolding, and one of them is doing duty as a section title.

**m4. `Weibull(1.7, 10 s)` in the explainer** is exactly the jargon your spec bans ("Plain language; no equations"). A smart non-expert does not hold a Weibull shape parameter. Say "usually about 9 seconds, occasionally much longer."

**m5. The explainer claims "Two doors halve deplaning time... two aisles instead of one."** An A320 has one aisle; two-doors adds a rear *exit*, not a second aisle. The mechanism is described wrongly, and the claim is contradicted by your own chart (see B1).

**m6. "prep 1-2 s" in the explainer** understates `config.js` (lognormal median 2s) and omits the distracted 10–30s tail it mentions one clause later.

**m7. Everyone stands up at once.** By t=2s, 35 of 64 aisle cells are occupied and 33 people are already pulling bags down; by t=7s it is 57/64 (`01-cold-0.4s.png` — the whole aisle is one unbroken amber row). From t=30s to t=120s, "moving" holds at 1–6 passengers out of 153 while 44–57 are blocked. It is a parking lot, which is *the point*, but the ramp is instantaneous and uniform rather than a wave, and 40 simultaneous bag retrievals in the first ten seconds reads as a glitch rather than as physics. Widen the prep distribution.

**m8. Amber is not scarce.** In the opening seconds it is the dominant color of the hero (`01-cold-0.4s.png`), and the bag pictogram is visually heavier than the dots it sits among. Your own design rule says one accent, used sparingly.

**m9. "Reverse pyramid" (13.82 min) beats "Steffen optimal" (15.66 min)** in your own 30-seed board run, while the UI label calls Steffen optimal. Either the label needs a footnote or the boarding model has an ordering problem against Steffen 2008.

**m10. The og:description says "Watch why free-for-all always wins."** Your own compare chart at defaults says *"Aisle first saves 0:51 over Free-for-all."* The social card that every share unfurls states the opposite of the product.

### NIT

**n1.** Time-split caption renders with doubled spaces: `"·  last off"`, `"  ·  passenger #67 · row 13"`.
**n2.** `passenger #67` exposes an internal array index to the user. Nobody is passenger 67.
**n3.** When you follow someone, the subtitle still reads "The last passenger off" while the bar shows your person. Contradictory.
**n4.** Canvas `aria-label` is a bare "Left cabin" for the entire race; it only becomes useful ("Left cabin: finished at 6:09.") at the very end. Spec asks for a live race-state summary.
**n5.** The Families slider is half-width while Load factor and Compliance are full-width, because Bins floats beside it. Ragged.
**n6.** Load factor serializes as `0.6` from the URL but `0.60` after any change.
**n7.** The forward galley renders as a large empty beige box with no door, no exit arrow, no EXIT mark — people simply vanish at the left edge. The one place the eye should be pulled toward is blank.

### Verified working (no action)

Speed multipliers are honest — measured 1.0x, 3.7x, 15.0x, 60.0x against wall time. Keyboard all works: space pauses and resumes, R restarts, 1/2/3/4 map to 1x/4x/15x/60x, N rerolls the seed. URL round-trips its eight params and updates live. The page renders correctly with `localStorage` throwing. `prefers-reduced-motion` still runs the sim. Click-again-to-unfollow works. The "Deplane this plane" CTA does appear once *both* lanes finish boarding (15.7s wall at 60x) and does switch modes. Explainer links point at real GitHub blob URLs. Zero console errors across every run. No horizontal scrollbar at any width tested.

---

## What would make me come back

1. **Fix the two-door result and then lead with it** — "open the back door, save 2:05" is your one genuinely shocking number and it currently renders as zero.
2. **A finish card worth screenshotting**: winner, margin, the one-line why ("aisle-first spent 3:29 seated vs 5:10"), seed, and a copy-link button, drawn over the empty cabins instead of leaving them empty.
3. **A personal best per plane+strategy pair in localStorage**, so "New plane" has stakes and the seed becomes a thing you chase.
4. **"Your worst seat" mode** — drop me in 30F, run it, tell me exactly how long I stood in the aisle and how many people passed me.
5. **A live gap readout** instead of two identical clocks: "aisle-first is 18 passengers ahead" is the sentence I would actually screenshot.
6. **A wager before the race** — pick the winner, then find out; one click of commitment converts a demo into a game.
7. **Parallel workers so compare returns in ~5s**, because a 34-second wait is where every session currently ends.
8. **Slow-mo replay of the last 20 seconds of the loser**, so I can watch the one person with two bags in row 12 personally cost 40 people a minute.

---

## Scores

**Fun: 5/10.** The race premise is good, follow-a-passenger is a genuinely lovely idea, and the strip chart rewards curiosity. But there is no loop: the finish is an empty room, nothing is at stake, nothing accumulates, nothing surprises me twice, and the one result that would have made me shout is broken. I ran it again because I was asked to, not because I wanted to.

**Polish: 6/10.** High baseline craft — the paper palette, the pictogram cabin, the type hierarchy, the clean console, the honest speed multipliers, the phone cabin view which is better than the desktop one. Dragged down by three default-blue sliders on a designed page, 73px of void in the hero card, a chart that draws unequal values as equal bars, a legend that vanishes on the platform where it matters most, every phone tap target under 44px, and copy that does not know which mode it is in.
