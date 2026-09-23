/**
 * Rankings data layer: fetch the index, resolve a cell for a (mode, preset, knob-vector)
 * request, snap knob values to the precomputed grid, and expose the nearest-run notes for the UI.
 *
 * The index file lives under `data/rankings/`:
 *   - Prefer `index.json` (the real headline / sensitivity build).
 *   - Fall back to `index-preview.json` (the 200-seed preview) when the real one is absent.
 *
 * A cell filename follows design/07:
 *   <mode>__<preset>__load=<n>__comply=<n>__groups=<n>__bags=<name>__bins=<name>__n=<seeds>.json
 * The client mirrors the same canonicalization the precompute tool uses so the id built from a
 * knob snap matches the id printed on disk.
 *
 * Boiled down: the UI gives us a snapshot of the store, we give it back a cell file plus a
 * "nearest run" note per knob so the user sees where their setting was rounded.
 */

const RANKINGS_DIR = 'data/rankings';

/** Sequential attempts. `preview` first only when the URL forces preview, else real first. */
const INDEX_CANDIDATES = Object.freeze([
  { name: 'index.json', preview: false },
  { name: 'index-preview.json', preview: true },
]);

// Module-level cache of the in-flight index-load promise. Both the main.js kickIndexLoad
// and the rankings tab's own lazy-mount call loadRankingsIndex(); without a shared cache
// each visit hit the network twice, producing the two 404s per visit N4-m9 flagged.
let indexPromise = null;

/**
 * Fetch the ranking index. Resolves with { indexUrl, indexObject } on success, or null if
 * no index file exists. Caches the in-flight promise so concurrent callers share one HTTP
 * round-trip (there is only one index; the same result is safe to hand back to everyone).
 * The `previewOnly` flag is set by the caller if they want to force the preview index
 * (used only for local debugging).
 */
export async function loadRankingsIndex({ previewOnly = false } = {}) {
  if (!previewOnly && indexPromise) return indexPromise;
  const attempts = previewOnly
    ? INDEX_CANDIDATES.filter((c) => c.preview)
    : INDEX_CANDIDATES;
  const promise = (async () => {
    for (const candidate of attempts) {
      const url = `${RANKINGS_DIR}/${candidate.name}`;
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const json = await response.json();
        if (json && Array.isArray(json.cells) && json.cells.length > 0) {
          return { indexUrl: url, indexObject: json, preview: candidate.preview };
        }
      } catch (error) {
        // Network error, JSON parse error: fall through to the next candidate.
      }
    }
    return null;
  })();
  if (!previewOnly) indexPromise = promise;
  return promise;
}

/**
 * Snap a raw knob vector (from the store) to the grid values the precompute plan uses. The
 * result includes both the snapped knob object (matching the index defaults) and the per-knob
 * gap so the UI can print "nearest run: 85%" under each control.
 *
 * The index's `grid` block enumerates:
 *   grid.load       [0.70, 0.85, 1.00]
 *   grid.compliance [0.50, 0.85, 1.00]
 *   grid.groups     [0, 0.25, 0.50]
 *   grid.bags       ['default', 'light', 'heavy']
 *   grid.bins       ['roomy', 'legacy']
 * Every numeric knob snaps to the nearest listed value. Bins snaps by the enum: 'space' from
 * the store maps to 'roomy' (the roomy default), 'legacy' passes through.
 */
export function snapKnobsToGrid(raw, grid, defaults) {
  const snapped = {
    load: snapNumeric(raw.loadFactor, grid.load, defaults.load),
    compliance: snapNumeric(raw.compliance, grid.compliance, defaults.compliance),
    groups: snapNumeric(raw.families, grid.groups, defaults.groups),
    bags: snapBagMix(raw.bagP0, raw.bagP1, raw.bagP2, grid.bags, defaults.bags),
    bins: snapBins(raw.bins, grid.bins, defaults.bins),
  };
  const nearest = {
    load: formatPercentGap(raw.loadFactor, snapped.load),
    compliance: formatPercentGap(raw.compliance, snapped.compliance),
    groups: formatPercentGap(raw.families, snapped.groups),
    bags: `nearest run: ${bagMixLabel(snapped.bags)}`,
    bins: `nearest run: ${binsLabel(snapped.bins)}`,
  };
  return { snapped, nearest };
}

function snapNumeric(value, choices, fallback) {
  if (!Array.isArray(choices) || choices.length === 0) return fallback;
  const number = Number.isFinite(value) ? value : fallback;
  let best = choices[0];
  let bestGap = Math.abs(number - best);
  for (const candidate of choices) {
    const gap = Math.abs(number - candidate);
    if (gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

function snapBagMix(p0, p1, p2, choices, fallback) {
  const options = Array.isArray(choices) && choices.length > 0 ? choices : ['default'];
  // The precompute plan uses three named mixes:
  //   default: [0.20, 0.60, 0.20], light: [0.40, 0.50, 0.10], heavy: [0.10, 0.50, 0.40]
  // Score each option by its L1 distance to the store's current mix and pick the closest.
  const mixes = {
    default: [0.20, 0.60, 0.20],
    light: [0.40, 0.50, 0.10],
    heavy: [0.10, 0.50, 0.40],
  };
  let best = fallback;
  let bestDist = Infinity;
  for (const option of options) {
    const mix = mixes[option];
    if (!mix) continue;
    const dist = Math.abs(p0 - mix[0]) + Math.abs(p1 - mix[1]) + Math.abs(p2 - mix[2]);
    if (dist < bestDist) {
      best = option;
      bestDist = dist;
    }
  }
  return best;
}

function snapBins(binsValue, choices, fallback) {
  // Store uses `space` (roomy new-style) and `legacy` (old-style). The precompute plan uses
  // `roomy` and `legacy`. Translate here.
  const options = new Set(Array.isArray(choices) ? choices : ['roomy']);
  if (binsValue === 'legacy' && options.has('legacy')) return 'legacy';
  return options.has('roomy') ? 'roomy' : fallback;
}

function formatPercentGap(raw, snapped) {
  if (!Number.isFinite(raw) || !Number.isFinite(snapped)) return '';
  return `nearest run: ${Math.round(snapped * 100)}%`;
}

function bagMixLabel(name) {
  if (name === 'light') return 'light bags';
  if (name === 'heavy') return 'heavy bags';
  return 'typical bags';
}

function binsLabel(name) {
  return name === 'legacy' ? 'old-style bins' : 'roomy bins';
}

/**
 * Find the cell in the index whose (mode, preset, knobs) match a snapped request exactly. If
 * a headline cell for this (mode, preset) exists but the exact knobs do not match, prefer the
 * headline cell over nothing: the rankings tab still shows the preset's rankings at the
 * default knobs, and the UI notes which knobs did not snap onto a real cell.
 */
export function selectCellForRequest(indexObject, { mode, preset, knobs }) {
  if (!indexObject || !Array.isArray(indexObject.cells)) return null;
  const modePresetCells = indexObject.cells.filter((cell) => cell.mode === mode && cell.preset === preset);
  if (modePresetCells.length === 0) return null;

  const exact = modePresetCells.find((cell) => knobsEqual(cell.knobs, knobs));
  if (exact) return { cell: exact, exactMatch: true };

  // Sensitivity cells hold one off-default knob; if the request differs by exactly one knob and
  // that knob matches a sensitivity cell, use it. Otherwise fall back to the headline cell
  // (all knobs at defaults) so the ranked chart still has something to show.
  const defaults = indexObject.defaults;
  const knobDiff = diffKnobs(knobs, defaults);
  if (knobDiff.length === 1) {
    const [knob] = knobDiff;
    const match = modePresetCells.find((cell) => {
      if (cell.kind !== 'sensitivity') return false;
      const cellDiff = diffKnobs(cell.knobs, defaults);
      return cellDiff.length === 1 && cellDiff[0] === knob && cell.knobs[knob] === knobs[knob];
    });
    if (match) return { cell: match, exactMatch: true };
  }

  const headline = modePresetCells.find((cell) => cell.kind === 'headline');
  return headline ? { cell: headline, exactMatch: false } : null;
}

/** Every sensitivity cell for a given (mode, preset). Used by the sensitivity slope charts. */
export function sensitivityCellsFor(indexObject, mode, preset) {
  if (!indexObject || !Array.isArray(indexObject.cells)) return [];
  return indexObject.cells.filter(
    (cell) => cell.mode === mode && cell.preset === preset && cell.kind === 'sensitivity',
  );
}

/** True when the index carries sensitivity cells for (mode, preset). */
export function hasSensitivity(indexObject, mode, preset) {
  return sensitivityCellsFor(indexObject, mode, preset).length > 0;
}

/** Fetch one cell's JSON file by filename (relative to data/rankings/). */
export async function loadCellFile(filename) {
  const url = `${RANKINGS_DIR}/${filename}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cell fetch failed: ${response.status} ${filename}`);
  return response.json();
}

// Cache for the preview index, used as a fallback source when the real index's cell files are
// still being written. Shared across calls so we hit the network at most once.
let previewIndexPromise = null;

async function loadPreviewIndex() {
  if (previewIndexPromise !== null) return previewIndexPromise;
  previewIndexPromise = (async () => {
    try {
      const response = await fetch(`${RANKINGS_DIR}/index-preview.json`, { cache: 'no-store' });
      if (!response.ok) return null;
      const json = await response.json();
      return (json && Array.isArray(json.cells)) ? json : null;
    } catch { return null; }
  })();
  return previewIndexPromise;
}

async function tryFetchCell(filename) {
  try {
    const response = await fetch(`${RANKINGS_DIR}/${filename}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

function findExactCell(indexObject, mode, preset, knobs) {
  if (!indexObject || !Array.isArray(indexObject.cells)) return null;
  return indexObject.cells.find(
    (cell) => cell.mode === mode && cell.preset === preset && knobsEqual(cell.knobs, knobs),
  ) || null;
}

function findHeadlineCell(indexObject, mode, preset) {
  if (!indexObject || !Array.isArray(indexObject.cells)) return null;
  return indexObject.cells.find(
    (cell) => cell.mode === mode && cell.preset === preset && cell.kind === 'headline',
  ) || null;
}

/**
 * Load a cell file, gracefully falling back when the primary file is missing (a partial
 * precompute run has not written it yet) or malformed.
 *
 * Fallback order:
 *   1. `primary.file` from the loaded index.
 *   2. The same (mode, preset, knobs) cell in `index-preview.json` if the preview build has it
 *      at a different filename.
 *   3. The headline cell for (mode, preset) in the loaded index.
 * If every attempt fails, resolves to null so the caller can show the empty state.
 *
 * A single console.info line is written when a fallback path is taken or when everything
 * fails; no console.error and no uncaught rejection ever escape this function.
 */
export async function loadCellWithFallback({ indexObject, mode, preset, knobs, primary }) {
  const tried = [];
  const seen = new Set([primary.file]);
  const attempts = [{ meta: primary, label: 'primary' }];

  // Preview equivalent of the primary: same (mode, preset, primary.knobs) in the preview
  // index, written at PREVIEW_SEEDS so its filename is a distinct file. This covers the
  // common case where a partial full-precompute run has not yet reached a cell that the
  // preview build already wrote.
  const previewIndex = await loadPreviewIndex();
  if (previewIndex) {
    const previewSamePrimary = findExactCell(previewIndex, mode, preset, primary.knobs);
    if (previewSamePrimary && !seen.has(previewSamePrimary.file)) {
      attempts.push({ meta: previewSamePrimary, label: 'preview' });
      seen.add(previewSamePrimary.file);
    }
    // If the primary was itself a sensitivity cell and the preview only has the headline for
    // this preset, still take the headline as a same-preset near neighbour.
    const previewHeadline = findHeadlineCell(previewIndex, mode, preset);
    if (previewHeadline && !seen.has(previewHeadline.file)) {
      attempts.push({ meta: previewHeadline, label: 'preview-headline' });
      seen.add(previewHeadline.file);
    }
  }

  const headline = findHeadlineCell(indexObject, mode, preset);
  if (headline && !seen.has(headline.file)) {
    attempts.push({ meta: headline, label: 'headline' });
    seen.add(headline.file);
  }
  void knobs;

  for (let i = 0; i < attempts.length; i += 1) {
    const { meta, label } = attempts[i];
    const cellData = await tryFetchCell(meta.file);
    tried.push(meta.file);
    if (cellData) {
      if (i > 0) {
        // Single info line so a partial run does not spam the console.
        // eslint-disable-next-line no-console
        console.info(
          `Rankings: primary cell ${primary.file} unavailable; using ${label} fallback ${meta.file}`,
        );
      }
      return { cellData, cellMeta: meta, wasFallback: i > 0 };
    }
  }
  // eslint-disable-next-line no-console
  console.info(`Rankings: no cell available for ${mode}/${preset}; tried ${tried.join(', ')}`);
  return null;
}

function knobsEqual(a, b) {
  if (!a || !b) return false;
  for (const key of ['load', 'compliance', 'groups', 'bags', 'bins']) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function diffKnobs(a, b) {
  const differs = [];
  for (const key of ['load', 'compliance', 'groups', 'bags', 'bins']) {
    if (a[key] !== b[key]) differs.push(key);
  }
  return differs;
}
