import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { admitsAutoplay, claimsNoPlayback, forbidsPlayback } from './playback-guard.js';
import type { PlaybackReceipt } from './playback-guard.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** FIX-27 — Deploy-26 core-03: the video autoplayed and the answer said 未播放. */
const deploy26 = JSON.parse(
  readFileSync(new URL('./fixtures/deploy26-core03.json', import.meta.url), 'utf8'),
) as {
  prompt: string;
  url: string;
  answer: string;
  backgroundRequests: Array<{ url: string; method: string; action: string; branch: string }>;
};

describe('the wording', () => {
  it.each([
    [deploy26.prompt, true],
    ['请使用云端浏览器，打开视频页，不要播放', true],
    ['open the video page without playing it', true],
    ['请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题', false],
  ])('%s forbids playback: %s', (intent, expected) => {
    expect(forbidsPlayback(intent)).toBe(expected);
  });
  it('tells a claim of no playback from an honest autoplay admission', () => {
    expect(claimsNoPlayback(deploy26.answer)).toBe(true);
    expect(admitsAutoplay(deploy26.answer)).toBe(false);
    const honest = '未主动播放；页面曾自动播放约 12 秒，已暂停。';
    expect(claimsNoPlayback(honest) && admitsAutoplay(honest)).toBe(true);
    expect(admitsAutoplay('已禁止自动播放，未播放')).toBe(false);
  });
});

describe('the playback guard on a real autoplaying video', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  // A muted autoplay video fed by a canvas stream, plus a page script that calls play().
  const html = `<!doctype html><body><video id="v" autoplay muted playsinline width="160" height="90"></video>
<script>
const c = document.createElement('canvas'); c.width = 160; c.height = 90;
const g = c.getContext('2d'); let n = 0;
setInterval(() => { g.fillStyle = n++ % 2 ? '#c00' : '#00c'; g.fillRect(0, 0, 160, 90); }, 50);
const v = document.getElementById('v'); v.srcObject = c.captureStream(20);
setTimeout(() => v.play().catch(() => {}), 300);
</script></body>`;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/watch`;
    browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
  });
  afterAll(async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const visit = async (intent: string) => {
    const page = await (await browser.newContext()).newPage();
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      taskIntent: intent,
    });
    try {
      await tools.execute({ tool: 'navigate', url: base } as never);
      await page.waitForTimeout(1500);
      return await tools.playbackReceipt();
    } finally {
      tools.dispose();
      await page.context().close();
    }
  };
  it('with 不播放, the video stays paused and the receipt shows ~0 s played', async () => {
    const receipt = (await visit(deploy26.prompt))!;
    expect(receipt.guarded).toBe(true);
    expect(receipt.media).toHaveLength(1);
    expect(receipt.media[0]).toMatchObject({ kind: 'video', paused: true, everPlayed: false });
    expect(receipt.playing).toBe(false);
    expect(receipt.playedSeconds).toBeLessThan(1);
  });
  it('without the constraint, nothing is touched and the video plays', async () => {
    const receipt = (await visit('请使用云端浏览器，打开这个视频页读标题'))!;
    expect(receipt.guarded).toBe(false);
    expect(receipt.playing).toBe(true);
    expect(receipt.media[0]!.currentTime).toBeGreaterThan(0.5);
  });
});

describe('a "未播放" answer is checked against the receipt and pings', () => {
  const READ = `heading "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)"\nRick Astley\n1.8B views\n16y ago`;
  const run = (
    answers: string[],
    receipt: PlaybackReceipt | null,
    pings: UnifiedToolResult['effect'] | undefined = undefined,
  ) => {
    let turn = 0;
    const seen: string[] = [];
    const calls = [
      { name: 'navigate', input: { url: deploy26.url } },
      { name: 'read_page', input: {} },
      ...answers.map((summary) => ({ name: 'finish', input: { status: 'completed', summary } })),
    ];
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
    return runUnifiedBrowserLoop({
      intent: deploy26.prompt,
      adapter,
      maxSteps: 8,
      execute: (async (action: { tool: string }) =>
        action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: deploy26.url, ...(pings ? { effect: pings } : {}) }
          : { ok: true, text: READ, url: deploy26.url }) as never,
      currentPageUrl: () => deploy26.url,
      playbackReceipt: async () => receipt,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const paused: PlaybackReceipt = {
    guarded: true,
    media: [{ kind: 'video', paused: true, currentTime: 0, playedSeconds: 0, everPlayed: false }],
    playedSeconds: 0,
    playing: false,
  };
  const autoplayed: PlaybackReceipt = {
    guarded: false,
    media: [
      { kind: 'video', paused: true, currentTime: 12.4, playedSeconds: 12.4, everPlayed: true },
    ],
    playedSeconds: 12.4,
    playing: false,
  };
  const deploy26Effect = {
    formChanged: false,
    domChanged: true,
    urlChanged: true,
    unexpected: false,
    networkCategories: ['GET:document'],
    backgroundRequests: deploy26.backgroundRequests,
  } as UnifiedToolResult['effect'];

  it('Deploy-26: the production answer with its playback pings is sent back, then fails if repeated', async () => {
    const { outcome, seen } = await run([deploy26.answer, deploy26.answer], null, deploy26Effect);
    expect(seen).toContain('有 YouTube 播放统计请求');
    expect(seen).toContain('不能写「未播放」');
    expect(outcome).toMatchObject({ status: 'failed', failureSource: 'task' });
  });
  it('a receipt showing 12 s played: the honest rewrite completes', async () => {
    const { outcome, seen } = await run(
      [
        deploy26.answer,
        '未主动播放；页面曾自动播放约 12 秒，已暂停。标题：Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
      ],
      autoplayed,
    );
    expect(seen).toContain('约 12 秒');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('a paused receipt with nothing played proves "未播放"', async () => {
    const { outcome, seen } = await run([deploy26.answer], paused);
    expect(seen).not.toContain('不能写「未播放」');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('no receipt at all: "未播放" cannot be delivered as completed', async () => {
    const { outcome } = await run([deploy26.answer, deploy26.answer], null);
    expect(outcome.status).toBe('failed');
  });
  it('an answer that makes no playback claim is not checked', async () => {
    const { outcome, seen } = await run(
      ['标题：Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)'],
      null,
    );
    expect(seen).not.toContain('不能写「未播放」');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});

/** FIX-27 rounds: ua core-07 read one of three titles; ua core-08 ran out of steps. */
function scriptedLoop(calls: Array<{ name: string; input: Record<string, unknown> }>) {
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
}

describe('ua core-07: every opened tab is read and its title is in the answer', () => {
  const OPEN3 = '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个';
  const TITLES: Record<string, string> = {
    source: 'Python - 维基百科，自由的百科全书',
    t1: 'CPython - 维基百科，自由的百科全书',
    t2: 'PyPy - 维基百科，自由的百科全书',
    t3: 'Stackless Python - 维基百科，自由的百科全书',
  };
  const browser = () => {
    let active = 'source';
    let next = 0;
    const read = () => ({
      ok: true,
      tabId: active,
      text: JSON.stringify({
        tabId: active,
        headings: [{ level: 1, text: TITLES[active] }],
        tree: `heading "${TITLES[active]}" [level=1]`,
      }),
    });
    const execute = async (action: {
      tool: string;
      targetTabId?: string;
    }): Promise<UnifiedToolResult> => {
      if (action.tool === 'click') {
        active = `t${++next}`;
        return {
          ok: true,
          text: `已打开新标签 ${active}`,
          tabId: active,
          openedTab: true,
          url: `https://zh.wikipedia.org/wiki/${active}`,
        };
      }
      if (action.tool === 'switch_tab') active = action.targetTabId!;
      return read() as UnifiedToolResult;
    };
    return execute;
  };
  const open3 = [
    { name: 'read_page', input: {} },
    { name: 'click', input: { ref: 'e1', newTab: true } },
    { name: 'switch_tab', input: { targetTabId: 'source' } },
    { name: 'click', input: { ref: 'e2', newTab: true } },
    { name: 'switch_tab', input: { targetTabId: 'source' } },
    { name: 'click', input: { ref: 'e3', newTab: true } },
    { name: 'switch_tab', input: { targetTabId: 't1' } },
    { name: 'switch_tab', input: { targetTabId: 'source' } },
  ];
  const oneTitle = {
    name: 'finish',
    input: {
      status: 'completed',
      summary:
        '打开了 CPython、PyPy、Stackless Python 三个链接，读取了第一个新标签标题「CPython - 维基百科，自由的百科全书」，已切回原标签。',
    },
  };
  const allTitles = {
    name: 'finish',
    input: {
      status: 'completed',
      summary:
        '三个新标签标题：1. CPython - 维基百科，自由的百科全书 2. PyPy - 维基百科，自由的百科全书 3. Stackless Python - 维基百科，自由的百科全书。已切回原标签。',
    },
  };
  const loop = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent: OPEN3,
      adapter,
      maxSteps: 20,
      observationV2: true,
      supportedTools: { download: false, upload: false, tabs: true },
      execute: browser() as never,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  it('the ua answer (one title) is sent back naming the unread tabs; reading them completes', async () => {
    const { outcome, seen } = await loop([
      ...open3,
      oneTitle,
      { name: 'switch_tab', input: { targetTabId: 't2' } },
      { name: 'switch_tab', input: { targetTabId: 't3' } },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      allTitles,
    ]);
    expect(seen).toContain('新标签 t2、t3 还没有读取');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('a repeated one-title answer fails instead of completing', async () => {
    const { outcome } = await loop([...open3, oneTitle, oneTitle]);
    expect(outcome).toMatchObject({ status: 'failed', failureSource: 'task' });
  });
  it('an answer with every title read passes without a return', async () => {
    const { outcome, seen } = await loop([
      ...open3.slice(0, 6),
      { name: 'switch_tab', input: { targetTabId: 't1' } },
      { name: 'switch_tab', input: { targetTabId: 't2' } },
      { name: 'switch_tab', input: { targetTabId: 't3' } },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      allTitles,
    ]);
    expect(seen).not.toContain('还没有读取');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});

describe('ua core-08: an honest 部分完成 is delivered if the run then runs out of steps', () => {
  const CORE08 =
    '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图';
  const run = (fill: boolean) => {
    const { adapter } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      { name: 'snapshot', input: {} },
      ...(fill ? [{ name: 'type', input: { ref: 'e21', text: 'Test User' } }] : []),
      { name: 'screenshot', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary:
            '部分完成：已在 httpbin.org/forms/post 填写 Customer name=Test User，未提交并截图；两个网站都没有日期控件。',
        },
      },
      // Then it keeps looking around until the steps run out.
      { name: 'navigate', input: { url: 'https://the-internet.herokuapp.com/' } },
    ]);
    let url = 'about:blank';
    return runUnifiedBrowserLoop({
      intent: CORE08,
      adapter,
      maxSteps: 9,
      currentPageUrl: () => url,
      execute: (async (action: { tool: string; url?: string; ref?: string }) => {
        if (action.tool === 'navigate') {
          url = action.url!;
          return { ok: true, text: '已打开', url };
        }
        if (action.tool === 'type')
          return {
            ok: true,
            text: '已输入',
            form: { ref: action.ref, filled: true, submitted: false },
          };
        if (action.tool === 'screenshot')
          return { ok: true, text: '截图', image: { mediaType: 'image/jpeg', data: 'AA==' } };
        return {
          ok: true,
          text: 'textbox "Customer name" Test User\ntextbox "Preferred delivery time" type=time',
          url,
        };
      }) as never,
    });
  };
  it('delivers the held answer as 部分完成', async () => {
    const outcome = await run(true);
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: '日期控件' } });
    expect(outcome.status === 'completed' && outcome.summary).toMatch(/^部分完成：已在 httpbin/);
  });
  it('with nothing filled, nothing is held and it fails as before', async () => {
    const outcome = await run(false);
    expect(outcome.status).toBe('failed');
  });
});
