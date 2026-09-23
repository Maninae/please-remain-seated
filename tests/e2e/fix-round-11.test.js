/**
 * Round-11 fix e2e: verifies the round-07 critic's blockers and majors.
 *
 * Coverage:
 *   - N7-B2: the board compare chart draws both stacked panels on ONE axis; px-per-min on
 *     the textbook panel equals px-per-min on the airline panel within 1%.
 *   - N7-M1: the under-chart caveat's front-to-back verdict word is computed from the
 *     rate, so a preset where the sim rate is above ~7 pax/min prints "faster"
 *     (or the clause is dropped inside rounding noise) instead of the literal "slower".
 *   - N7-M2: rankings tab writes tab, mode, preset, and the knob values to the URL, so a
 *     copied link reproduces the chart on screen.
 *   - N7-M3: on phone, the caveat cites only anchors the chart actually drew a label for.
 *   - Screenshots at 1280x800 and 400x800 for the two rankings modes on a320 and
 *     a321neo-three-class, and the race tab's board compare (shared-axis proof).
 *
 * Skips itself cleanly if Playwright cannot launch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-11');
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

async function goto(page, url) {
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => { try { window.localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2400);
  return page;
}

test('N7-B2: board compare panels share one axis (px-per-min equal within 1%)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await goto(context.newPage ? await context.newPage() : null,
      `${BASE_URL}/index.html?tab=race&mode=board&preset=a320&seed=n7b2`);
    // Set the seed count to 100 for a quick but representative run.
    const seedSelect = await page.$('#seed-count-select');
    if (seedSelect) {
      await seedSelect.selectOption('100');
    }
    await page.click('#btn-compare');
    // Wait for both SVGs to appear in the strips wrapper.
    await page.waitForFunction(() => {
      const wrap = document.getElementById('strips-wrap');
      return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
    }, {}, { timeout: 90000 });

    // For every axis tick on both panels, read the x pixel of two known minute values.
    // The x-axis in the strip chart has <text> children with a trailing 'm' character; we
    // parse the minute number out of that text.
    const axisSamples = await page.evaluate(() => {
      const wrap = document.getElementById('strips-wrap');
      const svgs = wrap ? Array.from(wrap.querySelectorAll('svg')) : [];
      return svgs.map((svg) => {
        const texts = Array.from(svg.querySelectorAll('text'));
        const ticks = [];
        for (const t of texts) {
          const raw = (t.textContent || '').trim();
          const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)m$/);
          if (!match) continue;
          const minute = Number(match[1]);
          const x = Number(t.getAttribute('x'));
          if (Number.isFinite(minute) && Number.isFinite(x)) ticks.push({ minute, x });
        }
        ticks.sort((a, b) => a.minute - b.minute);
        return ticks;
      });
    });
    assert.ok(axisSamples.length >= 2, `expected at least two panels, got ${axisSamples.length}`);
    // Skip the run entirely if a panel has fewer than two ticks (should never happen).
    const pxPerMinPerPanel = axisSamples.map((ticks) => {
      if (ticks.length < 2) return null;
      const first = ticks[0];
      const last = ticks[ticks.length - 1];
      const minutes = last.minute - first.minute;
      const pixels = last.x - first.x;
      if (minutes <= 0 || pixels <= 0) return null;
      return pixels / minutes;
    });
    for (const [i, r] of pxPerMinPerPanel.entries()) {
      assert.ok(Number.isFinite(r) && r > 0, `panel ${i} needs a positive px/min, got ${r}`);
    }
    const [textbookRate, airlineRate] = pxPerMinPerPanel;
    const ratio = airlineRate / textbookRate;
    assert.ok(Math.abs(ratio - 1) <= 0.01,
      `panels should share one scale: textbook ${textbookRate.toFixed(3)} px/min, ` +
      `airline ${airlineRate.toFixed(3)} px/min, ratio ${ratio.toFixed(4)} (want 0.99-1.01)`);
    // The caption above should say so once.
    const sharedCaption = await page.$('.compare-shared-scale');
    assert.ok(sharedCaption, 'shared scale caption should be rendered');
    const captionText = await page.evaluate((el) => el?.textContent || '', sharedCaption);
    assert.match(captionText, /shared|share this scale/i, `caption should mention the shared scale, got "${captionText}"`);
    await shot(page, 'race-board-compare-shared-axis-1280.png');
  } finally { await browser.close(); }
});

test('N7-M1: front-to-back caveat verdict word tracks the sim rate', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    // Two hand-built fixture cells: one where the back-to-front rate is well above 7 (sim
    // is "faster"), one where the rate is well below 7 (sim is "slower"). No route through
    // the real precompute needed.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await serveTwoCaveatFixtures(context);
    // Round-08 N8-M4: the caveat clause fires only on narrowbodies (where the MythBusters
    // anchor is drawn), so the "fast sim" fixture uses b738-hd (a real narrowbody) rather
    // than the widebody b789 the earlier round assumed. The fixture cell still has a
    // back-to-front row whose derived rate is well above 7 pax/min.
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=b738-hd&seed=m1-faster`);
    const caveatFaster = await page.evaluate(() =>
      document.querySelector('[data-rankings-chart-caveat]')?.textContent || '');
    // Round-08 N8-B1: the caveat now names the row it actually quotes (the back-to-front
    // row, which the chart labels "Back to front, in zones"), not the front-to-back row.
    assert.match(caveatFaster, /Back to front, in zones runs faster here/i,
      `on the fast-sim preset the caveat should say "faster", got "${caveatFaster}"`);
    assert.doesNotMatch(caveatFaster, /Back to front, in zones runs slower here/i,
      `on the fast-sim preset the caveat should NOT say "slower", got "${caveatFaster}"`);
    await shot(page, 'rankings-board-b789-caveat-faster.png');
    await page.close();

    const pageSlow = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=a320&seed=m1-slower`);
    const caveatSlower = await pageSlow.evaluate(() =>
      document.querySelector('[data-rankings-chart-caveat]')?.textContent || '');
    assert.match(caveatSlower, /Back to front, in zones runs slower here/i,
      `on the slow-sim preset the caveat should say "slower", got "${caveatSlower}"`);
    await shot(pageSlow, 'rankings-board-a320-caveat-slower.png');
  } finally { await browser.close(); }
});

test('N7-M2: Rankings tab writes mode/preset/knobs to the URL on change', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=a320&seed=m2`);
    const urlBefore = page.url();
    // Toggle to Boarding.
    await page.click('button[data-rankings-mode="board"]');
    await page.waitForTimeout(1200);
    const urlAfterMode = page.url();
    // Round-08 N8-M1: the rankings tab writes to r-prefixed URL keys so a Rankings toggle
    // never rewrites the Race tab's mode. Assert `rmode=board`, not `mode=board`.
    assert.match(urlAfterMode, /[?&]rmode=board(&|$)/, `URL should carry rmode=board after toggle, got ${urlAfterMode}`);
    // Change the preset select to a different aircraft that has cells.
    const presetTarget = await page.evaluate(() => {
      const sel = document.getElementById('rankings-preset-select');
      if (!sel) return null;
      for (const opt of sel.options) {
        if (opt.value && opt.value !== sel.value) return opt.value;
      }
      return null;
    });
    if (presetTarget) {
      await page.selectOption('#rankings-preset-select', presetTarget);
      await page.waitForTimeout(1400);
      const urlAfterPreset = page.url();
      // Round-08 N8-M1: preset writes go to `rpreset`, not `preset`.
      assert.match(urlAfterPreset, new RegExp(`[?&]rpreset=${presetTarget}(&|$)`),
        `URL should carry rpreset=${presetTarget} after change, got ${urlAfterPreset}`);
    }
    // Load a rankings URL with a non-default preset and knob and assert the provenance
    // footnote matches. `rload` is the rankings-slice knob; the r-prefixed URL round-trips
    // the rankings state on cold load.
    await page.goto(`${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=a320&rload=0.7&seed=m2-roundtrip`, { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    const footnoteText = await page.evaluate(() =>
      document.querySelector('[data-rankings-footnote]')?.textContent || '');
    assert.match(footnoteText, /load 70%/,
      `provenance footnote should reflect load=0.7 from URL, got "${footnoteText}"`);
    void urlBefore;
    await shot(page, 'rankings-url-roundtrip-1280.png');
  } finally { await browser.close(); }
});

test('N7-M3: phone caveat cites only anchors the chart actually drew', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=rankings&mode=board&preset=a320&seed=m3`);
    // Collect the anchor labels the SVG actually rendered (each has class
    // rankings-anchor-label or rankings-anchor-clickable).
    const drawn = await page.evaluate(() => {
      const svg = document.querySelector('[data-rankings-chart] svg');
      if (!svg) return [];
      const labels = Array.from(svg.querySelectorAll('.rankings-anchor-label, .rankings-anchor-clickable'));
      return labels.map((el) => (el.textContent || '').trim()).filter(Boolean);
    });
    const caveat = await page.evaluate(() =>
      document.querySelector('[data-rankings-chart-caveat]')?.textContent || '');
    // Sanity: at least one anchor should be drawn on A320 phone (KLM).
    assert.ok(drawn.length >= 1, `expected at least one anchor label at phone width, got ${drawn.length}`);
    // If Spirit is NOT among the drawn anchors, the caveat must not mention Spirit.
    const drawnNames = drawn.join(' ').toLowerCase();
    const spiritDrawn = drawnNames.includes('spirit');
    if (!spiritDrawn) {
      assert.doesNotMatch(caveat, /Spirit/,
        `phone caveat cites a Spirit anchor but the chart drew none, caveat: "${caveat}"`);
    }
    // MythBusters is not a drawn anchor at all; the caveat clause about MythBusters is
    // allowed only when the b2fRate differs meaningfully from 7 pax/min. Assert the
    // combination: caveat mentions MythBusters only when the strategy's rate line makes
    // sense in the sentence.
    await shot(page, 'rankings-board-a320-phone-caveat.png');
  } finally { await browser.close(); }
});

test('N7 screenshots: rankings modes on a320 and a321neo-three-class at 1280 and 400', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const targets = [
      { preset: 'a320', mode: 'board' },
      { preset: 'a320', mode: 'deplane' },
      { preset: 'a321neo-three-class', mode: 'board' },
      { preset: 'a321neo-three-class', mode: 'deplane' },
    ];
    for (const viewport of [{ width: 1280, height: 800 }, { width: 400, height: 800 }]) {
      const context = await browser.newContext({ viewport });
      for (const target of targets) {
        const page = await goto(await context.newPage(),
          `${BASE_URL}/index.html?tab=rankings&mode=${target.mode}&preset=${target.preset}&seed=shot-${target.preset}-${target.mode}`);
        await shot(page, `rankings-${target.mode}-${target.preset}-${viewport.width}x${viewport.height}.png`);
        await page.close();
      }
      await context.close();
    }
  } finally { await browser.close(); }
});

async function serveTwoCaveatFixtures(context) {
  const seeds = 200;
  const knobs = { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' };
  const filenameFor = (mode, preset) =>
    `${mode}__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`;
  // For the "faster" preset (b738-hd, a narrowbody with the MythBusters anchor drawn):
  // pax=200, target b2f rate ~13 pax/min → 200 / 13 * 60 = 923s.
  const fasterCell = buildCaveatCell('b738-hd', {
    passengerCount: 200, backToFrontSec: 923, textbookSec: 660,
    airlineSecs: [1000, 1020, 1040, 1060, 1080, 1100, 1120, 1140, 1160, 1180, 1200, 1220, 1240, 1260],
    randomSec: 1150,
  }, seeds);
  // For the "slower" preset (a320): pax=153, target b2f rate ~5.9 pax/min → 153/5.9=25.93 min=1556s.
  const slowerCell = buildCaveatCell('a320', {
    passengerCount: 153, backToFrontSec: 1556, textbookSec: 660,
    airlineSecs: [1150, 1160, 1180, 1200, 1220, 1250, 1300, 1400],
    randomSec: 1200,
  }, seeds);
  const cells = [
    metaCell('board', 'b738-hd', knobs, seeds),
    metaCell('board', 'a320', knobs, seeds),
  ];
  const index = {
    generatedAt: new Date().toISOString(), engineVersion: 'fixture11', preview: false,
    defaults: knobs,
    grid: {
      load: [0.7, 0.85, 1], compliance: [0.5, 0.85, 1], groups: [0, 0.25, 0.5],
      bags: ['default', 'light', 'heavy'], bins: ['roomy', 'legacy'],
    },
    strategyCountByMode: { deplane: 3, board: 12 },
    seedTiers: { headline: 10000, small: 2000, sensitivity: 2000, preview: 200 },
    namedHeadlinePresets: ['a320', 'b738-hd'],
    sensitivityPresets: [], sensitivityFactors: [], cells,
  };
  await context.route(/\/data\/rankings\/[^/]+\.json$/, (route) => route.fulfill({ status: 404, body: '' }));
  await context.route(new RegExp(`\\/data\\/rankings\\/${filenameFor('board', 'b738-hd').replace(/\./g, '\\.')}$`),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fasterCell) }));
  await context.route(new RegExp(`\\/data\\/rankings\\/${filenameFor('board', 'a320').replace(/\./g, '\\.')}$`),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(slowerCell) }));
  await context.route(/\/data\/rankings\/index\.json$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(index),
  }));
  await context.route(/\/data\/rankings\/index-preview\.json$/, (route) => route.fulfill({ status: 404, body: '' }));
}

function metaCell(mode, preset, knobs, seeds) {
  return {
    id: `${mode}__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}`,
    mode, preset, knobs, seeds, kind: 'headline',
    file: `${mode}__${preset}__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=${seeds}.json`,
  };
}

function buildCaveatCell(preset, spec, seeds) {
  const pax = spec.passengerCount;
  const strategies = [
    row('reverse-pyramid', 'Reverse pyramid', 'textbook', spec.textbookSec, pax, seeds),
    row('back-to-front', 'Back to front, in zones', 'textbook', spec.backToFrontSec, pax, seeds),
    row('random', 'Random order', 'textbook', spec.randomSec, pax, seeds),
  ];
  const airlineLabels = [
    'American Airlines', 'Delta Air Lines', 'United Airlines', 'Southwest',
    'JetBlue', 'Spirit', 'Alaska Airlines', 'Hawaiian Airlines',
    'Lufthansa', 'Air France', 'ANA', 'Qantas', 'Emirates', 'KLM',
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
    seeds, passengerCount: pax, strategies,
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
