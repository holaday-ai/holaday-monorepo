import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { assessCompletionFacts } from './completion-fields.js';
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
  // FIX-31 (Deploy-31 dy-1): autoplay that the guard paused at once (playing fired,
  // currentTime 1, nothing in the played ranges) is not 「未播放」; a page that only set
  // its progress bar is.
  it('a playing event the guard stopped at once: 「未播放」 sent back, the honest rewrite completes', async () => {
    const stoppedAtOnce: PlaybackReceipt = {
      guarded: true,
      media: [{ kind: 'video', paused: true, currentTime: 1, playedSeconds: 0, everPlayed: true }],
      playedSeconds: 0,
      playing: false,
    };
    const { outcome, seen } = await run(
      [
        deploy26.answer,
        '未主动播放；页面曾自动播放，已暂停。标题：Rick Astley - Never Gonna Give You Up',
      ],
      stoppedAtOnce,
    );
    expect(seen).toContain('曾自动开始播放');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('a progress bar the page set without playing still proves 「未播放」', async () => {
    const seeked: PlaybackReceipt = {
      guarded: true,
      media: [{ kind: 'video', paused: true, currentTime: 1, playedSeconds: 0, everPlayed: false }],
      playedSeconds: 0,
      playing: false,
    };
    const { outcome, seen } = await run([deploy26.answer], seeked);
    expect(seen).not.toContain('不能写「未播放」');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  // FIX-31 (local core-10 / xhs-read): finish(status=completed) whose answer opens with
  // 「部分完成」 is delivered as 部分完成, not completed.
  it('an answer opening with 「部分完成」 is partial whatever finish status came with it', async () => {
    const { outcome } = await run(
      [
        '部分完成：标题「Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)」，频道 Rick Astley；点赞数页面被拦截，未能读取。',
      ],
      paused,
    );
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { partial?: unknown }).partial).toBeDefined();
  });
  it('a full answer is not partial', async () => {
    const { outcome } = await run(
      [
        '标题「Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)」，频道 Rick Astley。',
      ],
      paused,
    );
    expect((outcome as { partial?: unknown }).partial).toBeUndefined();
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
  it('a wiki h1 with its edit link ("万维网[编辑]") still matches the title (xa/xb core-07)', async () => {
    const edited = { ...TITLES };
    for (const id of ['t1', 't2', 't3']) TITLES[id] = `${edited[id]!.split(' - ')[0]}[编辑]`;
    try {
      const { outcome, seen } = await loop([
        ...open3.slice(0, 6),
        { name: 'switch_tab', input: { targetTabId: 't1' } },
        { name: 'switch_tab', input: { targetTabId: 't2' } },
        { name: 'switch_tab', input: { targetTabId: 't3' } },
        { name: 'switch_tab', input: { targetTabId: 'source' } },
        allTitles,
      ]);
      expect(seen).not.toContain('标题没写进答案');
      expect(outcome).toMatchObject({ status: 'completed' });
    } finally {
      Object.assign(TITLES, edited);
    }
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

describe('va core-08: a later answer failing does not undo the held 部分完成', () => {
  const CORE08 =
    '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图';
  it('delivers the held 部分完成 when the last answer fails its check', async () => {
    const bad = {
      name: 'finish',
      input: {
        status: 'completed',
        summary: '部分完成：另见字段。',
        fields: [
          {
            name: 'the_internet_inputs_control',
            value: '仅含 number spinbutton',
            tabId: 'tab_closed',
          },
        ],
      },
    };
    const { adapter } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e21', text: 'Test User' } },
      { name: 'screenshot', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary:
            '部分完成：已在 httpbin.org/forms/post 填写 Customer name=Test User，未提交并截图；两个网站都没有日期控件。',
        },
      },
      bad,
      bad,
      bad,
    ]);
    let url = 'about:blank';
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE08,
      adapter,
      maxSteps: 14,
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
        return { ok: true, text: 'textbox "Customer name" Test User', url };
      }) as never,
    });
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: '日期控件' } });
    expect(outcome.status === 'completed' && outcome.summary).toMatch(/^部分完成：已在 httpbin/);
  });
});

describe('vb core-08: a form task that lands on a login page goes back instead of pausing', () => {
  const run = (intent: string) => {
    const { adapter, seen } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://the-internet.herokuapp.com/login' } },
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      { name: 'finish', input: { status: 'failed', summary: '没有找到日期控件。' } },
    ]);
    let url = 'about:blank';
    return runUnifiedBrowserLoop({
      intent,
      adapter,
      maxSteps: 6,
      currentPageUrl: () => url,
      probeBlocker: async () =>
        /\/login/.test(url)
          ? { reason: 'login', message: '页面遇到登录墙，需要你接管登录；当前任务尚未完成。' }
          : null,
      execute: (async (action: { tool: string; url?: string }) => {
        if (action.tool === 'navigate') url = action.url!;
        return { ok: true, text: '已打开', url };
      }) as never,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  it('the form task is told to go back to the form', async () => {
    const { outcome, seen } = await run(
      '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图',
    );
    expect(seen).toContain('这是登录页，任务不需要登录');
    expect(outcome.status).not.toBe('awaiting_user');
  });
  it('a task that is not a named-site form task still pauses at the login wall', async () => {
    const { outcome } = await run('请使用云端浏览器，打开 the-internet.herokuapp.com 读取页面标题');
    expect(outcome.status).toBe('awaiting_user');
  });
});

describe('wa core-08: an answer may not deny what the run did, nor leave out the fill', async () => {
  const { deniedActions, omitsFill } = await import('./action-claims.js');
  const wa = JSON.parse(
    readFileSync(new URL('./fixtures/fix27-wa-core08.json', import.meta.url), 'utf8'),
  ) as { answer: string };
  const ran = {
    visitedUrls: [
      'https://httpbin.org/forms/post',
      'https://the-internet.herokuapp.com/',
      'https://the-internet.herokuapp.com/login',
    ],
    loginPageVisited: true,
    filled: true,
    typedTexts: ['Test User', '1234567890'],
  };
  it('the wa answer denies opening /login and leaves out the fill', () => {
    expect(deniedActions(wa.answer, ran)[0]).toContain('不予打开');
    expect(omitsFill(wa.answer, ran)).toBe(true);
  });
  it('the same words are fine when the run never opened a login page', () => {
    const clean = { ...ran, visitedUrls: ran.visitedUrls.slice(0, 2), loginPageVisited: false };
    expect(deniedActions(wa.answer, clean)).toEqual([]);
  });
  it.each([
    [
      '已在 YouTube 公开视频页（https://www.youtube.com/watch?v=x）读取到四项信息（未点击播放按钮、未改变播放器状态）',
      ['https://www.youtube.com/watch?v=x'],
    ],
    [
      '本次未打开 Google 结果页，而是读取了 https://search-results.holaday.invalid/search?q=x',
      ['https://search-results.holaday.invalid/search?q=x', 'https://www.google.com/search?q=x'],
    ],
    ['本次未实际访问 weather.gov.sg', ['https://weather.yahoo.com/sg']],
    ['httpbin 没有日期控件，因此未填写日期控件', ['https://httpbin.org/forms/post']],
  ])('no denial: %s', (answer, urls) => {
    expect(deniedActions(answer, { ...ran, visitedUrls: urls, loginPageVisited: false })).toEqual(
      [],
    );
  });
  it.each([['没有打开 the-internet.herokuapp.com/login 页面'], ['本次未进行表单填写']])(
    'denial caught: %s',
    (answer) => {
      expect(deniedActions(answer, ran).length).toBeGreaterThan(0);
    },
  );
  it('a fill is mentioned by its value or by 已…填写', () => {
    expect(
      omitsFill('部分完成：已在 httpbin.org/forms/post 填写 Customer name，未提交。', ran),
    ).toBe(false);
    expect(omitsFill('部分完成：Customer name 为 Test User，没有日期控件。', ran)).toBe(false);
    expect(omitsFill('部分完成：没有日期控件。', { ...ran, filled: false })).toBe(false);
  });

  const loop = (answers: string[]) => {
    const { adapter, seen } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e21', text: 'Test User' } },
      { name: 'screenshot', input: {} },
      { name: 'navigate', input: { url: 'https://the-internet.herokuapp.com/login' } },
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      ...answers.map((summary) => ({ name: 'finish', input: { status: 'completed', summary } })),
    ]);
    let url = 'about:blank';
    return runUnifiedBrowserLoop({
      intent:
        '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图',
      adapter,
      maxSteps: 14,
      currentPageUrl: () => url,
      probeBlocker: async () =>
        /\/login/.test(url) ? { reason: 'login', message: '页面遇到登录墙' } : null,
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
        return { ok: true, text: 'textbox "Customer name" Test User', url };
      }) as never,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const honest =
    '部分完成：已在 httpbin.org/forms/post 填写 Customer name=Test User，未提交并截图。查找日期控件时曾打开过 the-internet 的 /login 登录页，被提示不需要登录后回到表单页。两个网站都没有日期控件。';
  it('the wa answer is sent back once; the honest rewrite is delivered', async () => {
    const { outcome, seen } = await loop([wa.answer, honest]);
    expect(seen).toContain('不要否认做过的事');
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.summary).toContain(
      '曾打开过 the-internet 的 /login',
    );
  });
  it('a repeated denial is not delivered as completed', async () => {
    const { outcome } = await loop([wa.answer, wa.answer]);
    expect(outcome.status).toBe('failed');
  });
});

describe('部分完成 only when something asked for is missing', () => {
  it('the prompt says so', async () => {
    const { UNIFIED_BROWSER_SYSTEM_PROMPT } = await import('./unified-browser-loop.js');
    expect(UNIFIED_BROWSER_SYSTEM_PROMPT).toContain('用户要的内容都齐了就不要写「部分完成」');
  });
});

/**
 * FIX-27 17:45 — core-02 ya/yb: weather.com prints pressure as two nodes,
 * 「"29.89"」「in」. The check missed 「29.89 in」 and told it against rainfall's
 * 「0 in」; and the page's own address, filed under the results tab that linked
 * to it (Brave lists /weather/today/l/…, which lands on /sg/city/singapore/today),
 * was called 「来自其他页面」.
 */
describe("core-02: split values and the page's own address", () => {
  const core02 = JSON.parse(
    readFileSync(new URL('./fixtures/fix27-core02-weather.json', import.meta.url), 'utf8'),
  ) as {
    searchPage: { tabId: string; sourceURL: string; tree: string };
    weatherPage: { tabId: string; sourceURL: string; tree: string; text: string };
    answers: Record<'ya' | 'yb', string>;
  };
  const intent = '请使用云端浏览器，Google 搜索「新加坡 天气」读出天气卡片';
  const weatherUrl = 'https://weather.com/zh-CN/sg/city/singapore/today';
  const pages = [
    { text: core02.searchPage.tree, tabId: 'tab_search', sourceURL: core02.searchPage.sourceURL },
    {
      text: core02.weatherPage.tree,
      tabId: 'tab_weather',
      sourceURL: core02.weatherPage.sourceURL,
    },
  ];
  const check = (summary: string, fields: unknown[] = []) =>
    assessCompletionFacts({ summary, fields, pages, intent }).contradictions;

  it('the fixture is what the runs read', () => {
    expect(core02.weatherPage.sourceURL).toBe(weatherUrl);
    expect(core02.weatherPage.tree).toMatch(
      /- generic \[ref=e\d+\]: "29\.89"\n\s*- generic \[ref=e\d+\]: in/,
    );
    expect(core02.weatherPage.tree).toMatch(/- paragraph \[ref=e\d+\]: 0 in/);
    expect(core02.searchPage.tree).toContain('weather.com/zh-CN/weather/today/l/');
    expect(core02.searchPage.tree).not.toContain(weatherUrl);
  });

  it.each(['ya', 'yb'] as const)("%s: the run's own answer passes", (round) => {
    expect(
      check(core02.answers[round], [
        { name: '气压', value: '29.89 in', tabId: 'tab_weather' },
        { name: '天气来源链接', value: weatherUrl, tabId: 'tab_search' },
      ]),
    ).toEqual([]);
  });

  it('a text read with the value and unit on separate lines passes, and tells a mismatch', () => {
    const text = [{ text: core02.weatherPage.text, tabId: 'tab_weather', sourceURL: weatherUrl }];
    const facts = (value: string) =>
      assessCompletionFacts({
        summary: '',
        fields: [{ name: '气压', value, tabId: 'tab_weather' }],
        pages: text,
        intent,
      }).contradictions;
    expect(facts('29.89 in')).toEqual([]);
    expect(facts('29.99 in')).toEqual(['气压「29.99 in」 与页面不符；页面为「29.89 in」']);
  });

  it('a different pressure is told against the pressure, not the rainfall', () => {
    expect(check('', [{ name: '气压', value: '29.99 in' }])).toEqual([
      '气压「29.99 in」 与页面不符；页面为「29.89 in」',
    ]);
    expect(check('', [{ name: '气压', value: '29.99 in', tabId: 'tab_weather' }])).toEqual([
      '气压「29.99 in」 与页面不符；页面为「29.89 in」',
    ]);
  });

  it('joined nodes are matched as whole values only', () => {
    // 「89 in」 is inside 「29.89 in」 only as a fragment.
    expect(check('', [{ name: '气压', value: '89 in', tabId: 'tab_weather' }])).toEqual([
      '气压「89 in」 与页面不符；页面为「29.89 in」',
    ]);
  });

  it("a page the run never opened is still not the results tab's content", () => {
    const radar = 'https://weather.com/zh-CN/sg/city/singapore/radar';
    expect(check('', [{ name: '雷达链接', value: radar, tabId: 'tab_search' }])).toEqual([
      `雷达链接「${radar}」 来自其他页面，不是 标签 tab_search 的内容`,
    ]);
  });
});

/**
 * FIX-27 — za core-02: right after a snapshot of the results page the model
 * clicked e44 three times with a revision no read had issued (its arguments
 * were not kept; e44 itself was valid, and the same click with the snapshot's
 * revision opens the link). Three stale refs failed the task.
 */
describe('a mis-copied observation revision', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const { searchResultsHtml } = await import('../search-fallback/search-results-page.js');
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url?.startsWith('/target'))
        return res.end('<!doctype html><title>Target</title><h1>Target page</h1>');
      res.end(
        searchResultsHtml({
          query: '新加坡 天气',
          label: 'Brave 搜索接口',
          results: Array.from({ length: 10 }, (_, i) => ({
            url: `${base}/target/${i}`,
            title: `结果 ${i}`,
            snippet: '摘要',
          })),
        }),
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
  const open = async () => {
    const page = await (await browser.newContext()).newPage();
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    await tools.execute({ tool: 'navigate', url: `${base}/results` } as never);
    const read = JSON.parse((await tools.execute({ tool: 'snapshot' } as never)).text) as {
      tree: string;
      observationRevision: string;
    };
    const ref = read.tree.match(/link "结果 9" \[ref=(e\d+)\]/)![1]!;
    return { page, tools, read, ref };
  };

  it.each([
    ['a garbled revision', { observationRevision: 'e3dc01aa-c82a-48f2-a364-9e4ea4ab3e5' }],
    ['no revision', {}],
  ])('%s on an unchanged page clicks the ref the model saw', async (_label, revision) => {
    const { page, tools, ref } = await open();
    try {
      const r = await tools.execute({ tool: 'click', ref, ...revision } as never);
      expect(r.errorCode).toBeUndefined();
      await page.waitForURL(/\/target\/9$/);
    } finally {
      tools.dispose();
      await page.context().close();
    }
  });

  it('a revision that was issued but is out of date stays stale', async () => {
    const { page, tools, read, ref } = await open();
    try {
      await page.evaluate(() =>
        document.querySelector('ol')!.prepend(document.createElement('li')),
      );
      const again = JSON.parse((await tools.execute({ tool: 'snapshot' } as never)).text);
      expect(again.observationRevision).not.toBe(read.observationRevision);
      const old = await tools.execute({
        tool: 'click',
        ref,
        observationRevision: read.observationRevision,
      } as never);
      expect(old.errorCode).toBe('stale_ref');
      expect(page.url()).toMatch(/\/results$/);
    } finally {
      tools.dispose();
      await page.context().close();
    }
  });

  it('a garbled revision after the structure changed stays stale', async () => {
    const { page, tools, ref } = await open();
    try {
      await page.evaluate(() => {
        const list = document.querySelector('ol')!;
        list.prepend(list.lastElementChild!.cloneNode(true));
      });
      await tools.execute({ tool: 'snapshot' } as never);
      const r = await tools.execute({
        tool: 'click',
        ref,
        observationRevision: 'garbled',
      } as never);
      expect(r.errorCode).toBe('stale_ref');
      expect(page.url()).toMatch(/\/results$/);
    } finally {
      tools.dispose();
      await page.context().close();
    }
  });

  it('a garbled revision on another document stays stale', async () => {
    const { page, tools, ref } = await open();
    try {
      await page.goto(`${base}/results?again=1`);
      const r = await tools.execute({
        tool: 'click',
        ref,
        observationRevision: 'garbled',
      } as never);
      expect(r.errorCode).toBe('stale_ref');
      expect(page.url()).toMatch(/again=1$/);
    } finally {
      tools.dispose();
      await page.context().close();
    }
  });
});

/**
 * FIX-27 — zb core-07: clicking a wiki preview whose text reads 「…locate
 * shared resources…」 was taken for a 「share」 button and paused a read-only
 * task for confirmation. English control words now match as whole words.
 */
describe('English control words are whole words', () => {
  const zb =
    'Browser service or Computer Browser Service is a feature of Microsoft Windows to let users easily browse and locate shared resources in neighboring computers. This is done by aggregating the informati';
  it.each([
    zb,
    'Shareholders of the company',
    'Removed from the list in 2019',
    'Publisher: Penguin',
    'Transferable skills',
    'Sending data over HTTP',
  ])('「%s」 is not a control that needs confirmation', (label) => {
    expect(classifyRuntimeAction({ kind: 'click', label }).allowed).toBe(true);
  });
  it.each([
    'Share',
    'Send',
    'Delete',
    'Remove from cart',
    'deleteItem',
    'send_message',
    'PayNow',
    'Buy now',
    'Buy it now',
    'Place your order',
    'Confirm and pay',
    'Proceed to payment',
    'Checkout',
    'Publish post',
    '发送',
    '立即购买',
  ])('「%s」 still needs confirmation', (label) => {
    const verdict = classifyRuntimeAction({ kind: 'click', label });
    expect(verdict.allowed).toBe(false);
    expect(verdict.requiresConfirmation).toBe(true);
  });
});

/**
 * PR #286 review — four points from the automated review, each with its own
 * test: the playback guard is given back when the task ends; one-token
 * identifiers still need confirmation; a read tab with no title asks for
 * list_tabs; a search query is not a disclosed form fill.
 */
describe('PR #286 review', () => {
  describe('the playback guard is given back when the task ends', () => {
    let browser: Browser;
    let server: Server;
    let base: string;
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
    const visit = async (page: import('playwright').Page, intent: string) => {
      const tools = createPlaywrightUnifiedExecutor(page, {
        observationV2: true,
        taskIntent: intent,
      });
      await tools.execute({ tool: 'navigate', url: `${base}?${Math.random()}` } as never);
      await page.waitForTimeout(1500);
      return { tools, receipt: (await tools.playbackReceipt())! };
    };

    it('a retained browser plays for the next task, and a later 不播放 task guards again', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const first = await visit(page, deploy26.prompt);
        expect(first.receipt.playing).toBe(false);
        await first.tools.releasePlayback();
        first.tools.dispose();
        // The page still open: its own play() works again.
        await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).play());
        await page.waitForTimeout(800);
        expect(
          await page.evaluate(() => !(document.querySelector('video') as HTMLVideoElement).paused),
        ).toBe(true);
        // The next task in the same context, without the constraint: new pages autoplay.
        const second = await visit(page, '请使用云端浏览器，打开这个视频页读标题');
        expect(second.receipt.playing).toBe(true);
        expect(second.receipt.media[0]!.currentTime).toBeGreaterThan(0.5);
        second.tools.dispose();
        // A later 不播放 task in the same context is guarded again.
        const third = await visit(page, deploy26.prompt);
        expect(third.receipt.playing).toBe(false);
        expect(third.receipt.playedSeconds).toBeLessThan(1);
        third.tools.dispose();
      } finally {
        await context.close();
      }
    });

    it('while the task runs, the guard holds', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const { tools } = await visit(page, deploy26.prompt);
        // FIX-28: refused the way a browser refuses autoplay.
        const refused = await page.evaluate(() =>
          (document.querySelector('video') as HTMLVideoElement).play().then(
            () => 'played',
            (error: DOMException) => error.name,
          ),
        );
        expect(refused).toBe('NotAllowedError');
        await page.waitForTimeout(800);
        expect((await tools.playbackReceipt())!.playing).toBe(false);
        tools.dispose();
      } finally {
        await context.close();
      }
    });
  });

  it.each(['sendmessage', 'deleteaccount', 'publishpost', 'sharenow', 'removeitem'])(
    'a one-token identifier 「%s」 still needs confirmation',
    (name) => {
      expect(classifyRuntimeAction({ kind: 'click', name }).requiresConfirmation).toBe(true);
      expect(classifyRuntimeAction({ kind: 'click', label: name }).requiresConfirmation).toBe(true);
    },
  );

  describe('a read tab with no title is asked for by list_tabs', () => {
    const TITLES: Record<string, string> = {
      t1: 'Alpha - Site',
      t2: 'Beta - Site',
      t3: 'Gamma - Site',
    };
    const execute = () => {
      let active = 'source';
      let next = 0;
      return (async (action: { tool: string; targetTabId?: string }) => {
        if (action.tool === 'click') {
          active = `t${++next}`;
          return { ok: true, text: `已打开新标签 ${active}`, tabId: active, openedTab: true };
        }
        if (action.tool === 'list_tabs')
          return {
            ok: true,
            text: JSON.stringify({
              tabs: Object.entries(TITLES).map(([tabId, title]) => ({ tabId, title })),
            }),
          };
        if (action.tool === 'switch_tab') active = action.targetTabId!;
        // No h1 on any page: the read carries no title.
        return {
          ok: true,
          tabId: active,
          text: JSON.stringify({ tabId: active, headings: [], tree: 'paragraph "text"' }),
        };
      }) as never;
    };
    const opened = [
      { name: 'read_page', input: {} },
      { name: 'click', input: { ref: 'e1', newTab: true } },
      { name: 'switch_tab', input: { targetTabId: 't1' } },
      { name: 'click', input: { ref: 'e2', newTab: true } },
      { name: 'switch_tab', input: { targetTabId: 't2' } },
      { name: 'click', input: { ref: 'e3', newTab: true } },
      { name: 'switch_tab', input: { targetTabId: 't3' } },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
    ];
    const finish = (summary: string) => ({
      name: 'finish',
      input: { status: 'completed', summary },
    });
    const loop = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
      const { adapter, seen } = scriptedLoop(calls);
      return runUnifiedBrowserLoop({
        intent: '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个',
        adapter,
        maxSteps: 20,
        observationV2: true,
        supportedTools: { download: false, upload: false, tabs: true },
        execute: execute(),
      }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
    };
    it('an answer naming nothing is sent back for list_tabs; with the titles it completes', async () => {
      const { outcome, seen } = await loop([
        ...opened,
        finish('打开了 3 个链接并读取了标题，已切回原标签。'),
        { name: 'list_tabs', input: {} },
        finish('三个标题：Alpha - Site、Beta - Site、Gamma - Site。已切回原标签。'),
      ]);
      expect(seen).toContain('请用 list_tabs 查看它的标题');
      expect(outcome).toMatchObject({ status: 'completed' });
    });
    it('after list_tabs, a missing title is told like any other', async () => {
      const { outcome } = await loop([
        ...opened,
        { name: 'list_tabs', input: {} },
        finish('标题：Alpha - Site。已切回原标签。'),
        finish('标题：Alpha - Site。已切回原标签。'),
      ]);
      expect(outcome).toMatchObject({ status: 'failed', failureSource: 'task' });
    });
    it('a page with no title at all does not fail the task after the one return', async () => {
      const { outcome } = await loop([
        ...opened,
        finish('打开了 3 个链接，这些页面都没有标题，已切回原标签。'),
        finish('打开了 3 个链接，这些页面都没有标题，已切回原标签。'),
      ]);
      expect(outcome).toMatchObject({ status: 'completed' });
    });
  });

  describe('a search query is not a disclosed form fill', () => {
    const loop = (answers: string[]) => {
      const { adapter, seen } = scriptedLoop([
        { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
        { name: 'type', input: { ref: 'e1', text: 'pizza order form' } },
        { name: 'type', input: { ref: 'e21', text: 'Test User' } },
        { name: 'screenshot', input: {} },
        ...answers.map((summary) => ({ name: 'finish', input: { status: 'completed', summary } })),
      ]);
      return runUnifiedBrowserLoop({
        intent: '请使用云端浏览器，在 httpbin.org/forms/post 填表单，只填不提交并截图',
        adapter,
        maxSteps: 12,
        execute: (async (action: { tool: string; url?: string; ref?: string }) => {
          if (action.tool === 'navigate') return { ok: true, text: '已打开', url: action.url };
          if (action.tool === 'type')
            return {
              ok: true,
              text: '已输入',
              form: {
                ref: action.ref,
                filled: true,
                submitted: false,
                ...(action.ref === 'e1' ? { search: true } : {}),
              },
            };
          if (action.tool === 'screenshot')
            return { ok: true, text: '截图', image: { mediaType: 'image/jpeg', data: 'AA==' } };
          return { ok: true, text: 'textbox "Customer name" Test User' };
        }) as never,
      }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
    };
    it('an answer repeating only the search query is asked for the fields it filled', async () => {
      const { seen } = await loop([
        '搜索了「pizza order form」，打开了表单页并截图，未提交。',
        '已在 httpbin.org/forms/post 填写 Customer name=Test User，未提交并截图。',
      ]);
      expect(seen).toContain('答案没有写出本次已经在表单里填写了哪些字段');
    });
    it('an answer naming the filled value passes without a return', async () => {
      const { seen } = await loop(['Customer name 填入 Test User，未提交并截图。']);
      expect(seen).not.toContain('答案没有写出本次已经在表单里填写了哪些字段');
    });
  });
});
