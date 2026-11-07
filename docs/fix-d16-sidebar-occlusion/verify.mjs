// Local seeded regression: run after building apps/web-workbench.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.join(root, 'apps/web-workbench');
const out = process.env.SIDEBAR_CHECK_OUTPUT;
assert(out, 'Set SIDEBAR_CHECK_OUTPUT to an evidence directory');
fs.mkdirSync(out, { recursive: true });
const phase = process.argv[2] ?? 'after';
const { chromium, expect } = createRequire(path.join(app, 'package.json'))('playwright/test');
const { startSeedServer } = await import(path.join(root, 'ui-suite/lib/server.mjs'));
const { measurePage, classifyGeometry } = await import(path.join(root, 'ui-suite/lib/checks.mjs'));
const sizes =
  phase === 'before'
    ? [[1366, 768]]
    : [
        [1366, 768],
        [1440, 960],
        [1280, 960],
        [1024, 960],
        [1200, 1000],
      ];
const server = await startSeedServer(app);
const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
const results = [];
try {
  for (const [width, height] of sizes) {
    for (const action of ['select', 'copy', 'pin']) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: 'reduce',
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      await context.route('**/*', (route) =>
        route.request().url().startsWith(server.origin) ? route.continue() : route.abort(),
      );
      await context.addInitScript(() => {
        localStorage.setItem('holaday.access_token', 'ui-local-seed');
        localStorage.setItem('holaday-theme', 'light');
      });
      await context.request.post(`${server.origin}/__ui_seed/reset`);
      const page = await context.newPage();
      await page.goto(`${server.origin}/?task=tsk_ui_generate_executing`);
      await expect(
        page.getByRole('button', { name: 'UI generate executing', exact: true }),
      ).toBeVisible();
      const countBefore = await page.locator('.holaday-task-row').count();
      if (action === 'select') {
        await page.getByRole('button', { name: 'UI generate executing', exact: true }).click();
      } else {
        await page
          .getByRole('button', { name: '任务菜单', exact: true })
          .nth(action === 'pin' ? 2 : 0)
          .click();
        await page
          .getByRole('menuitem', { name: action === 'pin' ? '置顶' : '复制任务文本', exact: true })
          .click();
        await expect(page.getByRole('menu')).toHaveCount(0);
      }
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const measured = await measurePage(page);
      const issues = classifyGeometry(measured.elements, width, height).filter(
        (f) => f.severity === 'P1',
      );
      const screenshot = `${phase}-${width}x${height}-${action}.png`;
      await page.screenshot({ path: path.join(out, screenshot), animations: 'disabled' });
      const countAfter = await page.locator('.holaday-task-row').count();
      results.push({ width, height, action, countBefore, countAfter, issues, screenshot });
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
fs.writeFileSync(path.join(out, `${phase}.json`), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify({
    cases: results.length,
    issues: results.flatMap((r) => r.issues),
    rowsPreserved: results.every((r) => r.countBefore === r.countAfter),
  }),
);
assert(
  results.every((r) => r.countBefore === r.countAfter),
  'History rows must not be removed',
);
assert.equal(
  results.flatMap((r) => r.issues).length,
  0,
  'History controls must remain unobstructed after task/menu actions',
);
