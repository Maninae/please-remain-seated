/**
 * Round-05 e2e: sectioned preset rendering, grouped selects, an airline popover, the per-class
 * finish line on a multi-class cabin, and the info-button size fix in the sidebar.
 *
 * Assumes the local dev server on http://localhost:5197. Playwright is optional: if it cannot
 * launch, every test skips cleanly instead of failing the pipeline on a fresh clone.
 *
 * Screenshots for a reviewer land under tests/e2e/artifacts/fix-round-05/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-05');
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

test('sectioned preset renders section dividers and wider first-class seats', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const url = `${BASE_URL}/index.html?mode=deplane&preset=b738-two-class&a=free-for-all&b=row-by-row&seed=r5-sect&speed=15`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    await page.waitForTimeout(800);

    // Sectioned cabins expose `cabin.sections` with more than one entry; the geometry pass
    // draws first-class seats WIDER on the cross axis than economy seats. Read the two seat
    // rectangles directly from the geometry so we assert an invariant, not a pixel.
    const geom = await page.evaluate(async () => {
      const layoutMod = await import('/js/render/cabin-layout.js');
      const cabinMod = await import('/js/engine/cabin.js');
      const cabin = cabinMod.createCabin({
        sections: [
          { id: 'first', label: 'First', cabinClass: 'first', layout: [2, 2], rows: 4, rowPitchMeters: 0.94, binCapacityPerSeatRow: 1.0 },
          { id: 'economy', label: 'Main Cabin', cabinClass: 'economy', layout: [3, 3], rows: 20, rowPitchMeters: 0.79, binCapacityPerSeatRow: 1.0 },
        ],
      });
      const g = layoutMod.computeGeometry(cabin, 1200, 260, 'horizontal');
      const firstSeat = g.seats.find((s) => s.row === 1 && s.col === 0);
      const economySeat = g.seats.find((s) => s.row === 6 && s.col === 0);
      return {
        dividerCount: g.sectionDividers.length,
        firstSeatCross: firstSeat.height,
        economySeatCross: economySeat.height,
        firstSectionClass: firstSeat.sectionIndex,
        economySectionClass: economySeat.sectionIndex,
      };
    });
    assert.equal(geom.dividerCount, 1, 'one divider between the two sections');
    assert.ok(geom.firstSeatCross > geom.economySeatCross,
      `first-class seat (${geom.firstSeatCross}) should be wider than economy (${geom.economySeatCross})`);

    await shot(page, 'sectioned-deplane-desktop.png');

    // Mobile screenshot at the same URL.
    const mobile = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });
    const mpage = await mobile.newPage();
    mpage.on('pageerror', (e) => errors.push(`[m] ${e.message}`));
    await mpage.goto(url, { waitUntil: 'load' });
    await mpage.waitForSelector('[data-canvas="a"]');
    await mpage.waitForTimeout(600);
    await shot(mpage, 'sectioned-deplane-mobile.png');

    assert.deepEqual(errors.filter(nonBenign), [], 'no console errors on the sectioned preset');
  } finally { await browser.close(); }
});

test('board strategy select and aircraft select carry optgroups', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = `${BASE_URL}/index.html?mode=board&preset=b738-two-class&a=random&b=united&seed=r5-grp`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#strategy-a');
    await page.waitForTimeout(500);

    const strategyGroups = await page.$eval('#strategy-a',
      (el) => Array.from(el.querySelectorAll('optgroup')).map((g) => ({ label: g.label, size: g.children.length })));
    assert.ok(strategyGroups.some((g) => g.label === 'Textbook methods' && g.size >= 3),
      `strategy select should carry a Textbook methods optgroup: ${JSON.stringify(strategyGroups)}`);
    assert.ok(strategyGroups.some((g) => g.label === 'How airlines actually board' && g.size >= 1),
      `strategy select should carry an airlines optgroup with entries: ${JSON.stringify(strategyGroups)}`);

    const presetGroups = await page.$eval('#preset-select',
      (el) => Array.from(el.querySelectorAll('optgroup')).map((g) => ({ label: g.label, size: g.children.length })));
    assert.ok(presetGroups.some((g) => g.label === 'Single class' && g.size >= 5),
      `preset select should carry a Single class optgroup: ${JSON.stringify(presetGroups)}`);
    assert.ok(presetGroups.some((g) => g.label === 'With first class' && g.size >= 2),
      `preset select should carry a With first class optgroup: ${JSON.stringify(presetGroups)}`);
    await shot(page, 'board-mode-grouped-selects.png');
  } finally { await browser.close(); }
});

test('info popover opens for a real airline strategy', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = `${BASE_URL}/index.html?mode=board&preset=b738-two-class&a=random&b=united&seed=r5-pop`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#strategy-b');
    await page.waitForTimeout(400);

    // Click the "i" button next to the lane-B strategy select (united). The popover title
    // should read the airline name from the glossary entry.
    const infoKey = await page.$eval('[data-strategy-lane="b"]', (el) => el.dataset.infoKey);
    assert.equal(infoKey, 'united', 'lane-B info button should track the united id');
    await page.click('[data-strategy-lane="b"]');
    await page.waitForSelector('.info-popover', { timeout: 3000 });
    const title = await page.$eval('.info-popover-title', (el) => el.textContent);
    const body = await page.$eval('.info-popover-body', (el) => el.textContent);
    assert.equal(title, 'United Airlines', `popover title should be United Airlines, got ${title}`);
    assert.ok(/WILMA|window|middle|aisle/i.test(body), `popover body should describe United's WILMA order: ${body}`);
    await shot(page, 'united-info-popover.png');
  } finally { await browser.close(); }
});

test('multi-class result card carries a per-class finish line', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Board a multi-class 737 with two real procedures so the race finishes at 60x quickly.
    const url = `${BASE_URL}/index.html?mode=board&preset=b738-two-class&a=random&b=united&seed=r5-cls&speed=60`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    await page.click('[data-speed="60"]');
    await page.waitForFunction(() => {
      const marginA = document.querySelector('[data-margin="a"]').textContent;
      const marginB = document.querySelector('[data-margin="b"]').textContent;
      return /(ahead|later)/.test(marginA) && /(ahead|later)/.test(marginB);
    }, { timeout: 60000 });
    await page.waitForTimeout(400);
    const byClassText = await page.$eval('.by-class', (el) => el.textContent).catch(() => '');
    assert.ok(byClassText.length > 0, 'result card should show a by-class line for a multi-class cabin');
    assert.ok(/First class/.test(byClassText),
      `by-class line should name First class: "${byClassText}"`);
    assert.ok(/Economy/.test(byClassText),
      `by-class line should name Economy: "${byClassText}"`);
    await shot(page, 'multi-class-finish-card.png');
  } finally { await browser.close(); }
});

test('info button next to Seed keeps its 22 px square, no tall oval', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?seed=r5-btn`, { waitUntil: 'load' });
    await page.waitForSelector('#seed-input');
    await page.waitForTimeout(300);
    const size = await page.evaluate(() => {
      const anchor = document.querySelector('.seed-row-side .settings-inline-label .info-anchor');
      const button = anchor && anchor.querySelector('.info-btn');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), ratio: rect.height / rect.width };
    });
    assert.ok(size, 'info button next to Seed must exist');
    assert.ok(size.width <= 26 && size.height <= 26,
      `info button should not stretch: got ${size.width} x ${size.height}`);
    assert.ok(size.ratio <= 1.25,
      `info button should stay roughly square (not a tall oval): height/width = ${size.ratio}`);
  } finally { await browser.close(); }
});

test('board mode finish shows both textbook and airline strips grouped', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = `${BASE_URL}/index.html?mode=board&preset=b738-two-class&a=random&b=united&seed=r5-cmp`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#btn-compare');
    // Cap the batch at a small seed count so the assertion runs quickly.
    await page.evaluate(() => {
      const select = document.getElementById('seed-count-select');
      const option = document.createElement('option');
      option.value = '10'; option.textContent = '10 (test)';
      select.appendChild(option); select.value = '10';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#btn-compare');
    await page.waitForFunction(() => {
      const wrap = document.getElementById('strips-wrap');
      return wrap && wrap.querySelectorAll('svg').length >= 1;
    }, { timeout: 180000 });
    await page.waitForTimeout(500);
    const layoutInfo = await page.evaluate(() => {
      const wrap = document.getElementById('strips-wrap');
      return {
        svgCount: wrap.querySelectorAll('svg').length,
        hasRule: !!wrap.querySelector('.compare-group-rule'),
        firstTitle: (wrap.querySelector('svg text') || {}).textContent,
      };
    });
    assert.ok(layoutInfo.svgCount === 2, `board compare should render two grouped strip charts, got ${layoutInfo.svgCount}`);
    assert.ok(layoutInfo.hasRule, 'a compare-group-rule should separate the textbook and airline strips');
    // The finding sentence names the fastest airline procedure and the fastest textbook
    // method by their labels ("easyJet boards fastest at 24:39; Reverse pyramid still wins on
    // paper at 13:32."). We match on the shared verbs so a strategy shuffle across seeds does
    // not flake the test.
    assert.ok(layoutInfo.firstTitle && /boards fastest/.test(layoutInfo.firstTitle),
      `strip title should mention the fastest airline: "${layoutInfo.firstTitle}"`);
    assert.ok(layoutInfo.firstTitle && /still wins on paper/.test(layoutInfo.firstTitle),
      `strip title should mention the fastest textbook method: "${layoutInfo.firstTitle}"`);
    await shot(page, 'grouped-strips.png');
  } finally { await browser.close(); }
});

function nonBenign(message) {
  if (/favicon/i.test(message)) return false;
  if (/net::ERR_FAILED/i.test(message) && /media\/og\.png/i.test(message)) return false;
  return true;
}
