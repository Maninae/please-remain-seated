/**
 * Colour and type tokens shared by the canvas renderer, the SVG charts, and css/base.css (keep in sync).
 *
 * Airline safety-card look: warm paper, one ink, and colour used only for passenger state.
 * The eye should land on the aisle: moving passengers are the only saturated green on the page,
 * bag handlers the only amber. Everything structural is a gray.
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

  // Passenger states (see types.js Vis)
  seated: '#a9a193',
  ready: '#6f685c',
  moving: '#1f8a4c',   // exit-sign green
  blocked: '#1f8a4c',  // same hue, drawn hollow: wants to move, cannot
  bag: '#e0a100',      // seatbelt-sign amber

  fontFamily: '"Barlow", "Helvetica Neue", Arial, sans-serif',
  fontMono: '"Barlow", "Helvetica Neue", Arial, sans-serif',
});

/** Fill and stroke for a passenger dot by visual state. Hollow means stroke only. */
export function passengerStyle(vis) {
  switch (vis) {
    case 'moving': return { fill: THEME.moving, stroke: THEME.moving, hollow: false };
    case 'blocked': return { fill: THEME.paper, stroke: THEME.blocked, hollow: true };
    case 'bag': return { fill: THEME.bag, stroke: THEME.bag, hollow: false };
    case 'ready': return { fill: THEME.ready, stroke: THEME.ready, hollow: false };
    case 'done': return null;
    default: return { fill: THEME.seated, stroke: THEME.seated, hollow: false };
  }
}
