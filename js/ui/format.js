/**
 * Small formatters shared by race.js, controls.js, compare.js.
 */

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

export function formatSplitTitle(passenger) {
  const bagText = passenger.bagCount === 1 ? '1 bag' : `${passenger.bagCount} bags`;
  return `passenger #${passenger.id + 1} · row ${passenger.row} · ${bagText}`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

export function findingSentenceFor(mode, results, racingIds) {
  // Compose the one-line finding used as the strips title. Passes through the ordered results
  // (sorted by median ascending) and the two racing ids so the sentence talks about them by name.
  if (!results || results.length === 0) return '';
  const byId = new Map(results.map((row) => [row.strategyId, row]));
  const [firstId, secondId] = racingIds;
  const a = byId.get(firstId);
  const b = byId.get(secondId);
  if (!a || !b) return '';
  const deltaSec = Math.abs(a.median - b.median);
  const deltaText = formatClock(deltaSec);
  const modeVerb = mode === 'deplane' ? 'deplaning' : 'boarding';
  if (deltaSec < 15) {
    return `${a.label} and ${b.label} finish within seconds of each other; the aisle rule is what matters, not the picking order.`;
  }
  const faster = a.median < b.median ? a : b;
  const slower = a.median < b.median ? b : a;
  return `${faster.label} saves ${deltaText} over ${slower.label} for ${modeVerb} at these settings.`;
}
