/**
 * Shared axis-scale helpers used by every minutes-in-seconds chart on the page.
 *
 * One `niceCeiling(seconds)` and one `niceMinuteStep(minuteRange, targetTicks)` so the three
 * charts never disagree on what a "nice minute" is. Round-08 caught three copies drifting;
 * this module is now the single source. The step ladder is the fine ladder N6-m9 landed for
 * the sensitivity panels: coarse steps used to round a 22-minute panel up to 30 min and leave
 * a third of the frame empty.
 *
 * Public API:
 *   niceCeiling(seconds)                       -> seconds, rounded UP to the next nice value
 *   niceMinuteStep(minuteRange, targetTicks?)  -> a nice tick step (minutes)
 *
 * `niceMinuteStep(range, 7)` aims for ~7 ticks over the visible range so a 30-minute band
 * draws four or five labelled ticks (a 5m or 10m step) instead of two. Callers that want a
 * different density pass their own targetTicks.
 */

const NICE_MINUTE_STEPS = Object.freeze([
  1, 2, 3, 5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 60, 75, 90, 120,
]);

const NICE_TICK_CANDIDATES = Object.freeze([
  0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 30,
]);

/**
 * Round a duration (in seconds) UP to the next nice minute value. Adds a 2% breathing pad
 * before snapping so a data point exactly on a ladder value still earns headroom. When the
 * requested duration exceeds the ladder's top step, snap to the next whole hour.
 */
export function niceCeiling(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  const paddedSeconds = seconds * 1.02;
  const minutes = paddedSeconds / 60;
  for (let i = 0; i < NICE_MINUTE_STEPS.length; i += 1) {
    if (minutes <= NICE_MINUTE_STEPS[i]) return NICE_MINUTE_STEPS[i] * 60;
  }
  return Math.ceil(minutes / 60) * 3600;
}

/**
 * Pick a tick step (in minutes) that yields roughly `targetTicks` ticks across a range of
 * `minuteRange` minutes. Ladder is a fixed set of friendly steps so a range of 33 minutes
 * with target 7 lands on 5 (yielding six or seven ticks) instead of 4.71.
 */
export function niceMinuteStep(minuteRange, targetTicks = 7) {
  if (!Number.isFinite(minuteRange) || minuteRange <= 0) return 1;
  const target = Number.isFinite(targetTicks) && targetTicks > 0 ? targetTicks : 7;
  const raw = minuteRange / target;
  for (let i = 0; i < NICE_TICK_CANDIDATES.length; i += 1) {
    if (NICE_TICK_CANDIDATES[i] >= raw) return NICE_TICK_CANDIDATES[i];
  }
  return Math.ceil(raw / 30) * 30;
}
