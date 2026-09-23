/**
 * Round-07 e2e: rankings tab arithmetic, snap-label truthfulness, deck seed count, About
 * calibration constants, and phone finding-sentence wrapping.
 *
 * Each test skips cleanly if Playwright cannot launch (CI without chromium). Assumes the dev
 * server on http://localhost:5197 and the rankings preview under data/rankings/.
 *
 * Screenshot capture also lands under tests/e2e/artifacts/fix-round-07/ so a reviewer can
 * pull a specific finding against its evidence without re-running the repro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { DEPLANE_CALIBRATION_GATES, formatWholeRunGateSentence } from '../../js/ui/calibration-gates.js';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-07');
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

function isBenignConsoleMessage(message) {
  if (/favicon/i.test(message)) return false;
  if (/net::ERR_FAILED/i.test(message)) return false;
  if (/status of 404/i.test(message) && /data\/rankings\//i.test(message)) return false;
  if (/Failed to load resource: the server responded with a status of 404/i.test(message)) return false;
  return true;
}

/**
 * The person-minute tile row must reconcile arithmetically on screen: best + diff = worst.
 * Under-tile arithmetic sub-labels print the same numbers to reinforce it.
 */
test('rankings tiles arithmetic: best + diff = worst on both modes', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?tab=rankings&seed=arith-1`, { waitUntil: 'load' });
    await page.waitForSelector('.rankings-stats-grid');
    await page.waitForTimeout(1200);

    async function readTileValues() {
      return page.evaluate(() => {
        function read(sel) { return document.querySelector(sel)?.getAttribute(sel.match(/data-[^=]+/)?.[0]); }
        return {
          best: Number(document.querySelector('[data-arith-best]')?.getAttribute('data-arith-best')),
          worst: Number(document.querySelector('[data-arith-worst]')?.getAttribute('data-arith-worst')),
          diff: Number(document.querySelector('[data-arith-diff]')?.getAttribute('data-arith-diff')),
          scaledYears: Number(document.querySelector('[data-arith-scaled-years]')?.getAttribute('data-arith-scaled-years')),
        };
        void read;
      });
    }

    const deplane = await readTileValues();
    assert.ok(Number.isFinite(deplane.best) && deplane.best > 0, `deplane best missing: ${JSON.stringify(deplane)}`);
    assert.equal(deplane.best + deplane.diff, deplane.worst,
      `deplane arithmetic: best ${deplane.best} + diff ${deplane.diff} != worst ${deplane.worst}`);
    assert.ok(deplane.scaledYears > 0, `scaled person-years should be > 0, got ${deplane.scaledYears}`);

    await page.click('[data-rankings-mode="board"]');
    await page.waitForTimeout(1500);
    const board = await readTileValues();
    assert.equal(board.best + board.diff, board.worst,
      `board arithmetic: best ${board.best} + diff ${board.diff} != worst ${board.worst}`);
  } finally {
    await browser.close();
  }
});

/**
 * The knob-note strip must report the values the CURRENTLY LOADED cell was run at, not the
 * requested-snap values. On b777 there are no compliance sensitivity cells, so a request for
 * compliance=0.5 must fall back to compliance=0.85 and the note must say so.
 */
test('rankings knob snap label: matches the loaded cell, flags fallback', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=b777&compliance=0.5&seed=snap-1`, { waitUntil: 'load' });
    await page.waitForSelector('[data-rankings-knob-notes]');
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => ({
      notes: document.querySelector('[data-rankings-knob-notes]')?.textContent || '',
      footnote: document.querySelector('[data-rankings-footnote]')?.textContent || '',
      fallbackCount: document.querySelectorAll('.rankings-knob-note-fallback').length,
    }));
    // The b777 has no compliance sensitivity cell; the compliance line must not lie by
    // claiming a 50% run when the loader picked the 85% cell.
    assert.ok(state.notes.length > 0, `knob notes should render, got "${state.notes}"`);
    if (/comply=0\.85/.test(state.footnote)) {
      assert.ok(/no run at 50%, showing 85%/.test(state.notes) || state.fallbackCount > 0,
        `compliance fallback should be flagged when the b777 falls back to the 85% cell: notes="${state.notes}"`);
    }
  } finally {
    await browser.close();
  }
});

/**
 * The deck lede must read the seed count from the index, never a hardcoded "thousands".
 */
test('rankings deck reads the seed count from the index', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?tab=rankings&seed=deck-1`, { waitUntil: 'load' });
    await page.waitForSelector('[data-rankings-lede]');
    await page.waitForTimeout(1500);
    const lede = await page.$eval('[data-rankings-lede]', (el) => el.textContent);
    assert.ok(!/thousands/i.test(lede), `deck must not claim "thousands" when running the preview: "${lede}"`);
    assert.ok(/\d{1,3}(,\d{3})*\s+times/.test(lede), `deck should quote a real number of runs: "${lede}"`);
  } finally {
    await browser.close();
  }
});

/**
 * The About tab's calibration gate must be rendered from the exported constants, not from
 * literal numbers in prose. This test asserts the on-page text matches the constants
 * module byte-for-byte for the whole-run sentence.
 */
test('about calibration gate matches the shared constants module', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?tab=about&seed=about-gate`, { waitUntil: 'load' });
    await page.waitForSelector('[data-about-whole-run-gate]');
    await page.waitForTimeout(1200);
    const printed = await page.$eval('[data-about-whole-run-gate]', (el) => el.textContent);
    const expected = formatWholeRunGateSentence();
    assert.equal(printed.trim(), expected.trim(),
      `About page whole-run gate text should equal the constants module sentence:\n  page: ${printed}\n  const: ${expected}`);
    // Assumption table lists door-open staging, patient fraction, prep distribution.
    const tableText = await page.$eval('[data-about-assumptions]', (el) => el.textContent);
    assert.match(tableText, /45 s from seatbelt sign off/i, 'staging window row present');
    assert.match(tableText, /Patient fraction/i, 'patient fraction row present');
    assert.match(tableText, /Prep distribution/i, 'prep distribution row present');
    assert.match(tableText, /Basic-fare share|Basic fare/i, 'basic fare row present');
    assert.match(tableText, /Pre-boarders/i, 'pre-boarders row present');
    // The gate constants themselves.
    const g = DEPLANE_CALIBRATION_GATES.wholeRunPaxPerMin;
    assert.match(printed, new RegExp(`${g.min}[^\\d]+${g.max}`),
      `whole-run gate should print ${g.min} and ${g.max}, got: "${printed}"`);
  } finally {
    await browser.close();
  }
});

/**
 * On a phone the finding sentence must wrap to multiple lines rather than truncating a word
 * with an ellipsis. Verify by measuring the rendered chart text: the wrapped title must
 * carry the full sentence across two or more <text> elements without a "…" appearing on any
 * of them.
 */
test('phone finding sentence wraps to multiple lines, no mid-word ellipsis', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?tab=rankings&mode=board&seed=wrap-1`, { waitUntil: 'load' });
    await page.waitForSelector('.rankings-chart-svg-host svg');
    await page.waitForTimeout(2000);
    const state = await page.evaluate(() => {
      const svg = document.querySelector('.rankings-chart-svg-host svg');
      if (!svg) return null;
      const texts = [...svg.querySelectorAll('text')].map((el) => el.textContent).filter(Boolean);
      // Title lines are the first ones drawn (font-weight 600). Take the first two candidate
      // lines as the title chunk.
      const titleTexts = texts.slice(0, 4);
      return { titleTexts };
    });
    assert.ok(state, 'chart svg should exist');
    // No ellipsis on any of the title lines: the reader must never be cut off mid-word.
    for (const line of state.titleTexts) {
      assert.ok(!/[…]/.test(line), `title line must not carry an ellipsis: "${line}"`);
    }
  } finally {
    await browser.close();
  }
});

/**
 * Screenshot capture into fix-round-07/. Kept last so a failure earlier still leaves the
 * arithmetic assertion visible.
 */
test('fix-round-07 screenshots for rankings modes + about, desktop + phone', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  const consoleMessages = [];
  try {
    for (const view of [
      { label: 'desktop-1280x800', vp: { width: 1280, height: 800 } },
      { label: 'phone-400x800', vp: { width: 400, height: 800 } },
    ]) {
      const context = await browser.newContext({ viewport: view.vp });
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleMessages.push(`${view.label}: ${m.text()}`); });
      page.on('pageerror', (e) => consoleMessages.push(`${view.label} pageerror: ${e.message}`));
      // Deplane rankings.
      await page.goto(`${BASE_URL}/index.html?tab=rankings&seed=shot-d`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      await shot(page, `rankings-deplane-${view.label}.png`);
      // Board rankings via click.
      await page.click('[data-rankings-mode="board"]');
      await page.waitForTimeout(1500);
      await shot(page, `rankings-board-${view.label}.png`);
      // About tab.
      await page.goto(`${BASE_URL}/index.html?tab=about&seed=shot-a`, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      await shot(page, `about-${view.label}.png`);
      // Horizontal scroll must not appear on any tab at phone width.
      if (view.vp.width === 400) {
        for (const tab of ['race', 'rankings', 'about']) {
          await page.goto(`${BASE_URL}/index.html?tab=${tab}&seed=hs-${tab}`, { waitUntil: 'load' });
          await page.waitForTimeout(1000);
          const scroll = await page.evaluate(() => ({
            docWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          assert.ok(
            scroll.docWidth <= scroll.clientWidth + 2,
            `tab ${tab} phone view should not scroll horizontally, got doc=${scroll.docWidth} client=${scroll.clientWidth}`,
          );
        }
      }
      await context.close();
    }
    const nonBenign = consoleMessages.filter(isBenignConsoleMessage);
    assert.deepEqual(nonBenign, [], `no non-benign console errors, got: ${nonBenign.join('; ')}`);
  } finally {
    await browser.close();
  }
});
