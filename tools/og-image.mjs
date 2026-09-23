#!/usr/bin/env node
/**
 * Generate the social-share image at media/og.png for Please Remain Seated (NEW-B2 in the
 * round-02 critic pass: og:image was a 404 and every unfurl rendered a naked card).
 *
 * The image is 1200x630 (Facebook / Twitter / LinkedIn standard). It captures a real finished
 * race so the unfurl shows the two cabins side by side with their clocks, the result headline,
 * and the worst-seats heat view under both.
 *
 * Usage:
 *   npm run og                        # renders media/og.png with the default matchup
 *   node tools/og-image.mjs [--url <query-only>] [--out <path>] [--wait <ms>]
 *
 * The dev server must be up on http://localhost:5197 (npm run serve). If Playwright is not
 * installed the script exits 0 with a diagnostic so a fresh clone does not fail the pipeline.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// The og image is the first-visit default matchup: free-for-all vs row-by-row. The lead's
// call in round-3 was that this is what a visitor sees on cold load, so the social card should
// show it, not the two-doors headline the compare chart owns.
const DEFAULT_QUERY = 'mode=deplane&a=free-for-all&b=row-by-row&seed=og-1&preset=a320&speed=60';
const DEFAULT_OUT = path.resolve('media/og.png');
const DEFAULT_WAIT_MS = 800;
// The og:image is 1200x630 by convention. The desktop layout stacks the two cabin cards
// vertically at any width above ~900 px, so we render at that width to get one page fold
// carrying the deck, both cabin cards, and the finish card headline.
const RENDER_VIEWPORT = { width: 1200, height: 2000 };
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

async function main(argv) {
  const args = parseArgs(argv);
  const query = args.url || DEFAULT_QUERY;
  const outPath = args.out || DEFAULT_OUT;
  const waitMs = Number.isFinite(args.wait) ? args.wait : DEFAULT_WAIT_MS;
  mkdirSync(path.dirname(outPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: RENDER_VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = `http://localhost:5197/index.html?${query}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-canvas="a"]');
    // Force max speed so the finish arrives quickly no matter what the URL asked for.
    await page.click('[data-speed="60"]');
    await page.waitForFunction(
      () => document.querySelectorAll('.cabin-card.winner').length >= 1,
      { timeout: 60000 },
    );
    // Wait for both lanes to actually finish so both cabins carry the heat view.
    await page.waitForFunction(
      () => {
        const marginA = document.querySelector('[data-margin="a"]').textContent;
        const marginB = document.querySelector('[data-margin="b"]').textContent;
        const hasBoth = /(ahead|later)/.test(marginA) && /(ahead|later)/.test(marginB);
        return hasBoth;
      },
      { timeout: 60000 },
    );
    // The finish-card handler auto-scrolls the card into view via setTimeout. Wait for that,
    // then pull the scroll back to the top so the deck + winning cabin + finish card fit in the
    // clip. The document is 2000px tall; the og image is a 1200x630 window near the top.
    await page.waitForTimeout(waitMs);
    // Shrink the page contents to fit the 630 px frame so the two cabin cards, the deck, and the
    // finish card headline all land inside the image. `zoom` scales layout, not just paint, so
    // getBoundingClientRect measurements stay consistent with what the screenshot captures.
    await page.evaluate(() => {
      document.documentElement.style.zoom = '0.72';
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    await page.waitForTimeout(200);

    const clip = await page.evaluate((h) => {
      const masthead = document.querySelector('.masthead');
      const startY = masthead ? Math.max(0, Math.floor(masthead.getBoundingClientRect().top)) : 0;
      return { x: 0, y: startY, width: 1200, height: h };
    }, OG_HEIGHT);
    await page.screenshot({ path: outPath, clip });
    console.log(`wrote ${outPath} (${OG_WIDTH}x${OG_HEIGHT})`);
  } finally {
    await browser.close();
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') out.url = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--wait') out.wait = Number(argv[++i]);
  }
  return out;
}

main(process.argv).catch((error) => {
  const message = error && error.message ? error.message : String(error);
  if (/Cannot find module 'playwright'/i.test(message)
      || /Cannot find package 'playwright'/i.test(message)) {
    console.error('playwright not installed; skipping og.png');
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
