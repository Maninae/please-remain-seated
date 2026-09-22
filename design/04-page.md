# Page design (binding for the integration builder)

One page, index.html. The hero is a race: two cabins, the same passengers and seed, two strategies. Everything else supports that.

## Hierarchy (what the eye hits, in order)

1. The two aisles. Moving dots are the only saturated green on the page, bag handlers the only amber. Every structural mark is gray on warm paper (see js/render/theme.js).
2. The two clocks. Largest type on the page, tabular numerals, one per cabin card, `m:ss`. When a cabin finishes, its clock freezes and the winner shows the margin in small type ("1:32 ahead"). Nothing else competes for size: the title is smaller than the clocks.
3. The strategy names on each card (a select styled as text, so it reads as a label you can change).
4. Controls, the time-split bars, the Monte Carlo strips, then the explainer.

## Structure, top to bottom

- Masthead: title "Please Remain Seated" in one weight and one color, a one-line deck that changes with mode: deplane "Why getting off a plane takes forever. Same people, same bags, two ways off." board "Same people, same bags, two ways on." Mode toggle (Deplane | Board) as a segmented control on the same line.
- Race: two cabin cards stacked (desktop, nose left) or side by side vertical (phone, nose top). Card header: strategy select at the left, count at the center ("142 of 180 off" / "on"), clock at the right. Canvas fills the card. Under the first card only, one muted line labels the four states inline (moving, blocked, bag, seated); never a boxed legend.
- Control bar: primary button (Race, then Restart), speed segmented (1x, 4x, 15x, 60x), a "new plane" button that rerolls the seed (seed shown as small text and editable), and the cabin knobs: aircraft preset select (all nine presets, label plus layout, e.g. "A320 · 3-3 · 180 seats"), load factor slider, compliance slider, families slider, bin era (Space bins / legacy). A "more knobs" disclosure holds politeness, distracted fraction, bag mix (0 / 1 / 2 probabilities as three sliders that renormalize), prep median.
- Where the time goes: two stacked bars (one per cabin) for the last passenger off, labelled inline; a toggle switches to the average passenger. Updates live during the race.
- Run it 200 times: a button that runs every strategy for the current settings in a module Web Worker (js/worker.js over js/batch.js) with a progress bar, then draws the strips via renderStrips, sorted by median, the two racing strategies highlighted. The strip title states the finding in words, computed: e.g. "Aisle-first saves 3:10 over free-for-all at 85% compliance" or "Nothing beats free-for-all once families and non-compliance are in". Default 100 seeds; 200 and 500 selectable.
- Deplane this plane: in Board mode, after a race finishes, a button carries that cabin's bin layout and population into a Deplane race (sim-factory takes `passengers` and `bins`).
- Explainer (collapsed by default, "How this works"): six bullets on the model with the measured sources, the compliance and families caveat, and links to design/01-spec.md and design/02-research.md on GitHub. Plain language; no equations.
- Footer: "Owen Wang" and the GitHub link, small.

## Interactions that make it fun

- Follow a passenger: click or tap any dot; it gets a ring, the card shows "Seat 27F · 2 bags · waited 6:12 · walked 0:41" live, and the time-split bar switches to that passenger. Click again to unfollow. Hovering a dot shows the same line as a tooltip on desktop.
- Finish moment: the finishing cabin's clock stops and bolds; the other keeps running; the margin appears. Optional seatbelt-chime "ding" via WebAudio, off by default, toggle in the control bar; nothing plays until the user turns it on.
- Keyboard: space play/pause, R restart, 1-4 speeds, N new plane.
- Shareable URL: ?mode=&a=&b=&seed=&preset=&load=&compliance=&families= round-trips every control. Controls persist in localStorage (try/catch; the page must render without it).
- Presets for a first-time visitor: land on Deplane, A320, free-for-all vs aisle-first, auto-start at 15x so the page is alive within a second. Restart is one click.

## Race mechanics

- Both sims share one population from `samplePopulation({ seed, cabinOverrides, passengerOverrides })` and step in lockstep: stepsPerFrame = speed * frameSeconds / SIM_DT_SECONDS, rounded, with a carry so 1x is exactly real time. Draw once per frame. Cap stepsPerFrame so a slow tab never freezes.
- When a strategy sets `cabinOverrides` (two-doors sets rearDoor), that cabin's sim is built with it; the population is still shared (same seats, same bags).
- Changing any control resets both sims (no mid-race mutation). The seed does not change on Restart; only "new plane" rerolls it.

## Responsive and accessibility

- Desktop (>= 900 px): cards stacked, canvas 100% wide, height from the layout (a 3-4-3 needs more rows of seats than a 2-2). Phone (< 900 px): the two canvases side by side, vertical orientation, each half the width; controls stack in one column; sliders full width; tap targets >= 44 px.
- Never a horizontal scrollbar on the page. Canvas is device-pixel-ratio aware.
- Every control has a label; the canvas has an aria-label summarising the race state, updated when a cabin finishes. `prefers-reduced-motion`: no flourish animations, the sim still runs.

## Copy

Short, plain, wry. Labels are nouns. No exclamation marks. The strategy blurbs from the engine appear as a one-line note under the strategy select when it changes.

## Files

index.html; css/base.css (tokens matching theme.js, type scale, layout), css/race.css (cards, clocks, control bar), css/charts.css; js/main.js (bootstrap only); js/ui/race.js (two sims, lockstep stepping, finish detection, follow-a-passenger); js/ui/controls.js (all inputs, URL and localStorage round-trip); js/ui/compare.js (worker batch + strips + finding sentence); js/ui/explainer.js (copy); js/ui/sound.js (chime, off by default); js/worker.js. Each under ~300 lines. Google Fonts link for Barlow with a real fallback stack.
