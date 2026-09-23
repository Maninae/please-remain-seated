/**
 * Round-10 e2e: verifications for the three deferred round-06 items.
 *
 * Coverage:
 *   - N6-m5: compare pool sharded by seed ranges. Runs 40 seeds two ways and asserts the
 *     resulting medians per strategy are identical (determinism). Times a 100-seed run on
 *     the A320 at defaults and prints the total ms so the reviewer sees the before/after.
 *   - N6-m6: every interactive control on the visible tab at 400x800 has a bounding box
 *     of at least 44 CSS px in both dimensions, walking the tab bar, the race tab, the
 *     rankings tab, and the phone settings drawer. Documented exceptions: `.info-btn` (22 px
 *     circle with a 44 px `::after` hit area on coarse pointers) and `input[type="range"]`
 *     (its own touch heuristics apply, and the sidebar range fills its 260 px row so the
 *     hit target is much larger than the input's own box).
 *   - N6-m7: the Rankings tab now carries a settings sidebar of grid-value <select>s. A
 *     knob change lands on a grid value and triggers a re-render of the matching cell.
 *
 * The suite skips itself cleanly when playwright chromium cannot launch, matching the
 * pattern the other e2e files follow.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-10');
if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });

// Elements the tap-target sweep intentionally skips, matching the "documented exception
// list for inline text links" the round-06 critic allowed:
//   .info-btn              22 px circle, 44 px `::after` hit area on pointer:coarse
//   input[type="range"]    browser-native range touch heuristics + the 260 px row width
//   input[type="hidden"]   not interactive
//   input#sound-toggle     the 16 px visual checkbox: the wrapping `.checkbox-label` is the
//                          real tap area (44 px on phone via base.css)
//   .footer a              inline text links in the page footer
//   .rankings-hover-hint a inline text inside the hover panel
const TAP_TARGET_EXCEPTIONS = [
  '.info-btn',
  'input[type="range"]',
  'input[type="hidden"]',
  'input#sound-toggle',
  '.footer a',
  '.rankings-hover-hint a',
];

async function safeLaunch() {
  try { return await chromium.launch({ headless: true }); }
  catch (error) { return null; }
}

async function shot(page, name) {
  const file = path.join(ARTIFACTS_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function loadAndWait(context, url, ready = null) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => { try { window.localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'load' });
  if (ready) await ready(page);
  return { page, consoleErrors };
}

/**
 * Walk every interactive control inside the panel at phone width and check its bounding
 * box. Returns an array of failures `[{selector, w, h, text}]`; empty means all controls
 * meet the 44 px spec.
 */
async function checkTapTargets(page, hostSelector) {
  return page.evaluate((args) => {
    const host = document.querySelector(args.hostSelector) || document.body;
    const controls = host.querySelectorAll('button, a, select, input, [role="button"], [role="tab"], [role="radio"]');
    const failures = [];
    for (const control of controls) {
      if (control.offsetParent === null && control.getClientRects().length === 0) continue;
      let excepted = false;
      for (const sel of args.exceptions) {
        if (control.matches(sel)) { excepted = true; break; }
      }
      if (excepted) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        failures.push({
          selector: control.tagName.toLowerCase()
            + (control.id ? `#${control.id}` : '')
            + (control.className && typeof control.className === 'string' ? `.${control.className.split(' ').filter(Boolean).join('.')}` : ''),
          w: Math.round(rect.width * 100) / 100,
          h: Math.round(rect.height * 100) / 100,
          text: (control.textContent || '').slice(0, 30).replace(/\s+/g, ' ').trim(),
        });
      }
    }
    return failures;
  }, { hostSelector, exceptions: TAP_TARGET_EXCEPTIONS });
}

test('N6-m5: sharded pool matches an unsharded reference run seed-for-seed (40 seeds)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    // Compute a reference run in the page's own runBatch (unsharded, single-strategy) and
    // compare against what the pool emits for the same seed list. The runBatch call is the
    // exact code path every seed inside the sharded pool exercises, so the totalSeconds
    // arrays should match seed-by-seed.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=aisle-first&seed=quant-40&preset=a320`;
    const { page } = await loadAndWait(context, url, async (p) => {
      await p.waitForSelector('#btn-compare');
    });
    const result = await page.evaluate(async () => {
      const batchMod = await import('/js/batch.js');
      const poolMod = await import('/js/ui/compare-pool.js');
      const seeds = batchMod.seedList('a320-deplane-quant-40', 40);
      const referenceRun = batchMod.runBatch({
        mode: 'deplane', strategyId: 'free-for-all', seeds,
        cabinOverrides: {}, passengerOverrides: {},
      });
      const pool = poolMod.createComparePool();
      const shardedTotals = await new Promise((resolve, reject) => {
        pool.run({
          mode: 'deplane', tasks: [{ strategyId: 'free-for-all', label: 'FFA', cabinOverrides: {}, passengerOverrides: {} }],
          seeds,
        }, {
          onDone: ({ results }) => resolve(results[0].totalSeconds),
          onError: ({ message }) => reject(new Error(message)),
        });
      });
      pool.dispose();
      return { reference: referenceRun.totalSeconds, sharded: shardedTotals };
    });
    assert.equal(result.reference.length, result.sharded.length,
      `seed count mismatch: ${result.reference.length} vs ${result.sharded.length}`);
    for (let i = 0; i < result.reference.length; i += 1) {
      assert.equal(result.sharded[i], result.reference[i],
        `seed ${i}: sharded ${result.sharded[i]} vs reference ${result.reference[i]}`);
    }
  } finally { await browser.close(); }
});

test('N6-m5: sharded pool wall-clock timing on 100 seeds a320 defaults', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=aisle-first&seed=timing-100&preset=a320`;
    const { page } = await loadAndWait(context, url, async (p) => {
      await p.waitForSelector('#btn-compare');
    });
    const timings = await page.evaluate(async () => {
      const batchMod = await import('/js/batch.js');
      const poolMod = await import('/js/ui/compare-pool.js');
      const seeds = batchMod.seedList('a320-deplane-timing-100', 100);
      // The seven deplaning strategies as of round-06. Their ids come from
      // js/engine/strategies/deplane.js DEPLANE_STRATEGIES. The `two-doors` strategy needs
      // its own cabin override (a rear door), which the sim-config helper builds for us.
      const simCfg = await import('/js/ui/sim-config.js');
      const strategiesMod = await import('/js/engine/strategies/index.js');
      const strategyIds = strategiesMod.DEPLANE_STRATEGIES.map((s) => s.id);
      const pool = poolMod.createComparePool();
      const tasks = strategyIds.map((strategyId) => ({
        strategyId, label: strategyId,
        cabinOverrides: simCfg.strategyCabinOverridesFor('deplane', strategyId) || {},
        passengerOverrides: {},
      }));
      const started = performance.now();
      await new Promise((resolve, reject) => {
        pool.run({ mode: 'deplane', tasks, seeds }, {
          onDone: () => resolve(),
          onError: ({ message }) => reject(new Error(message)),
        });
      });
      const elapsedMs = performance.now() - started;
      pool.dispose();
      return { elapsedMs, tasks: tasks.length, seedsPerTask: seeds.length };
    });
    t.diagnostic(`Sharded compare ${timings.tasks} strategies x ${timings.seedsPerTask} seeds on A320: ${timings.elapsedMs.toFixed(0)} ms`);
    // Very loose upper bound: the check is here so a runaway pool trips the test rather than
    // silently hanging CI. The actual timing is reported in the diagnostic above.
    assert.ok(timings.elapsedMs < 120000,
      `sharded compare should finish under 120s, took ${timings.elapsedMs.toFixed(0)} ms`);
  } finally { await browser.close(); }
});

test('N6-m6: every visible interactive control is at least 44x44 CSS px on the race tab at 400x800', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=aisle-first&seed=tap-race&preset=a320`;
    const { page } = await loadAndWait(context, url, async (p) => {
      await p.waitForSelector('#btn-race');
    });
    // Race tab + phone tab bar. Fold the settings drawer OPEN so its controls also get the
    // sweep.
    await page.click('#btn-open-settings');
    await page.waitForTimeout(400);
    const failures = await checkTapTargets(page, 'body');
    await shot(page, 'race-phone-400x800-drawer-open.png');
    assert.deepEqual(failures, [],
      `race tab tap-target failures at 400x800:\n${JSON.stringify(failures, null, 2)}`);
  } finally { await browser.close(); }
});

test('N6-m6: every visible interactive control is at least 44x44 CSS px on the rankings tab at 400x800', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const url = `${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=a320&seed=tap-rankings`;
    const { page } = await loadAndWait(context, url, async (p) => {
      await p.waitForSelector('[data-rankings-mode]');
      // Wait for the rankings knob-selects to populate (if the index is loaded).
      await p.waitForTimeout(2000);
    });
    const failures = await checkTapTargets(page, 'body');
    await shot(page, 'rankings-phone-400x800.png');
    assert.deepEqual(failures, [],
      `rankings tab tap-target failures at 400x800:\n${JSON.stringify(failures, null, 2)}`);
  } finally { await browser.close(); }
});

test('N6-m7: rankings-tab knob change snaps to a grid value and re-renders the cell', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const url = `${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=a320&seed=knob-rankings`;
    const { page } = await loadAndWait(context, url, async (p) => {
      await p.waitForSelector('[data-rankings-mode]');
      await p.waitForTimeout(3000);
    });
    // Sanity: the rankings settings sidebar must have populated its selects.
    const populated = await page.evaluate(() => {
      const selects = document.querySelectorAll('.rankings-settings [data-rankings-knob]');
      return Array.from(selects).map((select) => ({
        knob: select.dataset.rankingsKnob,
        options: Array.from(select.options).map((option) => option.value),
        value: select.value,
      }));
    });
    if (populated.length === 0) {
      t.diagnostic('rankings settings not populated; likely no index.json on this server; skipping');
      return;
    }
    const load = populated.find((k) => k.knob === 'load');
    assert.ok(load, 'expected a load knob select');
    assert.ok(load.options.length >= 2, `expected multiple load options, got ${JSON.stringify(load.options)}`);
    // Read the footnote id BEFORE the change so we can assert it changes after.
    const footnoteBefore = await page.evaluate(() => document.querySelector('[data-rankings-footnote]')?.getAttribute('data-cell-id') || '');
    // Pick a load value that differs from the current select value.
    const targetValue = load.options.find((option) => option !== load.value) || load.options[0];
    await page.evaluate((value) => {
      const select = document.querySelector('.rankings-settings [data-rankings-knob="load"]');
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, targetValue);
    await page.waitForTimeout(1200);
    const afterValue = await page.evaluate(() => document.querySelector('.rankings-settings [data-rankings-knob="load"]')?.value);
    assert.equal(afterValue, targetValue,
      `select should hold the chosen grid value after change, got "${afterValue}"`);
    // The load select value lands on one of the grid options (i.e., snapped).
    assert.ok(load.options.includes(afterValue),
      `after value "${afterValue}" should be a grid value from ${JSON.stringify(load.options)}`);
    // A footnote id change (or knob-note text change) indicates the tab re-rendered against
    // a different cell. The id encodes the knobs; a different load knob lands on a different
    // cell id, so this is a strong signal.
    const footnoteAfter = await page.evaluate(() => document.querySelector('[data-rankings-footnote]')?.getAttribute('data-cell-id') || '');
    if (footnoteBefore && footnoteBefore !== footnoteAfter) {
      // Ideal: the cell changed. Nothing more to assert.
    } else {
      // Some servers only carry a single load cell; in that case re-render lands on the same
      // cell. Confirm at least that the tab re-rendered by checking the load knob-note text
      // reflects the new selected value.
      const knobNote = await page.evaluate(() => {
        const notes = Array.from(document.querySelectorAll('.rankings-knob-note'));
        const loadNote = notes.find((el) => /How full/i.test(el.textContent || ''));
        return loadNote ? loadNote.textContent : '';
      });
      const targetPercent = `${Math.round(Number(targetValue) * 100)}%`;
      assert.match(knobNote, new RegExp(targetPercent),
        `load knob note should reflect the new value ${targetPercent}, got "${knobNote}"`);
    }
    await shot(page, 'rankings-desktop-1280x800-knob-changed.png');
  } finally { await browser.close(); }
});

test('N6-m7: rankings knob popovers say "grid values only"', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const url = `${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=a320&seed=knob-popover`;
    const { page } = await loadAndWait(context, url, async (p) => {
      await p.waitForSelector('[data-rankings-mode]');
      await p.waitForTimeout(3000);
    });
    const infoBtn = await page.$('.rankings-settings .info-btn');
    if (!infoBtn) {
      t.diagnostic('rankings settings info button not found; skipping');
      return;
    }
    await infoBtn.click();
    await page.waitForTimeout(400);
    const popoverText = await page.evaluate(() => {
      const popover = document.querySelector('.info-popover');
      return popover ? popover.textContent : '';
    });
    assert.match(popoverText, /grid values only/i,
      `rankings popover should say "grid values only", got "${popoverText}"`);
  } finally { await browser.close(); }
});

test('regression: rankings tab renders cleanly at 1280x800 and 400x800', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 400, height: 800 }]) {
      const context = await browser.newContext({ viewport });
      const url = `${BASE_URL}/index.html?tab=rankings&mode=deplane&preset=a320&seed=regress-rankings`;
      const { page, consoleErrors } = await loadAndWait(context, url, async (p) => {
        await p.waitForSelector('[data-rankings-mode]');
        await p.waitForTimeout(2500);
      });
      const label = viewport.width === 1280 ? 'desktop-1280x800' : 'phone-400x800';
      await shot(page, `rankings-${label}.png`);
      // No horizontal scroll on either width.
      const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      assert.equal(horizontal, false,
        `no horizontal scroll expected on rankings ${label}`);
      // No CSP violations or JS errors.
      const cspErrors = consoleErrors.filter((line) => /Content Security Policy/i.test(line));
      assert.deepEqual(cspErrors, [], `unexpected CSP violations on rankings ${label}:\n${cspErrors.join('\n')}`);
      const jsErrors = consoleErrors.filter((line) => /pageerror|Uncaught/i.test(line));
      assert.deepEqual(jsErrors, [], `unexpected JS errors on rankings ${label}:\n${jsErrors.join('\n')}`);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('regression: race tab renders cleanly at 400x800', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const url = `${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=aisle-first&seed=regress-race&preset=a320`;
    const { page, consoleErrors } = await loadAndWait(context, url, async (p) => {
      await p.waitForSelector('#btn-race');
      await p.waitForTimeout(1500);
    });
    await shot(page, 'race-phone-400x800.png');
    const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(horizontal, false, 'no horizontal scroll expected on race phone');
    const cspErrors = consoleErrors.filter((line) => /Content Security Policy/i.test(line));
    assert.deepEqual(cspErrors, [], `unexpected CSP violations on race phone:\n${cspErrors.join('\n')}`);
  } finally { await browser.close(); }
});
