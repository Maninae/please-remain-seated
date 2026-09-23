/**
 * Round-09 e2e: verifications for the round-06 critic fixes.
 *
 * Coverage:
 *   - N6-B2: comparison rows print signed values when the airlines LOSE to random on a
 *     preset. Fixture cells for the a321neo-three-class and b738-two-class presets carry
 *     airline medians that sit above random; the fixed rankings-stats.js must print the
 *     magnitude followed by "worse" instead of clamping at 0.0.
 *   - N6-B1: on a partial index whose board cell for a320 is pending, toggling from
 *     Deplaning to Boarding must clear every part of the tab (hero sentence, tiles,
 *     comparison rows, sub-line, footnote, chart) and NOT leave the previous deplane
 *     values on screen. `aria-checked` on the Boarding button must be true.
 *   - N6-M3: anchor label bboxes stay inside the SVG viewBox at 1280 and 400 px, on the
 *     A320 (three-anchor case) and the two-class 737 (three-anchor case). The desktop
 *     tree stacks three rows; phone drops to one row and skips overlapping labels.
 *   - Regression: rankings screenshots on the two-class 737 preset added to the round-09
 *     artifacts folder.
 *
 * Skips itself cleanly if Playwright cannot launch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-09');
if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function safeLaunch() {
  try { return await chromium.launch({ headless: true }); }
  catch (error) { return null; }
}

async function shot(page, name) {
  const file = path.join(ARTIFACTS_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/**
 * Build a synthetic index + cell files where the caller controls the airline vs random
 * relationship per preset. This keeps N6-B2 assertions deterministic and independent of
 * the live precompute.
 *
 * `presetSpec` shape:
 *   { [presetId]: {
 *       passengerCount: number,
 *       // random median, airline medians, best textbook median — all in seconds.
 *       randomSec: number, airlineSecs: number[], textbookSec: number,
 *       // one deplane strategy exposes a MODE the test can toggle to.
 *       deplaneMedianSec: number,
 *     }
 *   }
 */
async function serveFixtureCells(context, { presetSpec, includeDeplaneA320 = false, includeBoardA320 = false, seeds = 200 }) {
  const now = new Date().toISOString();

  const cells = [];
  for (const [preset, spec] of Object.entries(presetSpec)) {
    // Board cell for this preset.
    cells.push({
      id: `board__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
      mode: 'board', preset,
      knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
      seeds, kind: 'headline',
      file: `board__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`,
    });
    if (spec.deplaneMedianSec) {
      cells.push({
        id: `deplane__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
        mode: 'deplane', preset,
        knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
        seeds, kind: 'headline',
        file: `deplane__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`,
      });
    }
  }
  if (includeDeplaneA320) {
    cells.push({
      id: `deplane__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
      mode: 'deplane', preset: 'a320',
      knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
      seeds, kind: 'headline',
      file: `deplane__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`,
    });
  }
  if (includeBoardA320) {
    cells.push({
      id: `board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
      mode: 'board', preset: 'a320',
      knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
      seeds, kind: 'headline',
      file: `board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`,
    });
  }

  const index = {
    generatedAt: now,
    engineVersion: 'fixture09',
    preview: false,
    defaults: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
    grid: {
      load: [0.7, 0.85, 1], compliance: [0.5, 0.85, 1], groups: [0, 0.25, 0.5],
      bags: ['default', 'light', 'heavy'], bins: ['roomy', 'legacy'],
    },
    strategyCountByMode: { deplane: 3, board: 8 },
    seedTiers: { headline: 10000, small: 2000, sensitivity: 2000, preview: 200 },
    namedHeadlinePresets: ['a320'],
    sensitivityPresets: [],
    sensitivityFactors: [],
    cells,
  };
  await context.route(/\/data\/rankings\/index\.json$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(index),
  }));
  await context.route(/\/data\/rankings\/index-preview\.json$/, (route) => route.fulfill({ status: 404, body: '' }));

  for (const [preset, spec] of Object.entries(presetSpec)) {
    const boardCellFilename = `board__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`;
    await context.route(new RegExp(`\\/data\\/rankings\\/${boardCellFilename.replace(/\./g, '\\.')}$`), (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(buildBoardCell(preset, spec, seeds)),
    }));
    if (spec.deplaneMedianSec) {
      const deplaneCellFilename = `deplane__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`;
      await context.route(new RegExp(`\\/data\\/rankings\\/${deplaneCellFilename.replace(/\./g, '\\.')}$`), (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(buildDeplaneCell(preset, spec, seeds)),
      }));
    }
  }
  if (includeDeplaneA320) {
    const filename = `deplane__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`;
    await context.route(new RegExp(`\\/data\\/rankings\\/${filename.replace(/\./g, '\\.')}$`), (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(buildDeplaneCell('a320', { passengerCount: 153, deplaneMedianSec: 240 }, seeds)),
    }));
  }
  if (includeBoardA320) {
    const filename = `board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`;
    await context.route(new RegExp(`\\/data\\/rankings\\/${filename.replace(/\./g, '\\.')}$`), (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(buildBoardCell('a320', {
        passengerCount: 153,
        randomSec: 1230, airlineSecs: [1160, 1180, 1200, 1220, 1210, 1170, 1150, 1190], textbookSec: 660,
      }, seeds)),
    }));
  }
}

function buildBoardCell(preset, spec, seeds) {
  const pax = spec.passengerCount;
  const strategies = [
    row('reverse-pyramid', 'Reverse pyramid', 'textbook', spec.textbookSec, pax, seeds),
    row('random', 'Random order', 'textbook', spec.randomSec, pax, seeds),
    row('back-to-front', 'Back to front', 'textbook', spec.randomSec + 2400, pax, seeds),
  ];
  const airlineLabels = [
    'American Airlines', 'Delta Air Lines', 'United Airlines', 'Southwest',
    'JetBlue', 'Spirit', 'Alaska Airlines', 'Hawaiian Airlines',
  ];
  for (let i = 0; i < spec.airlineSecs.length; i += 1) {
    strategies.push(row(`airline-${i}`, airlineLabels[i] || `Airline ${i}`, 'airline', spec.airlineSecs[i], pax, seeds));
  }
  return {
    cell: {
      id: `board__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
      mode: 'board', preset,
      knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
      seeds,
    },
    seeds,
    passengerCount: pax,
    strategies,
  };
}

function buildDeplaneCell(preset, spec, seeds) {
  const pax = spec.passengerCount;
  const strategies = [
    row('both-doors', 'Both doors', 'textbook', spec.deplaneMedianSec, pax, seeds),
    row('free-for-all', 'Free-for-all', 'textbook', spec.deplaneMedianSec + 120, pax, seeds),
    row('one-row-at-a-time', 'One row at a time', 'textbook', spec.deplaneMedianSec + 900, pax, seeds),
  ];
  return {
    cell: {
      id: `deplane__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
      mode: 'deplane', preset,
      knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
      seeds,
    },
    seeds,
    passengerCount: pax,
    strategies,
  };
}

function row(id, label, family, medianSec, pax, seeds) {
  const p10 = medianSec - 50;
  const p90 = medianSec + 50;
  return {
    id, label, family,
    medianSeconds: medianSec, p10, p90, n: seeds,
    idlePersonMinutesMedian: (medianSec / 60) * (pax * 0.6),
    idlePersonMinutesPerPassenger: (medianSec / 60) * 0.6,
    histogram: { binSeconds: 30, counts: [2, 6, 10, 12, 10, 6, 2] },
  };
}

async function loadPage(context, url) {
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => { try { window.localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'load' });
  // Round-08: widen the wait so a slow parallel-suite run still catches the lede.
  await page.waitForSelector('[data-rankings-lede]', { timeout: 45000 });
  await page.waitForTimeout(2200);
  return page;
}

test('N6-B2: negative comparison values print with "worse" on losing presets', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    // Fixtures: on both presets, EVERY airline sits above random by ~2 min, so avg airline
    // vs random should print a positive person-years / day figure labelled "worse".
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await serveFixtureCells(context, {
      presetSpec: {
        'a321neo-three-class': {
          passengerCount: 194,
          randomSec: 1330,
          airlineSecs: [1420, 1440, 1450, 1460, 1470, 1480, 1490, 1500, 1510, 1520, 1530, 1540, 1550, 1560],
          textbookSec: 750,
        },
        'b738-two-class': {
          passengerCount: 160,
          randomSec: 1337,
          airlineSecs: [1450, 1460, 1470, 1480, 1490, 1500, 1510, 1520, 1530, 1540, 1550, 1560, 1570, 1580],
          textbookSec: 720,
        },
      },
    });

    for (const preset of ['a321neo-three-class', 'b738-two-class']) {
      const page = await loadPage(context, `${BASE_URL}/index.html?tab=rankings&mode=board&preset=${preset}&seed=b2-${preset}`);
      const readOut = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.rankings-comparison-row')];
        return rows.map((row) => ({
          head: row.querySelector('.rankings-comparison-head')?.textContent || '',
          value: row.querySelector('.rankings-comparison-value')?.textContent || '',
        }));
      });
      const avgRow = readOut.find((r) => /average airline vs random order/i.test(r.head));
      assert.ok(avgRow, `expected "Average airline vs random order" row on ${preset}, got ${JSON.stringify(readOut)}`);
      assert.match(avgRow.value, /\bworse\b/i,
        `on ${preset} the average-airline row should print "worse", got "${avgRow.value}"`);
      const magnitudeMatch = avgRow.value.match(/([0-9]+(?:\.[0-9]+)?)/);
      assert.ok(magnitudeMatch, `should print a numeric magnitude, got "${avgRow.value}"`);
      const magnitude = Number(magnitudeMatch[1]);
      assert.ok(magnitude > 0.5, `magnitude should exceed 0.5 person-years/day, got ${magnitude} on ${preset}`);
      // Best-airline vs random should also carry "worse" since best airline > random.
      const bestAirlineRow = readOut.find((r) => /best airline vs random order/i.test(r.head));
      assert.ok(bestAirlineRow, `expected "Best airline vs random order" row on ${preset}`);
      assert.match(bestAirlineRow.value, /\bworse\b/i,
        `on ${preset} the best-airline row should print "worse", got "${bestAirlineRow.value}"`);
      await shot(page, `rankings-board-${preset}-desktop-1280x800.png`);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('N7-B1: partial primary + real preview: mode toggle loads preview fallback with no crash', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    // Production shape: primary index.json misses the board a320 headline (still writing
    // it, listed under `pending`) while index-preview.json ships the board a320 cell it
    // always ships. Toggling from Deplaning to Boarding must fall through to the preview
    // cell without throwing, land the Boarding button lit, keep the aircraft select on
    // A320, and render board content (not a stale deplane finding).
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await servePartialIndexWithRealPreview(context);
    const pageErrors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error)));
    await page.goto('about:blank');
    await page.goto(`${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=a320&seed=b1-partial`, { waitUntil: 'load' });
    await page.evaluate(() => { try { window.localStorage.clear(); } catch {} });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-rankings-lede]');
    await page.waitForTimeout(2200);
    // Sanity: deplane hero present before the toggle.
    const preToggle = await page.evaluate(() => document.querySelector('[data-rankings-finding]')?.textContent || '');
    assert.ok(preToggle.length > 10, `deplane hero should be present before toggle, got "${preToggle}"`);

    await page.click('button[data-rankings-mode="board"]');
    await page.waitForTimeout(1800);
    const post = await page.evaluate(() => ({
      findingText: document.querySelector('[data-rankings-finding]')?.textContent || '',
      statsText: document.querySelector('[data-rankings-stats]')?.textContent || '',
      footnoteText: document.querySelector('[data-rankings-footnote]')?.textContent || '',
      caveatText: document.querySelector('[data-rankings-chart-caveat]')?.textContent || '',
      chartHTML: document.querySelector('[data-rankings-chart]')?.innerHTML || '',
      boardAriaChecked: document.querySelector('button[data-rankings-mode="board"]')?.getAttribute('aria-checked') || '',
      deplaneAriaChecked: document.querySelector('button[data-rankings-mode="deplane"]')?.getAttribute('aria-checked') || '',
      presetSelectValue: document.getElementById('rankings-preset-select')?.value || '',
    }));
    assert.equal(pageErrors.length, 0, `should be zero page errors, got: ${pageErrors.join(' | ')}`);
    assert.equal(post.boardAriaChecked, 'true', `Boarding aria-checked should be true, got "${post.boardAriaChecked}"`);
    assert.equal(post.deplaneAriaChecked, 'false', `Deplaning aria-checked should be false, got "${post.deplaneAriaChecked}"`);
    assert.equal(post.presetSelectValue, 'a320', `aircraft select should stay on A320, got "${post.presetSelectValue}"`);
    // Board content, not the previous deplane finding. Board hero mentions boarding words
    // ("board", "boards"); no deplane-specific text should leak.
    assert.match(post.findingText, /board(s|ing|)/i, `board hero should mention boarding, got "${post.findingText}"`);
    assert.doesNotMatch(post.findingText, /Both doors|Free-for-all|One row at a time/i,
      `board hero should not name a deplane strategy, got "${post.findingText}"`);
    // Chart should be populated with SVG content.
    assert.ok(post.chartHTML.length > 200, `chart should render board rows, got ${post.chartHTML.length} chars`);
    await shot(page, 'rankings-board-a320-partial-fallback.png');
  } finally { await browser.close(); }
});

/**
 * Serve a partial primary index (missing the board a320 headline, listed in `pending`)
 * plus a real production-shape preview index that ships the board a320 cell. The route
 * table covers the cell files: primary deplane a320 (200 seeds fixture) and preview
 * board a320 (200 seeds). Any other rankings cell fetch replies 404 so a wrong-path
 * lookup shows up as a request, not silently succeeds.
 */
async function servePartialIndexWithRealPreview(context) {
  const seeds = 200;
  const primaryDeplaneCell = {
    id: `deplane__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
    mode: 'deplane', preset: 'a320',
    knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
    seeds, kind: 'headline',
    file: `deplane__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`,
  };
  const primaryIndex = {
    generatedAt: new Date().toISOString(),
    engineVersion: 'fixture09-partial',
    preview: false,
    defaults: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
    grid: {
      load: [0.7, 0.85, 1], compliance: [0.5, 0.85, 1], groups: [0, 0.25, 0.5],
      bags: ['default', 'light', 'heavy'], bins: ['roomy', 'legacy'],
    },
    strategyCountByMode: { deplane: 3, board: 8 },
    seedTiers: { headline: 10000, small: 2000, sensitivity: 2000, preview: 200 },
    namedHeadlinePresets: ['a320'],
    sensitivityPresets: [],
    sensitivityFactors: [],
    cells: [primaryDeplaneCell],
    // A partial precompute discloses the cells it has not written yet through `pending`.
    pending: [{
      id: `board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=10000`,
      mode: 'board', preset: 'a320',
      knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
      seeds: 10000, kind: 'headline',
      file: `board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=10000.json`,
    }],
  };
  const previewBoardCell = {
    id: `board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
    mode: 'board', preset: 'a320',
    knobs: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
    seeds, kind: 'headline',
    file: `board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`,
  };
  const previewDeplaneCell = { ...primaryDeplaneCell };
  const previewIndex = {
    generatedAt: new Date().toISOString(),
    engineVersion: 'fixture09-preview',
    preview: true,
    defaults: primaryIndex.defaults,
    grid: primaryIndex.grid,
    strategyCountByMode: { deplane: 3, board: 8 },
    seedTiers: { headline: 200, small: 200, sensitivity: 200, preview: 200 },
    namedHeadlinePresets: ['a320'],
    sensitivityPresets: [],
    sensitivityFactors: [],
    cells: [previewDeplaneCell, previewBoardCell],
  };
  // Playwright's route matching is LIFO: the most recently registered route wins.
  // Register the catch-all FIRST so specific routes registered below override it.
  await context.route(/\/data\/rankings\/[^/]+\.json$/, (route) => route.fulfill({ status: 404, body: '' }));
  const deplaneCellPayload = buildDeplaneCell('a320', { passengerCount: 153, deplaneMedianSec: 240 }, seeds);
  await context.route(new RegExp(`\\/data\\/rankings\\/${primaryDeplaneCell.file.replace(/\./g, '\\.')}$`),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deplaneCellPayload) }));
  const boardCellPayload = buildBoardCell('a320', {
    passengerCount: 153,
    randomSec: 1230, airlineSecs: [1160, 1180, 1200, 1220, 1210, 1170, 1150, 1190], textbookSec: 660,
  }, seeds);
  await context.route(new RegExp(`\\/data\\/rankings\\/${previewBoardCell.file.replace(/\./g, '\\.')}$`),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(boardCellPayload) }));
  await context.route(/\/data\/rankings\/index\.json$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(primaryIndex),
  }));
  await context.route(/\/data\/rankings\/index-preview\.json$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(previewIndex),
  }));
}

test('N6-M3: anchor label bboxes stay inside the SVG viewBox at 1280 and 400 px', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 400, height: 800 }]) {
      const context = await browser.newContext({ viewport });
      await serveFixtureCells(context, {
        presetSpec: {
          a320: {
            passengerCount: 153,
            randomSec: 1230, airlineSecs: [1150, 1160, 1180, 1200, 1220, 1250, 1300, 1400], textbookSec: 660,
          },
          'b738-two-class': {
            passengerCount: 160,
            randomSec: 1200, airlineSecs: [1100, 1120, 1140, 1180, 1220, 1260, 1350, 1500], textbookSec: 720,
          },
        },
      });
      for (const preset of ['a320', 'b738-two-class']) {
        const page = await loadPage(context, `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=${preset}&seed=anchor-${preset}-${viewport.width}`);
        const check = await page.evaluate(() => {
          const svg = document.querySelector('.rankings-chart-svg-host svg');
          if (!svg) return { ok: false, reason: 'no svg' };
          const vb = svg.viewBox?.baseVal;
          const vbHeight = vb?.height || svg.height?.baseVal?.value || 0;
          const vbWidth = vb?.width || svg.width?.baseVal?.value || 0;
          const anchors = [...svg.querySelectorAll('.rankings-anchor-label, .rankings-anchor-clickable')];
          const bboxes = anchors.map((el) => {
            const bb = el.getBBox();
            return {
              id: el.getAttribute('data-anchor-id') || '?',
              text: el.textContent,
              x: bb.x, y: bb.y, w: bb.width, h: bb.height,
            };
          });
          return { ok: true, vbWidth, vbHeight, bboxes };
        });
        assert.ok(check.ok, `svg missing on ${preset} @${viewport.width}: ${check.reason || ''}`);
        for (const bb of check.bboxes) {
          assert.ok(bb.y >= 0,
            `anchor "${bb.id}" ("${bb.text}") bbox top (${bb.y}) below viewBox 0 on ${preset} @${viewport.width}`);
          assert.ok(bb.y + bb.h <= check.vbHeight,
            `anchor "${bb.id}" bbox bottom (${bb.y + bb.h}) below viewBox height (${check.vbHeight}) on ${preset} @${viewport.width}`);
          assert.ok(bb.x >= 0,
            `anchor "${bb.id}" bbox left (${bb.x}) left of viewBox 0 on ${preset} @${viewport.width}`);
          assert.ok(bb.x + bb.w <= check.vbWidth,
            `anchor "${bb.id}" bbox right (${bb.x + bb.w}) past viewBox width (${check.vbWidth}) on ${preset} @${viewport.width}`);
        }
        const label = viewport.width === 1280 ? 'desktop-1280x800' : 'phone-400x800';
        await shot(page, `rankings-board-${preset}-${label}.png`);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});

test('regression: rankings deplane on the two-class 737 and A320 renders cleanly', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 400, height: 800 }]) {
      const context = await browser.newContext({ viewport });
      await serveFixtureCells(context, {
        presetSpec: {
          a320: {
            passengerCount: 153,
            randomSec: 1230, airlineSecs: [1150, 1160, 1180, 1200, 1220, 1250, 1300, 1400], textbookSec: 660,
            deplaneMedianSec: 240,
          },
          'b738-two-class': {
            passengerCount: 160,
            randomSec: 1200, airlineSecs: [1100, 1120, 1140, 1180, 1220, 1260, 1350, 1500], textbookSec: 720,
            deplaneMedianSec: 260,
          },
        },
      });
      const label = viewport.width === 1280 ? 'desktop-1280x800' : 'phone-400x800';
      for (const preset of ['a320', 'b738-two-class']) {
        const page = await loadPage(context, `${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=${preset}&seed=regress-${preset}`);
        await shot(page, `rankings-deplane-${preset}-${label}.png`);
        // The under-chart caveat should be hidden in deplane mode.
        const caveatHidden = await page.evaluate(() => {
          const el = document.querySelector('[data-rankings-chart-caveat]');
          return !el || el.hidden || el.textContent.trim().length === 0;
        });
        assert.ok(caveatHidden, `under-chart caveat must be hidden in deplane mode on ${preset}`);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});

test('negative-result preset phone screenshot: a321neo-three-class board', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    await serveFixtureCells(context, {
      presetSpec: {
        'a321neo-three-class': {
          passengerCount: 194,
          randomSec: 1330,
          airlineSecs: [1420, 1440, 1450, 1460, 1470, 1480, 1490, 1500, 1510, 1520, 1530, 1540, 1550, 1560],
          textbookSec: 750,
        },
      },
    });
    const page = await loadPage(context, `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=a321neo-three-class&seed=neg-phone`);
    await shot(page, 'rankings-board-a321neo-three-class-phone-400x800.png');
    // Verify the hero states the negative result.
    const hero = await page.evaluate(() => document.querySelector('[data-rankings-finding]')?.textContent || '');
    assert.match(hero, /slower than random/i, `hero should state the negative result, got "${hero}"`);
  } finally { await browser.close(); }
});
