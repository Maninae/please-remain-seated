/**
 * Preset cabin geometries for the strategies to run against.
 *
 * Each entry is either single-class ({ id, label, layout, rows, binCapacityPerSeatRow,
 * rowPitchMeters, note }) or multi-class ({ id, label, sections: [...], note }); see
 * cabin-presets-sections.js for the sectioned entries and design/05-sections-and-airlines.md
 * for the section contract. Row counts and layouts are the standard configurations for the
 * aircraft; sources noted per entry. Load factor, rear-door use, and bin era stay independent
 * toggles: the UI overlays those on top.
 *
 * `DEFAULT_CABIN_PRESET_ID` picks the entry the page starts on ('a320'). Every id is unique.
 */

import { SECTION_CABIN_PRESETS } from './cabin-presets-sections.js';

const SINGLE_CLASS_CABIN_PRESETS = Object.freeze([
  Object.freeze({
    id: 'crj700',
    label: 'CRJ-700',
    layout: Object.freeze([2, 2]),
    rows: 17,
    binCapacityPerSeatRow: 0.5,
    rowPitchMeters: 0.79,
    note: 'A small regional jet, 2-2 seating, about 66 seats. The shelf-style bins fit only a couple of roller bags per row.',
  }),
  Object.freeze({
    id: 'e175',
    label: 'E175',
    layout: Object.freeze([2, 2]),
    rows: 19,
    binCapacityPerSeatRow: 0.5,
    rowPitchMeters: 0.79,
    note: 'Another regional jet, 2-2 seating, about 76 seats. Small overhead bins, like the CRJ.',
  }),
  Object.freeze({
    id: 'b717',
    label: 'Boeing 717',
    layout: Object.freeze([2, 3]),
    rows: 26,
    binCapacityPerSeatRow: 0.67,
    rowPitchMeters: 0.79,
    note: 'Older short-hop jet in a lopsided 2-3, about 117 seats. Uses old-style bins.',
  }),
  Object.freeze({
    id: 'a320',
    label: 'A320 / 737',
    layout: Object.freeze([3, 3]),
    rows: 30,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.79,
    note: 'The typical single-aisle jet, 3-3 seating, 180 seats. What most domestic flights use.',
  }),
  Object.freeze({
    id: 'b738-hd',
    label: '737 high-density',
    layout: Object.freeze([3, 3]),
    rows: 33,
    binCapacityPerSeatRow: 0.67,
    rowPitchMeters: 0.74,
    note: 'A 737 crammed to 189 seats, budget-airline style. Old-style bins, less legroom.',
  }),
  Object.freeze({
    id: 'a321neo',
    label: 'A321neo',
    layout: Object.freeze([3, 3]),
    rows: 37,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.79,
    note: 'A stretched A320 with 220 to 235 seats. Roomy new-style bins.',
  }),
  Object.freeze({
    id: 'b767',
    label: 'Boeing 767',
    layout: Object.freeze([2, 3, 2]),
    rows: 28,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.81,
    note: 'A twin-aisle jet, 2-3-2 seating, about 196 seats. Two aisles help a lot.',
  }),
  Object.freeze({
    id: 'b787',
    label: 'Boeing 787',
    layout: Object.freeze([3, 3, 3]),
    rows: 30,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.81,
    note: 'A wide-body long-hauler, 3-3-3 seating, about 270 seats. Big bins fit a bag per seat.',
  }),
  Object.freeze({
    id: 'b777',
    label: 'Boeing 777',
    layout: Object.freeze([3, 4, 3]),
    rows: 36,
    binCapacityPerSeatRow: 1.0,
    rowPitchMeters: 0.81,
    note: 'The dense long-haul jet, 3-4-3 seating, about 360 seats. Middle block has four across.',
  }),
]);

export const CABIN_PRESETS = Object.freeze([
  ...SINGLE_CLASS_CABIN_PRESETS,
  ...SECTION_CABIN_PRESETS,
]);

export const CABIN_PRESET_BY_ID = Object.freeze(
  Object.fromEntries(CABIN_PRESETS.map((preset) => [preset.id, preset])),
);

export const DEFAULT_CABIN_PRESET_ID = 'a320';
