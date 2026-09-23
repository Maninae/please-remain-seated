# Research: measured boarding and deplaning parameters

Literature values the simulator's defaults are drawn from. Every number carries its source.

## Per-passenger micro-timings (boarding models)

- Aisle free-walking speed 0.8 m/s, uniform across agents in Schultz's stochastic cellular automaton. (Schultz, "Field Trial Measurements to Validate a Stochastic Aircraft Boarding Model", Aerospace 5(1):27, 2018, https://doi.org/10.3390/aerospace5010027)
- Cellular-automaton cell 0.4 x 0.4 m; minimum inter-passenger spacing 0.4 m (one cell). (Schultz 2018, aerospace5010027, section 2.1 (Model))
- Bag stow time: 323 field-trial stow events fit Weibull with shape k = 1.7 and scale lambda = 16 s (mean ~14.3 s, median ~13 s). (Schultz 2018, aerospace5010027)
- Going from 0 to 2 carry-ons lengthens total boarding by ~60%. (Nyquist & McFadden, JATM 14(4):197-204, 2008, https://www.sciencedirect.com/science/article/abs/pii/S0969699708000513)
- Steffen treats luggage stowing as the dominant cost, ~10-15 s per passenger with luggage. (Steffen, JATM 14(3), 2008, https://arxiv.org/abs/0802.0733)
- Seat interference movement counts: 1 (no interference), 4 (aisle seat blocked), 5 (middle blocked, window target), up to 9 (worst case); ~5 s per movement, backed by 71 aisle interferences over 360 s in back-to-front runs. (Schultz, "Consideration of Passenger Interactions...", Aerospace 5(4):101, 2018, https://doi.org/10.3390/aerospace5040101)
- Carry-on mix implied by the Schultz field trials: roughly 20% / 60% / 20% for 0 / 1 / 2 bags. Milne & Kelly assume one 2-bag, one 1-bag, one 0-bag passenger per row-side. (Milne & Kelly, JATM 34:93-100, 2014, https://www.sciencedirect.com/science/article/pii/S0969699713001166)
- Economy pitch 30-32 in (0.76-0.81 m); at 0.8 m/s about 1 s per row unimpeded.
- Door arrivals while boarding: exponential inter-arrival, mean 3.7 s (~16 pax/min). (Salari et al. 2020, Schultz baseline)
- Door throughput fell from ~20 pax/min in the 1970s to ~9 pax/min today. (Nyquist & McFadden 2008)

## Total boarding time by method (~150-180 seats)

- Steffen 2008 simulation: optimal Steffen ~4x faster than back-to-front. (Steffen 2008)
- Steffen & Hotchkiss mock-757 field test (12 rows, 72 pax): Steffen 3:36, back-to-front 6:11, block 6:54. (JATM 18(1):64-67, 2012, https://arxiv.org/abs/1108.5211)
- MythBusters episode 222 (173 seats): back-to-front 24:29, random assigned 17:15, WILMA 14:55, WILMA + blocks 15:07, open seating 14:07, reverse pyramid 15:10. (aired 21 August 2014, https://mythresults.com/airplane-boarding)
- Reverse pyramid at America West saved ~2 min (~20%) on full A319/A320. (Van den Briel et al., Interfaces 35(3):191-201, 2005)
- Steffen with most-bags-first is fastest and lowest variance. (Qiang et al., JATM 40:42-47, 2014, https://www.sciencedirect.com/science/article/abs/pii/S096969971400074X)
- Slow-passengers-first cuts boarding ~13% vs random in the Lorentzian model. (Erland et al., PRE 100:062313, 2019, https://arxiv.org/abs/1906.05018)
- Traditional-method mean 30.33 min for a full narrowbody. (Nyquist & McFadden 2008)
- Survey of all three research strands (simulation, physical, theoretical). (Jaehn & Neumann, EJOR 244(2):339-359, 2015)

## Deplaning

- Door outflow in the first minute: Q0.25 = 18, median = 23, Q0.75 = 29 pax/min. 91% of flights finish deboarding by 8 min; deplaning is ~53% faster than boarding on the same fleet. (Schultz 2018, aerospace5010027)
- Structured deplaning: >40% reduction on full aircraft. Recommended for domestic high-load flights: one-column (aisle column front to back, then middle, then window). The paper reports the >40% figure on their simulated benchmarks; broader industry-wide totals in passenger-minutes or dollars are not quantified in the primary source and are not carried here. This model finds about 4% at default settings (aisle-first ~6:09 vs free-for-all ~6:24 on the A320 deplane headline cell); the gap tracks to defaults (0.85 compliance, 25% family groups) that blur the strict aisle-first order, and to the row-pair aisle that already lets seat-mates retrieve bags in parallel where the paper's model does not. (Wald, Harmon & Klabjan, "Structured deplaning via simulation and optimization", JATM 36:101-109, 2014, doi 10.1016/j.jairtraman.2014.01.001, https://www.sciencedirect.com/science/article/abs/pii/S0969699714000027)
- Lorentzian-geometry treatment of column-wise exit, similar order of gains. (Bachmat et al., "Deplaning", 2013, https://www.academia.edu/4621663/Deplaning)
- Stand plus collect personal item: 1-2 s. (Unverified; not confirmed against a primary source. Retained as a modelling assumption; see the assumptions table on the About tab.)
- Retrieve a bag from the bin: ~9-14 s per bag, the Schultz stow distribution reversed. (derived)
- Bag stored 1-3 rows away adds ~3-6 s per row of counterflow. (Bachmat 2013)
- Baseline yielding is strict row-by-row first-come-first-served; a politeness parameter for a walker letting a row-mate step ahead (P=0.9) is an unverified behavioural assumption in this project.
- Average deplaning rate on a full A320: 15-17 pax/min. At 144 seats that arithmetic gives 8.5-9.6 min as a derived total (rather than a directly measured total). A full 189-seat 737 at 14 pax/min through one door yields ~13-14 min by the same arithmetic. (Wald, Harmon & Klabjan 2014, JATM 36:101-109 and industry observation cited there)
- MythBusters tested boarding only. No publicly documented airline alternating-rows deplaning trial could be verified.

## Cabin geometry

- Boeing 737-800: 30-33 economy rows in 3-3, 162 (two-class) to 189 (high density) seats. Pitch 30-32 in, seat width 17-18 in, aisle ~19-20 in (~0.5 m). Bins: legacy 4 roller bags per bin, Space Bin retrofit 6 per bin. Jet-bridge deplaning uses the forward-left door only in normal operations.
- Airbus A320: 30 rows single-class 180 in 3-3. Pitch 28-33 in, cabin width 3.7 m, aisle ~0.5 m. Bins: original ~4 bags per bin, Airspace XL ~5-6. Forward door only.

## Observed behavior (not peer reviewed)

- Passengers standing the instant the plane leaves the runway do not exit sooner unless they sit within a few rows of the door.
- No peer-reviewed number for phone or seatbelt lag at deplaning; the 1-2 s stand-and-collect figure is the only published value.
- Row-by-row yielding is near universal on western carriers; cutting in is rare enough that most models omit it.

## Numbers not confirmed from a primary source

- Per-passenger phone-use delay at deplaning.
- Any live airline alternating-rows deplaning trial.
- Boeing datasheet aisle width for the 737-800 (industry-standard 0.48-0.51 m used).
- Explicit 0/1/2-bag fractions in Schultz's field data (inferred from the mix, not stated).
