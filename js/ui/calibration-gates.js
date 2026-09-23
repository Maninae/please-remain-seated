/**
 * Calibration-gate constants that the About tab prints.
 *
 * These are the numeric bounds the deplaning calibration test asserts against, mirrored here
 * so the About tab renders exactly what the test gate holds the engine to. If the test's
 * numbers move, this file moves with them, and the e2e test that reads the About tab
 * cross-checks that the rendered text matches this constant.
 *
 * The values line up one-to-one with the assertions in tests/unit/calibration-deplane.test.js:
 *   - whole-run door throughput (pax/min) median, across six seed families
 *   - first-two-minute door throughput (pax/min) median
 *   - total minutes from door open, median (sanity range)
 *
 * See design/01-spec.md and js/engine/config.js for the source arithmetic.
 */

export const DEPLANE_CALIBRATION_GATES = Object.freeze({
  wholeRunPaxPerMin: Object.freeze({ min: 14, max: 27 }),
  firstTwoMinPaxPerMin: Object.freeze({ min: 15, max: 30 }),
  totalMinutes: Object.freeze({ min: 5, max: 13 }),
  seedFamilyCount: 6,
  seedsPerFamily: 40,
});

/**
 * A one-sentence render of the whole-run gate, used by the About page and cross-checked by an
 * e2e test that greps the About tab for this exact string. Kept as a function so any change to
 * the constants above produces the matching printed sentence with no drift.
 */
export function formatWholeRunGateSentence() {
  const g = DEPLANE_CALIBRATION_GATES.wholeRunPaxPerMin;
  const t = DEPLANE_CALIBRATION_GATES.totalMinutes;
  return `Whole-run door throughput medians stay in ${g.min} to ${g.max} pax/min, and total minutes from door open in ${t.min} to ${t.max}, on every one of ${DEPLANE_CALIBRATION_GATES.seedFamilyCount} independent seed families (${DEPLANE_CALIBRATION_GATES.seedsPerFamily} seeds each).`;
}

export function formatFirstTwoMinGateSentence() {
  const t = DEPLANE_CALIBRATION_GATES.firstTwoMinPaxPerMin;
  return `First-two-minute door throughput median stays in ${t.min} to ${t.max} pax/min.`;
}
