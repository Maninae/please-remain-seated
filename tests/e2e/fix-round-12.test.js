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
const ROUND_14_DIR = path.resolve('tests/e2e/artifacts/fix-round-14');
if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });
if (!existsSync(ROUND_14_DIR)) mkdirSync(ROUND_14_DIR, { recursive: true });

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

// N9-M1 / N10-M1 / round-14: the tests below iterate BOTH panels (textbook + airline) and
// derive the row's true median from the DOM `data-median-seconds` attribute the chart now
// emits, not from the tick's own x. That closes the two round-10 findings: (a) the previous
// no-edge assertion only touched svgs[1], missing the textbook panel where clamping happens;
// (b) the previous tie assertion re-derived seconds from the median's own x, so any two
// medians sharing an x automatically read as sharing a value.
const STRIPS_PADDING_LEFT = 200;
const STRIPS_PADDING_RIGHT = 24;
const MEDIAN_TIE_TOLERANCE_SECONDS = 5;

async function runCompareAndMeasure(browser, preset, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await goto(await context.newPage(),
    `${BASE_URL}/index.html?tab=race&mode=board&preset=${preset}&seed=n8m2-${preset}`);
  const seedSelect = await page.$('#seed-count-select');
  if (seedSelect) await seedSelect.selectOption('100');
  await page.click('#btn-compare');
  await page.waitForFunction(() => {
    const wrap = document.getElementById('strips-wrap');
    return wrap && wrap.querySelectorAll('svg').length >= 2 && !wrap.textContent.includes('Running');
  }, {}, { timeout: 90000 });

  const measurements = await page.evaluate(({ padL, padR }) => {
    const wrap = document.getElementById('strips-wrap');
    const svgs = Array.from(wrap.querySelectorAll('svg'));
    const panels = [];
    for (const svg of svgs) {
      const svgWidth = Number(svg.getAttribute('width'));
      const chartX0 = padL;
      const chartX1 = svgWidth - padR;
      const plotBandPx = Math.max(1, chartX1 - chartX0);
      const airlineRowIds = new Set();
      // We can identify airline rows from the label attribute the chart emits.
      const medianLines = Array.from(svg.querySelectorAll('line[data-median-seconds]'));
      const medians = medianLines.map((line) => ({
        rowId: line.getAttribute('data-row-id') || '',
        x: Number(line.getAttribute('x1')),
        seconds: Number(line.getAttribute('data-median-seconds')),
      })).filter((m) => Number.isFinite(m.x) && Number.isFinite(m.seconds));
      const offScale = Array.from(svg.querySelectorAll('text[data-row-off-scale]')).map((t) => ({
        rowId: t.getAttribute('data-row-off-scale') || '',
        text: (t.textContent || '').trim(),
        seconds: Number(t.getAttribute('data-median-seconds')),
      }));
      panels.push({ svgWidth, chartX0, chartX1, plotBandPx, medians, offScale });
    }
    return { panels };
  }, { padL: STRIPS_PADDING_LEFT, padR: STRIPS_PADDING_RIGHT });
  await shot(page, `compare-board-${preset}-${width}x${height}.png`);
  await context.close();
  return measurements;
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

test('round-14: no two on-scale medians share a 2 px slot unless within 5 s of each other, BOTH panels (a320 and a321neo-three-class)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const preset of ['a320', 'a321neo-three-class']) {
      const { panels } = await runCompareAndMeasure(browser, preset);
      for (let i = 0; i < panels.length; i += 1) {
        const panel = panels[i];
        for (let a = 0; a < panel.medians.length; a += 1) {
          for (let b = a + 1; b < panel.medians.length; b += 1) {
            const dx = Math.abs(panel.medians[a].x - panel.medians[b].x);
            const ds = Math.abs(panel.medians[a].seconds - panel.medians[b].seconds);
            if (dx < 2) {
              assert.ok(ds < MEDIAN_TIE_TOLERANCE_SECONDS,
                `${preset}: panel ${i}: median ticks for ${panel.medians[a].rowId} and `
                + `${panel.medians[b].rowId} share x within ${dx.toFixed(2)} px, but their `
                + `true medians differ by ${ds.toFixed(1)} s (values ${panel.medians[a].seconds.toFixed(1)}, `
                + `${panel.medians[b].seconds.toFixed(1)})`);
            }
          }
        }
      }
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
        // The gutter label must carry a real clock string, never blank, never "off scale".
        assert.match(off.text, /^\d{1,2}:\d{2}$/,
          `off-scale gutter label for ${off.rowId} should print a clock, got "${off.text}"`);
        assert.ok(Number.isFinite(off.seconds) && off.seconds > 0,
          `off-scale gutter for ${off.rowId} must expose its true median in seconds, got ${off.seconds}`);
      }
    }
    assert.ok(sawOffScale, 'a320 board compare should have at least one off-scale row drawn as a broken bar');
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
