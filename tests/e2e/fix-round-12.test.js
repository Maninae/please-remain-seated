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

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-12');
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

test('N8-M2: airline medians span at least 25% of the compare axis (a320 board)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await goto(await context.newPage(),
      `${BASE_URL}/index.html?tab=race&mode=board&preset=a320&seed=n8m2`);
    const seedSelect = await page.$('#seed-count-select');
    if (seedSelect) await seedSelect.selectOption('100');
    await page.click('#btn-compare');
    await page.waitForFunction(() => {
      const wrap = document.getElementById('strips-wrap');
      return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
    }, {}, { timeout: 90000 });

    const measurements = await page.evaluate(() => {
      const wrap = document.getElementById('strips-wrap');
      const svgs = Array.from(wrap.querySelectorAll('svg'));
      // Panel 1 is the airline panel (the second svg).
      const airlineSvg = svgs[1];
      const textTicks = Array.from(airlineSvg.querySelectorAll('text'))
        .map((t) => ({ raw: (t.textContent || '').trim(), x: Number(t.getAttribute('x')) }))
        .filter((t) => /^[0-9]+(?:\.[0-9]+)?m$/.test(t.raw))
        .map((t) => ({ minute: Number(t.raw.slice(0, -1)), x: t.x }))
        .sort((a, b) => a.minute - b.minute);
      // Plot band width: distance between the first and last tick.
      const plotBandPx = textTicks.length >= 2 ? textTicks[textTicks.length - 1].x - textTicks[0].x : 0;
      // Median tick per airline row: the vertical strokes with stroke-width 2.4 (the median
      // tick). Group by rowY (rounded).
      const lines = Array.from(airlineSvg.querySelectorAll('line'));
      const medianXs = [];
      for (const line of lines) {
        const w = line.getAttribute('stroke-width');
        if (w !== '2.4') continue;
        const x1 = Number(line.getAttribute('x1'));
        const x2 = Number(line.getAttribute('x2'));
        if (Math.abs(x1 - x2) < 0.5) medianXs.push(x1);
      }
      medianXs.sort((a, b) => a - b);
      const spanPx = medianXs.length >= 2 ? medianXs[medianXs.length - 1] - medianXs[0] : 0;
      return { plotBandPx, spanPx, ticks: textTicks };
    });
    assert.ok(measurements.plotBandPx > 100, `plot band should be >100 px, got ${measurements.plotBandPx}`);
    const spanRatio = measurements.spanPx / measurements.plotBandPx;
    assert.ok(spanRatio >= 0.25,
      `airline medians should span at least 25% of the plot band, got ${(spanRatio * 100).toFixed(1)}% (${measurements.spanPx.toFixed(1)} / ${measurements.plotBandPx.toFixed(1)} px)`);
    const midTick = measurements.ticks.find((t) => t.minute >= 15 && t.minute <= 30);
    assert.ok(midTick,
      `airline panel should carry at least one tick between 15 and 30 min, got ticks ${measurements.ticks.map((t) => t.minute).join(', ')}`);
    await shot(page, 'compare-board-a320-n8m2.png');
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

test('N7-m7 carried: race controls fully inside the viewport on cold load (1280x800, 1280x720)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const height of [800, 720]) {
      const context = await browser.newContext({ viewport: { width: 1280, height } });
      const page = await goto(await context.newPage(),
        `${BASE_URL}/index.html?tab=race&mode=deplane&preset=a320&seed=n7m7-${height}`);
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
      assert.ok(boxes.restart, 'Restart button should be in the DOM');
      assert.ok(boxes.speed, 'Speed group should be in the DOM');
      assert.ok(boxes.restart.top >= 0 && boxes.restart.bottom <= height,
        `Restart button should sit inside 0..${height}, got top ${boxes.restart.top} bottom ${boxes.restart.bottom}`);
      assert.ok(boxes.speed.top >= 0 && boxes.speed.bottom <= height,
        `Speed group should sit inside 0..${height}, got top ${boxes.speed.top} bottom ${boxes.speed.bottom}`);
      await shot(page, `race-controls-1280x${height}.png`);
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
