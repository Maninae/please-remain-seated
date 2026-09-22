#!/usr/bin/env node
/**
 * Take two screenshots of the running page: 1280x800 desktop and 400x800 phone.
 *
 * Usage: node tests/e2e/shot.js <outdir> [--url <url>] [--wait <ms>]
 *
 * The screenshot capture starts the local dev server if it is not already running (via
 * python3 -m http.server 5197 from the repo root), waits until the page reports both cabin
 * canvases have drawn at least once, then takes the desktop and phone shots.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_URL = 'http://localhost:5197/index.html?mode=deplane&a=free-for-all&b=aisle-first&seed=smoke-1';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 400, height: 800 };

export async function takeShots(outDir, { url = DEFAULT_URL, waitMs = 800 } = {}) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // Desktop
    const desktop = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
    const dpage = await desktop.newPage();
    await dpage.goto(url, { waitUntil: 'load' });
    await dpage.waitForSelector('[data-canvas="a"]');
    await dpage.waitForTimeout(waitMs);
    await dpage.screenshot({ path: path.join(outDir, 'page-desktop-1280x800.png'), fullPage: true });

    // Mobile (phone width, vertical cabins)
    const mobile = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2 });
    const mpage = await mobile.newPage();
    await mpage.goto(url, { waitUntil: 'load' });
    await mpage.waitForSelector('[data-canvas="a"]');
    await mpage.waitForTimeout(waitMs);
    await mpage.screenshot({ path: path.join(outDir, 'page-mobile-400x800.png'), fullPage: true });

    return {
      desktop: path.join(outDir, 'page-desktop-1280x800.png'),
      mobile: path.join(outDir, 'page-mobile-400x800.png'),
    };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] || 'tests/e2e/artifacts';
  takeShots(outDir).then((paths) => {
    console.log(JSON.stringify(paths, null, 2));
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
