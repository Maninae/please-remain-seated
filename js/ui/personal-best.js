/**
 * Personal-best per (mode, preset, matchup, key knobs). Stored per browser in localStorage,
 * survives across sessions, ignores storage failures.
 *
 * What "best" means (NEW-m1 in round-02 critic): it is the biggest MARGIN a player has produced
 * with a specific winning strategy against a specific opposing strategy under one setup. That is
 * a number a player can actually earn: a bigger win with Two doors is a bigger PB, and the seed
 * is the free variable, not part of the key. The pre-round-02 "fastest time we ever rolled"
 * PB was a lottery. Keying by winner+loser also stops two different strategies from stomping on
 * each other's records.
 *
 * Keyed by a compact hash of the settings that materially change the race: mode, preset, the
 * ordered pair (winnerStrategy, loserStrategy), bins, load / compliance / families bucketed to
 * 5% so a millimetre-tuned slider does not fork the PB.
 *
 * Public API:
 *   const pb = createPersonalBestStore()
 *   const record = pb.recordFinish(state, winnerLane, marginSeconds)   // { improved, best, previous }
 *   const current = pb.currentBest(state)                              // may be null
 */

const STORAGE_KEY = 'prs.personal-best.v2';

export function createPersonalBestStore() {
  const cache = readAll();

  function currentBest(state) {
    const key = keyFor(state, null, null);
    return cache[key] || null;
  }

  function recordFinish(state, winnerLane, marginSeconds) {
    const { winnerId, loserId } = matchupIds(state, winnerLane);
    const key = keyFor(state, winnerId, loserId);
    const previous = cache[key] || null;
    const isBetter = !previous || marginSeconds > previous.marginSeconds;
    if (isBetter) {
      const record = {
        marginSeconds,
        winnerStrategy: winnerId,
        loserStrategy: loserId,
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

function matchupIds(state, winnerLane) {
  if (state.mode === 'deplane') {
    return winnerLane === 0
      ? { winnerId: state.strategyA, loserId: state.strategyB }
      : { winnerId: state.strategyB, loserId: state.strategyA };
  }
  return winnerLane === 0
    ? { winnerId: state.boardStrategyA, loserId: state.boardStrategyB }
    : { winnerId: state.boardStrategyB, loserId: state.boardStrategyA };
}

function keyFor(state, winnerId, loserId) {
  const parts = [
    state.mode,
    state.presetId,
    winnerId || 'winner',
    loserId || 'loser',
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
