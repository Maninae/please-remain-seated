/**
 * End-to-end smoke test.
 *
 * Loads the page from a running http://localhost:5197 (assumed already up: python3 -m http.server 5197),
 * waits for the race to be alive, asserts both clocks advance, switches strategies and asserts the
 * race resets, runs a 10-seed compare and asserts strips render, toggles Board mode, and takes
 * screenshots at 1280x800 and 400x800 into tests/e2e/artifacts/.
 *
 * Uses playwright (already in devDependencies). Skips itself with a warning if playwright cannot
 * connect (e.g. the browser binary is not installed) so this test never blocks CI on a fresh clone.
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

test('page smoke: race runs, switches, compares, screenshots', async (t) => {
  const browser = await safeLaunch();
  if (!browser) {
    t.diagnostic('playwright chromium not available; skipping');
    return;
  }
  const consoleErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=aisle-first&seed=e2e-1`;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('[data-canvas="a"]', { timeout: 10000 });

    // Wait for the race to be running: both clocks should have moved past 0:00 within a few seconds.
    const clockA0 = await page.$eval('[data-clock="a"]', (el) => el.textContent);
    const clockB0 = await page.$eval('[data-clock="b"]', (el) => el.textContent);
    // Speed defaults to 15x; the initial clock should tick to something non-zero within ~1s.
    await page.waitForFunction(() => {
      const a = document.querySelector('[data-clock="a"]').textContent;
      const b = document.querySelector('[data-clock="b"]').textContent;
      return a !== '0:00' && b !== '0:00';
    }, { timeout: 8000 });

    const clockA1 = await page.$eval('[data-clock="a"]', (el) => el.textContent);
    const clockB1 = await page.$eval('[data-clock="b"]', (el) => el.textContent);
    assert.notEqual(clockA1, '0:00', 'clock A should advance');
    assert.notEqual(clockB1, '0:00', 'clock B should advance');

    // Mid-race screenshot: desktop.
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'page-desktop-mid-race.png'), fullPage: true });

    // Switch strategy in lane A and assert the clock resets to 0:00.
    await page.selectOption('#strategy-a', 'row-by-row');
    await page.waitForFunction(() => document.querySelector('[data-clock="a"]').textContent === '0:00', { timeout: 3000 });

    // Compare: run a 10-seed batch on the current mode. Add a hidden option temporarily.
    await page.evaluate(() => {
      const select = document.getElementById('seed-count-select');
      const option = document.createElement('option');
      option.value = '10'; option.textContent = '10 (test)';
      select.appendChild(option); select.value = '10';
    });
    await page.click('#btn-compare');
    // Wait until the strips <svg> shows up (worker done).
    await page.waitForFunction(() => {
      const wrap = document.getElementById('strips-wrap');
      return wrap && wrap.querySelector('svg');
    }, { timeout: 60000 });

    // Take screenshot after compare renders.
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'page-desktop-after-compare.png'), fullPage: true });

    // Toggle Board mode and assert selects change to boarding strategies.
    await page.click('.masthead .segmented .seg[data-mode="board"]');
    await page.waitForFunction(() => {
      const options = Array.from(document.querySelector('#strategy-a').options).map((o) => o.value);
      return options.includes('random') && options.includes('steffen');
    }, { timeout: 3000 });

    // Mobile screenshot (400x800), vertical cabin cards.
    const mobileContext = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 2 });
    const mpage = await mobileContext.newPage();
    mpage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`[mobile] ${message.text()}`); });
    mpage.on('pageerror', (error) => consoleErrors.push(`[mobile pageerror] ${error.message}`));
    await mpage.goto(url, { waitUntil: 'load', timeout: 30000 });
    await mpage.waitForSelector('[data-canvas="a"]', { timeout: 10000 });
    await mpage.waitForTimeout(1000);
    await mpage.screenshot({ path: path.join(ARTIFACTS_DIR, 'page-mobile-mid-race.png'), fullPage: true });

    // The suite fails if there were any console errors we did not expect.
    assert.deepEqual(consoleErrors.filter(nonBenignError), [], 'no console errors');
  } finally {
    await browser.close();
  }
});

function nonBenignError(message) {
  // Filter out messages we know are safe to see.
  if (/favicon/i.test(message)) return false;
  if (/net::ERR_FAILED/i.test(message) && /media\/og\.png/i.test(message)) return false;
  return true;
}
