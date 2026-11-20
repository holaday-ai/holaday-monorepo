import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browserCompletionVerdict } from '../../execution/execution-pipeline.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { completionGap } from './browser-completion.js';
import {
  answerCount,
  checkSectionClaim,
  parseCount,
  requestedCount,
  requestedSection,
} from './ordinal-requests.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/** BROWSER-AUTOPILOT-3: Deploy-21 delivered a short list and a wrong section as completed. */
const P = '请使用云端浏览器，';
const BODY = ['史前时期', '文明起源', '夏朝', '商朝', '周朝'];

describe('ordinal and count requests are read from the user words', () => {
  it('parses counts and sections, ignoring actions and repetitions', () => {
    expect(parseCount('十二')).toBe(12);
    expect(parseCount('二十')).toBe(20);
    expect(requestedCount(`${P}YouTube 搜索「Playwright tutorial」返回前5个视频标题`)).toBe(5);
    expect(requestedCount('36kr 前三条新闻')).toBe(3);
    expect(requestedCount('top 10 results for rust')).toBe(10);
    expect(requestedCount(`${P}从一个页面打开3个链接到新标签，分别读标题后回到第一个`)).toBeNull();
    expect(
      requestedCount(`${P}the-internet.herokuapp.com/infinite_scroll 滚动5次后读内容`),
    ).toBeNull();
    expect(requestedSection(`${P}维基百科长页面，分段读取并总结第3节`)).toBe(3);
    expect(requestedSection('总结第三章')).toBe(3);
    expect(requestedSection(`${P}YouTube 搜索返回前5个视频标题`)).toBeNull();
  });
  it('counts the numbered items an answer lists, or what it admits', () => {
    expect(answerCount('1. A\n2. B\n3. C\n4. D')).toBe(4);
    expect(answerCount('1) A（tab_1）\n2) B\n3) C')).toBe(3);
    expect(answerCount('仅找到4个视频：A、B、C、D')).toBe(4);
    expect(answerCount('标题：A；时间 10:30；版本 4.5')).toBeNull();
    expect(answerCount('1. 说明\n1. A\n2. B\n3. C\n4. D\n5. E')).toBe(5);
  });
});

describe('“第N节” is checked against the article body outline', () => {
  const online =
    '第3节内容总结（章节标题：文明起源）\n本页为维基百科《中国历史》条目，其第3个H2章节标题为“文明起源”。';
  it('catches the Deploy-21 core-06 answer (the 2nd body section reported as the 3rd)', () => {
    expect(checkSectionClaim(online, 3, BODY)).toEqual({
      verdict: 'mismatch',
      claimed: '文明起源',
      expected: '夏朝',
    });
  });
  it('accepts the right section and leaves a title-less summary alone', () => {
    expect(checkSectionClaim('第3节「夏朝」：二里头文化…', 3, BODY).verdict).toBe('ok');
    expect(checkSectionClaim('第3节讲述了早期国家的形成。', 3, BODY).verdict).toBe('unknown');
    // Mentioning another section in the body of the summary is not a claim.
    expect(checkSectionClaim('第3节「夏朝」承接上一节文明起源的讨论。', 3, BODY).verdict).toBe(
      'ok',
    );
  });
});

const scripted = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: 'anthropic', model: 'fixture' },
        content: [{ type: 'tool_use', id: String(turn), ...call }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { adapter, seen };
};
const finish = (summary: string) => ({ name: 'finish', input: { status: 'completed', summary } });

describe('a short count is continued once, then delivered as 部分完成', () => {
  const titles = ['Alpha one', 'Beta two', 'Gamma three', 'Delta four', 'Epsilon five'];
  const page = titles.map((t) => `link "${t}"`).join('\n');
  const list = (n: number) =>
    titles
      .slice(0, n)
      .map((t, i) => `${i + 1}. ${t}`)
      .join('\n');
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    const { adapter, seen } = scripted(calls);
    return runUnifiedBrowserLoop({
      intent: `${P}YouTube 搜索「Playwright tutorial」返回前5个视频标题`,
      adapter,
      maxSteps: 8,
      execute: async () => ({ ok: true, text: page }),
    }).then((outcome) => ({ outcome, seen }));
  };
  it('asks for the rest once, then marks four of five as partial (Deploy-21 core-04)', async () => {
    const { outcome, seen } = await run([
      { name: 'snapshot', input: {} },
      finish(list(4)),
      { name: 'snapshot', input: {} },
      finish(list(4)),
    ]);
    expect(seen.join('\n')).toContain('任务要求 5 条，答案只列出 4 条');
    expect(outcome).toMatchObject({ status: 'completed', partial: { found: 4, wanted: 5 } });
    expect(outcome.status === 'completed' && outcome.summary).toMatch(/^部分完成：只找到 4\/5 条/);
  });
  it('completes when the continuation finds all five', async () => {
    const { outcome } = await run([
      { name: 'snapshot', input: {} },
      finish(list(4)),
      { name: 'snapshot', input: {} },
      finish(list(5)),
    ]);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect('partial' in outcome && outcome.partial).toBeFalsy();
  });
});

describe('a wrong “第N节” is corrected once with the real list, then fails', () => {
  const sectionsText = JSON.stringify({
    sections: BODY.map((title, i) => ({ index: String(i + 1), level: 2, title })),
  });
  const execute = async (action: UnifiedBrowserAction): Promise<UnifiedToolResult> =>
    action.tool === 'sections'
      ? { ok: true, text: sectionsText }
      : { ok: true, text: `heading "${BODY.join('"\nheading "')}"\n二里头文化` };
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    const { adapter, seen } = scripted(calls);
    return runUnifiedBrowserLoop({
      intent: `${P}维基百科长页面，分段读取并总结第3节`,
      adapter,
      observationV2: true,
      maxSteps: 8,
      execute,
    }).then((outcome) => ({ outcome, seen }));
  };
  it('returns the body list, then accepts the corrected section', async () => {
    const { outcome, seen } = await run([
      { name: 'read_page', input: {} },
      finish('第3节（章节标题：文明起源）'),
      finish('第3节「夏朝」：二里头文化'),
    ]);
    expect(seen.join('\n')).toContain('正文第3节是「夏朝」');
    expect(seen.join('\n')).toContain('1. 史前时期；2. 文明起源；3. 夏朝');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('fails on a second wrong section', async () => {
    const { outcome } = await run([
      { name: 'read_page', input: {} },
      finish('第3节（章节标题：文明起源）'),
      finish('第3节仍是文明起源（章节标题：文明起源）'),
    ]);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(outcome.status === 'failed' && outcome.reason).toContain('正文第3节是「夏朝」');
  });
});

describe('“JavaScript alerts” needs a native dialog receipt (core-10 f2-a)', () => {
  const intent = `${P}the-internet.herokuapp.com 的 iframe 与 JavaScript alerts`;
  const summary = '已完成 iframe 与 JavaScript alerts：关闭了页面内 alert 组件。';
  const read = { tool: 'read_page', ok: true, url: 'https://the-internet.herokuapp.com/iframe' };
  it('rejects an answer when no dialog was ever opened', () => {
    expect(completionGap(intent, summary, [read], false)).toContain('没有触发过任何原生对话框');
  });
  it('accepts it once a click opened one', () => {
    const click = {
      ...read,
      tool: 'click',
      dialogs: [{ type: 'alert', message: 'I am a JS Alert' }],
    };
    expect(completionGap(intent, summary, [read, click], false)).toBeNull();
    expect(completionGap(`${P}YouTube 搜索`, summary, [read], false)).toBeNull();
  });
});

describe('a partial browser answer is persisted as partial_success', () => {
  it('maps partial to partial_success and keeps the answer', () => {
    expect(
      browserCompletionVerdict({
        runnerStatus: 'completed',
        verification: null,
        verifiedText: '部分完成：只找到 4/5 条。',
        originalText: '部分完成：只找到 4/5 条。',
        partial: { found: 4, wanted: 5 },
      }),
    ).toMatchObject({ status: 'partial_success', text: '部分完成：只找到 4/5 条。' });
  });
});

describe('sections on real Chromium (body only, Vector 2022 layout)', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  const wiki = `<!doctype html><meta charset="utf-8"><title>中国历史 - 维基百科</title>
<body><nav id="vector-toc" class="vector-toc"><h2>目录</h2><ul><li>史前时期</li><li>文明起源</li></ul></nav>
<main id="content"><h1>中国历史</h1><div id="mw-content-text"><div class="mw-parser-output">
<p>导言段落。</p>
${BODY.map(
  (t, i) =>
    `<div class="mw-heading mw-heading2"><h2 id="${t}">${t}</h2><span class="mw-editsection">[编辑]</span></div><p>${t}正文${i + 1}。</p>${
      i === 2
        ? '<div class="mw-heading mw-heading3"><h3 id="二里头">二里头文化</h3></div><p>二里头遗址。</p>'
        : ''
    }`,
).join('\n')}
<div class="mw-heading mw-heading2"><h2 id="参考文献">参考文献</h2></div><ol><li>某书</li></ol>
<div class="navbox"><h2>中国历史导航</h2></div>
</div></div></main><aside><h2>侧栏</h2></aside></body>`;
  const blog = `<!doctype html><meta charset="utf-8"><title>Blog</title><body>
<header><h2>Site menu</h2></header><aside><h2>Popular</h2></aside>
<article><h1>Post</h1><h2>Intro</h2><p>a</p><h2>Setup</h2><p>b</p><h2>Usage</h2><p>c</p><h2>See also</h2></article>
<footer><h2>Footer</h2></footer></body>`;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/forbidden') res.statusCode = 403;
      if (req.url === '/alerts') {
        res.end(
          `<button onclick="alert('I am a JS Alert');r.textContent='You successfully clicked an alert'">Click for JS Alert</button><button onclick="r.textContent='You clicked: '+(confirm('I am a JS Confirm')?'Ok':'Cancel')">Click for JS Confirm</button><p id="r"></p>`,
        );
        return;
      }
      res.end(
        req.url === '/blog' ? blog : req.url === '/forbidden' ? '<h1>403 Forbidden</h1>' : wiki,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('numbers only body sections: 第3节 is 夏朝, not 文明起源', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/wiki`);
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const listed = JSON.parse((await tools.execute({ tool: 'sections' })).text);
    expect(listed.scope).toBe('#mw-content-text');
    expect(
      listed.sections.map((s: { index: string; title: string }) => `${s.index} ${s.title}`),
    ).toEqual(['1 史前时期', '2 文明起源', '3 夏朝', '3.1 二里头文化', '4 商朝', '5 周朝']);
    expect(listed.sections[2].anchor).toBe('#夏朝');
    expect(listed.excluded).toEqual(['参考文献']);
    const third = JSON.parse((await tools.execute({ tool: 'get_page_text', section: 3 })).text);
    expect(third.sectionTitle).toBe('夏朝');
    expect(third.text).toContain('夏朝正文3');
    expect(third.text).toContain('二里头遗址');
    expect(third.text).not.toContain('文明起源正文');
    expect(third.text).not.toContain('商朝正文');
    expect(third.text).not.toContain('编辑');
    const last = JSON.parse((await tools.execute({ tool: 'get_page_text', section: 5 })).text);
    expect(last.text).toContain('周朝正文5');
    expect(last.text).not.toContain('侧栏');
    const read = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    expect(
      read.headings
        .filter((h: { section?: number }) => h.section)
        .map((h: { text: string; section: number }) => `${h.section} ${h.text}`),
    ).toEqual(['1 史前时期', '2 文明起源', '3 夏朝', '4 商朝', '5 周朝']);
    tools.dispose();
    await page.close();
  });
  it('tells the model when navigation lands on an HTTP error page (core-07 f1-b)', async () => {
    const page = await browser.newPage();
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const opened = await tools.execute({ tool: 'navigate', url: `${base}/forbidden` });
    expect(opened.text).toContain('HTTP 403');
    expect(opened.text).toContain('换一个公开页面');
    expect((await tools.execute({ tool: 'navigate', url: `${base}/blog` })).text).not.toContain(
      'HTTP',
    );
    tools.dispose();
    await page.close();
  });
  it('records native dialogs as receipts and keeps their default outcome (core-10 f2-a)', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/alerts`);
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const read = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const ref = (name: string) =>
      String(read.tree).match(new RegExp(`button "${name}" \\[ref=(e\\d+)\\]`))![1]!;
    const revision = read.observationRevision;
    const alert = await tools.execute({
      tool: 'click',
      ref: ref('Click for JS Alert'),
      observationRevision: revision,
    });
    expect(alert.dialogs).toEqual([{ type: 'alert', message: 'I am a JS Alert' }]);
    expect(alert.text).toContain('alert「I am a JS Alert」');
    expect(await page.locator('#r').textContent()).toBe('You successfully clicked an alert');
    const fresh = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const confirmRef = String(fresh.tree).match(
      /button "Click for JS Confirm" \[ref=(e\d+)\]/,
    )![1]!;
    const confirm = await tools.execute({
      tool: 'click',
      ref: confirmRef,
      observationRevision: fresh.observationRevision,
    });
    expect(confirm.dialogs?.[0]?.type).toBe('confirm');
    expect(await page.locator('#r').textContent()).toBe('You clicked: Cancel');
    tools.dispose();
    await page.close();
  });
  it('uses the article region on a generic page', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/blog`);
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const listed = JSON.parse((await tools.execute({ tool: 'sections' })).text);
    expect(listed.scope).toBe('article');
    expect(listed.sections.map((s: { title: string }) => s.title)).toEqual([
      'Intro',
      'Setup',
      'Usage',
    ]);
    tools.dispose();
    await page.close();
  });
});
