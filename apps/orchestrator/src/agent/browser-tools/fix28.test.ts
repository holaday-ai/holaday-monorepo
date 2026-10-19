import { readFileSync } from 'node:fs';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { unvisitedChecks } from './action-claims.js';
import { observationState } from './cloud-observation.js';
import { claimsNoPlayback, installPlaybackGuard } from './playback-guard.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import {
  answeredItems,
  requestedVideoCount,
  videoShortfall,
  youtubeLinkKind,
} from './video-count.js';

const cases = JSON.parse(
  readFileSync(new URL('./fixtures/fix28-cases.json', import.meta.url), 'utf8'),
) as {
  core04: { prompt: string; answer: string; page: { sourceURL: string; tree: string } };
  jaCore08: { answer: string; visitedUrls: string[] };
};

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
const finish = (summary: string) => ({ name: 'finish', input: { status: 'completed', summary } });

/**
 * FIX-28 — Deploy-27 core-04: 「前5个视频」 answered with 3 videos and 2 course
 * cards (`yt-lockup-view-model`, title link `/watch?v=…&list=…`), completed.
 */
describe('core-04: only single videos count toward 「前 N 个视频」', () => {
  const page = [{ text: cases.core04.page.tree, sourceURL: cases.core04.page.sourceURL }];

  it('reads the count the task asks for', () => {
    expect(requestedVideoCount(cases.core04.prompt)).toBe(5);
    expect(requestedVideoCount('请使用云端浏览器，YouTube 返回 top 3 videos about cats')).toBe(3);
    expect(
      requestedVideoCount('请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接'),
    ).toBe(null);
  });

  it.each([
    ['https://www.youtube.com/watch?v=wGr5rz8WGCE&pp=ygUT', 'video'],
    ['https://www.youtube.com/shorts/abc123', 'video'],
    ['https://www.youtube.com/watch?v=4_m3HsaNwOE&list=PLhW3qG5bs', 'playlist'],
    ['https://www.youtube.com/playlist?list=PLhW3qG5bs', 'playlist'],
    ['https://www.youtube.com/@RaghavPal', 'channel'],
    ['https://example.com/watch?v=x', null],
  ])('%s is %s', (url, kind) => {
    expect(youtubeLinkKind(url)).toBe(kind);
  });

  it('the production answer is short: its two course cards are not videos', () => {
    const short = videoShortfall(cases.core04.prompt, cases.core04.answer, page)!;
    expect(short).toMatchObject({ wanted: 5, videos: 3 });
    expect(short.notVideos.map((item) => item.title)).toEqual([
      'Playwright Beginner Tutorials',
      'Playwright with TypeScript',
    ]);
  });

  it('without its own notes the page links still tell the course cards apart', () => {
    const bare = cases.core04.answer.replace(/（课程\/播放列表卡片）/g, '');
    expect(videoShortfall(cases.core04.prompt, bare, page)).toMatchObject({ videos: 3 });
  });

  it('a video whose title starts like a course title is still a video', () => {
    const items = answeredItems(
      '1. Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]\n2. What is Playwright? (🎭 Playwright introduction tutorial, features & demo)',
      page,
    );
    expect(items.map((item) => item.kind)).toEqual(['video', 'video']);
  });

  it('five videos, or an honest 部分完成, pass', () => {
    const five = [
      'What is Playwright? (🎭 Playwright introduction tutorial, features & demo)',
      'Software Testing Course – Playwright, E2E, and AI Agents',
      'Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]',
      'Playwright Automation Full Course for Beginners | Build Production Level Framework from Scratch',
      'Playwright Automation Tutorial for Beginners from Scratch',
    ]
      .map((title, i) => `${i + 1}. ${title}`)
      .join('\n');
    expect(videoShortfall(cases.core04.prompt, five, page)).toBeNull();
    expect(
      videoShortfall(
        cases.core04.prompt,
        `部分完成：只找到 3 个视频，缺 2 个。\n${cases.core04.answer}`,
        page,
      ),
    ).toBeNull();
  });

  it('fewer items without padding is left to the general count check', () => {
    const three = cases.core04.answer
      .split('\n')
      .filter((line) => !/课程/.test(line))
      .join('\n');
    expect(videoShortfall(cases.core04.prompt, three, page)).toBeNull();
  });

  const loop = (answers: string[]) => {
    const { adapter, seen } = scriptedLoop([
      { name: 'snapshot', input: {} },
      ...answers.map(finish),
    ]);
    return runUnifiedBrowserLoop({
      intent: cases.core04.prompt,
      adapter,
      maxSteps: 8,
      execute: async () => ({
        ok: true,
        text: JSON.stringify({
          tree: cases.core04.page.tree,
          sourceURL: cases.core04.page.sourceURL,
        }),
      }),
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };

  it('the production answer is sent back once, naming the course cards', async () => {
    const honest = [
      '部分完成：只找到 3 个单个视频，缺 2 个。',
      '1. What is Playwright? (🎭 Playwright introduction tutorial, features & demo)',
      '2. Software Testing Course – Playwright, E2E, and AI Agents',
      '3. Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]',
    ].join('\n');
    const { outcome, seen } = await loop([cases.core04.answer, honest]);
    expect(seen).toContain('答案里只有 3 个是单个视频');
    expect(seen).toContain('「Playwright Beginner Tutorials」');
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.summary).toMatch(/^部分完成/);
  });

  it('padding again is not delivered as completed', async () => {
    const { outcome } = await loop([cases.core04.answer, cases.core04.answer]);
    expect(outcome).toMatchObject({ status: 'failed', failureSource: 'task' });
  });
});

/** A YouTube results page whose first two results are course cards, in real Chromium. */
describe('a results page that starts with two course cards', () => {
  let browser: Browser;
  const URL_ = 'https://www.youtube.com/results?search_query=Playwright+tutorial';
  const card = (title: string, list: string, lessons: number) =>
    `<yt-lockup-view-model><div class="badge">${lessons} lessons</div><h3><a href="/watch?v=first${list}&amp;list=${list}">${title}</a></h3><span>Course</span><a href="/playlist?list=${list}">View full course</a></yt-lockup-view-model>`;
  const video = (title: string, id: string) =>
    `<ytd-video-renderer><h3><a id="video-title" href="/watch?v=${id}">${title}</a></h3><a href="/@channel${id}">Channel ${id}</a></ytd-video-renderer>`;
  const VIDEOS = [
    'What is Playwright? (introduction tutorial)',
    'Software Testing Course – Playwright, E2E, and AI Agents',
    'Playwright with TypeScript : Learn Playwright Automation from Scratch',
    'Playwright Automation Full Course for Beginners',
    'Playwright Automation Tutorial for Beginners from Scratch',
    'Playwright MCP Master Class',
  ];
  const html = `<!doctype html><title>Playwright tutorial - YouTube</title><main>${card(
    'Playwright Beginner Tutorials',
    'PLaaa',
    16,
  )}${card('Playwright with TypeScript', 'PLbbb', 26)}${VIDEOS.map((t, i) =>
    video(t, `v${i}`),
  ).join('')}</main>`;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  const open = async () => {
    const context = await browser.newContext();
    await context.route('https://www.youtube.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
    );
    const page = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      taskIntent: cases.core04.prompt,
    });
    await tools.execute({ tool: 'navigate', url: URL_ } as never);
    return { context, tools };
  };

  it('links: course cards are playlists, results are videos', async () => {
    const { context, tools } = await open();
    try {
      const { items } = JSON.parse((await tools.execute({ tool: 'links' } as never)).text) as {
        items: Array<{ text: string; kind: string }>;
      };
      const kindOf = (text: string) => items.find((item) => item.text === text)?.kind;
      expect(kindOf('Playwright Beginner Tutorials')).toBe('playlist');
      expect(kindOf('View full course')).toBe('playlist');
      expect(kindOf(VIDEOS[0]!)).toBe('video');
      expect(kindOf(VIDEOS[2]!)).toBe('video');
    } finally {
      tools.dispose();
      await context.close();
    }
  });

  it('a snapshot read tells course cards from videos', async () => {
    const { context, tools } = await open();
    try {
      const read = JSON.parse((await tools.execute({ tool: 'snapshot' } as never)).text);
      const pages = [{ text: String(read.tree), sourceURL: URL_ }];
      const padded = [
        'Playwright Beginner Tutorials',
        'Playwright with TypeScript',
        ...VIDEOS.slice(0, 3),
      ]
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n');
      expect(answeredItems(padded, pages).map((item) => item.kind)).toEqual([
        'playlist',
        'playlist',
        'video',
        'video',
        'video',
      ]);
      expect(videoShortfall(cases.core04.prompt, padded, pages)).toMatchObject({ videos: 3 });
    } finally {
      tools.dispose();
      await context.close();
    }
  });

  it('the loop sends a padded answer back; five videos complete', async () => {
    const { context, tools } = await open();
    try {
      const padded = [
        'Playwright Beginner Tutorials',
        'Playwright with TypeScript',
        ...VIDEOS.slice(0, 3),
      ]
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n');
      const five = VIDEOS.slice(0, 5)
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n');
      const { adapter, seen } = scriptedLoop([
        { name: 'snapshot', input: {} },
        finish(padded),
        { name: 'scroll', input: { direction: 'down' } },
        { name: 'snapshot', input: {} },
        finish(five),
      ]);
      const outcome = await runUnifiedBrowserLoop({
        intent: cases.core04.prompt,
        adapter,
        maxSteps: 10,
        observationV2: true,
        execute: (action) => tools.execute(action as never),
      });
      expect(seen.join('\n')).toContain('这些不是视频');
      expect(outcome.status).toBe('completed');
      expect(outcome.status === 'completed' && outcome.summary).toContain(VIDEOS[4]);
    } finally {
      tools.dispose();
      await context.close();
    }
  });
});

/**
 * FIX-28 — replay frames under the playback guard: a player told play()
 * succeeded kept redrawing its progress bar, so the page never settled across a
 * screenshot. Refused like a browser refuses autoplay, it settles.
 */
describe('a guarded player settles', () => {
  let browser: Browser;
  // A player that redraws its progress bar while it believes it is playing.
  const html = `<!doctype html><body><div id="bar" aria-valuenow="0"></div><video id="v" muted width="160" height="90"></video>
<script>
const v = document.getElementById('v');
const c = document.createElement('canvas'); c.width = 160; c.height = 90;
v.srcObject = c.captureStream(10);
v.play().then(() => setInterval(() => document.getElementById('bar').setAttribute('aria-valuenow', String(v.currentTime)), 100),
  () => document.getElementById('bar').setAttribute('data-state', 'play-button'));
</script></body>`;
  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
  });
  afterAll(async () => {
    await browser?.close();
  });
  it('the page does not change across a screenshot, and the player shows its play button', async () => {
    const context = await browser.newContext();
    await installPlaybackGuard(context);
    const page = await context.newPage();
    try {
      // A canvas-stream video never fires `load` (with or without the guard).
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      let changed = 0;
      for (let i = 0; i < 5; i++) {
        const before = (await observationState(page.mainFrame())).version;
        await page.screenshot({ type: 'jpeg', quality: 45 });
        await page.waitForTimeout(150);
        if ((await observationState(page.mainFrame())).version !== before) changed++;
      }
      expect(changed).toBe(0);
      expect(await page.getAttribute('#bar', 'data-state')).toBe('play-button');
      expect(
        await page.evaluate(() => (document.getElementById('v') as HTMLVideoElement).paused),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe('「未播放」 is about playback, not the page', () => {
  it.each([
    '页面没有播放列表，列出的都是单个视频',
    '这些不是播放列表',
    '页面没有播放次数，只有点赞数',
    '页面未显示播放量',
    '没有播放按钮可点',
    'did not find a playlist',
  ])('「%s」 is not a 未播放 claim', (answer) => {
    expect(claimsNoPlayback(answer)).toBe(false);
  });
  it.each(['视频未播放，只读取了标题', '全程没有播放视频', '未主动播放', 'did not play the video'])(
    '「%s」 is one',
    (answer) => {
      expect(claimsNoPlayback(answer)).toBe(true);
    },
  );
});

describe('an entry without a playback receipt does not fail 「未播放」', () => {
  const run = (playbackReceipt?: () => Promise<null>) => {
    const { adapter, seen } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://www.youtube.com/watch?v=x' } },
      { name: 'read_page', input: {} },
      finish('视频标题：Me at the zoo（未播放）'),
      finish('视频标题：Me at the zoo（未播放）'),
    ]);
    return runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，YouTube 公开视频页读标题（不播放）',
      adapter,
      maxSteps: 6,
      ...(playbackReceipt ? { playbackReceipt } : {}),
      execute: async (action) =>
        action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: 'https://www.youtube.com/watch?v=x' }
          : { ok: true, text: 'heading "Me at the zoo"\nMe at the zoo' },
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  it('no receipt function: not checked, delivered', async () => {
    const { outcome, seen } = await run();
    expect(seen).not.toContain('没有播放状态回执');
    expect(outcome.status).toBe('completed');
  });
  it('a receipt function that reads nothing: still sent back, then failed', async () => {
    const { outcome, seen } = await run(async () => null);
    expect(seen).toContain('没有播放状态回执');
    expect(outcome.status).toBe('failed');
  });
});

/** FIX-27 ja core-08: 「其余表单页（inputs、dropdown、radio_buttons、tinymce）均不含…」. */
describe('pages named as checked must have been opened', () => {
  const run = {
    visitedUrls: cases.jaCore08.visitedUrls,
    loginPageVisited: false,
    filled: true,
    typedTexts: ['Test User'],
  };
  it('the ja answer names dropdown and radio_buttons, never opened', () => {
    const found = unvisitedChecks(cases.jaCore08.answer, run);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('dropdown、radio_buttons');
  });
  it.each([
    '手动访问 /datepicker 返回 404；/large_form 为敏感输入页被遮挡无法读取',
    '其余表单页（inputs、tinymce）均不含日期选择器',
    '从 Wikipedia 页面（tab_0e443644-2dd9-4eba-a9b4-9cdc03a61a4a）打开了 3 个链接',
    'the-internet.herokuapp.com 的 Inputs、Large Form 页面无 date 日期控件',
    '未打开 /login 登录页',
    '页面（Customer name、Telephone）已填写',
    // Scan of 410 real answers: titles in brackets are not page lists.
    '已使用云端浏览器访问 the-internet.herokuapp.com 的 iframe 页面（标题为 "An iFrame containing the TinyMCE WYSIWYG Editor"）',
    '最后已切换回打开这些链接的起始页面（Web browser - Wikipedia，tab_6c0885e4-4ff2-4f07-bfa7-48f8ccc47b10）',
  ])('no false hit: %s', (answer) => {
    expect(unvisitedChecks(answer, run)).toEqual([]);
  });
  it.each(['已检查 /dropdown 和 /inputs，均无日期控件', '逐项查看了表单页（checkboxes、inputs）'])(
    'caught: %s',
    (answer) => {
      expect(unvisitedChecks(answer, run).length).toBe(1);
    },
  );

  const loop = (answers: string[]) => {
    const { adapter, seen } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://the-internet.herokuapp.com/inputs' } },
      { name: 'read_page', input: {} },
      ...answers.map(finish),
    ]);
    let url = 'about:blank';
    return runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，the-internet.herokuapp.com 找日期控件，没有就说明',
      adapter,
      maxSteps: 6,
      currentPageUrl: () => url,
      execute: async (action) => {
        if (action.tool === 'navigate') {
          url = (action as { url: string }).url;
          return { ok: true, text: '已打开', url };
        }
        return { ok: true, text: 'heading "Inputs"\nNumber', url };
      },
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const claimed = '其余表单页（inputs、dropdown、radio_buttons）均不含日期控件。';
  const honest = '只打开了 /inputs 页，该页只有数字输入框，没有日期控件。';
  it('sent back once; the honest rewrite is delivered', async () => {
    const { outcome, seen } = await loop([claimed, honest]);
    expect(seen).toContain('本次没有打开过：dropdown、radio_buttons');
    expect(outcome.status).toBe('completed');
  });
  it('a repeat is not delivered as completed', async () => {
    const { outcome } = await loop([claimed, claimed]);
    expect(outcome.status).toBe('failed');
  });
});
