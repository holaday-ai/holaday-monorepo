// Focused ui:audit using the unchanged seed, action observer and geometry checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.join(root, 'apps/web-workbench');
const out = process.env.SIDEBAR_CHECK_OUTPUT;
assert(out, 'Set SIDEBAR_CHECK_OUTPUT');
fs.mkdirSync(out, { recursive: true });
const phase = process.argv[2] ?? 'after';
const { chromium, expect } = createRequire(path.join(app, 'package.json'))('playwright/test');
const { startSeedServer } = await import(path.join(root, 'ui-suite/lib/server.mjs'));
const { measurePage, classifyGeometry } = await import(path.join(root, 'ui-suite/lib/checks.mjs'));
const { observeControl } = await import(path.join(root, 'ui-suite/lib/interaction.mjs'));
const sizes =
  phase === 'before'
    ? [
        [1440, 960],
        [1366, 768],
      ]
    : [
        [1440, 960],
        [1366, 768],
        [1200, 1000],
        [1280, 960],
        [1024, 960],
      ];
const server = await startSeedServer(app);
const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
const results = [];
async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function geometry(page, width, height) {
  await settle(page);
  const measured = await measurePage(page);
  return {
    controls: measured.elements.length,
    issues: classifyGeometry(measured.elements, width, height).filter((f) => f.severity === 'P1'),
  };
}
async function act(page, find) {
  const measured = await measurePage(page);
  const control = measured.elements.find(find);
  assert(control, 'Required audit control must exist');
  return observeControl(page, control);
}
async function rect(locator) {
  return locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const scroll = document.querySelector('.hd-task-history-scroll').getBoundingClientRect();
    return {
      y: r.y,
      height: r.height,
      top: scroll.top,
      bottom: scroll.bottom,
      fullyVisible: r.top >= scroll.top - 1 && r.bottom <= scroll.bottom + 1,
      hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
    };
  });
}
try {
  for (const [width, height] of sizes) {
    const scenarios =
      phase === 'before'
        ? ['batch']
        : ['batch', 'disabled', 'cancelled', 'menu', 'completed', 'awaiting'];
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: 'reduce',
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
      page.setDefaultTimeout(10000);
      await page.clock.setFixedTime(new Date('2026-10-09T10:00:00Z'));
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
      });
      const route = scenario === 'batch' ? 'executing' : 'awaiting_user';
      await page.goto(`${server.origin}/?task=tsk_ui_generate_${route}`);
      await expect(page.getByTitle('批量管理任务', { exact: true })).toBeVisible();
      const countBefore = await page.locator('.holaday-task-row').count();
      const actions = [];
      if (scenario === 'batch' || scenario === 'disabled') {
        actions.push(await act(page, (e) => e.label === '批量管理任务'));
      }
      if (scenario === 'batch') {
        actions.push(
          await act(page, (e) => e.tag === 'div' && e.label.includes('UI generate cancelled')),
        );
      } else if (scenario === 'disabled') {
        actions.push(
          await act(
            page,
            (e) => e.tag === 'div' && e.disabled && e.label === '进行中的任务不能批量操作',
          ),
        );
      } else if (scenario === 'menu') {
        actions.push(await act(page, (e) => e.id === 'BUTTON||任务菜单||5'));
      } else {
        const text = {
          cancelled: 'UI generate cancelled',
          completed: 'UI browser completed',
          awaiting: 'UI generate awaiting_us…',
        }[scenario];
        actions.push(await act(page, (e) => e.tag === 'button' && e.label === text));
      }
      const exact = await geometry(page, width, height);
      const shot = `${phase}-${width}x${height}-${scenario}.png`;
      await page.screenshot({ path: path.join(out, shot), animations: 'disabled' });
      const record = {
        width,
        height,
        scenario,
        actions: actions.map((a) => ({ id: a.id, status: a.status, layout: a.layout })),
        exact,
        errors,
        screenshot: shot,
      };
      if (scenario === 'batch') {
        const pager = page.getByRole('button', { name: '加载更多任务', exact: true });
        record.pagerAtSelection = await rect(pager);
        const scroller = page.locator('.hd-task-history-scroll');
        await scroller.evaluate((e) => {
          e.scrollTop = e.scrollHeight;
        });
        await settle(page);
        const last = page.locator('.holaday-task-row').last();
        await last.scrollIntoViewIfNeeded();
        record.lastRow = await rect(last);
        await scroller.evaluate((e) => {
          e.scrollTop = e.scrollHeight;
        });
        record.pagerAtBottom = await rect(pager);
        record.footer = await page.locator('[data-sidebar="footer"]').evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { bottom: r.bottom, inViewport: r.bottom <= innerHeight };
        });
        record.beforeLoadCount = await page.locator('.holaday-task-row').count();
        if (phase !== 'before') {
          // Real pointer click without locator auto-scrolling the button into view.
          const box = await pager.boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await expect
            .poll(() => page.locator('.holaday-task-row').count())
            .toBeGreaterThan(record.beforeLoadCount);
          record.afterLoadCount = await page.locator('.holaday-task-row').count();
          const state = await (
            await context.request.get(`${server.origin}/__ui_seed/state`)
          ).json();
          record.listRequests = state.requests.filter((r) => r.name === 'tasks.list').length;
          record.afterLoad = await geometry(page, width, height);
          await page.screenshot({
            path: path.join(out, `${phase}-${width}x${height}-loaded.png`),
            animations: 'disabled',
          });
          // Focus navigation must bring the last item fully above the batch bar too.
          await last.locator('button').first().focus();
          await settle(page);
          record.focusedLastRow = await rect(last);
        }
      }
      record.countBefore = countBefore;
      record.countAfter = await page.locator('.holaday-task-row').count();
      results.push(record);
      console.log(JSON.stringify({ width, height, scenario, p1: exact.issues.length }));
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
fs.writeFileSync(path.join(out, `${phase}.json`), JSON.stringify(results, null, 2));
assert.equal(
  results.flatMap((r) => r.exact.issues).length,
  0,
  'No control-occluded P1 after the exact action path',
);
if (phase !== 'before') {
  for (const r of results) {
    assert.equal(r.errors.length, 0, 'No HTTP or browser errors');
    assert(
      r.actions.every((a) => ['passed', 'disabled', 'idempotent'].includes(a.status)),
      'Original action must work',
    );
    if (r.scenario === 'batch') {
      assert(r.lastRow.fullyVisible && r.lastRow.hit, 'Last row fully visible and clickable');
      assert(
        r.pagerAtBottom.fullyVisible && r.pagerAtBottom.hit,
        'Pager fully visible and clickable',
      );
      assert(
        r.focusedLastRow.fullyVisible && r.focusedLastRow.hit,
        'Focused last row fully visible',
      );
      assert(r.footer.inViewport, 'Batch footer stays within viewport');
      assert(
        r.afterLoadCount > r.beforeLoadCount && r.listRequests >= 2,
        'Load more retrieves and displays more tasks',
      );
      assert.equal(r.afterLoad.issues.length, 0, 'No P1 after loading');
    } else assert.equal(r.countBefore, r.countAfter, 'Existing rows preserved');
  }
}
