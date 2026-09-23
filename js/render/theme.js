/**
 * Colour and type tokens shared by the canvas renderer, the SVG charts, and css/base.css (keep in sync).
 *
 * Airline safety-card look: warm paper, one ink, and colour used only for passenger state.
 * The eye should land on the aisle: moving passengers are the only saturated green on the page,
 * bag handlers the only amber. Everything structural is a gray. Blocked passengers are drawn as
 * an ink-gray hollow ring; ready passengers are the same gray, filled. That is the fix for
 * NEW-M1: making moving and blocked the same green erased the aisle-jam story.
 *
 * The heat-view ramp encodes total-time-aboard per seat once a lane finishes. It is a sequential
 * single-hue ramp on the paper palette (very light warm tan through deep ochre to near-black),
 * chosen not to collide with the exit-sign green or the seatbelt amber. That closes the critic's
 * top ask: the emptied cabin at the finish becomes the worst-seats map.
 */

export const THEME = Object.freeze({
  paper: '#f4efe6',
  ink: '#1f2a33',
  rule: '#c9c2b4',
  seatFill: '#e6dfd2',
  seatStroke: '#b8b0a0',
  aisleFill: '#ebe5da',
  binEmpty: '#e6dfd2',
  binFull: '#8f8676',
  doorInk: '#1f2a33',

  // Passenger states (see types.js Vis).
  seated: '#a9a193',
  ready: '#6f685c',
  moving: '#1f8a4c',        // exit-sign green: the only saturated green on the page
  blocked: '#4a4740',       // ink-gray: hollow ring, so the green fraction of the aisle *is* the throughput
  bag: '#e0a100',           // seatbelt-sign amber: only on the bag glyph, not on the passenger dot itself

  fontFamily: '"Barlow", "Helvetica Neue", Arial, sans-serif',
  fontMono: '"Barlow", "Helvetica Neue", Arial, sans-serif',
});

/**
 * Sequential single-hue heat ramp. Six stops light-to-dark on a warm-earth axis (paper -> deep
 * ochre -> near-black). Interpolate linearly with `heatColorAt(fraction)` where fraction is a
 * seat's total-time-aboard divided by the worst seat's time on the same lane.
 */
export const HEAT_STOPS = Object.freeze([
  '#f0e4d2',   // 0.00 - barely above paper; short waits fade in
  '#e2c99a',   // 0.20
  '#c99f5a',   // 0.40
  '#9d7332',   // 0.60
  '#6c4a15',   // 0.80
  '#382507',   // 1.00 - near-black warm brown
]);

/** Fill and stroke for a passenger dot by visual state. Hollow means stroke only. */
export function passengerStyle(vis) {
  switch (vis) {
    case 'moving': return { fill: THEME.moving, stroke: THEME.moving, hollow: false };
    case 'blocked': return { fill: THEME.paper, stroke: THEME.blocked, hollow: true };
    case 'bag': return { fill: THEME.paper, stroke: THEME.blocked, hollow: true, bagGlyph: true };
    case 'ready': return { fill: THEME.ready, stroke: THEME.ready, hollow: false };
    case 'done': return null;
    default: return { fill: THEME.seated, stroke: THEME.seated, hollow: false };
  }
}

/**
 * Linear interpolation of the HEAT_STOPS ramp. `fraction` clamps to [0, 1]. Returns a hex string.
 * Used by the emptied-cabin heat view (cabin-view.js drawHeatFills).
 */
export function heatColorAt(fraction) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const stops = HEAT_STOPS;
  const scaled = clamped * (stops.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(stops.length - 1, lower + 1);
  const local = scaled - lower;
  if (lower === upper) return stops[lower];
  return mixHex(stops[lower], stops[upper], local);
}

function mixHex(a, b, t) {
  const ra = parseInt(a.slice(1, 3), 16);
  const ga = parseInt(a.slice(3, 5), 16);
  const ba = parseInt(a.slice(5, 7), 16);
  const rb = parseInt(b.slice(1, 3), 16);
  const gb = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function toHex(n) {
  const v = Math.max(0, Math.min(255, n)).toString(16);
  return v.length === 1 ? `0${v}` : v;
}
