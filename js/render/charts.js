/**
 * Charts entry point. Re-exports the strip chart and the time-split bar so existing imports
 * (`import { renderStrips, renderTimeSplit } from './render/charts.js'`) keep working.
 *
 * The actual drawing sits in:
 *   - charts-strips.js       one row per strategy: dots + p10-p90 band + median tick.
 *   - charts-time-split.js   one stacked bar of seated / aisle-blocked / bags / walking.
 *   - charts-svg-dom.js      the small DOM shim both share so they unit-test cleanly.
 *
 * All the numeric helpers (quantile, jitterFor, niceCeiling) are exported from
 * charts-strips.js. Callers that pin them (a test does) can import from either name; this file
 * re-exports the surface.
 */

export { renderStrips, quantile, jitterFor, niceCeiling } from './charts-strips.js';
export { renderTimeSplit } from './charts-time-split.js';
