import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

/** Test-only terminal evidence collection. Complete before the owner closes its App/schema. */
export async function captureTaskHistoryCloseout(options: {
  out: string;
  origin: string;
  token: string;
  taskId: string;
  expectedStatus: string;
  files: Array<{ fileId: string; filename: string; bytes: number; sha256: string }>;
  readFromNewConnection: () => Promise<{
    beforeConnectionId: number;
    afterConnectionId: number;
    status: string;
  }>;
}) {
  const { out, origin, token, taskId, files } = options;
  const url = new URL(origin);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.protocol, 'http:');
  assert(files.length > 0 && files.length <= 16);
  assert.equal(new Set(files.map((file) => file.filename)).size, files.length);
  for (const file of files) assert.equal(basename(file.filename), file.filename);
  const sql = await options.readFromNewConnection();
  assert.notEqual(sql.beforeConnectionId, sql.afterConnectionId);
  assert.equal(sql.status, options.expectedStatus);
  await writeFile(join(out, 'terminal-sql.json'), JSON.stringify(sql, null, 2), { mode: 0o600 });
  const downloads: unknown[] = [];
  const views: unknown[] = [];
  const pageErrors: string[] = [];
  const blockedOrigins: string[] = [];
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  let passed = false;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      acceptDownloads: true,
    });
    context.setDefaultTimeout(10_000);
    await context.route('**/*', async (route) => {
      const target = new URL(route.request().url());
      if (target.hostname !== '127.0.0.1' && !['blob:', 'data:'].includes(target.protocol)) {
        blockedOrigins.push(target.origin);
        await route.abort();
      } else await route.continue();
    });
    await context.addInitScript(
      (value) => localStorage.setItem('holaday.access_token', value),
      token,
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const target = `${origin}/?task=${encodeURIComponent(taskId)}`;
    await page.goto(target);
    const dir = join(out, 'history-downloads');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload();
      await page
        .getByRole('button', { name: /^下载.* summary\.csv$/ })
        .waitFor({ state: 'visible' });
      const region = page.getByRole('region', { name: '浏览器工作区', exact: true });
      if (viewport.width === 390 && (await region.isVisible()))
        await region.getByRole('button', { name: '收起浏览器', exact: true }).click();
      for (const file of files) {
        const escaped = file.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const button = page.getByRole('button', { name: new RegExp(`^下载.* ${escaped}$`) });
        await button.waitFor({ state: 'visible' });
        await button.scrollIntoViewIfNeeded();
        const pending = page.waitForEvent('download');
        await button.click();
        const item = await pending;
        const destination = join(dir, `${viewport.width}-${file.filename}`);
        await item.saveAs(destination);
        const bytes = await readFile(destination);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        assert.equal(bytes.length, file.bytes);
        assert.equal(sha256, file.sha256);
        downloads.push({
          viewport: viewport.width,
          fileId: file.fileId,
          filename: file.filename,
          bytes: bytes.length,
          sha256,
          via: 'actual history card click',
        });
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
        false,
      );
      await page.screenshot({ path: join(out, `history-${viewport.width}.png`), fullPage: true });
      await writeFile(
        join(out, `history-${viewport.width}.txt`),
        await page.locator('body').innerText(),
      );
      views.push({
        ...viewport,
        historyReloaded: true,
        status: sql.status,
        noHorizontalOverflow: true,
      });
    }
    assert.deepEqual(pageErrors, []);
    assert(blockedOrigins.every((value) => value === 'https://assets.holaday.ai'));
    const result = {
      passed: true,
      taskId,
      status: sql.status,
      sql,
      downloads,
      views,
      pageErrors,
      blockedOrigins,
      modelCalls: 0,
      websiteExports: 0,
    };
    await writeFile(join(out, 'history-verification.json'), JSON.stringify(result, null, 2), {
      mode: 0o600,
    });
    passed = true;
    return result;
  } finally {
    await browser.close();
    await writeFile(
      join(out, 'history-browser-closed.json'),
      JSON.stringify({ passed, ownedBrowserClosed: true, pageErrors, blockedOrigins }),
      { mode: 0o600 },
    );
  }
}
