/** Model-key-free public-site regression. Fixed tool calls; no auth state or credentials. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { persistBrowserDownload } from '../src/agent/browser-tools/browser-download.js';
import { createPlaywrightUnifiedExecutor } from '../src/agent/browser-tools/playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from '../src/agent/browser-tools/unified-browser-loop.js';
import type { MessagesAdapter } from '../src/llm/messages-adapter.js';

const out = resolve(process.argv[2] ?? '/tmp/holaday-browser-fix-regression');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-quic', '--disable-http2'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  ignoreHTTPSErrors: true,
});
const results: Array<{ name: string; passed: boolean; details?: unknown; error?: string }> = [];
async function check(name: string, run: () => Promise<unknown>) {
  try {
    results.push({ name, passed: true, details: await run() });
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2));
}
try {
  await check('download_public_file', async () => {
    const page = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page, {
      saveDownload: (download) =>
        persistBrowserDownload(download, async (input) => {
          await writeFile(join(out, input.filename), input.buffer);
          return {
            fileId: 'local-public-regression',
            filename: input.filename,
            sizeBytes: input.buffer.length,
            sha256: input.sha256,
            downloadUrl: join(out, input.filename),
          };
        }),
    });
    try {
      const nav = await tools.execute({
        tool: 'navigate',
        url: 'https://the-internet.herokuapp.com/download',
      });
      if (!nav.ok) throw new Error(nav.text);
      const snap = await tools.execute({ tool: 'snapshot' });
      const ref = snap.text
        .split('\n')
        .find((line) => /\.txt/.test(line))
        ?.match(/\[ref=(e\d+)\]/)?.[1];
      if (!ref) throw new Error('no public txt link');
      const result = await tools.execute({ tool: 'download', ref });
      if (!result.ok || !result.download) throw new Error(result.text);
      await page.screenshot({ path: join(out, 'download.png') });
      return result.download;
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  await check('login_wall_public_form', async () => {
    const page = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page);
    try {
      await page.goto('https://the-internet.herokuapp.com/login', {
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      });
      const blocker = await tools.blocker();
      await page.screenshot({ path: join(out, 'login-wall.png') });
      if (blocker?.reason !== 'login') throw new Error('login wall not detected');
      return blocker;
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  await check('zero_step_navigation_recovery', async () => {
    const page = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page);
    let n = 0;
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixed-sequence' },
      async create() {
        const steps = [
          ['finish', { status: 'completed', summary: 'fabricated', evidence: 'fabricated' }],
          ['navigate', { url: 'https://httpbin.org/html' }],
          ['snapshot', {}],
          [
            'finish',
            { status: 'completed', summary: 'Herman Melville', evidence: 'Herman Melville' },
          ],
        ] as const;
        const [name, input] = steps[n++] ?? ['finish', { status: 'failed', summary: 'exhausted' }];
        return {
          id: String(n),
          metadata: this.metadata,
          content: [{ type: 'tool_use', id: String(n), name, input }],
          stopReason: 'tool_use',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    try {
      const result = await runUnifiedBrowserLoop({
        intent: '必须用浏览器读取 httpbin HTML',
        adapter,
        execute: tools.execute,
        probeBlocker: tools.blocker,
        requireBrowserEvidence: true,
        supportedTools: tools.supportedTools,
        maxSteps: 5,
      });
      await page.screenshot({ path: join(out, 'navigation.png') });
      if (result.status !== 'completed' || page.url() === 'about:blank')
        throw new Error(JSON.stringify(result));
      return result;
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  await check('public_three_tabs_return', async () => {
    const page = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page);
    try {
      await tools.execute({ tool: 'navigate', url: 'https://httpbin.org/html' });
      const first = JSON.parse((await tools.execute({ tool: 'list_tabs' })).text).tabs[0].tabId;
      for (const suffix of ['get', 'headers', 'user-agent']) {
        const created = await tools.execute({ tool: 'new_tab' });
        if (!created.ok) throw new Error(created.text);
        const nav = await tools.execute({ tool: 'navigate', url: `https://httpbin.org/${suffix}` });
        if (!nav.ok) throw new Error(nav.text);
      }
      const tabs = JSON.parse((await tools.execute({ tool: 'list_tabs' })).text);
      if (tabs.tabs.length !== 4) throw new Error('expected four owned tabs');
      const switched = await tools.execute({ tool: 'switch_tab', targetTabId: first });
      if (!switched.ok || tools.page !== page) throw new Error('switch failed');
      await page.screenshot({ path: join(out, 'tabs.png') });
      return tabs;
    } finally {
      tools.dispose();
      for (const p of context.pages()) await p.close();
    }
  });
  await check('public_five_scroll_growth', async () => {
    const page = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page);
    try {
      await page.goto('https://the-internet.herokuapp.com/infinite_scroll', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      const receipts = [];
      for (let n = 0; n < 5; n++) {
        const result = await tools.execute({ tool: 'scroll', direction: 'down', amount: 10 });
        receipts.push(result.scroll);
        if (!result.scroll?.grew)
          throw new Error(`scroll ${n + 1} no growth: ${JSON.stringify(receipts)}`);
      }
      await page.screenshot({ path: join(out, 'scroll.png') });
      return receipts;
    } finally {
      tools.dispose();
      await page.close();
    }
  });
} finally {
  await context.close();
  await browser.close();
}
console.log(
  JSON.stringify(
    results.map(({ name, passed, error }) => ({ name, passed, error })),
    null,
    2,
  ),
);
if (results.some((result) => !result.passed)) process.exitCode = 1;
