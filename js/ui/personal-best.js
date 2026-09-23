/**
 * Personal-best per (mode, preset, strategy pair, key knobs). Stored per browser in localStorage,
 * survives across sessions, ignores storage failures.
 *
 * Keyed by a compact hash of the settings that materially change the race, so switching the
 * plane, strategies, or bins gives you a fresh leaderboard. Compliance and families are
 * rounded to 5% buckets since a millimetre-tuned slider should not fork the PB.
 *
 * Public API:
 *   const pb = createPersonalBestStore()
 *   const record = pb.recordFinish(state, winnerLane, seconds)     // returns { improved, best, previous }
 *   const current = pb.currentBest(state)                          // may be null
 */

const STORAGE_KEY = 'prs.personal-best';

export function createPersonalBestStore() {
  const cache = readAll();

  function currentBest(state) {
    const key = keyFor(state);
    return cache[key] || null;
  }

  function recordFinish(state, winnerLane, seconds) {
    const key = keyFor(state);
    const previous = cache[key] || null;
    const isBetter = !previous || seconds < previous.seconds;
    if (isBetter) {
      const record = {
        seconds,
        strategy: winnerLaneStrategyLabel(state, winnerLane),
        seed: state.seed,
        atMs: Date.now(),
      };
      cache[key] = record;
      writeAll(cache);
      return { improved: true, best: record, previous };
    }
    return { improved: false, best: previous, previous };
  }

  return { currentBest, recordFinish };
}

function keyFor(state) {
  const strategies = state.mode === 'deplane'
    ? [state.strategyA, state.strategyB].sort()
    : [state.boardStrategyA, state.boardStrategyB].sort();
  const parts = [
    state.mode,
    state.presetId,
    strategies.join('|'),
    state.bins,
    bucket(state.loadFactor),
    bucket(state.compliance),
    bucket(state.families),
  ];
  return parts.join('::');
}

function bucket(value) {
  return Math.round(Number(value) * 20) / 20;
}

function winnerLaneStrategyLabel(state, winnerLane) {
  const which = winnerLane === 0 ? 'A' : 'B';
  return state.mode === 'deplane' ? state[`strategy${which}`] : state[`boardStrategy${which}`];
}

function readAll() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeAll(cache) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (error) {
    // Private tab or full quota; PBs are a bonus.
  }
}
