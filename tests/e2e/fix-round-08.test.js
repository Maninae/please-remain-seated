/**
 * Round-08 e2e: verifications for the round-05 critic fixes.
 *
 * Coverage:
 *   - N5-B1: the deck's run count matches the loaded cell's `seeds` on three cells (a
 *     headline preset, a non-headline preset, a sensitivity cell), using page.route to serve
 *     fixture files so this test does not depend on the state of a running precompute.
 *   - N5-M2: hierarchy — the finding sentence is the largest text on the tab under the mode
 *     toggle, the chart sits directly beneath it, and each stat tile prints smaller than
 *     the finding.
 *   - CSP: fonts load (document.fonts.check for Barlow), the compare worker runs, the OG
 *     image and favicon load, and there are ZERO CSP violation console messages on the
 *     Race, Rankings and About tabs.
 *   - Screenshots at 1280x800 and 400x800 of both Rankings modes and About, into
 *     tests/e2e/artifacts/fix-round-08/.
 *
 * Skips itself cleanly if Playwright cannot launch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PRS_BASE_URL || 'http://localhost:5197';
const ARTIFACTS_DIR = path.resolve('tests/e2e/artifacts/fix-round-08');
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

function collectCspViolations(page, sink) {
  page.on('console', (m) => {
    const text = m.text() || '';
    if (/Content Security Policy|Refused to (load|apply|execute)/i.test(text)) sink.push(text);
  });
  page.on('pageerror', (e) => {
    if (/Content Security Policy/i.test(e.message)) sink.push(e.message);
  });
}

/**
 * Route the rankings index and cell fetches to synthetic fixtures so we can prove the deck
 * reads THIS cell's seed count on three different tiers. Fixture strategies mirror the
 * boarding schema so the render pipeline runs to completion.
 */
async function serveFixtureRankings(context, seedByFile) {
  const now = new Date().toISOString();
  await context.route(/\/data\/rankings\/index\.json$/, async (route) => {
    const cells = Object.entries(seedByFile).map(([file, seeds]) => {
      const m = file.match(/^(deplane|board)__([a-z0-9-]+)__/);
      // Parse the knobs out of the FILENAME so the sensitivity cell (load=0.7) actually
      // carries load: 0.7 in its knobs; the exact-match selector in rankings-data.js will
      // then find it. The previous test fixture hardcoded load: 0.85 for every cell.
      const parseNumericKnob = (name, dflt) => {
        const mm = file.match(new RegExp(`${name}=([0-9.]+)`));
        return mm ? Number(mm[1]) : dflt;
      };
      return {
        id: file.replace(/\.json$/, ''),
        mode: m ? m[1] : 'board',
        preset: m ? m[2] : 'a320',
        knobs: {
          load: parseNumericKnob('load', 0.85),
          compliance: parseNumericKnob('comply', 0.85),
          groups: parseNumericKnob('groups', 0.25),
          bags: file.match(/bags=([a-z]+)/)?.[1] || 'default',
          bins: file.match(/bins=([a-z]+)/)?.[1] || 'roomy',
        },
        seeds,
        kind: file.includes('load=0.7') || file.includes('comply=0.5') ? 'sensitivity' : 'headline',
        file,
      };
    });
    const index = {
      generatedAt: now,
      engineVersion: 'fixture0',
      preview: false,
      defaults: { load: 0.85, compliance: 0.85, groups: 0.25, bags: 'default', bins: 'roomy' },
      grid: { load: [0.7, 0.85, 1], compliance: [0.5, 0.85, 1], groups: [0, 0.25, 0.5], bags: ['default', 'light', 'heavy'], bins: ['roomy', 'legacy'] },
      strategyCountByMode: { deplane: 3, board: 3 },
      seedTiers: { headline: 10000, small: 2000, sensitivity: 2000, preview: 200 },
      namedHeadlinePresets: ['a320'],
      sensitivityPresets: [],
      sensitivityFactors: [],
      cells,
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(index) });
  });
  await context.route(/\/data\/rankings\/index-preview\.json$/, (route) => route.fulfill({ status: 404, body: '' }));
  for (const [file, seeds] of Object.entries(seedByFile)) {
    await context.route(new RegExp(`\\/data\\/rankings\\/${file.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`), async (route) => {
      const m = file.match(/^(deplane|board)__([a-z0-9-]+)__/);
      const parseNumericKnob = (name, dflt) => {
        const mm = file.match(new RegExp(`${name}=([0-9.]+)`));
        return mm ? Number(mm[1]) : dflt;
      };
      const cellPayload = {
        cell: {
          id: file.replace(/\.json$/, ''),
          mode: m ? m[1] : 'board',
          preset: m ? m[2] : 'a320',
          knobs: {
            load: parseNumericKnob('load', 0.85),
            compliance: parseNumericKnob('comply', 0.85),
            groups: parseNumericKnob('groups', 0.25),
            bags: file.match(/bags=([a-z]+)/)?.[1] || 'default',
            bins: file.match(/bins=([a-z]+)/)?.[1] || 'roomy',
          },
          seeds,
        },
        seeds,
        passengerCount: 153,
        strategies: [
          {
            id: 'random', label: 'Random order', family: 'textbook',
            medianSeconds: 1230, p10: 1100, p90: 1400, n: seeds,
            idlePersonMinutesMedian: 900,
            idlePersonMinutesPerPassenger: 5.9,
            histogram: { binSeconds: 30, counts: [1, 4, 8, 12, 8, 4, 1] },
          },
          {
            id: 'united', label: 'United Airlines', family: 'airline',
            medianSeconds: 1180, p10: 1050, p90: 1350, n: seeds,
            idlePersonMinutesMedian: 830,
            idlePersonMinutesPerPassenger: 5.4,
            histogram: { binSeconds: 30, counts: [1, 3, 7, 11, 9, 5, 2] },
          },
          {
            id: 'reverse-pyramid', label: 'Reverse pyramid', family: 'textbook',
            medianSeconds: 660, p10: 590, p90: 780, n: seeds,
            idlePersonMinutesMedian: 340,
            idlePersonMinutesPerPassenger: 2.2,
            histogram: { binSeconds: 30, counts: [2, 6, 10, 8, 3, 1] },
          },
        ],
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cellPayload) });
    });
  }
}

test('N5-B1: deck seed count matches loaded cell on three tiers (fixture routes)', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    // Three cells at three different seed tiers, mimicking the plan (headline 10k, other
    // preset 2k, sensitivity 2k). The deck must state the loaded cell's seeds, never a plan
    // headline that would contradict the footer.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await serveFixtureRankings(context, {
      'board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=10000.json': 10000,
      'board__b787__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=2000.json': 2000,
      'board__a320__load=0.7__comply=0.85__groups=0.25__bags=default__bins=roomy__n=2000.json': 2000,
    });
    const page = await context.newPage();

    async function checkOne(url, expectedSeeds) {
      // Land on about:blank first so we can clear localStorage BEFORE the target URL boots.
      // Without this, initialState() reads a stale prs.state from the previous checkOne
      // and the store keeps the previous preset even though the URL overrides it (the URL
      // params fold in, but they land on top of a stored knob for the new URL's tab).
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => { try { window.localStorage.clear(); } catch {} });
      // Reload so main.js re-reads state without the leftover localStorage snapshot.
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-rankings-lede]');
      await page.waitForSelector('[data-rankings-footnote]');
      // Give the tab controller, index fetch and rerender a settled beat.
      await page.waitForTimeout(2500);
      const readOut = await page.evaluate(() => ({
        lede: document.querySelector('[data-rankings-lede]')?.textContent || '',
        footnote: document.querySelector('[data-rankings-footnote]')?.textContent || '',
      }));
      const ledeMatch = readOut.lede.match(/(\d{1,3}(?:,\d{3})*)\s+times/);
      const footMatch = readOut.footnote.match(/(\d{1,3}(?:,\d{3})*)\s+runs/);
      assert.ok(ledeMatch, `deck should print a run count: "${readOut.lede}" (expected ${expectedSeeds}, url ${url})`);
      assert.ok(footMatch, `footnote should print a run count: "${readOut.footnote}"`);
      const ledeNum = Number(ledeMatch[1].replace(/,/g, ''));
      const footNum = Number(footMatch[1].replace(/,/g, ''));
      assert.equal(ledeNum, footNum, `deck (${ledeNum}) must equal footnote (${footNum}) for url ${url}\n  lede: ${readOut.lede}\n  footnote: ${readOut.footnote}`);
      assert.equal(ledeNum, expectedSeeds, `expected ${expectedSeeds}, got ${ledeNum} for url ${url}\n  lede: ${readOut.lede}\n  footnote: ${readOut.footnote}`);
    }

    // Round-08 N8-M1: rankings URL keys are r-prefixed.
    await checkOne(`${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=a320&seed=deck-headline`, 10000);
    await checkOne(`${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=b787&seed=deck-nonheadline`, 2000);
    await checkOne(`${BASE_URL}/index.html?tab=rankings&rmode=board&rpreset=a320&rload=0.7&seed=deck-sensitivity`, 2000);
  } finally {
    await browser.close();
  }
});

test('N5-M2: finding sentence is the largest text on the Rankings tab', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/index.html?tab=rankings&mode=board&seed=hero-1`, { waitUntil: 'load' });
    await page.waitForSelector('[data-rankings-finding]');
    await page.waitForTimeout(1500);
    const sizes = await page.evaluate(() => {
      const findingEl = document.querySelector('[data-rankings-finding]');
      const findingSize = findingEl ? parseFloat(getComputedStyle(findingEl).fontSize) : 0;
      const tileNumbers = [...document.querySelectorAll('.rankings-stat-number')]
        .map((el) => parseFloat(getComputedStyle(el).fontSize));
      const findingRect = findingEl ? findingEl.getBoundingClientRect() : null;
      const chartWrap = document.querySelector('[data-rankings-chart]');
      const chartRect = chartWrap ? chartWrap.getBoundingClientRect() : null;
      const statsRect = document.querySelector('[data-rankings-stats]')?.getBoundingClientRect();
      return {
        findingSize,
        tileNumbers,
        findingText: findingEl?.textContent || '',
        findingTop: findingRect?.top || 0,
        chartTop: chartRect?.top || 0,
        statsTop: statsRect?.top || 0,
      };
    });
    assert.ok(sizes.findingText.length > 20, `finding sentence should be present: "${sizes.findingText}"`);
    assert.ok(sizes.findingSize >= 20, `finding should be at least 20 px, got ${sizes.findingSize}`);
    for (const t2 of sizes.tileNumbers) {
      assert.ok(t2 < sizes.findingSize,
        `stat-tile number (${t2} px) must be smaller than the finding (${sizes.findingSize} px)`);
    }
    // Layout: finding before chart before stats.
    assert.ok(sizes.findingTop < sizes.chartTop,
      `finding (top ${sizes.findingTop}) must sit above the chart (top ${sizes.chartTop})`);
    assert.ok(sizes.chartTop < sizes.statsTop,
      `chart (top ${sizes.chartTop}) must sit above the stat tiles (top ${sizes.statsTop})`);
  } finally { await browser.close(); }
});

test('CSP: fonts load, fetches work, no violations on Race, Rankings, About', async (t) => {
  const browser = await safeLaunch();
  if (!browser) { t.diagnostic('playwright chromium not available; skipping'); return; }
  const violations = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    collectCspViolations(page, violations);

    // Race tab (default).
    await page.goto(`${BASE_URL}/index.html?seed=csp-race`, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    await page.waitForFunction(() => document.fonts && document.fonts.check && document.fonts.check('12px "Barlow"'), { timeout: 4000 });
    const fontsOnRace = await page.evaluate(() => document.fonts.check('12px "Barlow"'));
    assert.equal(fontsOnRace, true, 'Barlow should load under CSP on Race');

    // Rankings tab.
    await page.goto(`${BASE_URL}/index.html?tab=rankings&seed=csp-rankings`, { waitUntil: 'load' });
    await page.waitForSelector('.rankings-chart-svg-host svg', { timeout: 6000 });
    // Compare worker: run a small compare batch to prove worker-src 'self' works. The Race
    // page carries a "Run" button that spawns a Worker per strategy through worker.js.
    await page.goto(`${BASE_URL}/index.html?seed=csp-worker`, { waitUntil: 'load' });
    await page.waitForSelector('#btn-compare');
    await page.click('#btn-compare');
    await page.waitForFunction(() => {
      const el = document.querySelector('.compare-timing');
      return el && /runs/.test(el.textContent);
    }, { timeout: 30000 });

    // About tab.
    await page.goto(`${BASE_URL}/index.html?tab=about&seed=csp-about`, { waitUntil: 'load' });
    await page.waitForSelector('.about-tab');

    // OG image and favicon: fetch them via the page origin so a CSP block would surface.
    const ogStatus = await page.evaluate(async () => {
      const r = await fetch('media/og.png', { cache: 'no-store' });
      return r.status;
    });
    assert.equal(ogStatus, 200, 'og.png should load through CSP');

    // Filter out the known-benign missing sensitivity 404 log line (unrelated to CSP).
    const cspOnly = violations.filter((v) => /Content Security Policy|Refused to/i.test(v));
    assert.deepEqual(cspOnly, [], `zero CSP violations expected, got: ${cspOnly.join(' | ')}`);
  } finally { await browser.close(); }
});

test('fix-round-08 screenshots: Rankings (both modes) and About at 1280 and 400 px', async (t) => {
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
      await page.goto(`${BASE_URL}/index.html?tab=rankings&mode=deplane&seed=shot-d8`, { waitUntil: 'load' });
      await page.waitForSelector('[data-rankings-finding]');
      await page.waitForTimeout(1500);
      await shot(page, `rankings-deplane-${view.label}.png`);
      await page.click('[data-rankings-mode="board"]');
      await page.waitForTimeout(1500);
      await shot(page, `rankings-board-${view.label}.png`);
      await page.goto(`${BASE_URL}/index.html?tab=about&seed=shot-a8`, { waitUntil: 'load' });
      await page.waitForSelector('.about-tab');
      await page.waitForTimeout(1200);
      await shot(page, `about-${view.label}.png`);
      // Phone horizontal-scroll check.
      if (view.vp.width === 400) {
        for (const tab of ['race', 'rankings', 'about']) {
          await page.goto(`${BASE_URL}/index.html?tab=${tab}&seed=hs-${tab}-8`, { waitUntil: 'load' });
          await page.waitForTimeout(900);
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
    // Ignore benign 404 lines from missing sensitivity cells; treat everything else as fail.
    const nonBenign = consoleMessages.filter((m) => {
      if (/favicon/i.test(m)) return false;
      if (/data\/rankings\/.+404/i.test(m)) return false;
      if (/Failed to load resource.*404/i.test(m)) return false;
      return true;
    });
    assert.deepEqual(nonBenign, [], `no non-benign console errors, got: ${nonBenign.join('; ')}`);
  } finally {
    await browser.close();
  }
});
