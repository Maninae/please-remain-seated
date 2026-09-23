/**
 * End-to-end smoke test.
 *
 * Assumes the local dev server is up on http://localhost:5197. Loads the page in headless
 * Chromium, walks the fixes from round 1 of the critic pass, and asserts they hold:
 *   - Race runs, clocks advance, mode toggle works, screenshots taken.
 *   - Range inputs and checkbox use the ink accent, not browser blue (M1).
 *   - Legend visible at phone width (B3).
 *   - Compare batch reports a two-doors median clearly below free-for-all (B1).
 *   - Time-split at finish shows a shorter bar for the faster lane (B2).
 *   - Loser's margin line reads "finished X later" (M11).
 *   - URL round-trips every knob (M10).
 *   - Finish card renders with a copy-link button.
 *
 * The suite skips itself if playwright cannot connect, so it never blocks CI on a fresh clone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts');

if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function safeLaunch() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    return null;
  }
}

test('page smoke: race, styles, and mode-toggle', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  const consoleErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=aisle-first&seed=e2e-1&preset=a320`;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('[data-canvas="a"]');

    // Race is alive: both clocks tick within a couple of seconds at the default 15x speed.
    await page.waitForFunction(() => {
      const a = document.querySelector('[data-clock="a"]').textContent;
      const b = document.querySelector('[data-clock="b"]').textContent;
      // clocks either advance past 0:00, count down from a negative, or are already past staging
      return a !== '0:00' && b !== '0:00';
    }, { timeout: 8000 });

    // M1: range inputs and checkbox use the ink accent, not browser blue.
    const sliderAccent = await page.$eval('#load-slider', (el) => getComputedStyle(el).accentColor);
    assert.match(sliderAccent, /rgb\(31[,\s]+42[,\s]+51\)/, 'load slider accent should be ink');
    const checkboxAccent = await page.$eval('#sound-toggle', (el) => getComputedStyle(el).accentColor);
    assert.match(checkboxAccent, /rgb\(31[,\s]+42[,\s]+51\)/, 'sound toggle accent should be ink');

    // M10: the URL carries every knob after a store change.
    await page.evaluate(() => {
      const slider = document.getElementById('politeness-slider');
      slider.value = '0.6';
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const params = new URL(page.url()).searchParams;
    for (const key of ['mode', 'a', 'b', 'seed', 'preset', 'bins', 'load', 'compliance', 'families', 'politeness', 'distracted', 'prep', 'bag0', 'bag1', 'bag2']) {
      assert.ok(params.get(key) != null, `URL should carry knob "${key}"`);
    }

    // Compare heading matches default seed count.
    const heading = await page.$eval('#compare-heading', (el) => el.textContent);
    assert.equal(heading, 'Run it 100 times', 'compare heading matches default seed count');

    // Mid-race screenshot.
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'page-desktop-mid-race.png'), fullPage: true });

    // Toggle Board mode.
    await page.click('.masthead .segmented .seg[data-mode="board"]');
    await page.waitForFunction(() => {
      const options = Array.from(document.querySelector('#strategy-a').options).map((o) => o.value);
      return options.includes('random') && options.includes('steffen');
    }, { timeout: 3000 });

    // Phone screenshot.
    const mobile = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });
    const mpage = await mobile.newPage();
    mpage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[m] ${m.text()}`); });
    mpage.on('pageerror', (e) => consoleErrors.push(`[m pageerror] ${e.message}`));
    await mpage.goto(url, { waitUntil: 'load' });
    await mpage.waitForSelector('[data-canvas="a"]');
    await mpage.waitForTimeout(1000);
    // B3: legend visible at phone width under lane A.
    const legendDisplay = await mpage.$eval('.cabin-card[data-lane="a"] .race-legend', (el) => getComputedStyle(el).display);
    assert.notEqual(legendDisplay, 'none', 'race legend must be visible on phone');
    await mpage.screenshot({ path: path.join(ARTIFACTS_DIR, 'page-mobile-mid-race.png'), fullPage: true });

    assert.deepEqual(consoleErrors.filter(nonBenignError), [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('compare batch: two doors saves at least 90 seconds over free-for-all (B1)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=two-doors&seed=b1&preset=a320`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');

    // Add a "20 (test)" seed option to keep the batch quick.
    await page.evaluate(() => {
      const select = document.getElementById('seed-count-select');
      const option = document.createElement('option');
      option.value = '20'; option.textContent = '20 (test)';
      select.appendChild(option); select.value = '20';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#btn-compare');
    await page.waitForFunction(() => {
      const wrap = document.getElementById('strips-wrap');
      return wrap && wrap.querySelector('svg');
    }, { timeout: 120000 });
    await page.waitForTimeout(500);
    const finding = await page.$eval('#strips-wrap svg text', (el) => el.textContent);
    // The strategy at the top of the sorted strips must be two-doors, saving many seconds.
    assert.ok(/Two doors/.test(finding), `strips title should mention Two doors: "${finding}"`);
    assert.ok(/saves/.test(finding), `strips title should say saves: "${finding}"`);
    // A saving of at least 1:30 (well over the "0.00" bug we started with).
    const match = /saves (\d+):(\d{2})/.exec(finding);
    assert.ok(match, `strips title should include a saving: "${finding}"`);
    const savedSeconds = Number(match[1]) * 60 + Number(match[2]);
    assert.ok(savedSeconds >= 90, `two-doors should save at least 90s over free-for-all, got ${savedSeconds}s`);
  } finally {
    await browser.close();
  }
});

test('finish card and time-split shared scale (B2, M11)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Use two-doors vs free-for-all so the finish times are meaningfully different.
    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=two-doors&seed=b2&preset=a320&speed=60`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    await page.click('[data-speed="60"]');

    await page.waitForFunction(() => document.querySelectorAll('.cabin-card.winner').length >= 1, { timeout: 60000 });
    await page.waitForTimeout(4000);   // give both lanes time to finish

    // M11: the loser's margin cell shows "finished X later", never empty.
    const laneAMargin = await page.$eval('[data-margin="a"]', (el) => el.textContent);
    const laneBMargin = await page.$eval('[data-margin="b"]', (el) => el.textContent);
    const hasBehindText = /finished \d+:\d{2} later/.test(laneAMargin)
      || /finished \d+:\d{2} later/.test(laneBMargin);
    const hasAheadText = /\d+:\d{2} ahead/.test(laneAMargin) || /\d+:\d{2} ahead/.test(laneBMargin);
    assert.ok(hasAheadText, 'the winner should carry "X:YZ ahead"');
    assert.ok(hasBehindText, 'the loser should carry "finished X:YZ later"');

    // Finish card is rendered with the copy-link button.
    const finishHidden = await page.$eval('#finish-card', (el) => el.hidden);
    assert.equal(finishHidden, false, 'finish card should be visible after both lanes finish');
    const hasCopyButton = await page.$('#finish-card .actions button.primary');
    assert.ok(hasCopyButton, 'finish card should include a Copy link button');

    // B2: shared scale — the faster lane's bar must draw shorter than the slower lane's bar.
    // Get the sum of segment widths for each lane's <svg>.
    const laneWidths = await page.evaluate(() => {
      function sum(letter) {
        const svg = document.querySelector(`[data-split-svg="${letter}"]`);
        if (!svg) return 0;
        let total = 0;
        for (const rect of svg.querySelectorAll('rect[fill]:not([fill="none"]):not([stroke-dasharray])')) {
          const fill = rect.getAttribute('fill');
          if (fill === '#f4efe6') continue;   // ghost track
          const width = Number(rect.getAttribute('width'));
          if (Number.isFinite(width)) total += width;
        }
        return total;
      }
      return { a: sum('a'), b: sum('b') };
    });
    // Two doors is the faster lane; its bar should be visibly shorter.
    assert.ok(laneWidths.b < laneWidths.a * 0.95, `two-doors bar (${laneWidths.b}) should be shorter than free-for-all bar (${laneWidths.a})`);
  } finally {
    await browser.close();
  }
});

test('finish scroll and heat view (NEW-B1 and worst-seats)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    // Test at 1280x800 exactly — this is the viewport the critic caught the below-fold bug at.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=two-doors&seed=r2-b1&preset=a320&speed=60`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    await page.click('[data-speed="60"]');

    await page.waitForFunction(() => document.querySelectorAll('.cabin-card.winner').length >= 1, { timeout: 60000 });
    await page.waitForTimeout(3500);

    // NEW-B1: the finish card must be fully in view at 1280x800 after finish scroll.
    const cardVisibility = await page.evaluate(() => {
      const card = document.getElementById('finish-card');
      if (!card || card.hidden) return { visible: false, pctVisible: 0 };
      const rect = card.getBoundingClientRect();
      const clamp = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return { visible: rect.bottom > 0 && rect.top < window.innerHeight, pctVisible: (clamp / rect.height) * 100 };
    });
    assert.ok(cardVisibility.visible, 'finish card should be in the 1280x800 viewport after finish');
    assert.ok(cardVisibility.pctVisible >= 95, `finish card should be at least 95% visible, got ${Math.round(cardVisibility.pctVisible)}%`);

    // Heat view: after finish, the winning cabin canvas must be filled with heat colors on its
    // seats. We assert the seat fills sit on the ochre ramp (not the neutral seatFill hex).
    // Reading a canvas 2d pixel through page.evaluate is safe here (same origin).
    const heatSample = await page.evaluate(() => {
      const canvas = document.querySelector('[data-canvas="b"]');
      const ctx = canvas.getContext('2d');
      // Sample a stripe of pixels along the winning cabin's canvas at ~1/3 down. Any pixel
      // whose r channel is well above g+b is on the paper/ochre axis (warm), not the aisle blue.
      const width = canvas.width;
      const height = canvas.height;
      const strip = ctx.getImageData(0, Math.floor(height * 0.35), width, 1);
      const pixels = strip.data;
      let warmCount = 0;
      let paperCount = 0;
      const warmHexes = new Set();
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r > g && g > b && r - b > 40) warmCount += 1;
        if (r >= 240 && g >= 235 && b >= 220) paperCount += 1;
        if (warmHexes.size < 24) warmHexes.add(`${r},${g},${b}`);
      }
      return { warmCount, paperCount, sampleHexes: [...warmHexes] };
    });
    assert.ok(heatSample.warmCount > 20, `heat view should paint many warm pixels on the winning cabin, got ${heatSample.warmCount}`);

    // The heat legend caption is visible on both cabins.
    const captions = await page.evaluate(() => {
      const a = document.querySelector('.cabin-card[data-lane="a"] .race-legend');
      const b = document.querySelector('.cabin-card[data-lane="b"] .race-legend');
      return {
        a: a && a.classList.contains('heat-caption') ? a.textContent : '',
        b: b && b.classList.contains('heat-caption') ? b.textContent : '',
      };
    });
    assert.ok(/Worst/.test(captions.a), `lane A heat caption should say Worst ...: "${captions.a}"`);
    assert.ok(/Worst/.test(captions.b), `lane B heat caption should say Worst ...: "${captions.b}"`);

    // Heat toggle: clicking it removes the heat and re-paints seats with the seatFill neutral.
    await page.click('#btn-heat-toggle');
    await page.waitForTimeout(400);
    const heatOffSample = await page.evaluate(() => {
      const canvas = document.querySelector('[data-canvas="b"]');
      const ctx = canvas.getContext('2d');
      const strip = ctx.getImageData(0, Math.floor(canvas.height * 0.35), canvas.width, 1);
      const pixels = strip.data;
      let ochreCount = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r > g && g > b && r - b > 60 && r < 230) ochreCount += 1;
      }
      return ochreCount;
    });
    assert.ok(heatOffSample < heatSample.warmCount * 0.6, `heat off should have far fewer ochre pixels (${heatOffSample} vs ${heatSample.warmCount})`);
  } finally {
    await browser.close();
  }
});

test('moving and blocked passengers use different colours (NEW-M1)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Import the theme module through the page so the values are the actual production build.
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
    const theme = await page.evaluate(async () => {
      const mod = await import('/js/render/theme.js');
      return { moving: mod.THEME.moving, blocked: mod.THEME.blocked, bag: mod.THEME.bag };
    });
    assert.ok(theme.moving, 'THEME.moving must be defined');
    assert.ok(theme.blocked, 'THEME.blocked must be defined');
    assert.notEqual(theme.moving.toLowerCase(), theme.blocked.toLowerCase(),
      `NEW-M1: THEME.moving (${theme.moving}) and THEME.blocked (${theme.blocked}) must differ`);
    // Blocked must be an ink-gray, not a green. Check it is far enough from the moving hex.
    const rgbDiff = colorDistance(theme.moving, theme.blocked);
    assert.ok(rgbDiff > 60, `blocked hue must be visibly distinct from moving, got rgb distance ${rgbDiff.toFixed(1)}`);
  } finally {
    await browser.close();
  }
});

function colorDistance(a, b) {
  const parse = (hex) => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [ra, ga, ba] = parse(a);
  const [rb, gb, bb] = parse(b);
  return Math.sqrt((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2);
}

test('og image is generated (NEW-B2)', async (t) => {
  const { statSync } = await import('node:fs');
  try {
    const stat = statSync(path.resolve('media/og.png'));
    assert.ok(stat.size > 5000, `media/og.png should exist and be >5KB, got ${stat.size}`);
  } catch (error) {
    t.diagnostic('media/og.png missing — run `npm run og`');
    assert.fail('media/og.png is required for the og:image tag (NEW-B2)');
  }
});

function nonBenignError(message) {
  if (/favicon/i.test(message)) return false;
  if (/net::ERR_FAILED/i.test(message) && /media\/og\.png/i.test(message)) return false;
  return true;
}
