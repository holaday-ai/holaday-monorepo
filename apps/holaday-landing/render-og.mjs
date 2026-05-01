// Renders og-template.html to og-image.png at 1200x630 using Playwright.
// Run from monorepo root: node apps/holaday-landing/render-og.mjs
//
// Pulls Playwright from @holaday/orchestrator's node_modules so we don't need
// to add it as a separate dep here — landing has no package.json of its own.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const templateUrl = `file://${resolve(here, 'og-template.html')}`;
const outPath = resolve(here, 'og-image.png');

// pnpm strict mode + ESM = the script can't resolve `playwright` from a
// sibling workspace package by name. Use an absolute file URL to the
// orchestrator's installed copy. If you ever move the orchestrator dir,
// this path needs updating — or run from inside apps/orchestrator/.
const playwrightUrl = pathToFileURL(
  resolve(here, '..', 'orchestrator', 'node_modules', 'playwright', 'index.mjs'),
).href;
const { chromium } = await import(playwrightUrl);

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2, // crisp 2x output
  });
  const page = await context.newPage();
  await page.goto(templateUrl, { waitUntil: 'networkidle' });
  // Belt-and-suspenders for the Outfit web font
  await page.evaluate(() => document.fonts ? document.fonts.ready : Promise.resolve());
  await page.waitForTimeout(150);
  await page.screenshot({
    path: outPath,
    type: 'png',
    omitBackground: false,
    fullPage: false,
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  console.log(`og-image written: ${outPath}`);
} finally {
  await browser.close();
}
