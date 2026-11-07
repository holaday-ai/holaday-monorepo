/** Scripted execution of real sites through the production executor; no model calls. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { persistBrowserDownload } from '../src/agent/browser-tools/browser-download.js';
import { createPlaywrightUnifiedExecutor } from '../src/agent/browser-tools/playwright-unified-executor.js';
import type { UnifiedBrowserAction } from '../src/agent/browser-tools/unified-tools.js';
const output = process.argv[2];
if (!output) throw new Error('output directory required');
await mkdir(output, { recursive: true });
const prompts: Record<string, string> = {
  'core-04': '请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题',
  'core-06': '请使用云端浏览器，维基百科长页面，分段读取并总结第3节',
  'core-07': '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个',
  'core-08':
    '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图',
  'core-09': '请使用云端浏览器，the-internet.herokuapp.com/download 下载小文件，报告文件名与大小',
  'core-10': '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts',
  'core-11': '请使用云端浏览器，the-internet.herokuapp.com/infinite_scroll 滚动5次后读内容',
};
const browser = await chromium.launch({ headless: true });
const results: unknown[] = [];
try {
  for (const id of Object.keys(prompts).filter(
    (id) => !process.argv[3] || process.argv[3].split(',').includes(id),
  )) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
    });
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(15000);
    let page = await context.newPage();
    let meta: Record<string, string> = {};
    const steps: unknown[] = [];
    const started = Date.now();
    let details: unknown;
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      taskIntent: prompts[id],
      actionTimeoutMs: 15000,
      saveDownload: (download) =>
        persistBrowserDownload(
          download,
          async (input) => {
            const path = join(output, `${id}-${input.filename}`);
            await writeFile(path, input.buffer, { mode: 0o600 });
            return {
              fileId: id,
              filename: input.filename,
              sizeBytes: input.buffer.length,
              sha256: input.sha256,
              downloadUrl: path,
            };
          },
          2 * 1024 * 1024,
        ),
    });
    const act = async (a: UnifiedBrowserAction) => {
      const start = Date.now();
      const r = await tools.execute(a);
      page = tools.page;
      const { image, ...safe } = r;
      steps.push({ action: a, result: safe, screenshot: !!image, elapsedMs: Date.now() - start });
      if (!r.ok) throw new Error(`${r.errorCode}: ${r.text.slice(0, 160)}`);
      if (r.interruption) throw new Error(`interruption:${r.interruption.reason}`);
      const blocker = await tools.blocker();
      if (blocker && !('disposition' in blocker && blocker.disposition === 'continue'))
        throw new Error(`site_blocked:${blocker.reason}`);
      return r;
    };
    const read = async () => {
      const r = await act({ tool: 'read_page' });
      const value = JSON.parse(r.text);
      meta = {
        tabId: value.tabId,
        frameId: value.frameId,
        observationRevision: value.observationRevision,
      };
      return value;
    };
    const ref = (tree: string, pattern: RegExp) => {
      const line = tree.split('\n').find((l) => pattern.test(l) && l.includes('[ref='));
      const value = line?.match(/\[ref=(e\d+)\]/)?.[1];
      if (!value) throw new Error('required control not observed');
      return value;
    };
    try {
      if (id === 'core-04') {
        await act({
          tool: 'navigate',
          url: 'https://www.youtube.com/results?search_query=Playwright+tutorial',
        });
        await page.waitForTimeout(1200);
        const titles = await page.locator('a#video-title').allTextContents();
        if (titles.filter(Boolean).length < 5)
          throw new Error('fewer than five actual video titles');
        details = { titles: titles.filter(Boolean).slice(0, 5) };
        await read();
      }
      if (id === 'core-06') {
        await act({
          tool: 'navigate',
          url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
        });
        const first = JSON.parse((await act({ tool: 'get_page_text', maxChars: 1800 })).text);
        await read();
        const second = JSON.parse(
          (await act({ tool: 'get_page_text', cursor: first.cursor, maxChars: 1800 })).text,
        );
        if (second.range[0] !== 1800 || second.snapshotId !== first.snapshotId)
          throw new Error('unstable cursor');
        details = {
          ranges: [first.range, second.range],
          headings: await page.locator('h2').allTextContents(),
        };
      }
      if (id === 'core-07') {
        await act({
          tool: 'navigate',
          url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
        });
        const first = await read();
        const links = await page.locator('#mw-content-text a[href]').evaluateAll((nodes) =>
          Array.from(new Set(nodes.map((n) => (n as HTMLAnchorElement).href)))
            .filter(
              (h) =>
                h.startsWith('https://en.wikipedia.org/wiki/') &&
                !h.includes(':', h.indexOf('/wiki/') + 6) &&
                !h.includes('#') &&
                new URL(h).pathname !== '/wiki/Artificial_intelligence',
            )
            .slice(0, 3),
        );
        if (links.length !== 3) throw new Error('three article links not available');
        const titles = [];
        for (const url of links) {
          const n = JSON.parse((await act({ tool: 'new_tab' })).text);
          meta = { tabId: n.tabId, frameId: n.frameId, observationRevision: n.observationRevision };
          await act({ tool: 'navigate', url, ...meta });
          await read();
          titles.push(await page.title());
        }
        await act({ tool: 'switch_tab', targetTabId: first.tabId });
        if (page.url() !== first.sourceURL) throw new Error('did not return to original tab');
        details = { links, titles, returned: true };
      }
      if (id === 'core-08') {
        await act({ tool: 'navigate', url: 'https://httpbin.org/forms/post' });
        let s = await read();
        const oldMeta = { ...meta };
        const oldRef = ref(s.tree, /Customer name/i);
        await read();
        const stale = await tools.execute({
          tool: 'type',
          ref: oldRef,
          text: 'SHOULD NOT RUN',
          ...oldMeta,
        });
        steps.push({ action: 'stale-ref recovery probe', result: stale });
        if (
          stale.errorCode !== 'stale_ref' ||
          !stale.text.includes('fresh_observation') ||
          (await page.locator('input[name="custname"]').inputValue()) !== ''
        )
          throw new Error('stale recovery did not preserve input');
        s = await read();
        await act({
          tool: 'type',
          ref: ref(s.tree, /Customer name/i),
          text: 'Local Browser Test',
          ...meta,
        });
        s = await read();
        const timeLine = s.tree.split('\n').find((l: string) => l.includes('[type=time]'));
        if (timeLine) {
          await act({ tool: 'type', ref: ref(s.tree, /\[type=time\]/), text: '12:30', ...meta });
        }
        await read();
        const shot = await act({ tool: 'screenshot' });
        if (!shot.image) throw new Error('screenshot missing');
        await writeFile(join(output, `${id}-filled.jpg`), Buffer.from(shot.image.data, 'base64'));
        details = {
          nameFilled:
            (await page.locator('input[name="custname"]').inputValue()) === 'Local Browser Test',
          timeControl: !!timeLine,
          submitted: false,
          dateControl: await page.locator('input[type=date]').count(),
        };
      }
      if (id === 'core-09') {
        await act({ tool: 'navigate', url: 'https://the-internet.herokuapp.com/download' });
        const s = await read();
        const line = s.tree.split('\n').find((l: string) => /link .*\.txt/.test(l));
        if (!line) throw new Error('small text download not found');
        const r = await act({
          tool: 'download',
          ref: ref(s.tree, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
          ...meta,
        });
        if (!r.download || r.download.sizeBytes <= 0) throw new Error('download receipt missing');
        details = r.download;
      }
      if (id === 'core-10') {
        await act({ tool: 'navigate', url: 'https://the-internet.herokuapp.com/iframe' });
        const s = await read();
        const frame = s.frames.find(
          (f: { sourceURL: string }) =>
            f.sourceURL.includes('tiny') || f.sourceURL === 'about:blank',
        );
        if (!frame) throw new Error('iframe unavailable on site');
        const frameText = frame
          ? (
              await act({
                tool: 'get_page_text',
                tabId: s.tabId,
                frameId: frame.frameId,
                maxChars: 4000,
              })
            ).text
          : 'No editor frame available';
        const editorReadOnly = /read.?only|exceeded|quota|limit/i.test(frameText);
        await act({
          tool: 'navigate',
          url: 'https://the-internet.herokuapp.com/javascript_alerts',
        });
        const a = await read();
        let dialogSeen = false;
        page.once('dialog', async (d) => {
          dialogSeen = true;
          await d.accept();
        });
        await act({ tool: 'click', ref: ref(a.tree, /button "Click for JS Alert"/), ...meta });
        const text = await page.locator('#result').innerText();
        if (!dialogSeen || !text.includes('successfully')) throw new Error('alert not completed');
        details = { frameText, editorReadOnly, alert: text };
      }
      if (id === 'core-11') {
        await act({ tool: 'navigate', url: 'https://the-internet.herokuapp.com/infinite_scroll' });
        const receipts = [];
        for (let n = 0; n < 5; n++) {
          await read();
          receipts.push((await act({ tool: 'scroll', direction: 'down', ...meta })).scroll);
        }
        await read();
        if (receipts.some((r) => !r) || !receipts.some((r) => r?.grew))
          throw new Error('scroll growth not observed');
        details = { receipts };
      }
      results.push({
        id,
        prompt: prompts[id],
        status: 'scripted_pass',
        details,
        elapsedMs: Date.now() - started,
        modelCalls: 0,
        costCNY: 0,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown';
      results.push({
        id,
        prompt: prompts[id],
        status: reason.startsWith('site_blocked:') ? 'site_blocked' : 'failed',
        reason,
        elapsedMs: Date.now() - started,
        modelCalls: 0,
        costCNY: 0,
      });
    } finally {
      await page.screenshot({ path: join(output, `${id}.png`), timeout: 5000 }).catch(() => {});
      await writeFile(join(output, `${id}-steps.json`), JSON.stringify(steps, null, 2));
      tools.dispose();
      await context.close();
      await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
    }
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await browser.close();
}
