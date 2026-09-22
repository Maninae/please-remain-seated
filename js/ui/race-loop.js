/**
 * Lockstep stepping for the two race sims.
 *
 * Owns the requestAnimationFrame loop, converts wall-clock deltas into simulation steps at the
 * chosen speed (with a fractional carry so 1x is exactly real time), caps steps per frame so a
 * slow tab does not freeze the page, and reports back per frame.
 *
 * The loop knows nothing about DOM. It calls the two callbacks the caller provides:
 *   onStep({ laneSims, laneJustFinished })  after each frame's step block, before drawing.
 *   onDraw()                                 once per frame, always.
 * When both sims are done the loop suspends itself; call `start()` again to resume.
 */

import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../engine/config.js';

const MAX_STEPS_PER_FRAME = 200;
const FRAME_SECONDS_CLAMP = 0.1;

export function createRaceLoop({ laneSims, speed = 15, onStep, onDraw }) {
  let running = false;
  let carrySeconds = 0;
  let lastFrameMs = null;
  let rafHandle = null;
  let currentSpeed = speed;
  const finishLatched = [false, false];

  function start() {
    if (running) return;
    if (bothFinished()) return;
    running = true;
    lastFrameMs = null;
    carrySeconds = 0;
    rafHandle = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  function setSpeed(next) { currentSpeed = Math.max(1, Math.min(60, Number(next) || 1)); }

  function reset(nextLaneSims) {
    pause();
    for (let i = 0; i < nextLaneSims.length; i += 1) {
      laneSims[i] = nextLaneSims[i];
      finishLatched[i] = false;
    }
    carrySeconds = 0;
  }

  function frame(now) {
    if (!running) return;
    if (lastFrameMs === null) lastFrameMs = now;
    const dtMs = now - lastFrameMs;
    lastFrameMs = now;
    const frameSeconds = Math.min(FRAME_SECONDS_CLAMP, dtMs / 1000);
    const simSeconds = currentSpeed * frameSeconds + carrySeconds;
    let steps = Math.floor(simSeconds / SIM_DT_SECONDS);
    if (steps < 0) steps = 0;
    if (steps > MAX_STEPS_PER_FRAME) steps = MAX_STEPS_PER_FRAME;
    carrySeconds = simSeconds - steps * SIM_DT_SECONDS;

    const laneJustFinished = [false, false];
    for (let step = 0; step < steps; step += 1) {
      for (let laneIndex = 0; laneIndex < laneSims.length; laneIndex += 1) {
        const sim = laneSims[laneIndex];
        if (!sim || finishLatched[laneIndex]) continue;
        if (!sim.state.done) sim.step(SIM_DT_SECONDS);
        if (sim.state.done || sim.state.t >= MAX_SIM_SECONDS) {
          finishLatched[laneIndex] = true;
          laneJustFinished[laneIndex] = true;
        }
      }
      if (bothFinished()) break;
    }

    if (onStep) onStep({ laneSims: laneSims.slice(), laneJustFinished });
    if (onDraw) onDraw();

    if (bothFinished()) {
      running = false;
      rafHandle = null;
      return;
    }
    rafHandle = requestAnimationFrame(frame);
  }

  function bothFinished() { return finishLatched[0] && finishLatched[1]; }

  return {
    start, pause, setSpeed, reset,
    isRunning: () => running,
    finished: (index) => finishLatched[index],
    bothFinished,
  };
}
