/**
 * Plain-language explanations that back the small "i" info buttons across the page.
 *
 * Each entry is `{ title, body, learnMore? }`. `body` is 2-4 short sentences aimed at a smart
 * high-school reader: first-principles, concrete, no equations, no jargon without an immediate
 * gloss. `learnMore.href` opens in a new tab (Wikipedia for the well-known ideas, or the repo's
 * own research doc for the measured numbers). Titles double as the popover's aria-labelledby
 * target.
 *
 * Keys:
 *   - every strategy id (mode-agnostic; the boarding "back-to-front" entry describes zones
 *     because the deplaning strategy is separate and lives elsewhere in the sim, but its
 *     copy applies to both variants), plus every aircraft preset id.
 *   - one entry per setting the sidebar exposes: how-full, follow-the-rules, groups,
 *     overhead-bins, let-people-out, phone-checkers, time-to-get-up, carry-ons, runs, seed,
 *     speed, heat-view, time-split, compare, door-countdown.
 */

const RESEARCH_LINK = {
  label: 'Where these numbers come from',
  href: 'https://github.com/Maninae/please-remain-seated/blob/main/design/02-research.md',
};

export const GLOSSARY = Object.freeze({
  // -------------------- deplaning strategies --------------------

  'free-for-all': {
    title: 'Free-for-all',
    body: 'The seatbelt sign turns off and everyone stands at once. It is what actually happens on a plane, and it is the baseline every other order is judged against here.',
  },
  'row-by-row': {
    title: 'One row at a time',
    body: 'The crew asks each row to wait for the row in front of it to empty. It is the strict version of the announced rule, and it is slow because most of the plane spends the whole time sitting.',
  },
  'aisle-first': {
    title: 'Aisle seats first',
    body: 'Everyone in an aisle seat leaves before the middle seats stand, and the window seats wait until the middles are gone. Nobody has to climb over anyone else.',
  },
  'alternating-rows': {
    title: 'Every other row',
    body: 'Even rows stand first, then odd rows. It spreads bag-pull moments so two people are not reaching into overhead bins right next to each other.',
  },
  'two-doors': {
    title: 'Both doors',
    body: 'The back door of the plane opens as well as the front. Each half of the cabin drains through its own exit instead of everyone squeezing to the front. It is the single biggest win in the sim.',
    learnMore: {
      label: 'Aircraft doors on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Aircraft_door',
    },
  },
  'bagless-first': {
    title: 'No bags first',
    body: 'People with nothing in the overhead bin leave first. Bag pulls are the slowest part of deplaning, so getting the fast movers out of the aisle first clears the way.',
  },
  'back-to-front': {
    title: 'Back to front',
    body: 'The last row leaves first, then the row in front of it, and so on toward row 1. Sounds tidy but is even slower than one-row-at-a-time: nobody in front can start moving.',
  },

  // -------------------- boarding strategies --------------------

  random: {
    title: 'Random order',
    body: 'People board in whatever order they show up at the gate. This is what most airlines actually do once first class and priority groups are past.',
  },
  wilma: {
    title: 'Window, middle, aisle',
    body: 'Every window seat boards first, then every middle, then every aisle. Nobody in a seat has to stand up to let someone past. It is one of the fastest simple orders.',
    learnMore: {
      label: 'Airline boarding on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Airline_boarding',
    },
  },
  steffen: {
    title: 'Steffen method',
    body: 'A physicist named Jason Steffen worked out a boarding order in 2008. Windows first, spaced two rows apart on the same side, then middles, then aisles. The gaps let neighbours stow bags at the same time instead of waiting on each other. In theory it is the fastest possible order.',
    learnMore: {
      label: 'Steffen method on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Steffen_boarding_method',
    },
  },
  'steffen-modified': {
    title: 'Steffen, in blocks',
    body: 'A looser version of the Steffen method that airlines could actually run. Four waves, every fourth row, outside seats first. Easier to announce at a gate.',
    learnMore: {
      label: 'Steffen method on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Steffen_boarding_method',
    },
  },
  'reverse-pyramid': {
    title: 'Reverse pyramid',
    body: 'Start with the window seat in the very back row and work diagonally forward and inward, ending at the front-aisle corner. Delta and US Airways used variants of this in the 2000s.',
    learnMore: {
      label: 'Airline boarding on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Airline_boarding',
    },
  },
  'rotating-zone': {
    title: 'Rotating zones',
    body: 'Board the back quarter, then the front quarter, then the next-in bands, alternating toward the middle. The alternation stops long lines of neighbours from forming in one place.',
  },
  'front-to-back': {
    title: 'Front to back',
    body: 'The cabin boards in bands starting at the front. Every later passenger has to squeeze past someone already sitting down. This is the classic bad idea.',
  },
  'open-seating': {
    title: 'Pick any seat',
    body: 'No assigned seats. People walk down the aisle and pick a seat that does not make anyone stand up (an empty row, or the aisle seat of a partly full one). Southwest used to board this way.',
    learnMore: {
      label: 'Open seating on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Southwest_Airlines#Open_seating',
    },
  },

  // -------------------- aircraft presets --------------------

  crj700: {
    title: 'CRJ-700 (regional jet)',
    body: 'A small twin-engine jet used for short hops, with 2-2 seating and about 66 seats. The overhead bins are shallow shelves that fit only a couple of roller bags per row.',
    learnMore: {
      label: 'Bombardier CRJ700 on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Bombardier_CRJ700_series',
    },
  },
  e175: {
    title: 'Embraer E175 (regional jet)',
    body: 'Another common regional jet, 2-2 seating, about 76 seats. Similar bin situation to the CRJ.',
    learnMore: {
      label: 'Embraer E-Jet family on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Embraer_E-Jet_family',
    },
  },
  b717: {
    title: 'Boeing 717',
    body: 'An older short-hop jet with a lopsided 2-3 layout, about 117 seats. Delta flew a lot of these. Old-style bins.',
    learnMore: {
      label: 'Boeing 717 on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Boeing_717',
    },
  },
  a320: {
    title: 'A320 or 737',
    body: 'The typical single-aisle domestic jet with 3-3 seating and about 180 seats. Almost every US flight of a couple of hours is one of these.',
    learnMore: {
      label: 'Airbus A320 family on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Airbus_A320_family',
    },
  },
  'b738-hd': {
    title: '737 high-density',
    body: 'A 737-800 packed to 189 seats, budget-airline style. Old-style bins and less legroom, which slows the aisle down.',
    learnMore: {
      label: 'Boeing 737 Next Generation on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Boeing_737_Next_Generation',
    },
  },
  a321neo: {
    title: 'A321neo',
    body: 'A stretched A320 with 220 to 235 seats. Airbus makes it with roomy new-style bins that fit a bag per seat.',
    learnMore: {
      label: 'Airbus A321neo on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Airbus_A321neo',
    },
  },
  b767: {
    title: 'Boeing 767',
    body: 'A twin-aisle jet in 2-3-2 seating, about 196 seats. Two aisles help a lot: half the plane drains through each one.',
    learnMore: {
      label: 'Boeing 767 on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Boeing_767',
    },
  },
  b787: {
    title: 'Boeing 787 Dreamliner',
    body: 'A modern wide-body long-hauler in 3-3-3 seating, about 270 seats. Big pivot bins fit a bag per seat over two rows.',
    learnMore: {
      label: 'Boeing 787 Dreamliner on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Boeing_787_Dreamliner',
    },
  },
  b777: {
    title: 'Boeing 777',
    body: 'The dense long-haul jet with 3-4-3 seating, about 360 seats. The middle block has four across, so those inner passengers climb over three people to reach the aisle.',
    learnMore: {
      label: 'Boeing 777 on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Boeing_777',
    },
  },

  // -------------------- multi-class aircraft presets --------------------

  'b738-two-class': {
    title: '737-800, first + economy',
    body: 'The standard US mainline 737-800. Sixteen first-class seats up front in a 2-2 layout with wider recliners, then six rows of extra-legroom economy, then twenty rows of standard 3-3 economy. Alaska Airlines and American Airlines both fly this configuration.',
    learnMore: {
      label: 'Alaska 737-800 seat map',
      href: 'https://www.alaskaair.com/content/travel-info/flight-experience/aircraft/737-800',
    },
  },
  'a321neo-three-class': {
    title: 'A321neo, three classes',
    body: 'A stretched A321neo in the US transcon three-class layout: twenty first-class seats up front (2-2, wide recliners), fifty-four extra-legroom economy seats, then a hundred and forty-four standard 3-3 economy seats. Alaska and Delta both fly variants of this.',
    learnMore: {
      label: 'Delta A321neo seat map',
      href: 'https://www.delta.com/us/en/aircraft/airbus/a321neo',
    },
  },
  'b737max8-lcc': {
    title: '737 MAX 8, low-cost',
    body: 'A 737 MAX 8 in single-class low-cost configuration: every row is 3-3, one hundred and seventy-four seats, and the front five rows are sold as extra legroom. Ryanair and Southwest use variants of this.',
    learnMore: {
      label: 'Ryanair 737 MAX 8 seat map',
      href: 'https://www.ryanair.com/gb/en/plan-trip/flying-with-us/our-fleet',
    },
  },
  'b789-three-class': {
    title: '787-9, three classes',
    body: 'A long-haul Boeing 787-9 in the standard three-class layout: forty-eight lie-flat business suites at the front in 1-2-1, then a small premium-economy cabin in 2-3-2, then the main 3-3-3 economy cabin. Business rows are longer than economy because the seats fold flat. United, ANA, and JAL fly this.',
    learnMore: {
      label: 'United 787-9 seat map',
      href: 'https://www.united.com/ual/en/us/fly/travel/inflight/aircraft/787-9.html',
    },
  },

  // -------------------- airline boarding procedures --------------------

  alaska: {
    title: 'Alaska Airlines',
    body: 'Alaska boards First, then A (top elites, families with young kids, active military, oneworld Emerald and Sapphire), then B (Silver elites and Premium Class), then C (Alaska Visa cardholders), then D and E (rear half of Main Cabin, then front half), then F (Saver fare last). Hybrid: status and cabin first, back-to-front within economy. Current as of September 2026.',
    learnMore: {
      label: 'Alaska boarding process',
      href: 'https://www.alaskaair.com/content/travel-info/flight-experience/our-boarding-process',
    },
  },
  american: {
    title: 'American Airlines',
    body: 'American boards by pure fare and status: pre-boarding for ConciergeKey, First, Business, unaccompanied minors, wheelchair, active military, and families with kids under two, then Groups 1 through 9 by status tier and fare bucket, with Basic Economy last. No seat-location ordering. Restructured in May 2025 and current as of September 2026.',
    learnMore: {
      label: 'American Airlines boarding',
      href: 'https://www.aa.com/i18n/travel-info/during-trip/boarding-your-flight.jsp',
    },
  },
  delta: {
    title: 'Delta Air Lines',
    body: 'Delta boards by fare and status only: pre-board for assistance and active military, then Group 1 (Delta One and First), Group 2 (Diamond Medallion and Premium Select), Group 3 (Comfort+), Group 4 (Sky Priority), Groups 5 through 7 (Main Cabin by branded fare), and Group 8 (Basic Economy) last. Current as of September 2026.',
    learnMore: {
      label: 'Delta boarding page',
      href: 'https://www.delta.com/us/en/onboard/travel-experience-onboard/boarding',
    },
  },
  united: {
    title: 'United Airlines',
    body: 'United boards Polaris, First, and top elites first, then Premier Platinum and Gold, then Silver and Economy Plus. Economy then boards window seats first, then middle seats, then aisle seats, with Basic Economy last. This is the WILMA order that United says saves about two minutes per turn. Current since October 2023 and still current as of September 2026.',
    learnMore: {
      label: 'United on WILMA (CNBC Select)',
      href: 'https://www.cnbc.com/select/united-boarding-process-prioritize-window-seats/',
    },
  },
  southwest: {
    title: 'Southwest Airlines',
    body: 'Southwest switched from open seating to assigned seats in January 2026. They now board pre-board first, then A-List Preferred as a dedicated group, then eight numbered groups: A-List and Choice Extra, extra-legroom, Choice Preferred (twice), cardholders, Choice, and finally Basic. Family boarding for adults with a child six or under slots between Groups 2 and 3.',
    learnMore: {
      label: 'Southwest assigned seating',
      href: 'https://www.southwest.com/customer-enhancements/assigned-seating/',
    },
  },
  jetblue: {
    title: 'JetBlue',
    body: 'JetBlue moved to numbered groups on April 29, 2026. Pre-board for extra time, then Group 1 (Mint business and top Mosaic), Group 2 (EvenMore extra-legroom and mid-Mosaic), Group 3 (JetBlue cardholders and Blue Extra fare), then Groups 4 through 8 by seat location (rear-first), with Blue Basic last. Current as of September 2026.',
    learnMore: {
      label: 'JetBlue boarding procedures',
      href: 'https://www.jetblue.com/help/boarding-procedures',
    },
  },
  frontier: {
    title: 'Frontier Airlines',
    body: 'Frontier boards in seven groups since October 2, 2025: pre-board for assistance, Elite Diamond, military, and families with kids under two, then Elite Platinum and Business bundle, then Silver and members with carry-ons, then paid carry-on, then cardholders and Priority Boarding, then general members, and finally Basic fare split rear then front. Current as of September 2026.',
    learnMore: {
      label: 'Frontier boarding page',
      href: 'https://faq.flyfrontier.com/help/frontier-boarding-process',
    },
  },
  hawaiian: {
    title: 'Hawaiian Airlines',
    body: 'Hawaiian moved to the same A through F system as Alaska in 2026 on their shared reservation system: pre-board, First, A (top elites, families with young kids, military), B (Silver and Extra Comfort), C (cardholders), D (Main rear), E (Main front), and F (Main Basic) last. Current as of September 2026.',
    learnMore: {
      label: 'Alaska + Hawaiian shared PSS',
      href: 'https://news.alaskaair.com/company/alaska-airlines-hawaiian-airlines-transition-to-shared-passenger-service-system-to-deliver-a-more-seamless-guest-experience/',
    },
  },
  ryanair: {
    title: 'Ryanair',
    body: 'Ryanair uses only two groups after a pre-board for reduced mobility: Priority (paid Priority Boarding or a Priority fare with two cabin bags), then everyone else. When the gate allows it Ryanair also boards through the rear door as well as the front. Current as of September 2026.',
    learnMore: {
      label: 'Ryanair boarding guide',
      href: 'https://whichterminal.co.uk/guides/ryanair-boarding-process-explained',
    },
  },
  easyjet: {
    title: 'easyJet',
    body: 'easyJet boards in three groups after pre-boarding for special assistance: Speedy Boarding (easyJet Plus, Up Front, Extra Legroom, Large Cabin Bag), then families with children under five, then everyone else. easyJet uniquely boards through both front and rear doors at the same time when the aircraft parks on a stand. Current as of September 2026.',
    learnMore: {
      label: 'easyJet boarding groups',
      href: 'https://upgradedpoints.com/travel/airlines/easyjet-boarding-groups/',
    },
  },
  lufthansa: {
    title: 'Lufthansa',
    body: 'Lufthansa boards pre-board (kids under five, unaccompanied minors, mobility), then First and HON Circle, then Business, Senator, and Star Alliance Gold, then Premium Economy on long-haul, then economy in window, middle, aisle order with Light fare last. Current as of September 2026.',
    learnMore: {
      label: 'Lufthansa boarding page',
      href: 'https://www.lufthansa.com/us/en/boarding',
    },
  },
  'british-airways': {
    title: 'British Airways',
    body: 'British Airways simplified its groups in April 2025. Pre-board for families with kids under two and mobility, then Group 0 (top-tier trial), Group 1 (First and Gold), Group 2 (Club Europe, Silver, Premium Economy), Group 3 (Bronze), Group 4 (everyone else), and on short-haul Group 5 (Basic fare) last. Current as of September 2026.',
    learnMore: {
      label: 'British Airways boarding',
      href: 'https://www.britishairways.com/content/information/checking-in-and-boarding/boarding',
    },
  },
  'air-canada': {
    title: 'Air Canada',
    body: 'Air Canada boards by fare and status: pre-board for wheelchair and extra time, then Zone 1 (Business and Super Elite plus one companion), Zone 2 (Premium Economy and top Aeroplan tiers plus Star Alliance Gold), a family zone for kids under six, Zone 3 (Latitude, Comfort, preferred seats), then Zones 4 through 6 for the rest of economy (rear-first). Current as of September 2026.',
    learnMore: {
      label: 'Air Canada boarding by zone',
      href: 'https://www.aircanada.com/ca/en/aco/home/fly/at-the-airport/boarding-by-zone.html',
    },
  },
  ana: {
    title: 'ANA (All Nippon Airways)',
    body: 'ANA has boarded in WILMA order in economy since November 15, 2021. Pre-board for wheelchair and infants under two, then Group 1 (Diamond and First), Group 2 (Platinum, Super Flyers, Star Alliance Gold, Business), then economy window, middle, and aisle in that order. Current as of September 2026.',
    learnMore: {
      label: 'ANA WILMA announcement',
      href: 'https://www.ana.co.jp/en/us/offers-and-announcements/announcements/211115-boarding/',
    },
  },

  // -------------------- settings --------------------

  'how-full': {
    title: 'How full the plane is',
    body: 'The fraction of seats that have a person in them. 100 percent is a full flight; 60 percent means four seats out of ten are empty. US flights average around 85 percent full.',
    learnMore: {
      label: 'Load factor on Wikipedia',
      href: 'https://en.wikipedia.org/wiki/Passenger_load_factor',
    },
  },
  'follow-the-rules': {
    title: 'How well people follow the rules',
    body: 'How much of the announced order people actually go along with. At 100 percent everyone waits their turn. At 0 percent everyone stands the moment the seatbelt sign turns off. This is the setting that decides whether any clever strategy really works.',
  },
  groups: {
    title: 'Groups travelling together',
    body: 'The share of passengers travelling with someone. Groups leave and board together, so a strategy that separates a family often loses time to them regrouping in the aisle.',
  },
  'overhead-bins': {
    title: 'Overhead bins',
    body: 'Newer roomy bins ("Space bins" or Airspace XL) tilt down and fit a bag per seat. Old-style bins fit fewer bags, so people have to walk past their row to find an open bin, which slows everyone behind them.',
    learnMore: {
      label: 'Overhead bins',
      ...RESEARCH_LINK,
    },
  },
  'let-people-out': {
    title: 'Letting people out',
    body: 'How willing seated passengers are to lean into the aisle so someone behind them can pass. Higher means fewer aisle jams; lower means the aisle stops the moment one person freezes.',
  },
  'phone-checkers': {
    title: 'Phone-checkers',
    body: 'The share of passengers who miss their cue because they are looking at a phone. They take much longer to notice the aisle is clear, and a single distracted person can hold up the whole row behind them.',
  },
  'time-to-get-up': {
    title: 'Time to get up',
    body: 'The typical number of seconds a person takes to notice their turn, put a phone away, and stand up. Most people are ready in 2 or 3 seconds; a long tail take much longer.',
    learnMore: RESEARCH_LINK,
  },
  'carry-ons': {
    title: 'Carry-ons',
    body: 'The three sliders decide the share of passengers with no bag, one bag, or two bags in the overhead bin. Bag pulls and stows are the slowest single action on the plane, so this dial matters a lot.',
    learnMore: RESEARCH_LINK,
  },
  runs: {
    title: 'Runs',
    body: 'The compare chart runs every strategy this many times, each with a different random seed, and shows the range of results. More runs means a more reliable answer at the cost of waiting a few more seconds.',
  },
  seed: {
    title: 'Seed',
    body: 'The random number that decides which seats are empty, who has bags, who is distracted, and who is in a group. Same seed, same plane. Change it or click "New plane" for a fresh set of passengers.',
  },
  speed: {
    title: 'Playback speed',
    body: 'How much faster than real life the sim plays. 1x is real time; 15x is the default. The math is identical at every speed; only the drawing gets faster.',
  },
  'heat-view': {
    title: 'Worst-seats view',
    body: 'After the race, each seat is coloured by how long that passenger spent on the plane. Dark seats are the ones who waited longest. The label calls out the worst and best seats on each cabin.',
  },
  'time-split': {
    title: 'Where the time goes',
    body: 'The last passenger to get off (or on) spends most of their time in one of four states: sitting and waiting, blocked in the aisle, dealing with a bag, or actually walking. This bar breaks their total time into those four pieces.',
  },
  compare: {
    title: 'Run it 100 times',
    body: 'The two races on top show one plane each. This section runs every strategy across many random planes and draws where each one usually finishes, so a lucky race does not fool you. The two highlighted rows are the strategies you are watching above.',
  },
  'door-countdown': {
    title: 'Door countdown',
    body: 'The clock ticks up from the seatbelt sign turning off. There is a short staging window (about 45 seconds) before the door opens, so people can prep, stand, and pull bags. That is why the timer might read a negative number before the door opens.',
  },
});
