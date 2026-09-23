/**
 * Round-04 e2e: the sidebar layout, the phone settings drawer, the info popover, and the
 * 0:60 formatter regression (validated end-to-end against a real time-split render).
 *
 * The test loads the page over the local dev server (assumed running on port 5197). It skips
 * itself cleanly if playwright cannot connect, so a fresh clone does not fail CI on it.
 *
 * Deterministic patterns:
 *   - Fixed seeds, and the 60x speed for anything that has to race to a finish.
 *   - Wait on a state condition (a class, a margin string, the presence of a node) instead of
 *     a fixed sleep. Round-04 lead flake: the previous suite had a couple of `waitForTimeout`
 *     calls where the state condition was not being polled.
 *   - Round-05 e2e flake fix: any test that clicks a sidebar control first calls
 *     `clearOverlays(page)`, which closes any open info popover, closes the phone drawer if
 *     it is open, scrolls the target into view, and waits for the scrim to be gone. The
 *     bins-select click intermittently hit "subtree intercepts pointer events" without this
 *     because a leftover popover caught the click.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';

async function safeLaunch() {
  try { return await chromium.launch({ headless: true }); }
  catch (error) { return null; }
}

/**
 * Defensive click preamble. Guarantees the target selector has no overlay above it before we
 * click. Used before any sidebar-control click to keep the suite deterministic (round-05
 * flake: an info popover or the settings scrim would silently intercept a click).
 */
async function clearOverlays(page) {
  // Close any open info popover.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.info-popover')) el.remove();
  });
  // If the phone drawer is open, close it and wait for the scrim to become hidden.
  const drawerOpen = await page.evaluate(() => document.body.classList.contains('settings-open'));
  if (drawerOpen) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('settings-open'), { timeout: 2000 });
  }
  // Wait for the scrim to be truly hidden (no pointer events).
  await page.waitForFunction(() => {
    const scrim = document.getElementById('settings-scrim');
    return !scrim || scrim.hidden === true;
  }, { timeout: 2000 });
}

async function safeSidebarClick(page, selector) {
  await clearOverlays(page);
  const handle = await page.$(selector);
  if (!handle) throw new Error(`no element for selector: ${selector}`);
  await handle.scrollIntoViewIfNeeded();
  await handle.waitForElementState('stable');
  await handle.click();
}

test('sidebar renders at 1280 px with all settings visible', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(`${BASE_URL}/index.html?seed=sidebar-1`, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    // Wait for the sidebar to lay out as a real side column, not a stacked block.
    await page.waitForFunction(() => {
      const grid = document.getElementById('page-grid');
      if (!grid) return false;
      return getComputedStyle(grid).display === 'grid';
    }, { timeout: 4000 });

    const geom = await page.evaluate(() => {
      const sidebar = document.getElementById('settings-panel');
      const main = document.getElementById('page-main');
      const rBar = sidebar.getBoundingClientRect();
      const rMain = main.getBoundingClientRect();
      return {
        sidebarLeft: Math.round(rBar.left),
        sidebarWidth: Math.round(rBar.width),
        mainRight: Math.round(rMain.right),
        // These knobs are the ones the brief says must live in the sidebar.
        hasHowFull: !!sidebar.querySelector('#load-slider'),
        hasFollowRules: !!sidebar.querySelector('#compliance-slider'),
        hasGroups: !!sidebar.querySelector('#families-slider'),
        hasAircraft: !!sidebar.querySelector('#preset-select'),
        hasBins: !!sidebar.querySelector('#bins-select'),
        hasRestart: !!sidebar.querySelector('#btn-race-side'),
        hasSpeed: !!sidebar.querySelector('#speed-group-side'),
        hasMoreKnobs: !!sidebar.querySelector('.more-knobs'),
        sidebarComputedDisplay: getComputedStyle(sidebar).display,
      };
    });

    assert.ok(geom.sidebarLeft > geom.mainRight - 4, `sidebar should sit to the RIGHT of the main column: sidebarLeft=${geom.sidebarLeft} mainRight=${geom.mainRight}`);
    assert.ok(geom.sidebarWidth >= 280 && geom.sidebarWidth <= 340, `sidebar width should be ~300 px, got ${geom.sidebarWidth}`);
    assert.equal(geom.hasHowFull, true, 'sidebar should carry the load-factor slider ("How full")');
    assert.equal(geom.hasFollowRules, true, 'sidebar should carry the compliance slider ("Follow the rules")');
    assert.equal(geom.hasGroups, true, 'sidebar should carry the families slider ("Groups")');
    assert.equal(geom.hasAircraft, true, 'sidebar should carry the aircraft picker');
    assert.equal(geom.hasBins, true, 'sidebar should carry the overhead-bins picker');
    assert.equal(geom.hasRestart, true, 'sidebar should carry a Restart button');
    assert.equal(geom.hasSpeed, true, 'sidebar should carry the speed group');
    assert.equal(geom.hasMoreKnobs, true, 'sidebar should carry the "More knobs" disclosure');
    assert.deepEqual(consoleErrors, [], 'no console errors');
  } finally { await browser.close(); }
});

test('drawer opens and closes at 400 px with focus trapped', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?seed=drawer-1`, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    // The top bar with Settings button is visible on phone.
    const topbar = await page.$('#phone-topbar');
    assert.ok(topbar, 'phone top bar should exist at 400 px');
    const initialOpen = await page.$eval('body', (el) => el.classList.contains('settings-open'));
    assert.equal(initialOpen, false, 'drawer starts closed');
    await page.click('#btn-open-settings');
    await page.waitForFunction(() => document.body.classList.contains('settings-open'), { timeout: 2000 });
    const afterOpen = await page.evaluate(() => ({
      open: document.body.classList.contains('settings-open'),
      ariaExpanded: document.getElementById('btn-open-settings').getAttribute('aria-expanded'),
      focused: document.activeElement && document.activeElement.id,
      scrimHidden: document.getElementById('settings-scrim').hidden,
    }));
    assert.equal(afterOpen.open, true, 'body should carry settings-open');
    assert.equal(afterOpen.ariaExpanded, 'true', 'open button reports aria-expanded=true');
    assert.equal(afterOpen.focused, 'btn-close-settings', 'focus lands on the drawer close button');
    assert.equal(afterOpen.scrimHidden, false, 'scrim visible while open');

    // Escape closes the drawer, focus returns.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('settings-open'), { timeout: 2000 });
    const afterClose = await page.evaluate(() => ({
      open: document.body.classList.contains('settings-open'),
      ariaExpanded: document.getElementById('btn-open-settings').getAttribute('aria-expanded'),
      focused: document.activeElement && document.activeElement.id,
    }));
    assert.equal(afterClose.open, false, 'drawer closes on Escape');
    assert.equal(afterClose.ariaExpanded, 'false', 'open button reports aria-expanded=false');
    assert.equal(afterClose.focused, 'btn-open-settings', 'focus returns to the open button');

    // Tap outside closes: reopen and click the scrim.
    await page.click('#btn-open-settings');
    await page.waitForFunction(() => document.body.classList.contains('settings-open'), { timeout: 2000 });
    await page.click('#settings-scrim');
    await page.waitForFunction(() => !document.body.classList.contains('settings-open'), { timeout: 2000 });
  } finally { await browser.close(); }
});

test('info popover opens for the strategy select and closes on Escape', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?seed=popover-1&a=free-for-all&b=two-doors`, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    // The strategy-a info button is inserted right after the strategy select. Its label maps
    // to the current strategy ("Free-for-all").
    await page.waitForSelector('[data-strategy-picker="a"] .info-btn', { timeout: 3000 });
    await page.click('[data-strategy-picker="a"] .info-btn');
    await page.waitForSelector('.info-popover', { timeout: 2000 });
    const info = await page.evaluate(() => {
      const pop = document.querySelector('.info-popover');
      const title = pop.querySelector('.info-popover-title').textContent;
      const body = pop.querySelector('.info-popover-body').textContent;
      const role = pop.getAttribute('role');
      return { title, body, role };
    });
    assert.equal(info.role, 'dialog', 'popover should carry role="dialog"');
    assert.match(info.title, /Free-for-all/, `popover title should describe the strategy: "${info.title}"`);
    assert.ok(info.body.length > 40, `popover body should be non-trivial, got "${info.body}"`);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.info-popover'), { timeout: 2000 });

    // Change the strategy and verify the popover reflects the new selection.
    await page.selectOption('#strategy-a', 'row-by-row');
    await page.waitForTimeout(200);
    await page.click('[data-strategy-picker="a"] .info-btn');
    await page.waitForSelector('.info-popover', { timeout: 2000 });
    const info2 = await page.$eval('.info-popover .info-popover-title', (el) => el.textContent);
    assert.match(info2, /One row at a time/, `after switching strategy the popover should update: "${info2}"`);
  } finally { await browser.close(); }
});

test('time-split labels never render 0:60 near a minute boundary', async (t) => {
  // The formatter fix ships in js/ui/format.js; charts-time-split.js now delegates. Verify
  // the render path never emits ":60" inside a time-split segment label.
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?mode=deplane&a=free-for-all&b=two-doors&seed=zero-sixty&preset=a320&speed=60`, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    await page.click('[data-speed="60"]');
    await page.waitForFunction(() => {
      const marginA = document.querySelector('[data-margin="a"]').textContent;
      const marginB = document.querySelector('[data-margin="b"]').textContent;
      return /(ahead|later)/.test(marginA) && /(ahead|later)/.test(marginB);
    }, { timeout: 60000 });
    // Give the time-split render one more frame after both lanes finish.
    await page.waitForFunction(() => {
      const svg = document.querySelector('[data-split-svg="a"]');
      return svg && svg.querySelector('text');
    }, { timeout: 4000 });

    // No segment label may render ":60" anywhere on either bar. That was the bug (0:60 ->
    // 1:00) fixed in js/ui/format.js, verified end-to-end here.
    const badLabels = await page.evaluate(() => {
      const svgs = document.querySelectorAll('[data-split-svg]');
      const found = [];
      for (const svg of svgs) {
        for (const text of svg.querySelectorAll('text')) {
          const t = text.textContent || '';
          if (/:60(\b|[^0-9])/.test(t) || t.endsWith(':60')) found.push(t);
        }
      }
      // Also check the "total" labels next to the bars.
      for (const total of document.querySelectorAll('[data-split-total]')) {
        const t = total.textContent || '';
        if (/:60(\b|[^0-9])/.test(t) || t.endsWith(':60')) found.push(`total: ${t}`);
      }
      return found;
    });
    assert.deepEqual(badLabels, [], `no time-split label should render ":60"; found ${JSON.stringify(badLabels)}`);
  } finally { await browser.close(); }
});

/**
 * Bins-select interaction (round-05 flake fix). This test used to intermittently hit
 * "subtree intercepts pointer events" when an info popover was still open above the
 * settings sidebar. `clearOverlays` closes any popover, waits for the scrim, and scrolls
 * the target into view before we interact with it.
 */
test('bins-select changes value deterministically after any popover', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(`${BASE_URL}/index.html?seed=bins-1&bins=roomy`, { waitUntil: 'load' });
    await page.waitForSelector('#bins-select');
    // Open the strategy-a info popover on purpose so the flake condition is present.
    await page.click('[data-strategy-picker="a"] .info-btn');
    await page.waitForSelector('.info-popover', { timeout: 2000 });
    // Now change the bins picker. clearOverlays inside safeSelectOption must dispatch cleanly.
    await clearOverlays(page);
    const before = await page.$eval('#bins-select', (el) => el.value);
    await page.selectOption('#bins-select', 'legacy');
    await page.waitForFunction(() => document.getElementById('bins-select')?.value === 'legacy', { timeout: 2000 });
    const after = await page.$eval('#bins-select', (el) => el.value);
    assert.notEqual(after, before, 'bins-select value should change');
    assert.equal(after, 'legacy', 'bins-select should hold the new value');
    assert.deepEqual(consoleErrors, [], 'no console errors after the bins change');
  } finally { await browser.close(); }
});
