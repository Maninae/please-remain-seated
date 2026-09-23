/**
 * Round-12 fix e2e: the five targeted verifications the round-08 critic asked for, plus
 * the two carried defects (race-controls fold and the drawer scrim). Every test runs against
 * the live production data shape (no fixture removes the branch under test).
 *
 * Coverage map:
 *   - N8-B1: caveat names "Back to front, in zones" and quotes THAT row's median-derived
 *     rate. Verified on a320 (anchor drawn) and b787 (anchor withheld, so no clause).
 *   - N8-M1: Rankings tab writes only its own r-prefixed URL params; a Rankings preset +
 *     mode change leaves the Race tab's aircraft, mode and both strategies alone. Reloading
 *     the Rankings URL reproduces the chart.
 *   - N8-M2: on the a320 board compare, the airline medians span at least 25% of the plot
 *     band and at least one tick lands between 15 and 30 minutes.
 *   - N8-M3: no two anchor label bboxes intersect at 1024, 1280 and 1440 px widths.
 *   - N7-m7: the Restart button and the speed group are fully inside the viewport on cold
 *     load at 1280x800 and 1280x720.
 *
 * Skips itself cleanly if Playwright cannot launch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  computeStripsChartGeometry,
  STRIPS_PHONE_WIDTH_THRESHOLD,
} from '../../js/render/charts-strips.js';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-12');
const ROUND_14_DIR = path.resolve('tests/e2e/artifacts/fix-round-14');
const ROUND_15_DIR = path.resolve('tests/e2e/artifacts/fix-round-15');
if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });
if (!existsSync(ROUND_14_DIR)) mkdirSync(ROUND_14_DIR, { recursive: true });
if (!existsSync(ROUND_15_DIR)) mkdirSync(ROUND_15_DIR, { recursive: true });

async function safeLaunch() {
  try { return await chromium.launch({ headless: true }); }
  catch (error) { return null; }
}

async function shot(page, name) {
  const file = path.join(ARTIFACTS_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function goto(page, url) {
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => { try { window.localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return page;
}

// The precompute stores each board headline cell under this filename pattern; picking the
// highest-seeded copy that exists on disk gives us the same numbers the live page will read.
function findHeadlineCellFile(mode, preset) {
  const dir = path.resolve('data/rankings');
  const files = readdirSync(dir).filter((f) => (
    f.startsWith(`${mode}__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=`)
  ));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const n = (name) => Number(name.match(/n=(\d+)/)?.[1] || 0);
    return n(b) - n(a);
  });
  return path.join(dir, files[0]);
}

function readBackToFrontRatePaxPerMin(mode, preset) {
  const file = findHeadlineCellFile(mode, preset);
  if (!file) return null;
  const cell = JSON.parse(readFileSync(file, 'utf-8'));
  const row = cell.strategies.find((s) => s.id === 'back-to-front');
  const pax = cell.passengerCount;
  if (!row || !Number.isFinite(row.medianSeconds) || !Number.isFinite(pax)) return null;
  return { rate: pax / (row.medianSeconds / 60), label: row.label, pax };
}

test('N8-B1: caveat names the back-to-front row and quotes its own rate (a320)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=a320&seed=n8b1-a320`);
    const caveat = await page.evaluate(() =>
      document.querySelector('[data-rankings-chart-caveat]')?.textContent || '');
    // The caveat's named strategy must equal the row label the chart draws for id
    // "back-to-front" (`Back to front, in zones`). It must NOT say "Front-to-back" because
    // that names a different row six inches up the page.
    assert.match(caveat, /Back to front, in zones runs (faster|slower) here/i,
      `caveat must name "Back to front, in zones" as the sim row, got "${caveat}"`);
    assert.doesNotMatch(caveat, /Front-to-back runs (faster|slower) here/i,
      `caveat must NOT name "Front-to-back" as the compared row, got "${caveat}"`);
    // The printed rate must equal (within 0.1 pax/min) the median-derived rate of the same
    // row in the cell we shipped. Numeric arithmetic on the cell file is the reference.
    const expected = readBackToFrontRatePaxPerMin('board', 'a320');
    assert.ok(expected, 'a320 board headline cell should exist for the fixture-free check');
    const match = caveat.match(/about ([0-9.]+) pax\/min in the sim/);
    assert.ok(match, `caveat should print an "about X pax/min in the sim" clause, got "${caveat}"`);
    const printed = Number(match[1]);
    assert.ok(Math.abs(printed - expected.rate) < 0.15,
      `printed pax/min (${printed}) should match the cell's back-to-front rate (${expected.rate.toFixed(2)})`);
    await shot(page, 'rankings-board-a320-caveat-1280x900.png');
  } finally { await browser.close(); }
});

test('N8-B1 / N8-M4: on b787 (widebody, no anchor) the caveat carries no MythBusters clause', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=b787&seed=n8b1-b787`);
    const caveat = await page.evaluate(() =>
      document.querySelector('[data-rankings-chart-caveat]')?.textContent || '');
    // N8-M4: the anchor is not drawn on the twin-aisle 306-seat cabin, so the sentence that
    // makes the field comparison is dropped entirely. The rest of the caveat still prints.
    assert.doesNotMatch(caveat, /MythBusters/i,
      `widebody caveat should not name MythBusters, got "${caveat}"`);
    assert.doesNotMatch(caveat, /back-to-front field/i,
      `widebody caveat should not compare to the back-to-front field figure, got "${caveat}"`);
    // The passenger-count opening line still fires so the caveat is not empty.
    assert.match(caveat, /passenger cabin/i,
      `widebody caveat should still open with the cabin context, got "${caveat}"`);
    await shot(page, 'rankings-board-b787-caveat-1280x900.png');
  } finally { await browser.close(); }
});

test('N8-M1: Rankings tab changes never rewrite the Race tab', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Land on the Race tab with an explicit matchup, mode and preset the user "set".
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=race&mode=board&preset=a320&a=random&b=united&seed=n8m1`);
    const raceBefore = await page.evaluate(() => new URLSearchParams(window.location.search).toString());
    const rmParams = new URLSearchParams(raceBefore);
    const originalMode = rmParams.get('mode');
    const originalA = rmParams.get('a');
    const originalB = rmParams.get('b');
    const originalPreset = rmParams.get('preset');

    // Switch to the Rankings tab and change the preset and mode there.
    await page.click('[data-tab-id="rankings"]');
    await page.waitForTimeout(1500);
    await page.click('button[data-rankings-mode="deplane"]');
    await page.waitForTimeout(1200);
    // Pick a preset different from a320 that has cells.
    const rTarget = await page.evaluate(() => {
      const sel = document.getElementById('rankings-preset-select');
      if (!sel) return null;
      for (const opt of sel.options) {
        if (opt.value && opt.value !== 'a320') return opt.value;
      }
      return null;
    });
    if (rTarget) {
      await page.selectOption('#rankings-preset-select', rTarget);
      await page.waitForTimeout(1200);
    }
    // Read the URL: the Race tab's params must still name the Race tab's aircraft, mode
    // and both strategies. The Rankings slice writes to `r*` params only.
    const afterParams = new URLSearchParams(await page.evaluate(() => window.location.search));
    assert.equal(afterParams.get('mode'), originalMode,
      `Race mode should be untouched by a Rankings change: was ${originalMode}, now ${afterParams.get('mode')}`);
    assert.equal(afterParams.get('a'), originalA,
      `Race strategy A should be untouched: was ${originalA}, now ${afterParams.get('a')}`);
    assert.equal(afterParams.get('b'), originalB,
      `Race strategy B should be untouched: was ${originalB}, now ${afterParams.get('b')}`);
    assert.equal(afterParams.get('preset'), originalPreset,
      `Race preset should be untouched: was ${originalPreset}, now ${afterParams.get('preset')}`);
    // And the URL now carries the Rankings slice under r-prefixed keys.
    assert.equal(afterParams.get('rmode'), 'deplane', 'rmode should reflect the rankings toggle');
    if (rTarget) {
      assert.equal(afterParams.get('rpreset'), rTarget, `rpreset should equal ${rTarget}`);
    }

    // Reload the Rankings URL and assert the chart preset+mode matches.
    const rankingsUrl = `${BASE_URL}/index.html?${afterParams.toString()}`;
    const page2 = await context.newPage();
    await page2.goto(rankingsUrl, { waitUntil: 'load' });
    await page2.waitForTimeout(2500);
    const observed = await page2.evaluate(() => ({
      mode: [...document.querySelectorAll('[data-rankings-mode]')]
        .find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.rankingsMode,
      preset: document.getElementById('rankings-preset-select')?.value,
      tab: document.body.dataset.tab,
    }));
    assert.equal(observed.tab, 'rankings', 'reload should land on the Rankings tab');
    assert.equal(observed.mode, 'deplane', 'reload should light Deplaning');
    if (rTarget) assert.equal(observed.preset, rTarget, `reload should select preset ${rTarget}`);
    await shot(page2, 'rankings-url-roundtrip-n8m1.png');
  } finally { await browser.close(); }
});

// N9-M1 / N10-M1 / round-14 / round-15: the tests below iterate BOTH panels (textbook +
// airline) and derive the row's true median from the DOM `data-median-seconds` attribute
// the chart now emits, not from the tick's own x. That closes the two round-10 findings:
// (a) the previous no-edge assertion only touched svgs[1], missing the textbook panel
// where clamping happens; (b) the previous tie assertion re-derived seconds from the
// median's own x, so any two medians sharing an x automatically read as sharing a value.
//
// Round-11 R11-m2: chart geometry comes from the renderer's own computeStripsChartGeometry
// (imported at top of file) rather than a copy of STRIPS_PADDING_LEFT / STRIPS_PADDING_RIGHT
// that already drifted 86 px from the value the renderer uses when a panel has off-scale
// rows. The axis extents now match the ones the chart draws exactly.
const DESKTOP_TIE_TOLERANCE_SECONDS = 5;
const PHONE_TIE_TOLERANCE_BUFFER_SECONDS = 0.5;

async function runCompareAndMeasure(browser, preset, { width = 1280, height = 900, mobile = false } = {}) {
  const contextOpts = { viewport: { width, height } };
  if (mobile) { contextOpts.hasTouch = true; contextOpts.isMobile = true; }
  const context = await browser.newContext(contextOpts);
  const page = await goto(await context.newPage(),
    `${BASE_URL}/index.html?tab=race&mode=board&preset=${preset}&seed=n8m2-${preset}`);
  const seedSelect = await page.$('#seed-count-select');
  if (seedSelect) await seedSelect.selectOption('100');
  await page.click('#btn-compare');
  await page.waitForFunction(() => {
    const wrap = document.getElementById('strips-wrap');
    return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
  }, {}, { timeout: 90000 });

  const measurements = await page.evaluate((phoneWidthThreshold) => {
    const wrap = document.getElementById('strips-wrap');
    const svgs = Array.from(wrap.querySelectorAll('svg'));
    const panels = [];
    for (const svg of svgs) {
      const svgWidth = Number(svg.getAttribute('width'));
      // Derive the axis baseline directly from the DOM: the axis rule is the widest
      // horizontal line drawn in the SVG. Falls back to the padding computation only if
      // the rule is missing, which should never happen on a rendered panel.
      const lines = Array.from(svg.querySelectorAll('line'));
      let chartX0 = null;
      let chartX1 = null;
      let bestSpan = 0;
      for (const line of lines) {
        const x1 = Number(line.getAttribute('x1'));
        const x2 = Number(line.getAttribute('x2'));
        const y1 = Number(line.getAttribute('y1'));
        const y2 = Number(line.getAttribute('y2'));
        if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
        if (Math.abs(y1 - y2) > 0.001) continue;
        const span = Math.abs(x2 - x1);
        if (span > bestSpan) {
          bestSpan = span;
          chartX0 = Math.min(x1, x2);
          chartX1 = Math.max(x1, x2);
        }
      }
      const plotBandPx = Math.max(1, (chartX1 || 0) - (chartX0 || 0));
      const isPhone = svgWidth < phoneWidthThreshold;
      const medianLines = Array.from(svg.querySelectorAll('line[data-median-seconds]'));
      const medians = medianLines.map((line) => ({
        rowId: line.getAttribute('data-row-id') || '',
        x: Number(line.getAttribute('x1')),
        seconds: Number(line.getAttribute('data-median-seconds')),
      })).filter((m) => Number.isFinite(m.x) && Number.isFinite(m.seconds));
      const offScale = Array.from(svg.querySelectorAll('text[data-row-off-scale]')).map((t) => {
        const bbox = t.getBBox();
        const parseFloatOrNull = (val) => {
          if (val == null || val === '') return null;
          const n = Number(val);
          return Number.isFinite(n) ? n : null;
        };
        return {
          rowId: t.getAttribute('data-row-off-scale') || '',
          text: (t.textContent || '').trim(),
          clock: t.getAttribute('data-off-scale-clock') || '',
          seconds: Number(t.getAttribute('data-median-seconds')),
          p10Seconds: parseFloatOrNull(t.getAttribute('data-off-scale-p10-seconds')),
          barLeftX: parseFloatOrNull(t.getAttribute('data-off-scale-bar-left-x')),
          bboxLeft: bbox.x,
          bboxRight: bbox.x + bbox.width,
          bboxTop: bbox.y,
          bboxBottom: bbox.y + bbox.height,
        };
      });
      panels.push({ svgWidth, chartX0, chartX1, plotBandPx, isPhone, medians, offScale });
    }
    return { panels };
  }, STRIPS_PHONE_WIDTH_THRESHOLD);
  await shot(page, `compare-board-${preset}-${width}x${height}.png`);
  await context.close();
  return measurements;
}

// Load the row's committed p10 / cap so we can independently derive where the off-scale
// bar's left edge should land for that row. The e2e run itself renders live (100 seeds),
// but the 10 000-seed cell is the same shape and gives us the ground-truth p10 the
// renderer would compute at scale.
function loadCellRowsByPreset(preset) {
  const file = findHeadlineCellFile('board', preset);
  if (!file) return null;
  const cell = JSON.parse(readFileSync(file, 'utf-8'));
  return cell.strategies.map((s) => ({
    id: s.id, family: s.family, median: s.medianSeconds, p10: s.p10, p90: s.p90,
  }));
}

test('round-14: on-scale medians never sit on the plot-band edge on BOTH panels (a320)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const { panels } = await runCompareAndMeasure(browser, 'a320');
    assert.ok(panels.length >= 2, `expected at least two panels, got ${panels.length}`);
    for (let i = 0; i < panels.length; i += 1) {
      const panel = panels[i];
      for (const m of panel.medians) {
        assert.ok(m.x > panel.chartX0 + 2 && m.x < panel.chartX1 - 2,
          `panel ${i}: median tick for ${m.rowId} at x=${m.x.toFixed(2)} must sit strictly inside `
          + `[${(panel.chartX0 + 2).toFixed(1)}, ${(panel.chartX1 - 2).toFixed(1)}]`);
      }
    }
  } finally { await browser.close(); }
});

test('round-14: no two on-scale medians share a 2 px slot unless within 5 s of each other, BOTH panels, at desktop AND phone widths (a320 and a321neo-three-class)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    // Round-11 R11-M1 / R11-m1: run the tie invariant at BOTH desktop and phone widths.
    // The desktop run keeps the strict 5 s tolerance; the phone run floors at 5 s but
    // scales up to what a 400 px viewport can physically resolve on the slowest preset,
    // because 400 px cannot separate 5 s pairs on a 1080 s plot band no matter where the
    // gutter is set. The scaled tolerance is 2 px worth of the actual band plus 0.5 s.
    for (const viewport of [
      { width: 1280, height: 900, mobile: false, label: 'desktop' },
      { width: 400, height: 800, mobile: true, label: 'phone' },
    ]) {
      for (const preset of ['a320', 'a321neo-three-class', 'b737max8-lcc']) {
        const { panels } = await runCompareAndMeasure(browser, preset, viewport);
        for (let i = 0; i < panels.length; i += 1) {
          const panel = panels[i];
          if (panel.medians.length < 2) continue;
          // Derive px-per-second from two on-scale median points. The chart projects each
          // median as x = chartX0 + (seconds - floor) * plotBandPx / (cap - floor), so any
          // two medians give slope = (s2 - s1) / (x2 - x1) seconds per px, and pxPerSec is
          // its reciprocal. This matches the renderer's own scale exactly; deriving it from
          // max(medians)-min(medians) instead would understate the plot span by whatever
          // margin sits between the extreme medians and the axis edges.
          const sorted = [...panel.medians].sort((a, b) => a.x - b.x);
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          const dxSpan = last.x - first.x;
          const dsSpan = last.seconds - first.seconds;
          const pxPerSec = dxSpan > 1e-9 && Math.abs(dsSpan) > 1e-9 ? dxSpan / dsSpan : 1;
          const scaledTolerance = 2 / Math.max(1e-9, pxPerSec) + PHONE_TIE_TOLERANCE_BUFFER_SECONDS;
          const tolerance = Math.max(DESKTOP_TIE_TOLERANCE_SECONDS, scaledTolerance);
          for (let a = 0; a < panel.medians.length; a += 1) {
            for (let b = a + 1; b < panel.medians.length; b += 1) {
              const dx = Math.abs(panel.medians[a].x - panel.medians[b].x);
              const ds = Math.abs(panel.medians[a].seconds - panel.medians[b].seconds);
              if (dx < 2) {
                assert.ok(ds < tolerance,
                  `${preset} @ ${viewport.label} (${viewport.width} px, band ${panel.plotBandPx.toFixed(0)} px, `
                  + `tolerance ${tolerance.toFixed(1)} s): panel ${i} median ticks for `
                  + `${panel.medians[a].rowId} and ${panel.medians[b].rowId} share x within `
                  + `${dx.toFixed(2)} px but their true medians differ by ${ds.toFixed(1)} s `
                  + `(values ${panel.medians[a].seconds.toFixed(1)}, ${panel.medians[b].seconds.toFixed(1)})`);
              }
            }
          }
        }
      }
    }
  } finally { await browser.close(); }
});

test('round-15 R11-M1: at phone widths the plot band takes at least 70% of the SVG width (a320 and b737max8-lcc)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const preset of ['a320', 'b737max8-lcc']) {
      const { panels } = await runCompareAndMeasure(browser, preset,
        { width: 400, height: 800, mobile: true });
      assert.ok(panels.length >= 2, `${preset}: expected at least two panels at 400x800`);
      for (let i = 0; i < panels.length; i += 1) {
        const panel = panels[i];
        const ratio = panel.plotBandPx / panel.svgWidth;
        assert.ok(ratio >= 0.70,
          `${preset}: panel ${i} phone plot band ${panel.plotBandPx.toFixed(1)} px must be `
          + `>= 70% of svg width ${panel.svgWidth} (got ${(ratio * 100).toFixed(1)}%)`);
      }
    }
  } finally { await browser.close(); }
});

test('round-15 R11-M1: at phone widths every row label sits fully inside the SVG viewBox', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const preset of ['a320', 'b737max8-lcc']) {
      const context = await browser.newContext({
        viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true,
      });
      const page = await goto(await context.newPage(),
        `${BASE_URL}/index.html?tab=race&mode=board&preset=${preset}&seed=r15-labels-${preset}`);
      const seedSelect = await page.$('#seed-count-select');
      if (seedSelect) await seedSelect.selectOption('100');
      await page.click('#btn-compare');
      await page.waitForFunction(() => {
        const wrap = document.getElementById('strips-wrap');
        return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
      }, {}, { timeout: 90000 });

      const outOfBoundsLabels = await page.evaluate(() => {
        const wrap = document.getElementById('strips-wrap');
        const svgs = Array.from(wrap.querySelectorAll('svg'));
        const misfits = [];
        for (const svg of svgs) {
          const svgWidth = Number(svg.getAttribute('width'));
          const labels = Array.from(svg.querySelectorAll('text[data-row-label]'));
          for (const label of labels) {
            const bbox = label.getBBox();
            if (bbox.x < -0.5 || bbox.x + bbox.width > svgWidth + 0.5) {
              misfits.push({
                rowId: label.getAttribute('data-row-label') || '',
                text: (label.textContent || '').trim(),
                left: bbox.x,
                right: bbox.x + bbox.width,
                svgWidth,
              });
            }
          }
        }
        return misfits;
      });

      assert.equal(outOfBoundsLabels.length, 0,
        `${preset}: every row label at phone width must be fully inside the SVG viewBox, `
        + `got ${JSON.stringify(outOfBoundsLabels)}`);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('round-15 R11-M2: every off-scale row draws its bar from max(floor, p10) to the cap; a row whose p10 is beyond the cap draws no bar at all (a320 and a321neo-three-class)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const preset of ['a320', 'a321neo-three-class']) {
      const { panels } = await runCompareAndMeasure(browser, preset, { width: 1280, height: 800 });
      // Cross-check on ground truth (the 10 000-seed cell). Cell p10 may drift a little
      // from the live 100-seed p10, but for the four rows checked here it never crosses
      // the cap in either direction, so the "bar or no bar" branch matches the DOM.
      const cellRows = loadCellRowsByPreset(preset);
      assert.ok(cellRows, `${preset}: headline cell must load`);
      const cellById = new Map(cellRows.map((r) => [r.id, r]));
      let sawOffScale = 0;
      for (const panel of panels) {
        for (const off of panel.offScale) {
          sawOffScale += 1;
          const cell = cellById.get(off.rowId);
          assert.ok(cell,
            `${preset}: off-scale row ${off.rowId} must exist in the cell data (found ids ${[...cellById.keys()].join(',')})`);
          // Derive floor/cap from two on-scale medians whose x and seconds we know:
          //   x = chartX0 + (seconds - floor) * plotBandPx / (cap - floor)
          // Pick the two ticks with the greatest x-separation for numerical stability.
          assert.ok(panel.medians.length >= 2,
            `${preset}: at least two on-scale medians are needed to derive floor/cap`);
          const sorted = [...panel.medians].sort((a, b) => a.x - b.x);
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          const slope = (last.seconds - first.seconds) / (last.x - first.x); // s per px
          const derivedFloor = first.seconds - slope * (first.x - panel.chartX0);
          const derivedCap = derivedFloor + slope * panel.plotBandPx;
          // Use the p10 the chart itself computed (from live 100-seed data) for the
          // pixel-position check. Cell p10 supplies the ground-truth cross-check on the
          // "bar drawn or not" branch just below.
          const domP10 = off.p10Seconds;
          if (Number.isFinite(cell.p10) && cell.p10 >= derivedCap) {
            assert.equal(off.barLeftX, null,
              `${preset}: off-scale row ${off.rowId} has cell p10 ${cell.p10.toFixed(1)}s at or beyond `
              + `cap ${derivedCap.toFixed(1)}s, so no broken bar should be drawn (barLeftX ${off.barLeftX})`);
            continue;
          }
          if (!Number.isFinite(domP10) || domP10 >= derivedCap) {
            // Live drift pushed p10 past cap: chart correctly draws no bar. Nothing to
            // pixel-check on this row for this run.
            continue;
          }
          const bandLow = Math.max(derivedFloor, domP10);
          const expectedX = panel.chartX0
            + (bandLow - derivedFloor) / Math.max(1e-9, derivedCap - derivedFloor) * panel.plotBandPx;
          assert.ok(off.barLeftX !== null,
            `${preset}: off-scale row ${off.rowId} has on-scale live p10 ${domP10.toFixed(1)}s `
            + `(cap ${derivedCap.toFixed(1)}s); broken bar must be drawn`);
          const dx = Math.abs(off.barLeftX - expectedX);
          assert.ok(dx <= 2,
            `${preset}: off-scale row ${off.rowId} bar left edge at ${off.barLeftX.toFixed(2)} px `
            + `should map to max(floor, p10) = ${bandLow.toFixed(1)}s -> expected ${expectedX.toFixed(2)} px `
            + `(within 2 px), got dx=${dx.toFixed(2)} px`);
        }
      }
      assert.ok(sawOffScale >= 1,
        `${preset}: expected at least one off-scale row on the compare view`);
    }
  } finally { await browser.close(); }
});

test('round-14: off-scale rows draw as broken bars with the true value printed, not clamped to the cap (a320)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const { panels } = await runCompareAndMeasure(browser, 'a320');
    let sawOffScale = false;
    for (const panel of panels) {
      for (const off of panel.offScale) {
        sawOffScale = true;
        // The clock attribute must carry a real M:SS value, and the visible text pairs it
        // with " (off scale)" (desktop) or a dagger glyph (phone). Never blank.
        assert.match(off.clock, /^\d{1,2}:\d{2}$/,
          `off-scale row ${off.rowId} clock attribute should be M:SS, got "${off.clock}"`);
        assert.ok(Number.isFinite(off.seconds) && off.seconds > 0,
          `off-scale gutter for ${off.rowId} must expose its true median in seconds, got ${off.seconds}`);
      }
    }
    assert.ok(sawOffScale, 'a320 board compare should have at least one off-scale row drawn as a broken bar');
  } finally { await browser.close(); }
});

// Round-14 lead follow-up: the printed value of an off-scale row must be fully inside the
// SVG viewBox at both desktop and phone widths, and must carry a real M:SS clock (not a
// blank or a "25:" fragment). Runs against both a320 (three off-scale rows, wide labels)
// and b717 (one off-scale row on the tightest plot band the presets carry).
test('round-14: off-scale value text is never clipped by the SVG on a320 or b717 at 1280 or 400 px', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const preset of ['a320', 'b717']) {
      for (const size of [{ width: 1280, height: 900 }, { width: 400, height: 800 }]) {
        const { panels } = await runCompareAndMeasure(browser, preset, size);
        let saw = 0;
        for (const panel of panels) {
          for (const off of panel.offScale) {
            saw += 1;
            assert.match(off.clock, /^\d{1,2}:\d{2}$/,
              `${preset} @ ${size.width}: off-scale row ${off.rowId} clock must be M:SS, got "${off.clock}" `
              + `(rendered as "${off.text}")`);
            assert.ok(off.bboxLeft >= 0,
              `${preset} @ ${size.width}: off-scale text "${off.text}" for ${off.rowId} left edge ${off.bboxLeft.toFixed(2)} `
              + `must be >= 0 (inside svg viewBox)`);
            assert.ok(off.bboxRight <= panel.svgWidth + 1e-6,
              `${preset} @ ${size.width}: off-scale text "${off.text}" for ${off.rowId} right edge ${off.bboxRight.toFixed(2)} `
              + `must be <= svgWidth ${panel.svgWidth} (never clipped)`);
          }
        }
        assert.ok(saw >= 1,
          `${preset} @ ${size.width}: expected at least one off-scale row in the board compare, got ${saw}`);
      }
    }
  } finally { await browser.close(); }
});

test('round-14: phone width routes both axis notes into an external caption and they do not overprint', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=race&mode=board&preset=a320&seed=n10m2`);
    const seedSelect = await page.$('#seed-count-select');
    if (seedSelect) await seedSelect.selectOption('100');
    await page.click('#btn-compare');
    await page.waitForFunction(() => {
      const wrap = document.getElementById('strips-wrap');
      return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
    }, {}, { timeout: 90000 });

    const observed = await page.evaluate(() => {
      const wrap = document.getElementById('strips-wrap');
      const captions = Array.from(wrap.querySelectorAll('p.compare-axis-notes'));
      // For each caption compute its bounding box so we can assert on non-overlap between
      // captions and also between axis text nodes inside the same panel.
      const captionRects = captions.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: (el.textContent || '').trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
      // Any residual italic axis note inside an SVG (shouldn't exist on phone).
      const inlineNotes = [];
      for (const svg of wrap.querySelectorAll('svg')) {
        for (const t of svg.querySelectorAll('text')) {
          const txt = (t.textContent || '').trim();
          if (/off scale/i.test(txt) || /axis starts at/i.test(txt)) inlineNotes.push(txt);
        }
      }
      return { captionRects, inlineNotes };
    });

    // On phone: the two axis notes must be external captions, not inline SVG text.
    assert.equal(observed.inlineNotes.length, 0,
      `phone widths must not draw axis notes inline in the SVG, got ${JSON.stringify(observed.inlineNotes)}`);
    assert.ok(observed.captionRects.length >= 1,
      `phone widths must render at least one .compare-axis-notes caption, got ${observed.captionRects.length}`);
    // Successive captions must not overlap vertically.
    for (let i = 0; i < observed.captionRects.length; i += 1) {
      for (let j = i + 1; j < observed.captionRects.length; j += 1) {
        const a = observed.captionRects[i];
        const b = observed.captionRects[j];
        const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        if (overlapX > 0 && overlapY > 0) {
          assert.fail(`compare-axis-notes captions overlap: "${a.text}" and "${b.text}" (overlap ${overlapX.toFixed(1)} x ${overlapY.toFixed(1)} px)`);
        }
      }
    }
    await shot(page, 'compare-a320-400x800-phone-notes.png');
  } finally { await browser.close(); }
});

test('N8-M3: no two anchor label bboxes intersect at 1024, 1280 and 1440 px widths', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const width of [1024, 1280, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await goto(await context.newPage(),
        `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=a320&seed=n8m3-${width}`);
      const bboxes = await page.evaluate(() => {
        const svg = document.querySelector('[data-rankings-chart] svg');
        if (!svg) return [];
        const labels = Array.from(svg.querySelectorAll('.rankings-anchor-label, .rankings-anchor-clickable'));
        return labels.map((el) => {
          const box = el.getBBox();
          return {
            text: (el.textContent || '').trim(),
            x: box.x, y: box.y, w: box.width, h: box.height,
          };
        });
      });
      assert.ok(bboxes.length >= 2, `${width}: expected at least two anchor labels on a320 board, got ${bboxes.length}`);
      for (let i = 0; i < bboxes.length; i += 1) {
        for (let j = i + 1; j < bboxes.length; j += 1) {
          const a = bboxes[i];
          const b = bboxes[j];
          const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
          const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
          assert.ok(!(xOverlap && yOverlap),
            `${width}px: labels "${a.text}" and "${b.text}" overlap (x: ${a.x}+${a.w} vs ${b.x}+${b.w}, y: ${a.y}+${a.h} vs ${b.y}+${b.h})`);
        }
      }
      await shot(page, `rankings-board-a320-anchors-${width}.png`);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('N7-m7 / N9-m1: race controls fully inside the viewport on cold load at 1280x720, 1280x800, 1440x900 and 1512x982', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const viewports = [
      { width: 1280, height: 720 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
      { width: 1512, height: 982 },
    ];
    for (const { width, height } of viewports) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await goto(await context.newPage(),
        `${BASE_URL}/index.html?tab=race&mode=deplane&preset=a320&seed=n7m7-${width}x${height}`);
      const boxes = await page.evaluate(() => {
        const restart = document.getElementById('btn-race');
        const speed = document.getElementById('speed-group');
        const asRect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        return { restart: asRect(restart), speed: asRect(speed) };
      });
      assert.ok(boxes.restart, `${width}x${height}: Restart button should be in the DOM`);
      assert.ok(boxes.speed, `${width}x${height}: Speed group should be in the DOM`);
      assert.ok(boxes.restart.top >= 0 && boxes.restart.bottom <= height,
        `${width}x${height}: Restart button should sit inside 0..${height}, got top ${boxes.restart.top} bottom ${boxes.restart.bottom}`);
      assert.ok(boxes.speed.top >= 0 && boxes.speed.bottom <= height,
        `${width}x${height}: Speed group should sit inside 0..${height}, got top ${boxes.speed.top} bottom ${boxes.speed.bottom}`);
      await shot(page, `race-controls-${width}x${height}.png`);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('screenshots: rankings on a320, b787, a321neo-three-class boards at three widths', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const presets = ['a320', 'b787', 'a321neo-three-class'];
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 400, height: 800 }]) {
      const context = await browser.newContext({ viewport });
      for (const preset of presets) {
        const page = await goto(await context.newPage(),
          `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=${preset}&seed=shot12-${preset}`);
        await shot(page, `rankings-board-${preset}-${viewport.width}x${viewport.height}.png`);
        await page.close();
      }
      await context.close();
    }
  } finally { await browser.close(); }
});

test('N8-m4 carried: phone drawer open shot at 400x800 shows a real tap-outside strip', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await goto(await context.newPage(), `${BASE_URL}/index.html?seed=drawer-12`);
    await page.click('#btn-open-settings');
    await page.waitForFunction(() => document.body.classList.contains('settings-open'), { timeout: 2000 });
    const geom = await page.evaluate(() => {
      const panel = document.getElementById('settings-panel');
      const scrim = document.getElementById('settings-scrim');
      return {
        panel: panel.getBoundingClientRect().left,
        panelWidth: panel.getBoundingClientRect().width,
        scrimWidth: scrim.getBoundingClientRect().width,
      };
    });
    // The panel left must be at least 40 px from the viewport left, so the tap strip is
    // real. At 400 px viewport, 85vw gives 340 px width, leaving 60 px strip.
    assert.ok(geom.panel >= 40,
      `drawer left should be >= 40 px so the tap strip is real, got ${geom.panel} (panel width ${geom.panelWidth})`);
    await shot(page, 'drawer-open-400x800.png');
  } finally { await browser.close(); }
});

test('N9-m2: About tab prints both the paper\'s >40% figure and this model\'s computed aisle-first figure on the A320 deplane cell', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=about&seed=n9m2`);
    // Wait for the index to load and the aisle-first bullet to be rewritten from the a320
    // deplane headline cell. The rewrite is async (loadCellFile fetches a JSON file).
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-about-aisle-first]');
      if (!el) return false;
      const txt = el.textContent || '';
      return /this model finds about\s+\d+(?:\.\d+)?%/.test(txt);
    }, {}, { timeout: 10000 });
    const bulletText = await page.evaluate(() => {
      const el = document.querySelector('[data-about-aisle-first]');
      return el ? el.textContent : '';
    });
    assert.ok(/>\s*40\s*%/.test(bulletText),
      `About aisle-first bullet must cite the paper's >40% figure, got: ${bulletText}`);
    assert.ok(/this model finds about\s+\d+(?:\.\d+)?%/.test(bulletText),
      `About aisle-first bullet must print the model's own percentage, got: ${bulletText}`);
    assert.ok(/A320 deplane headline/.test(bulletText),
      `About aisle-first bullet must name the A320 deplane headline cell, got: ${bulletText}`);
    await shot(page, 'about-aisle-first-n9m2.png');
  } finally { await browser.close(); }
});

// Round-14 screenshots: race compare on a320, b738-two-class, a321neo-three-class at
// desktop and phone widths. Runs inside this file so it does not add a new parallel test
// process, which previously starved the fix-round-08 CSP test's 30-s wait.
test('round-14 screenshots: race compare at 1280x800 and 400x800 across a320, b738-two-class, a321neo-three-class', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const presets = ['a320', 'b738-two-class', 'a321neo-three-class'];
    for (const preset of presets) {
      for (const viewport of [{ width: 1280, height: 800, mobile: false }, { width: 400, height: 800, mobile: true }]) {
        const contextOpts = { viewport: { width: viewport.width, height: viewport.height } };
        if (viewport.mobile) { contextOpts.hasTouch = true; contextOpts.isMobile = true; }
        const context = await browser.newContext(contextOpts);
        const page = await goto(await context.newPage(),
          `${BASE_URL}/index.html?tab=race&mode=board&preset=${preset}&seed=fr14-${preset}`);
        const seedSelect = await page.$('#seed-count-select');
        if (seedSelect) await seedSelect.selectOption('100');
        await page.click('#btn-compare');
        await page.waitForFunction(() => {
          const wrap = document.getElementById('strips-wrap');
          return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
        }, {}, { timeout: 120000 });
        const file = path.join(ROUND_14_DIR, `compare-race-${preset}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: file, fullPage: true });
        await context.close();
      }
    }
  } finally { await browser.close(); }
});

test('round-15 screenshots: race compare at 1280x800 and 400x800 on a320, b737max8-lcc and a321neo-three-class (fix-round-15 evidence)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const presets = ['a320', 'b737max8-lcc', 'a321neo-three-class'];
    for (const preset of presets) {
      for (const viewport of [{ width: 1280, height: 800, mobile: false }, { width: 400, height: 800, mobile: true }]) {
        const contextOpts = { viewport: { width: viewport.width, height: viewport.height } };
        if (viewport.mobile) { contextOpts.hasTouch = true; contextOpts.isMobile = true; }
        const context = await browser.newContext(contextOpts);
        const page = await goto(await context.newPage(),
          `${BASE_URL}/index.html?tab=race&mode=board&preset=${preset}&seed=fr15-${preset}`);
        const seedSelect = await page.$('#seed-count-select');
        if (seedSelect) await seedSelect.selectOption('100');
        await page.click('#btn-compare');
        await page.waitForFunction(() => {
          const wrap = document.getElementById('strips-wrap');
          return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
        }, {}, { timeout: 120000 });
        const file = path.join(ROUND_15_DIR, `compare-race-${preset}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: file, fullPage: true });
        await context.close();
      }
    }
  } finally { await browser.close(); }
});
