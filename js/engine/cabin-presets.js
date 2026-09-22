/**
 * Preset cabin geometries for the strategies to run against.
 *
 * Each entry is `{ id, label, layout, rows, binCapacityPerSeatRow, rowPitchMeters, note }`. Layouts
 * are seat-block widths left to right; see cabin.js for the block/aisle rules. Row counts and
 * layouts are the standard one-class configurations for the aircraft; sources noted per entry.
 * Load factor, rear-door use, and bin era stay independent toggles: the UI overlays those on top.
 *
 * `DEFAULT_CABIN_PRESET_ID` picks the entry the page starts on ('a320'). Every id is unique.
 */

export const CABIN_PRESETS = Object.freeze([
  Object.freeze({
    id: 'crj700',
    label: 'CRJ-700',
    layout: Object.freeze([2, 2]),
    rows: 17,
    binCapacityPerSeatRow: 0.5,
    rowPitchMeters: 0.79,
    note: 'Bombardier regional jet, 2-2 layout, ~66-70 economy seats; shelf-style bins fit few roller bags (regional 0.5).',
  }),
  Object.freeze({
    id: 'e175',
    label: 'E175',
    layout: Object.freeze([2, 2]),
    rows: 19,
    binCapacityPerSeatRow: 0.5,
    rowPitchMeters: 0.79,
    note: 'Embraer E175 regional jet, 2-2 layout, ~76 seats one-class; regional bins.',
  }),
  Object.freeze({
    id: 'b717',
    label: 'Boeing 717',
    layout: Object.freeze([2, 3]),
    rows: 26,
    binCapacityPerSeatRow: 0.67,
    rowPitchMeters: 0.79,
    note: 'MD-95 lineage, 2-3 layout; ~117 economy seats in Delta configuration (legacy bins).',
  }),
  Object.freeze({
    id: 'a320',
    label: 'A320 / 737-800',
    layout: Object.freeze([3, 3]),
    rows: 30,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.79,
    note: 'Standard narrowbody, 180 seats in 3-3 at 31 in pitch (Airspace XL / Space Bin era).',
  }),
  Object.freeze({
    id: 'b738-hd',
    label: '737-800 high-density',
    layout: Object.freeze([3, 3]),
    rows: 33,
    binCapacityPerSeatRow: 0.67,
    rowPitchMeters: 0.74,
    note: '189-seat Ryanair-style config; legacy bins (~4 bags per 3-wide bin over 2 rows) and 29 in pitch.',
  }),
  Object.freeze({
    id: 'a321neo',
    label: 'A321neo',
    layout: Object.freeze([3, 3]),
    rows: 37,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.79,
    note: 'Stretched A320 in 3-3, 220-235 seats one-class; Airspace XL bins.',
  }),
  Object.freeze({
    id: 'b767',
    label: 'Boeing 767',
    layout: Object.freeze([2, 3, 2]),
    rows: 28,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.81,
    note: 'Twin-aisle widebody in 2-3-2, ~196 economy seats at 32 in pitch.',
  }),
  Object.freeze({
    id: 'b787',
    label: 'Boeing 787',
    layout: Object.freeze([3, 3, 3]),
    rows: 30,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.81,
    note: 'Standard 787 economy in 3-3-3, ~270 seats; large pivot bins hold a bag per seat over 2 rows.',
  }),
  Object.freeze({
    id: 'b777',
    label: 'Boeing 777',
    layout: Object.freeze([3, 4, 3]),
    rows: 36,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.81,
    note: 'High-density 3-4-3 in economy, ~360 seats total across the twin-aisle cabin.',
  }),
]);

export const CABIN_PRESET_BY_ID = Object.freeze(
  Object.fromEntries(CABIN_PRESETS.map((preset) => [preset.id, preset])),
);

export const DEFAULT_CABIN_PRESET_ID = 'a320';
