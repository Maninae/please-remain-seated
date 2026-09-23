# Page design (binding for the integration builder)

One page, index.html. Three tabs: Race, Rankings, About. The hero of the Race tab is two cabins racing the same passengers and seed on different strategies; the Rankings tab is the analytical core (see design/07-rankings.md); the About tab holds the thesis, the model, and the sources.

## Navigation (Race, Rankings, About)

- Desktop (>= 900 px): a narrow vertical tab rail is fixed on the left edge of the viewport. Each tab is a real `<button role="tab">` with a code-drawn inline SVG icon and a short label. The active tab is ink-on-paper; the rest are soft gray. Keyboard: arrow keys move focus and activate, Home / End jump to the ends.
- Phone (< 900 px): the desktop rail hides and a bottom tab bar (fixed to viewport bottom) carries the same three tabs.
- URL round-trip: `?tab=<race|rankings|about>` reflects the active tab and restores on reload. The tab param sits alongside every other URL param the store writes.
- Race pauses when the reader leaves the Race tab and resumes on return. Every tab activation dispatches a `prs:tab-changed` event (detail: `{ tab }`); the race module and the rankings tab both listen.

## Hierarchy (what the eye hits, in order)

1. The two aisles. Moving dots are the only saturated green on the page, bag handlers the only amber. Every structural mark is gray on warm paper (see js/render/theme.js).
2. The two clocks. Largest type on the page, tabular numerals, one per cabin card, `m:ss`. When a cabin finishes, its clock freezes and the winner shows the margin in small type ("1:32 ahead"). Nothing else competes for size: the title is smaller than the clocks.
3. The strategy names on each card (a select styled as text, so it reads as a label you can change).
4. Controls, the time-split bars, the Monte Carlo strips, then the explainer.

## Structure

Two-column grid on desktop, single column on phone via a slide-in drawer. The main column holds the race and everything it makes; the sidebar holds every setting.

- Phone top bar (< 900 px only, sticky): title "Please Remain Seated", a "Settings" button on the right that opens the drawer. The button carries a sliders icon and stays a 44 px tap target.
- Masthead (main column, desktop only): title "Please Remain Seated" in one weight and one colour, a one-line deck that changes with mode, and the Deplane / Board segmented toggle on the same line.
- Race (main column): two cabin cards stacked (desktop, nose left) or side by side vertical (phone, nose top). Card header: strategy select at the left with a small "i" info button inline, count at the centre ("142 of 180 off" / "on"), clock at the right. Canvas fills the card. Under the first card only, one muted line labels the four states inline (moving, blocked, bag, seated); never a boxed legend. In Board mode the strategy select is grouped under two optgroups: "Textbook methods" (Random order, WILMA, Steffen, and the rest of the classic 9) and "How airlines actually board" (the 14 real airline procedures from design/06-airline-research.md). The Aircraft picker in the sidebar is grouped the same way: "Single class" (the nine original presets) and "With first class" (the four sectioned presets: 737-800 two-class, A321neo three-class, 737 MAX 8 LCC, 787-9 three-class). On a multi-class cabin the finish card carries an extra line ("First class off in 0:48, economy in 6:10") and the follow line names the passenger's class ("Seat 2A · First · 1 bag ...").
- Race controls (main column, compact): Restart, speed segmented (1x, 4x, 15x, 60x), and the worst-seats-view toggle after finish. These are the controls used constantly, so they stay in the main column even at desktop widths where the sidebar owns the knobs. Chime toggle, "New plane", and the seed input live only in the sidebar to keep this bar tight.
- Sidebar / settings drawer (right, sticky): a "Settings" heading, then Restart, the speed pips (mirrored), New plane and seed input, the aircraft picker, overhead bins ("Roomy (new)" / "Old-style"), the three main sliders (How full, Follow the rules, Groups), and a "More knobs" disclosure holding Let people out, Phone-checkers, Time to get up, and Carry-ons (three sub-sliders: No bag, One bag, Two bags), plus the chime-on-finish toggle. Every knob carries a small round "i" info button that opens a plain-language popover.
- Where the time goes: two stacked bars (one per cabin) for the last passenger off, labelled inline; a toggle switches to the average passenger. Updates live during the race.
- Run it 100 times: a button that runs every strategy for the current settings in a module Web Worker with a progress bar, then draws the strips sorted by median. The strip title states the finding in words. Runs count selectable: 100 (default), 200, 500.
- Deplane this plane: in Board mode, after a race finishes, a button carries that cabin's bin layout and population into a Deplane race.
- "How this works" (moved to the About tab in round 06): the six-bullet explanation of the model lives under the About tab's "How the model works" section. The Race tab no longer carries a collapsed disclosure.
- Footer: "Owen Wang" and the GitHub link, small.

### Breakpoints

- **>= 1100 px (sidebar)**: two-column grid. Left column flexible, holds race, race controls, time-split, compare, explainer. Right column ~300 px, sticky under the masthead, holds Settings.
- **900-1099 px (stacked)**: single column. Settings sit under the main column, same content, no drawer. No sticky.
- **< 900 px (drawer)**: sticky phone top bar with title and Settings button opens a slide-in drawer from the right (min(360, 92vw), full height, focus-trapped, Escape or scrim tap to close). The compact race controls (Restart, speed, worst-seats toggle) stay under the cabins on the main flow.

## Interactions that make it fun

- Follow a passenger: click or tap any dot; it gets a ring, the card shows "Seat 27F · 2 bags · waited 6:12 · walked 0:41" live, and the time-split bar switches to that passenger. Click again to unfollow. Hovering a dot shows the same line as a tooltip on desktop.
- Finish moment: the finishing cabin's clock stops and bolds; the other keeps running; the margin appears. Optional seatbelt-chime "ding" via WebAudio, off by default, toggle in the control bar; nothing plays until the user turns it on.
- Keyboard: space play/pause, R restart, 1-4 speeds, N new plane.
- Shareable URL: ?mode=&a=&b=&seed=&preset=&load=&compliance=&families= round-trips every control. Controls persist in localStorage (try/catch; the page must render without it).
- Presets for a first-time visitor: on Deplane land on A320, free-for-all vs one row at a time, auto-start at 15x. The two lanes differ from the first second (everyone standing versus one row standing) and the announced remain-seated policy loses by roughly two and a half times, which is the finding the site is named for. Two doors and aisle-first are one dropdown away. On Board mode land on the 737-800 two-class preset, Random order vs United Airlines: a real airline procedure (United's WILMA order) races the baseline every airline still falls back to once its numbered zones are past. Restart is one click.

## Race mechanics

- Both sims share one population from `samplePopulation({ seed, cabinOverrides, passengerOverrides })` and step in lockstep: stepsPerFrame = speed * frameSeconds / SIM_DT_SECONDS, rounded, with a carry so 1x is exactly real time. Draw once per frame. Cap stepsPerFrame so a slow tab never freezes.
- When a strategy sets `cabinOverrides` (two-doors sets rearDoor), that cabin's sim is built with it; the population is still shared (same seats, same bags).
- Changing any control resets both sims (no mid-race mutation). The seed does not change on Restart; only "new plane" rerolls it.

## Responsive and accessibility

- Desktop (>= 900 px): cards stacked, canvas 100% wide, height from the layout (a 3-4-3 needs more rows of seats than a 2-2). Phone (< 900 px): the two canvases side by side, vertical orientation, each half the width; controls stack in one column; sliders full width; tap targets >= 44 px.
- Never a horizontal scrollbar on the page. Canvas is device-pixel-ratio aware.
- Every control has a label; the canvas has an aria-label summarising the race state, updated when a cabin finishes. `prefers-reduced-motion`: no flourish animations, the sim still runs.

## Copy

Short, plain, wry, aimed at a smart high-school reader. Labels are nouns. No exclamation marks. Any technical term appears inside an info popover, not in the main label.

### Label rename map (round-04)

| Old label | New label |
| --- | --- |
| Load factor | How full |
| Compliance | Follow the rules |
| Families | Groups |
| Bins (Space bins / Legacy) | Overhead bins (Roomy (new) / Old-style) |
| Politeness | Let people out |
| Distracted fraction | Phone-checkers |
| Prep median (sec) | Time to get up (sec) |
| P(no bag) / P(one bag) / P(two bags) | Carry-ons: No bag / One bag / Two bags |
| Seeds (compare picker) | Runs |
| Two doors (strategy) | Both doors |
| Row-by-row (strategy) | One row at a time |
| Aisle first (strategy) | Aisle seats first |
| Alternating rows (strategy) | Every other row |
| Bagless first (strategy) | No bags first |
| Random (boarding) | Random order |
| Back to front (5 zones) | Back to front, in zones |
| Front to back (5 zones) | Front to back |
| WILMA (window / middle / aisle) | Window, middle, aisle |
| Steffen optimal | Steffen method |
| Steffen modified | Steffen, in blocks |
| Rotating zone | Rotating zones |
| Open seating (Southwest) | Pick any seat |

### Info popovers

Each popover carries: a title, 2 to 4 plain sentences (under ~70 words), and where useful a "Learn more" link opening in a new tab. Content lives in `js/ui/glossary.js` keyed by id. Every strategy id, every aircraft preset id, and every setting has an entry:

- Settings keys: `how-full`, `follow-the-rules`, `groups`, `overhead-bins`, `let-people-out`, `phone-checkers`, `time-to-get-up`, `carry-ons`, `runs`, `seed`, `speed`, `heat-view`, `time-split`, `compare`, `door-countdown`.
- Strategy keys: every id in `js/engine/strategies/deplane.js` and `js/engine/strategies/board.js`.
- Aircraft keys: every id in `js/engine/cabin-presets.js`.

Popover behaviour: click opens, click outside or Escape closes, one open at a time, focus lands on the close button, focus returns to the trigger on close. Keyboard accessible; the popover carries `role="dialog"` with `aria-labelledby` on the title.

Attachment points: each strategy select (info button next to the dropdown, updates on change), the aircraft select, overhead bins, every slider, the "Where the time goes" heading, the compare heading, the runs picker, the seed field, the door-countdown line, the Speed group, and the worst-seats-view toggle.

## Files

index.html; css/base.css (tokens matching theme.js, type scale, layout), css/race.css (cards, clocks, control bar), css/charts.css, css/sidebar.css (sidebar, phone drawer, info popover); js/main.js (bootstrap only); js/ui/race.js (two sims, lockstep stepping, finish detection, follow-a-passenger); js/ui/controls.js (all inputs, URL and localStorage round-trip, both speed groups); js/ui/compare.js (worker batch + strips + finding sentence); js/ui/explainer.js (copy); js/ui/sound.js (chime, off by default); js/ui/info-popover.js (round "i" button + anchored popover, one open at a time); js/ui/glossary.js (plain-language content keyed by id); js/ui/settings-drawer.js (phone drawer + focus trap + scroll lock); js/worker.js. Each under ~300 lines. Google Fonts link for Barlow with a real fallback stack.
