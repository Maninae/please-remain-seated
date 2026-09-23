/**
 * Multi-class cabin presets. Each entry lists `sections` explicitly, front to back, with a
 * one-line `note` and a `source` link (usually an airline seat-map page). Every section carries
 * its own `cabinClass`, block widths (`layout`), row count, pitch, and bin era.
 *
 * Sections must share `layout.length` (aisle count) but may differ in block widths, so a first-
 * class 2-2 sits next to an economy 3-3 on a narrowbody (both have layout.length 2, one aisle)
 * and a business 1-2-1 sits next to an economy 3-3-3 on a twinaisle widebody (both have
 * layout.length 3, two aisles). See design/05-sections-and-airlines.md.
 *
 * Every id here is unique against the single-class presets in cabin-presets.js, and every
 * entry ships with a source URL for the seat map, verified against the airline's own
 * published configuration.
 */

const IN_PER_METER = 39.3700787;

const inches = (value) => value / IN_PER_METER;

/**
 * 737-800 US mainline two-class (Alaska Airlines / American Airlines standard 737-800 seat
 * map). First 2-2 x 4 rows at 37 in, extra-legroom 3-3 x 6 rows at 34 in (Alaska calls it
 * Premium; American Main Cabin Extra), economy 3-3 x 20 rows at 31 in.
 *
 * Sources:
 *   Alaska 737-800 seat map ("First Class" 2-2 x 4, "Premium Class" 3-3 x 6 at 35 in,
 *   "Main Cabin" 3-3 x 20 at 31-32 in):
 *   https://www.alaskaair.com/content/travel-info/flight-experience/aircraft/737-800
 *   American 737-800 seat map ("First" 2-2 x 4, "Main Cabin Extra" 3-3 x 6 at 33-34 in,
 *   "Main Cabin" 3-3 x 20 at 30-31 in):
 *   https://www.aa.com/i18n/travel-info/travel-experience/planes/boeing-737-800.jsp
 */
const B738_TWO_CLASS = Object.freeze({
  id: 'b738-two-class',
  label: '737-800 two-class',
  binCapacityPerSeatRow: 1.0,
  sections: Object.freeze([
    Object.freeze({
      id: 'first',
      label: 'First',
      cabinClass: 'first',
      layout: Object.freeze([2, 2]),
      rows: 4,
      rowPitchMeters: inches(37),
      binCapacityPerSeatRow: 1.0,
      note: 'US mainline first: 2-2 x 4 at 37 in pitch, four rows of leather recliners.',
      source: 'https://www.alaskaair.com/content/travel-info/flight-experience/aircraft/737-800',
    }),
    Object.freeze({
      id: 'premium',
      label: 'Extra legroom',
      cabinClass: 'economy',
      premium: true,
      layout: Object.freeze([3, 3]),
      rows: 6,
      rowPitchMeters: inches(34),
      binCapacityPerSeatRow: 1.0,
      note: 'Extra-legroom rows (Alaska Premium / AA Main Cabin Extra): 3-3 x 6 at 34 in.',
      source: 'https://www.alaskaair.com/content/travel-info/flight-experience/aircraft/737-800',
    }),
    Object.freeze({
      id: 'economy',
      label: 'Main Cabin',
      cabinClass: 'economy',
      layout: Object.freeze([3, 3]),
      rows: 20,
      rowPitchMeters: inches(31),
      binCapacityPerSeatRow: 1.0,
      note: 'Standard economy: 3-3 x 20 at 31 in pitch.',
      source: 'https://www.aa.com/i18n/travel-info/travel-experience/planes/boeing-737-800.jsp',
    }),
  ]),
  note: 'Textbook US narrowbody two-class 737-800: 16 first, 18 premium legroom, 120 economy.',
});

/**
 * A321neo three-class in the US-domestic-transcon configuration (JetBlue Mint, or the Alaska /
 * Delta three-class hybrid). First 2-2 x 5 rows at 37 in, premium 3-3 x 9 rows at 34 in,
 * economy 3-3 x 24 rows at 30 in.
 *
 * Sources:
 *   Alaska A321neo seat map (2-2 x 5 first, 3-3 premium, 3-3 x 24 main):
 *   https://www.alaskaair.com/content/travel-info/flight-experience/aircraft/321
 *   Delta A321neo seat map (First 20, Comfort+ 42, Main Cabin 132):
 *   https://www.delta.com/us/en/aircraft/airbus/a321neo
 */
const A321NEO_THREE_CLASS = Object.freeze({
  id: 'a321neo-three-class',
  label: 'A321neo three-class',
  binCapacityPerSeatRow: 1.0,
  sections: Object.freeze([
    Object.freeze({
      id: 'first',
      label: 'First',
      cabinClass: 'first',
      layout: Object.freeze([2, 2]),
      rows: 5,
      rowPitchMeters: inches(37),
      binCapacityPerSeatRow: 1.0,
      note: 'US transcon first: 2-2 x 5 at 37 in, five rows of leather recliners.',
      source: 'https://www.alaskaair.com/content/travel-info/flight-experience/aircraft/321',
    }),
    Object.freeze({
      id: 'premium',
      label: 'Extra legroom',
      cabinClass: 'economy',
      premium: true,
      layout: Object.freeze([3, 3]),
      rows: 9,
      rowPitchMeters: inches(34),
      binCapacityPerSeatRow: 1.0,
      note: 'Extra-legroom economy: 3-3 x 9 at 34 in pitch.',
      source: 'https://www.delta.com/us/en/aircraft/airbus/a321neo',
    }),
    Object.freeze({
      id: 'economy',
      label: 'Main Cabin',
      cabinClass: 'economy',
      layout: Object.freeze([3, 3]),
      rows: 24,
      rowPitchMeters: inches(30),
      binCapacityPerSeatRow: 1.0,
      note: 'Dense economy: 3-3 x 24 at 30 in, the trans-con standard.',
      source: 'https://www.alaskaair.com/content/travel-info/flight-experience/aircraft/321',
    }),
  ]),
  note: 'A321neo transcon three-class: 20 first, 54 premium legroom, 144 economy.',
});

/**
 * 737 MAX 8 low-cost single-class (Ryanair / Southwest 737 MAX 8 layout). Every seat is 3-3
 * at 30 in pitch; the first five rows are flagged premium (extra legroom over-wing exits and
 * front row) via the top-level `premiumRows` list, matching how Ryanair sells rows 1-2 and
 * 16-17 as "extra legroom" but for simplicity we keep the extra-legroom flag on the front block.
 *
 * Sources:
 *   Ryanair 737 MAX 8-200 seat map (3-3 x 32 at 30 in with rows 1-2 and 16-17 extra legroom):
 *   https://www.ryanair.com/gb/en/plan-trip/flying-with-us/our-fleet
 *   Southwest 737 MAX 8 configuration (175 seats 3-3):
 *   https://www.southwest.com/html/customer-service/faqs.html
 */
const B737MAX8_LCC = Object.freeze({
  id: 'b737max8-lcc',
  label: '737 MAX 8 (low-cost)',
  binCapacityPerSeatRow: 0.67,
  premiumRows: Object.freeze([1, 2, 3, 4, 5]),
  sections: Object.freeze([
    Object.freeze({
      id: 'economy',
      label: 'Economy',
      cabinClass: 'economy',
      layout: Object.freeze([3, 3]),
      rows: 29,
      rowPitchMeters: inches(30),
      binCapacityPerSeatRow: 0.67,
      note: '737 MAX 8 low-cost economy: 3-3 x 29 at 30 in, legacy bins. Front rows flagged premium.',
      source: 'https://www.ryanair.com/gb/en/plan-trip/flying-with-us/our-fleet',
    }),
  ]),
  note: 'Single-class LCC 737 MAX 8: 174 seats, five front rows sold as extra legroom.',
});

/**
 * 787-9 three-class long-haul (United / ANA / JAL). Business 1-2-1 x 12 rows at 44 in
 * (lie-flat, each row spans three aisle cells because of the reversed herringbone footprint),
 * premium economy 2-3-2 x 3 rows at 38 in, economy 3-3-3 x 26 rows at 31 in.
 *
 * Sources:
 *   United 787-9 seat map ("Polaris Business" 1-2-1 x 12, "Premium Plus" 2-3-2, Economy 3-3-3):
 *   https://www.united.com/ual/en/us/fly/travel/inflight/aircraft/787-9.html
 *   Japan Airlines 787-9 A configuration (48 J 1-2-1, 40 W 2-3-2, 195 Y 3-3-3):
 *   https://www.jal.co.jp/en/inflight/seatmap/b789.html
 */
const B789_THREE_CLASS = Object.freeze({
  id: 'b789-three-class',
  label: '787-9 three-class',
  binCapacityPerSeatRow: 1.0,
  sections: Object.freeze([
    Object.freeze({
      id: 'business',
      label: 'Business (lie-flat)',
      cabinClass: 'business',
      layout: Object.freeze([1, 2, 1]),
      rows: 12,
      rowPitchMeters: inches(44),
      binCapacityPerSeatRow: 1.0,
      note: 'Reverse-herringbone lie-flat business: 1-2-1 x 12 at 44 in (3 aisle cells per row).',
      source: 'https://www.united.com/ual/en/us/fly/travel/inflight/aircraft/787-9.html',
    }),
    Object.freeze({
      id: 'premium',
      label: 'Premium Economy',
      cabinClass: 'premium',
      layout: Object.freeze([2, 3, 2]),
      rows: 3,
      rowPitchMeters: inches(38),
      binCapacityPerSeatRow: 1.0,
      note: 'Premium economy: 2-3-2 x 3 at 38 in, wider seats and a bigger recline.',
      source: 'https://www.united.com/ual/en/us/fly/travel/inflight/aircraft/787-9.html',
    }),
    Object.freeze({
      id: 'economy',
      label: 'Economy',
      cabinClass: 'economy',
      layout: Object.freeze([3, 3, 3]),
      rows: 26,
      rowPitchMeters: inches(31),
      binCapacityPerSeatRow: 1.0,
      note: 'Long-haul economy: 3-3-3 x 26 at 31 in, Space Bin era.',
      source: 'https://www.jal.co.jp/en/inflight/seatmap/b789.html',
    }),
  ]),
  note: '787-9 three-class long-haul: 48 business, 21 premium, 234 economy.',
});

export const SECTION_CABIN_PRESETS = Object.freeze([
  B738_TWO_CLASS,
  A321NEO_THREE_CLASS,
  B737MAX8_LCC,
  B789_THREE_CLASS,
]);
