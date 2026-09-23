# Round 13 — Final verification of the compare-chart fixes (data-visualization critic)

Reviewer: last check on the five round-12 items, a judgement on the lead's projection-faithfulness decision, and a new-defect sweep. Headless Chromium 1.58.2 at 1280x800 and 400x800 (the latter with `hasTouch` + `isMobile`), on `a320`, `a321neo-three-class` and `b737max8-lcc`, plus `b789-three-class` once the title work pointed there. Six preset/width combinations of live 100-run compares, plus five extra seeded runs.
Build: `8cfa024`, clean tree. Artifacts: `tests/e2e/artifacts/critic-round-13/`.
`npm test`: **449/449**. `npm run test:e2e`: **77 tests, 76 pass, 1 fail** — the failure is my own CPU contention, not a defect; it passes in isolation (details in Test counts).

**Review conditions.** Every geometry number is derived from the rendered SVG, not from the renderer's constants: `chartX0` / `chartX1` from the widest horizontal line (the axis rule), floor and cap solved from the `(x, data-median-seconds)` pairs the chart emits. Dot counts are per-panel counts of drawn `<circle>` elements. Text widths are `getComputedTextLength` in the page's own font context, not estimates. The guard mutation analysis replays the e2e test's exact algorithm against deliberately corrupted panels. I wrote nothing into `data/`. Port 5197 was already running and is left running; the extra server I did not start.

---

## Verdict

**All five round-12 items are closed, and the fix round did something this series has not managed in five attempts: it added an absolute, non-derived guard.** R12-M1 is dead by arithmetic. On every one of the six panels, drawn dots plus the "N off scale" note plus the "N below" note equal rows x 100 exactly, with no slack: a320 textbook 643 + 233 + 24 = 900, a321neo airline 1390 + 10 + 0 = 1400, and four more the same. Round 12's headline case, a321neo's textbook panel printing "1 off scale" above a row with at least 91 runs off scale, now prints 86 and conserves. Off-scale rows keep their in-window dots (a320's rotating-zone draws 44 of 100, back-to-front 45 of 100), and the rows whose p10 really is past the cap correctly draw none. The new e2e test asserts that conservation identity directly, which is a bound fixed by the design's promise rather than derived from the thing under test.

The other three are clean too. R12-M3's phone clipping is gone: the title wraps to two lines on all three presets, longest line 285.0 px inside a 330 px frame, and the SVG grows by exactly 18 px. R12-m1 is exact, 330 measured against 330 asserted. R12-m2 is properly fixed at the policy level, not by relabelling: b737max8-lcc's British Airways is back on scale (14 of 14 rows carry a median tick) because the cap rose a rung to 32:00, and the seven span ratchets were **not** loosened to pay for it — every preset still clears its bound with the same 3.0 points of slack.

**Two things are wrong, and both are the same defect the round found and fixed, reappearing one step to the side.**

**The finding sentence is still cut mid-word — on desktop now instead of phone.** The wrap only runs when the SVG is under 520 px. On `b789-three-class`, whose 10,000-seed cell makes Southwest the fastest airline by 10 seconds, the title measures 667.6 px in a 630 px frame and loses its closing clock. Three of five seeds I ran produced it.

**Off-scale rows now show a censored half of their runs with nothing marking the censoring.** Drawing their in-window dots was the right call, but only the runs at or under the cap are drawn, the median tick is suppressed, and nothing says the row is truncated. So the visible cluster's centre sits well left of the row's real median: 109 s left on a320's rotating-zone, 121 s on back-to-front, 337 s on a321neo's front-to-back. On `b789-three-class` a row whose median is **6 seconds** past the cap reads 2 minutes 9 seconds fast.

---

## Re-verification of the five round-12 items

| id | Fixer's claim | Status | Evidence (my own measurement) |
|---|---|---|---|
| **R12-M1** | Edge notes count every run beyond the cap or floor across all rows; off-scale rows keep their in-window dots, only band and median tick suppressed | **FIXED** | Conservation holds exactly on all six panels: a320 textbook 643 dots + 233 off scale + 24 below = 900 (9 rows); a320 airline 1216 + 184 + 0 = 1400; a321neo textbook 772 + 86 + 42 = 900; a321neo airline 1390 + 10 + 0 = 1400; b737max8-lcc textbook 745 + 113 + 42 = 900; b737max8-lcc airline 1140 + 260 + 0 = 1400. **Off-scale rows draw dots**: a320 rotating-zone 44/100, back-to-front 45/100, a321neo front-to-back 14/100 (desktop attribution, labels vertically centred on the row). Rows with p10 past the cap draw 0, which is correct. The phone external caption carries the same totals ("24 below · axis starts at 13m · 233 off scale"). Round 12's worst case is gone. |
| **R12-M2** | Tie rule replaced with a projection-faithfulness guard; close pairs logged, not asserted | **REPLACED, and it can fail** | See the guard verdict below. The diagnostic log fires on real data (6 close-neighbour pairs across the six combinations, worst 8.8 s at 1.94 px on a 4.53 s/px band), so the close-pair information survives without being asserted. |
| **R12-M3** | Title wraps to up to three lines on phone and the SVG grows | **FIXED AT PHONE; the same defect is live at desktop (R13-M1)** | Phone: 2 lines on all three presets, longest line **285.0 px in a 330 px frame**; SVG height 550 px against 532 unwrapped, so the extra line is paid for exactly. The worst constructible title (110 chars, longest label in each slot) wraps to 3 lines, longest 272 px — the 3-line cap and the unwrapped last line are safe for every reachable title. Desktop stays single-line and unguarded. |
| **R12-m1** | The unit phone width equals the rendered 330 px | **FIXED** | `STRIPS_PHONE_MEASURED_SVG_WIDTH = 330` is exported by the renderer and imported by the unit test. Measured on all three presets at a 400 px viewport: wrap `clientWidth` 330, SVG width attribute 330, plot band 278 px (84.2% of the frame). The 25% overstatement is gone. |
| **R12-m2** | A median inside the cap is never labelled off scale; the cap rises a rung instead | **FIXED** | b737max8-lcc's cap rose 30:00 -> 32:00 (`raisedForOffScaleCap: true`) and British Airways is on scale: the airline panel draws **14 median ticks for 14 rows** and zero off-scale texts, where round 12 had it in the gutter at 1.3 s inside the cap. Across all three presets at both widths, every off-scale row's median is strictly above the cap. **The ratchets were not loosened to pay for the wider band**: measured span vs bound is a320 23.2/20.2, b738-two-class 22.9/19.9, a321neo 22.3/19.3, b717 21.0/18.0, crj700 18.0/15.0, b737max8-lcc 15.9/12.9, e175 13.1/10.1 — all seven pass with the same 3.0-point slack as round 11 left them. |

**Round-12 scoreboard: 5 of 5 closed.** R12-M3's desktop half is re-filed below as a new finding, because the fix round chose the phone-only scope deliberately and stated a reason for it.

---

## The lead's projection-faithfulness decision

**It is a legitimate guard against the round 8 to 10 defect class, and unlike its predecessor it has satisfying inputs.** Replaying the e2e test's exact algorithm against corrupted copies of real panels, it fires on an off-scale row that also emits a median tick, on a median pinned to the plot-band edge, and on a single row drawn 3 px off its projection — precisely the clamping family that produced round 8's dot-at-the-cap and round 10's edge case — where round 12's `dx < 2 && ds >= max(5, 2/pxPerSec + 0.5)` had no satisfying input at any geometry.

**It can fail in two ways, both narrow.** Clause (a) derives floor and cap from two of the very ticks it is checking, so it is a collinearity test rather than a projection-truth test: I re-projected a whole panel with a cap 20% wrong, every tick stayed collinear, and the guard passed; it is also vacuous on a panel with exactly two on-scale medians (all real panels carry 6 to 14). Only clause (b)'s fixed 2 px edge buffer and clause (c)'s off-scale cross-reference are absolute, and a band collapsing back to round 11's 86 px would slip past all three clauses — that case is caught instead by the round-15 test asserting the phone band holds at least 70% of the SVG width, which is itself an absolute bound.

| mutation applied to a real panel | guard result |
|---|---|
| unmutated | pass |
| off-scale row also emits a tick clamped to the cap | **fails (caught)** |
| interior median pinned to `chartX1` | **fails (caught)** |
| one median drawn 3.0 px off its projection | **fails (caught)** |
| one median drawn 0.70 px off | pass (inside the 0.75 px tolerance, by design) |
| whole panel's cap wrong by 20%, ticks still collinear | pass (blind spot) |
| plot band collapses to 86 px, ticks honest | pass (covered by the 70% band test) |
| only two on-scale medians, one moved 25 px | pass (vacuous) |

The lead's acceptance that two medians 5 s apart share a pixel at 4 s per pixel is correct on the physics: the diagnostic log shows the tightest real pair at 5.8 s and 1.51 px on a 3.88 s/px band, which no gutter setting separates.

---

## New findings

### MAJOR

**R13-M1. At desktop widths the finding sentence is still clipped mid-word, on a shipped preset, in three runs out of five.**

`charts-strips.js:169-173` applies `wrapStripsTitleLines` only when `isPhone` is true, i.e. below a 520 px SVG. Desktop draws one unwrapped `<text>` at x=4 into a 630 px frame with `overflow: hidden`.

`b789-three-class`'s committed 10,000-seed cell ranks Southwest fastest among airlines by 10 seconds over Hawaiian and Alaska, so a 100-run compare returns it often. When it does, the title is 102 characters.

| seed | title | measured width | outcome |
|---|---|---|---|
| s1 | Southwest ... still wins on paper at 17:38. | 667.6 px | **clipped by 42 px** |
| s2 | Southwest ... still wins on paper at 17:31. | 668.7 px | **clipped by 43 px** |
| s3 | Alaska Airlines ... | 550.6 px | fits |
| s4 | Southwest ... still wins on paper at 17:24. | 668.8 px | **clipped by 43 px** |
| s5 | Alaska Airlines ... | 550.6 px | fits |

The rendered result is in `strips-b789-three-class-1280-clipped-title.png`: the line ends "... still wins on paper at" and the number is gone. That is the same loss round 12 documented at phone width — the clause carrying the comparison the chart exists to make.

The code comment justifying the desktop exemption is also wrong about the mechanism: "the wide left gutter (200 px) means the sentence still fits at 630 px svg width without wrapping" (`charts-strips.js:164-165`). The title is drawn at x=4 and spans the whole SVG; the left gutter has nothing to do with it. What actually holds today is that the three presets the round measured happen to top out at 518.5 px.

**Fix:** drop the `isPhone` condition and wrap at every width against `width - STRIPS_TITLE_X - STRIPS_TITLE_RIGHT_PADDING`. The wrapper already handles the 630 px case correctly (the 110-character worst case wraps to two lines at 630 px), and the padding-top growth is already wired.

**R13-M2. Off-scale rows draw a censored subsample of their runs with no mark of the censoring, so the row's visible centre reads minutes fast.**

The dot pass now runs for off-scale rows (the R12-M1 fix, which is right), but a value above the cap is skipped and counted rather than drawn, the median tick is suppressed, and no mark distinguishes "this row's dots are all of it" from "this row's dots are its faster half". Every other row on the chart carries the same dot mark meaning the whole distribution.

| panel | row | true median | dots drawn | visible-subset median | understated by |
|---|---|---|---|---|---|
| b789-three-class, airline | delta | 25:06 (cap + 6 s) | 48 / 100 | 22:57 | **129 s** |
| a320, textbook | rotating-zone | 26:12 (cap + 12 s) | 44 / 100 | 24:23 | **109 s** |
| a320, textbook | back-to-front | 26:18 (cap + 18 s) | 45 / 100 | 24:18 | **121 s** |
| a321neo-three-class, textbook | front-to-back | 43:56 (cap + 236 s) | 14 / 100 | 38:19 | **337 s** |

The b789 row is the one that bites. Delta's median is six seconds past a 24:00 cap. The chart removes its median tick, hides the slower half of its runs, and leaves a dot cluster centred at 22:57 sitting directly under thirteen rows whose clusters mean something else. `strips-b789-three-class-1280.png` shows American Airlines and Delta Air Lines as the only two rows in the panel without a median tick, with full-looking dot clusters.

This is weaker than a misplaced mark — every drawn dot is a real run at its true x, and the true median is printed on the same row — but readers read a dot cluster as a distribution, and here it is a truncated one.

**Fix:** the row already has the vocabulary. Off-scale rows whose p10 is on scale draw a faint bar from p10 to the frame edge with a zigzag break; extend that treatment so the censoring is always visible, or print the drawn fraction next to the value ("25:06, 48 of 100 shown"). Either restores the one fact the mark is currently missing.

### MINOR

**R13-m1. The cap policy protects one side of its own boundary and not the other.** `raiseCapForOffScaleAndLegibility` lifts the cap a rung when an on-scale median sits within 2% below it (`strips-axis-policy.js:321-328`), which is the correct R12-m2 fix. Nothing does the equivalent for a median a few seconds *above* the cap: it is exiled to the gutter, loses its tick, and loses half its dots. On b789-three-class that boundary falls between Delta at cap + 6 s and the rows just inside it, and on a320 between the cap and two rows 12 s and 18 s past it (0.9% and 1.4% of a 13-minute band). The off-scale population cap (`MAX_OFF_SCALE_ROWS = 3`) is the only thing pulling the other way, and a320 sits at exactly 3 so it never fires. **Fix:** apply the same 2% bracket symmetrically — raise the cap a rung when a median sits just above it, not only just below — or state in the policy docstring why the asymmetry is intended.

**R13-m2. The policy module still computes and documents per-row dot counts that exclude off-scale rows, contradicting what the chart now prints.** `strips-axis-policy.js:177-193` skips off-scale rows when filling `belowFloorDotCounts` / `aboveCapDotCounts`, and the module docstring still states "Off-scale rows contribute zero to these counts because they are treated as separate rows entirely" (lines 33-35). Both are in the module's documented public API (line 8). Neither map has a single consumer anywhere in `js/`, `tests/` or `tools/` — the renderer counts its own totals in the dot loop, which is why R12-M1 is fixed. So this is dead code carrying the exact rule that was just removed, next to a docstring asserting it. A future caller that wires the caption to `aboveCapDotCounts` reintroduces R12-M1 verbatim, and the docstring will tell them it is correct. **Fix:** delete both maps and the docstring clause, or make them count off-scale rows too.

### NIT

**R13-n1.** On `a321neo-three-class` at phone width the axis's first tick label ("15m") overflows the left frame edge by 0.46 px, because the floor (15 m) coincides with a tick and the label is centre-anchored at `chartX0 = 8`. Not visible at 1x — I checked the render before filing it. Only fires when the floor lands on a tick.

**R13-n2.** The title wrap measures in characters against a hardcoded 7.2 px/char (`charts-strips.js:82`), calibrated against today's three worst-case titles at a measured 6.63 px/char. This is the kind of derived constant this series keeps flagging, but here it is defensible: the renderer must run under the test DOM stub, where `getComputedTextLength` does not exist. Worth a comment saying so, since the reason is not obvious.

**R12-n1 carried, still open.** A row entirely past the cap draws no graphical mark at all — a320's and b737max8-lcc's front-to-back are blank rows with a right-aligned number. Now more conspicuous, because the rows beside them do draw dots.

**R11-n1 carried, verified still open.** `grep` for the dagger across `js/`, `index.html` and `css/` returns the two sites that print it and no legend. A phone reader still meets "26:12†" with nothing defining it.

**R11-n3 carried, verified still open.** `capStepInfo.stopReason` reports `'rungLimit'` on a320 while `stepped` is false, because the candidate-rung list was empty and `lastTried` never moved off `startCap`. The field conflates "tried every rung and failed" with "never tried one".

**R11-n2, R11-n4 and the round-10 list carried, not re-checked** (the a320 24m cap note, the seven first words under "Source or assumption", the `demonstration` dotted underline, the empty door-status slot, `m` and `t` doing nothing, the loser's time printing five times, `?load=0.93` leaving the thumb at 0.95).

**Checked and NOT a defect.** On desktop the italic edge notes and the axis tick labels overlap by 2 px vertically in bounding-box terms ("30m" against "113 off scale" on b737max8-lcc, 19.08 x 2 px). That is bbox padding, not ink: the note baseline sits 10 px above the tick baseline at a 10 px font, and the render shows two cleanly stacked lines. No change wanted.

---

## Test counts

| suite | tests | pass | fail | duration |
|---|---|---|---|---|
| `npm test` | 449 | **449** | 0 | 21.8 s |
| `npm run test:e2e` | 77 | 76 | 1 | 1027.6 s |

The unit count matches the fixer's claim exactly (68 suites). The e2e run showed one failure, `rankings tab: renders chart, stat tiles, and knob notes when data is present` (`tabs-rankings-about.test.js:132`), asserting on the empty state with the status still reading "Loading rankings...". **This is my own interference, not a defect**: I had four Chromium instances running my measurements concurrently, and the lazily-loaded rankings index did not finish inside the wait. Re-run alone with nothing else on the machine, the file passes 7 of 7 and that test completes in 605 ms against 8718 ms under load. Effective result: **77/77**, with the note that this one test is timing-sensitive under CPU contention.

The flake the fixer mentioned, the sections-airlines multi-class card test, **passed** on my run (33.6 s). So there are at least two timing-sensitive e2e tests, not one.

Four e2e tests are new this round. The conservation test (`round-16 R12-M1: (drawn dots) + (N below) + (N off scale) = rows * seeds across BOTH panels`) is the one that matters: it is an exact identity with no tolerance and no constant derived from the renderer, and it is the first guard on this chart in five rounds that cannot be satisfied by whatever happens to ship.

---

## Scores

**Truth: 9/10.** Held. Both statements round 12 called false are gone, and the replacement is not a patch but an identity: drawn dots plus both edge counts equal the run total exactly on six of six panels, asserted absolutely in e2e. The mislabelled row is fixed at the policy rather than in the wording, and it was paid for honestly — the cap rose a rung and every span ratchet still clears with its original slack. What keeps this from rising is that the same fix opened a new way to mislead: an off-scale row now shows the faster half of its runs as an ordinary dot cluster, and on b789 a row six seconds past the cap reads two minutes fast. That is a weaker fault than the ones it replaced, since no dot is in the wrong place and the true value is printed alongside, which is why this is a hold rather than a drop.

**Clarity: 9/10.** Held, and the two moves cancel. The phone finding sentence — the single thing round 12 named as holding clarity off 10 — is fixed properly, wrapped at the real frame width with the SVG growing to make room, and it survives the worst title the strategy list can produce. Against that, the identical clipping is still live at desktop on b789-three-class in three runs of five, and the off-scale rows are now harder to read than when they were empty: a row with dots and no median tick asks the reader to work out why. Desktop and phone are otherwise the best this chart has been, at 84.2% of the phone frame given to data with nothing colliding.

**Delight: 7/10.** Held, eleventh round running. The commit touches four files, all renderer, policy and test. The delight ledger has not moved since round 05 and the wager before the door opens is still unbuilt. This is not a criticism of a fix round scoped to defects; it is the standing observation that eleven rounds of review have bought a correct chart and no new reason to stay on the page.

---

## End condition

**Not met. Four items stand above nit, and none of them needs a new idea — two are one-line scope changes to fixes this round already built.**

Where the chart stands: every round-12 item is closed, the data marks conserve exactly, the tie guard has been replaced by one that actually fires, and for the first time the test that matters is bounded by the design's promise rather than by a constant read out of the renderer. The process note that has run for five rounds can be retired on the evidence of this one.

What remains:

| id | severity | item |
|---|---|---|
| R13-M1 | MAJOR | Wrap the finding sentence at desktop widths too; drop the `isPhone` condition. `b789-three-class` clips 42-43 px in 3 of 5 seeds. |
| R13-M2 | MAJOR | Mark the censoring on off-scale rows. Their dots are the faster half only, and the visible centre reads 109-337 s fast. |
| R13-m1 | MINOR | Apply the 2% cap bracket symmetrically, or document why a median just above the cap is treated differently from one just below. |
| R13-m2 | MINOR | Delete the policy module's off-scale-excluding dot-count maps and the docstring clause asserting the rule R12-M1 removed. |
| R13-n1 | NIT | a321neo phone axis first tick overflows the frame by 0.46 px. Not visible at 1x. |
| R13-n2 | NIT | Note in a comment why the title wrap uses a char-width proxy instead of `getComputedTextLength`. |
| R12-n1 | NIT | A row entirely past the cap still draws no mark at all. |
| R11-n1 | NIT | The dagger has no key anywhere on the page. |
| R11-n3 | NIT | `stopReason` reports `rungLimit` when no rung was tried. |
| R11-n2, R11-n4, round-10 list | NIT | Carried, not re-checked. |

One process note, and it is a different one this time. Every previous round closed a guard that asserted less than it appeared to and opened the next. This round did not: the conservation identity is exact, absolute, and derived from nothing under test. The two majors above are not guard failures at all — they are the same fix stopping one viewport and one mark short of its own logic. That is an easier class of problem than the one this series has been stuck on.

REMAINING ABOVE NIT: 4
