/**
 * Real-world anchors overlaid on the ranked chart as thin labelled ticks.
 *
 * A measured anchor is a real (mode, narrowbody-ish) boarding or deplaning time reported by
 * an airline or a study. It sits on the chart in a distinct "measured, not simulated" style,
 * with a popover carrying the source line the reader can click for the URL.
 *
 * Sources (design/06-airline-research.md and design/02-research.md):
 *   - KLM 17 to 22 minutes on a 737-800 (Forbes 2013): airline field claim.
 *   - Spirit ~20 minutes on an A320 (Forbes 2013): airline field claim.
 *   - MythBusters back-to-front 24:29 on 173 seats (2014): controlled test.
 *   - Schultz 2018 deplane median 23 pax/min (Aerospace 5(1):27): translated to a minutes
 *     figure per cell using the actual passengerCount so the tick sits at the right x.
 *
 * We only draw an anchor when the current cell's aircraft class fits: narrowbody 737 / A320
 * class only. A 787 or 777 cell shows no measured anchors (there is nothing to compare
 * against). The narrowbody check leans on the preset id (a320, b738-hd, b737max8-lcc,
 * b738-two-class, a321neo, a321neo-three-class) rather than the passenger count so a very
 * light narrowbody cell still qualifies.
 */

const NARROWBODY_PRESETS = new Set([
  'a320', 'b738-hd', 'a321neo', 'b738-two-class', 'a321neo-three-class',
  'b737max8-lcc',
]);

/**
 * Return the anchors that fit the current cell. `passengerCount` is used to translate the
 * Schultz deplane throughput (pax/min) to a minutes figure that lands where the current
 * cell's simulated planes actually finish.
 */
export function anchorsFor({ mode, preset, passengerCount }) {
  if (!NARROWBODY_PRESETS.has(preset)) return [];
  const anchors = [];
  if (mode === 'board') {
    // KLM published a 17 to 22 min RANGE for the same aircraft class. Draw it as a single
    // shaded band spanning both endpoints (one source, one label) rather than as two
    // separate ticks that read as two independent measurements (N5-m2).
    anchors.push({
      id: 'klm-737',
      kind: 'range',
      label: 'KLM 737 · 17 to 22 min',
      minutes: 17,
      minutesEnd: 22,
      source: 'Forbes 2013 (KLM 737-800 boarding, redesigned to legacy range)',
      href: 'https://www.forbes.com/sites/tedreed/2013/11/16/klm-we-can-board-a-boeing-737-800-in-17-minutes/',
    });
    anchors.push({
      id: 'spirit-a320',
      label: 'Spirit A320 · 20 min',
      minutes: 20,
      source: 'Forbes 2013 (Spirit A320 field claim)',
      href: 'https://www.forbes.com/sites/tedreed/2013/05/21/spirit-airlines-we-board-an-a320-in-20-minutes/',
    });
    anchors.push({
      id: 'mythbusters-b2f',
      label: 'MythBusters · 24:29',
      // 24 minutes 29 seconds
      minutes: 24 + 29 / 60,
      source: 'MythBusters episode 222 (2014), back-to-front on a 173-seat mock',
      href: 'https://mythresults.com/airplane-boarding',
    });
  } else if (mode === 'deplane') {
    // Schultz 2018 field median: 23 pax/min out the door. Total minutes = passengers / rate.
    if (Number.isFinite(passengerCount) && passengerCount > 0) {
      const minutes = passengerCount / 23;
      anchors.push({
        id: 'schultz-deplane',
        label: `Schultz field · ${formatMinutes(minutes)} min`,
        minutes,
        source: 'Schultz 2018, Aerospace 5(1):27, median 23 pax/min out the door',
        href: 'https://doi.org/10.3390/aerospace5010027',
      });
    }
  }
  return anchors;
}

function formatMinutes(m) {
  if (!Number.isFinite(m) || m <= 0) return '0';
  if (m < 10) return m.toFixed(1);
  return String(Math.round(m));
}
