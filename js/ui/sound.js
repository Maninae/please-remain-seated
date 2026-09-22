/**
 * Seatbelt-chime ding via WebAudio. Off by default, opt-in via the checkbox in the control bar.
 * `unlock()` runs the first-time gesture the browser requires; `playChime()` plays a short two-tone.
 */

export function createSound() {
  let audioCtx = null;
  let unlocked = false;

  function ensureCtx() {
    if (typeof window === 'undefined') return null;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function unlock() {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (unlocked) return;
    // Resume on user gesture (autoplay policy). Called from the toggle click handler.
    if (typeof ctx.resume === 'function') ctx.resume();
    unlocked = true;
  }

  function playChime() {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (!unlocked) return;
    const now = ctx.currentTime;
    playTone(ctx, 660, now, 0.35);
    playTone(ctx, 880, now + 0.28, 0.35);
  }

  function playTone(ctx, frequency, when, duration) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.18, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  return { unlock, playChime };
}
