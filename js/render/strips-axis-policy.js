/**
 * Shared axis policy for the "Run it N times" strip chart. Round-14 replaced three rounds
 * of ad-hoc floor+cap tuning with one rule the tests can verify from the cell data alone.
 *
 * Public API:
 *   computeStripsAxisPolicy(rowsAcrossBothPanels, { preset }) -> {
 *     floorSeconds, capSeconds,
 *     rowsOffScale, belowFloorDotCounts, aboveCapDotCounts,
 *     airlineSpanFraction, plotBandSeconds, capStepInfo, preset,
 *   }
 *
 * Contract (also encoded as invariants in tests/unit/compare-axis-policy.test.js):
 *   - Floor: the largest ladder value at least 30 s below the smallest median across both
 *     panels. Every on-scale median therefore sits strictly above the floor.
 *   - Cap: initial value is the smallest ladder value at or above the p90 of the medians
 *     across both panels. On narrowbody presets, if the airline group spans under 25% of
 *     the plot band the cap steps DOWN one rung at a time (never below the third-largest
 *     median) until the airline span reaches 25% or the rung limit. Then a lead follow-up
 *     clause: if more than three rows would be off scale under the current cap, walk the
 *     cap UP one rung at a time until at most three rows are off scale or the ladder ends.
 *     Eight broken bars in the right gutter reads as "half the chart is off scale"; a
 *     slightly wider band is worth keeping the airline neighbours on scale.
 *     capStepInfo.stopReason records the step-down outcome; capStepInfo.raisedForOffScaleCap
 *     records whether the follow-up widened the cap.
 *   - Off-scale rows: any median STRICTLY above the cap. A median within 2% of the cap
 *     used to be treated as off-scale ("legibility bracket"), but this labelled rows with a
 *     median inside the cap "(off scale)" beside an axis whose top tick equalled or
 *     exceeded that value. The cap-raise pass below now handles the legibility case: if
 *     any on-scale median sits within 2% of the cap, the cap steps UP one rung so the
 *     median comfortably clears the top of the axis, and the row stays on-scale. Off-scale
 *     rows draw as a broken bar in the right gutter with the true value printed; NEVER as
 *     a clamped dot on the cap. (round-16 R12-m2)
 *   - Dot counts per row: p10-p90 dots outside the [floor, cap] window count into the
 *     "N below" and "N off scale" edge marks. Off-scale rows contribute zero to these
 *     counts because they are treated as separate rows entirely.
 *
 * Pure module. No DOM. No side effects. Testable at unit level against the committed cell
 * files: given each preset's real medians, the invariants can be checked from the numbers
 * without loading a chart.
 */

/**
 * The shared minute ladder for strip-chart axis snapping. Denser than
 * axis-scale.js:NICE_MINUTE_STEPS (used by niceCeiling) between 20 and 30, so the initial
 * cap can land inside the airline cluster's natural bracket rather than snapping past to
 * the next coarser rung (28 -> 30 leaves 11% of the frame empty and drops the airline span
 * below 25% on b738-two-class). Round-10 recommended adding 26, 27, 29; we also filled in
 * 11, 13, 14, 16, 17, 19, 21, 23, 24, 32 so the floor rule has the same fine-grained access.
 */
export const STRIPS_NICE_MINUTE_LADDER = Object.freeze([
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  30, 32, 35, 40, 45, 50, 55, 60, 75, 90, 120,
]);

/**
 * Presets treated as narrowbody for the 25% airline-span step-down. Includes the regional
 * jets (crj700, e175, b717) because their axis needs the same tightening: a wide plot band
 * with a narrow airline cluster reads as "airlines all tie" when the cabin actually spreads
 * a minute across the group.
 */
const NARROWBODY_STRIPS_PRESETS = new Set([
  'a320', 'b738-hd', 'b738-two-class', 'a321neo', 'a321neo-three-class',
  'b737max8-lcc', 'b717', 'crj700', 'e175',
]);

export function isNarrowbodyStripsPreset(preset) {
  return typeof preset === 'string' && NARROWBODY_STRIPS_PRESETS.has(preset);
}

const OFF_SCALE_MARGIN_FRACTION = 0.02;
const NARROWBODY_MIN_AIRLINE_SPAN_FRACTION = 0.25;
const MIN_MEDIAN_TO_FLOOR_MARGIN_SECONDS = 30;
// Round-14 (lead follow-up): a compare view with more than three broken-bar rows in the
// right gutter reads as "half the chart is off scale". Cap the population by raising the
// cap one rung at a time past the step-down finish, until at most three rows are off scale
// or the ladder runs out.
const MAX_OFF_SCALE_ROWS = 3;

/**
 * Compute the shared axis for a compare view. Pure function.
 *
 * `rows` is the full list from BOTH panels (textbook + airline) or from a single unsplit
 * panel, each entry `{ id, family?, values?, median?, p10?, p90? }`:
 *   - `values` (seed totalSeconds array) is the primary form used by the app and the tests.
 *     When present, the function computes each row's median / p10 / p90 from `values` so
 *     the drawn median matches the on-scale check exactly.
 *   - When only `median` is present (no values), the row still contributes to the floor,
 *     cap, off-scale set, and airline span; dot counts are left at zero for that row.
 *
 * `opts.preset` is the preset id (e.g., 'a320'). Narrowbody presets trigger the step-down;
 * missing or non-narrowbody preset skips it.
 */
export function computeStripsAxisPolicy(rows, opts = {}) {
  const preset = opts && typeof opts.preset === 'string' ? opts.preset : null;
  const summarised = summariseRows(rows);
  const medians = summarised.map((r) => r.median).filter(Number.isFinite);
  if (medians.length === 0) return emptyPolicy(preset);

  const floorSeconds = pickFloor(medians);
  const initialCap = pickInitialCap(medians);

  const airlineMedians = summarised
    .filter((r) => r.family === 'airline')
    .map((r) => r.median)
    .filter(Number.isFinite);

  // Step-down: only on narrowbody presets, and only if the initial cap leaves the airline
  // span short of the 25% threshold. Never below the third-largest median across both
  // panels: crossing that boundary would push a THIRD row off-scale, which is the point
  // this rule is meant to keep bounded.
  let capSeconds = initialCap;
  let capStepInfo = {
    initialSeconds: initialCap,
    finalSeconds: initialCap,
    stepped: false,
    stopReason: isNarrowbodyStripsPreset(preset) ? 'reachedSpan' : 'notNarrowbody',
    thirdLargestMedianSeconds: null,
  };
  if (isNarrowbodyStripsPreset(preset) && airlineMedians.length >= 2) {
    const sortedMediansDesc = [...medians].sort((a, b) => b - a);
    const thirdLargest = sortedMediansDesc[Math.min(2, sortedMediansDesc.length - 1)];
    const stepResult = stepDownCap({
      startCap: initialCap,
      floor: floorSeconds,
      airlineMedians,
      thirdLargest,
    });
    capSeconds = stepResult.finalCap;
    capStepInfo = {
      initialSeconds: initialCap,
      finalSeconds: capSeconds,
      stepped: capSeconds < initialCap - 1e-9,
      stopReason: stepResult.stopReason,
      thirdLargestMedianSeconds: thirdLargest,
    };
  }

  // Lead follow-up: cap the off-scale population at MAX_OFF_SCALE_ROWS AND keep any on-scale
  // median clear of the top-of-axis legibility bracket. If the current cap either pushes
  // more than three rows above the cap, OR leaves an on-scale median within 2% of the cap
  // (round-16 R12-m2: a row at cap - 1.3 s reads as "at the axis edge" and used to be
  // mislabelled off scale), walk the ladder UP one rung at a time until both conditions
  // hold or the ladder ends.
  {
    const raiseResult = raiseCapForOffScaleAndLegibility({
      startCap: capSeconds,
      floor: floorSeconds,
      medians,
    });
    if (raiseResult.finalCap > capSeconds + 1e-9) {
      capSeconds = raiseResult.finalCap;
      capStepInfo = {
        ...capStepInfo,
        finalSeconds: capSeconds,
        raisedForOffScaleCap: true,
        raisedStopReason: raiseResult.stopReason,
      };
    } else {
      capStepInfo = {
        ...capStepInfo,
        raisedForOffScaleCap: false,
        raisedStopReason: raiseResult.stopReason,
      };
    }
  }

  const plotBand = Math.max(1, capSeconds - floorSeconds);
  // Round-16 R12-m2: off-scale is now STRICTLY above the cap. Medians close to the cap
  // are handled by raising the cap in raiseCapForOffScaleAndLegibility above, so nothing
  // inside the axis window is ever labelled "off scale".
  const rowsOffScale = new Set();
  for (const r of summarised) {
    if (r.median > capSeconds + 1e-9) rowsOffScale.add(r.id);
  }

  // Dot counts feed the "N below" / "N off scale" edge marks. Off-scale rows are handled
  // as their own broken-bar rows, so their dots are not counted here.
  const belowFloorDotCounts = new Map();
  const aboveCapDotCounts = new Map();
  for (const r of summarised) {
    if (rowsOffScale.has(r.id)) continue;
    let below = 0;
    let above = 0;
    const values = Array.isArray(r.values) ? r.values : [];
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < floorSeconds) below += 1;
      else if (v > capSeconds) above += 1;
    }
    belowFloorDotCounts.set(r.id, below);
    aboveCapDotCounts.set(r.id, above);
  }

  // Round-16 R12-m2: on-scale is now median <= cap (strict off-scale > cap); the raise
  // pass above already guarantees no on-scale median sits in the top-of-axis legibility
  // bracket, so this matches the rowsOffScale set the renderer draws.
  const onScaleAirlineMedians = airlineMedians.filter((m) => m <= capSeconds + 1e-9);
  let airlineSpanFraction = 0;
  if (onScaleAirlineMedians.length >= 2) {
    const lo = Math.min(...onScaleAirlineMedians);
    const hi = Math.max(...onScaleAirlineMedians);
    airlineSpanFraction = (hi - lo) / plotBand;
  }

  return {
    floorSeconds,
    capSeconds,
    rowsOffScale,
    belowFloorDotCounts,
    aboveCapDotCounts,
    airlineSpanFraction,
    plotBandSeconds: plotBand,
    capStepInfo,
    preset,
  };
}

function summariseRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const id = r.id;
    if (id == null) continue;
    const family = r.family === 'airline' ? 'airline' : 'textbook';
    const finiteValues = Array.isArray(r.values) ? r.values.filter(Number.isFinite) : [];
    if (finiteValues.length > 0) {
      const sorted = [...finiteValues].sort((a, b) => a - b);
      out.push({
        id, label: r.label, family,
        median: quantile(sorted, 0.5),
        p10: quantile(sorted, 0.1),
        p90: quantile(sorted, 0.9),
        values: r.values,
      });
    } else if (Number.isFinite(r.median)) {
      out.push({
        id, label: r.label, family,
        median: r.median,
        p10: Number.isFinite(r.p10) ? r.p10 : r.median,
        p90: Number.isFinite(r.p90) ? r.p90 : r.median,
        values: [],
      });
    }
  }
  return out;
}

function emptyPolicy(preset) {
  return {
    floorSeconds: 0,
    capSeconds: 60,
    rowsOffScale: new Set(),
    belowFloorDotCounts: new Map(),
    aboveCapDotCounts: new Map(),
    airlineSpanFraction: 0,
    plotBandSeconds: 60,
    capStepInfo: {
      initialSeconds: 60, finalSeconds: 60, stepped: false,
      stopReason: 'empty', thirdLargestMedianSeconds: null,
    },
    preset: preset || null,
  };
}

function pickFloor(medians) {
  const minMedian = Math.min(...medians);
  const bound = minMedian - MIN_MEDIAN_TO_FLOOR_MARGIN_SECONDS;
  if (bound <= 0) return 0;
  const boundMinutes = bound / 60;
  let best = 0;
  for (const step of STRIPS_NICE_MINUTE_LADDER) {
    if (step <= boundMinutes + 1e-9) best = step;
    else break;
  }
  return best * 60;
}

function pickInitialCap(medians) {
  const sortedAsc = [...medians].sort((a, b) => a - b);
  const p90 = quantile(sortedAsc, 0.9);
  const p90Minutes = p90 / 60;
  for (const step of STRIPS_NICE_MINUTE_LADDER) {
    if (step >= p90Minutes - 1e-9) return step * 60;
  }
  return Math.ceil(p90Minutes / 60) * 3600;
}

function stepDownCap({ startCap, floor, airlineMedians, thirdLargest }) {
  const startSpan = airlineSpanAt(airlineMedians, startCap, floor);
  if (startSpan >= NARROWBODY_MIN_AIRLINE_SPAN_FRACTION) {
    return { finalCap: startCap, stopReason: 'reachedSpan' };
  }
  const startMinutes = startCap / 60;
  const thirdMinutes = thirdLargest / 60;
  const candidateRungs = STRIPS_NICE_MINUTE_LADDER
    .filter((step) => step < startMinutes - 1e-9 && step >= thirdMinutes - 1e-9)
    .sort((a, b) => b - a);
  let lastTried = startCap;
  for (const rung of candidateRungs) {
    const candidateCap = rung * 60;
    lastTried = candidateCap;
    const span = airlineSpanAt(airlineMedians, candidateCap, floor);
    if (span >= NARROWBODY_MIN_AIRLINE_SPAN_FRACTION) {
      return { finalCap: candidateCap, stopReason: 'reachedSpan' };
    }
  }
  return { finalCap: lastTried, stopReason: 'rungLimit' };
}

// Round-16 R12-m2: two conditions can force a cap raise. Off-scale is now STRICTLY above
// cap; a median in the top-of-axis legibility bracket (within 2% of cap while at or below
// cap) is separate: raising past it keeps the row on scale rather than mislabelling it.
function countStrictlyAboveCap(medians, cap) {
  let n = 0;
  for (const m of medians) if (m > cap + 1e-9) n += 1;
  return n;
}

function anyMedianWithinLegibilityBracket(medians, cap, floor) {
  const plotBand = Math.max(1, cap - floor);
  const lower = cap - plotBand * OFF_SCALE_MARGIN_FRACTION;
  for (const m of medians) {
    if (m <= cap + 1e-9 && m >= lower - 1e-9) return true;
  }
  return false;
}

function raiseCapForOffScaleAndLegibility({ startCap, floor, medians }) {
  const shouldRaise = (cap) => (
    countStrictlyAboveCap(medians, cap) > MAX_OFF_SCALE_ROWS
    || anyMedianWithinLegibilityBracket(medians, cap, floor)
  );
  if (!shouldRaise(startCap)) return { finalCap: startCap, stopReason: 'withinCap' };
  const startMinutes = startCap / 60;
  const higherRungs = STRIPS_NICE_MINUTE_LADDER
    .filter((step) => step > startMinutes + 1e-9)
    .sort((a, b) => a - b);
  let candidate = startCap;
  for (const rung of higherRungs) {
    candidate = rung * 60;
    if (!shouldRaise(candidate)) return { finalCap: candidate, stopReason: 'withinCap' };
  }
  return { finalCap: candidate, stopReason: 'ladderEnd' };
}

function airlineSpanAt(airlineMedians, cap, floor) {
  const plotBand = Math.max(1, cap - floor);
  // Round-16 R12-m2: on-scale is now median <= cap. During step-down we still exclude the
  // legibility bracket, so a candidate cap that would leave an airline median at the axis
  // edge does not count as satisfying the span target; the raise pass above will lift the
  // cap past it if it does anyway.
  const legibilityLower = cap - plotBand * OFF_SCALE_MARGIN_FRACTION;
  const onScale = airlineMedians.filter((m) => m < legibilityLower);
  if (onScale.length < 2) return 0;
  return (Math.max(...onScale) - Math.min(...onScale)) / plotBand;
}

function quantile(sortedValues, q) {
  const n = sortedValues.length;
  if (n === 0) return 0;
  if (n === 1) return sortedValues[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  const frac = pos - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}
