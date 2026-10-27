import { describe, expect, it } from 'vitest';
import { extractStructuredItems, reviewListAnswer } from '../../execution/answer-verifier.js';
import type { ExecutionContract } from '../../execution/execution-contract.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { contentIds, namedContentUrl, onNamedContent } from './content-target.js';
import { siteEntryHint } from './site-entry-hints.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

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

/** Deploy-41 dy-1 (tsk_okbqkQc9mtTeDv3YziGan). */
const DY1_PROMPT =
  '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
const DY1_URL = 'https://www.douyin.com/video/7507106798919601427';
const OTHER_VIDEO = 'https://www.douyin.com/jingxuan?modal_id=7688783892253347098';
const OTHER_TITLE = '中式梦核恐怖游戏《童年诡事录》的一命速通体验分享';
const NAMED_TITLE = '杭州西湖四季';
/** The answer Deploy-41 delivered as completed (title of the other video). */
const DY1_ANSWER = `已打开抖音指定视频页面并读取到所需信息。视频标题为「${OTHER_TITLE}」；作者为「查理蛙A」。页面互动数字未带明确标签，无法确认各自对应的指标类型。`;

describe('FIX-41 #1 · content-target: the content an address names', () => {
  it.each([
    [DY1_URL, ['7507106798919601427']],
    [OTHER_VIDEO, ['7688783892253347098']],
    ['https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8', ['6929ba55000000001e023ef8']],
    ['https://item.jd.com/100142621606.html', ['100142621606']],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', ['dQw4w9WgXcQ']],
    ['https://en.wikipedia.org/wiki/Web_browser', []],
    ['https://baike.baidu.com/item/西湖/4668821', []],
  ])('%s → %j', (url, ids) => {
    expect(contentIds(url)).toEqual(ids);
  });

  it('dy-1, xhs-read and fc-jd name one piece of content', () => {
    expect(namedContentUrl(DY1_PROMPT)).toBe(DY1_URL);
    expect(
      namedContentUrl(
        '打开 https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8 读这篇笔记的标题、作者和点赞数',
      ),
    ).toBe('https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8');
    expect(
      namedContentUrl('打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格'),
    ).toBe('https://item.jd.com/100142621606.html');
  });

  it.each([
    '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个',
    '打开 https://www.douyin.com/video/7507106798919601427 然后点开作者主页读粉丝数',
    '打开 https://www.douyin.com/video/7507106798919601427 再搜索同名视频',
    '打开 https://en.wikipedia.org/wiki/Web_browser 读第一段',
    '比较 https://item.jd.com/100142621606.html 和 https://item.jd.com/100000000001.html 的价格',
  ])('reverse: 「%s」 is not held to one content', (intent) => {
    expect(namedContentUrl(intent)).toBeNull();
  });

  it('the same video under another address is the named content; another video is not', () => {
    expect(
      onNamedContent(DY1_URL, 'https://www.douyin.com/jingxuan?modal_id=7507106798919601427'),
    ).toBe(true);
    expect(onNamedContent(DY1_URL, `${DY1_URL}?previous_page=web_code_link`)).toBe(true);
    expect(onNamedContent(DY1_URL, OTHER_VIDEO)).toBe(false);
    expect(onNamedContent(DY1_URL, 'https://www.douyin.com/jingxuan')).toBe(false);
    // Another site (a wall's host, about:blank) is judged by its own checks.
    expect(onNamedContent(DY1_URL, 'about:blank')).toBe(true);
    expect(onNamedContent(DY1_URL, 'https://passport.example.com/login')).toBe(true);
  });
});

describe('FIX-41 #1 · dy-1: Esc moved the page to another video', () => {
  /** Douyin as Deploy-41 met it: Esc on the named video lands on the 精选 feed's other video. */
  const douyin = (opts: { reopenLandsElsewhere?: boolean } = {}) => {
    let url = 'about:blank';
    let opened = 0;
    const calls: Array<{ tool: string; url?: string }> = [];
    const page = () => ({
      ok: true,
      url,
      text: JSON.stringify({
        sourceURL: url,
        tree: url.includes('7507106798919601427')
          ? `heading "${NAMED_TITLE}"\nlink "@西湖摄影"`
          : `heading "${OTHER_TITLE}"\nlink "@查理蛙A"`,
      }),
    });
    const execute = (async (action: { tool: string; url?: string }) => {
      calls.push({ tool: action.tool, ...(action.url ? { url: action.url } : {}) });
      if (action.tool === 'navigate') {
        url = opts.reopenLandsElsewhere && opened++ > 0 ? OTHER_VIDEO : action.url!;
        return page();
      }
      if (action.tool === 'press_key') {
        if (url.includes('7507106798919601427')) url = OTHER_VIDEO;
        return { ok: true, url, text: '已按 Escape' };
      }
      if (action.tool === 'wait_for') return { ok: true, url, text: 'ok' };
      return page();
    }) as never;
    return { execute, calls, currentPageUrl: () => url };
  };
  const ORIGINAL = [
    { name: 'navigate', input: { url: DY1_URL } },
    { name: 'wait_for', input: { text: '点赞' } },
    { name: 'snapshot', input: {} },
    { name: 'press_key', input: { key: 'Escape' } },
    { name: 'snapshot', input: {} },
  ];
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>, site = douyin()) => {
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent: DY1_PROMPT,
      adapter,
      maxSteps: 20,
      observationV2: true,
      execute: site.execute,
      currentPageUrl: site.currentPageUrl,
    }).then((outcome) => ({ outcome, seen: seen.join('\n'), site }));
  };

  it('the original trace: after Esc the host reopens the named video before anything is read', async () => {
    const site = douyin();
    const { outcome, seen } = await run(
      [...ORIGINAL, finish(`视频标题为「${NAMED_TITLE}」；作者为「西湖摄影」。`)],
      site,
    );
    expect(site.calls.filter((call) => call.tool === 'navigate')).toEqual([
      { tool: 'navigate', url: DY1_URL },
      { tool: 'navigate', url: DY1_URL },
    ]);
    expect(seen).toContain('宿主已重新打开点名页面');
    expect(site.currentPageUrl()).toBe(DY1_URL);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { summary: string }).summary).toContain(NAMED_TITLE);
  });

  it("the other video's title is never completed: sent back once, then the task fails", async () => {
    // Douyin keeps sending the page to the other video, even when reopened.
    const { outcome, seen } = await run(
      [
        ...ORIGINAL,
        finish(DY1_ANSWER),
        { name: 'navigate', input: { url: DY1_URL } },
        finish(DY1_ANSWER),
      ],
      douyin({ reopenLandsElsewhere: true }),
    );
    expect(seen).toContain('不是任务点名的 https://www.douyin.com/video/7507106798919601427');
    expect(outcome.status).toBe('failed');
    expect((outcome as { reason: string }).reason).toContain('页面跳到了别的内容');
    expect(JSON.stringify(outcome)).not.toContain(OTHER_TITLE);
  });

  it("an answer citing another video's address is not completed either", async () => {
    const { outcome } = await run([
      { name: 'navigate', input: { url: DY1_URL } },
      { name: 'snapshot', input: {} },
      finish(`视频标题为「${NAMED_TITLE}」，见 ${OTHER_VIDEO}`),
      finish(`视频标题为「${NAMED_TITLE}」，见 ${OTHER_VIDEO}`),
    ]);
    expect(outcome.status).toBe('failed');
  });

  it('reverse: the same video under ?modal_id= is not reopened and completes', async () => {
    let url = 'about:blank';
    const calls: string[] = [];
    const execute = (async (action: { tool: string; url?: string }) => {
      calls.push(action.tool);
      if (action.tool === 'navigate') url = action.url!;
      if (action.tool === 'press_key')
        url = 'https://www.douyin.com/jingxuan?modal_id=7507106798919601427';
      return {
        ok: true,
        url,
        text: JSON.stringify({ sourceURL: url, tree: `heading "${NAMED_TITLE}"` }),
      };
    }) as never;
    const { adapter } = scriptedLoop([...ORIGINAL, finish(`视频标题为「${NAMED_TITLE}」。`)]);
    const outcome = await runUnifiedBrowserLoop({
      intent: DY1_PROMPT,
      adapter,
      maxSteps: 20,
      observationV2: true,
      execute,
      currentPageUrl: () => url,
    });
    expect(calls.filter((tool) => tool === 'navigate')).toHaveLength(1);
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('reverse: a task that names no content is not held to its first page', async () => {
    const site = douyin();
    const { adapter } = scriptedLoop([...ORIGINAL, finish(`视频标题为「${OTHER_TITLE}」。`)]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://www.douyin.com/video/7507106798919601427 然后点开作者主页读作者名',
      adapter,
      maxSteps: 20,
      observationV2: true,
      execute: site.execute,
      currentPageUrl: site.currentPageUrl,
    });
    expect(site.calls.filter((call) => call.tool === 'navigate')).toHaveLength(1);
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});

describe('FIX-41 #2 · core-06: a page with no 第N节 is not completed', () => {
  const INTENT = '请使用云端浏览器，维基百科长页面，分段读取并总结第3节';
  const SHORT = 'https://zh.wikipedia.org/zh-cn/%E7%BB%B4%E5%9F%BA%E7%99%BE%E7%A7%91';
  const LONG = 'https://zh.wikipedia.org/wiki/%E6%9D%AD%E5%B7%9E%E5%B8%82';
  /** Deploy-41 core-06, verbatim lead: the honest answer marked completed. */
  const CORE_06 =
    '当前维基百科页面《维基百科历史》仅有2个正文章节（1.成立与发展、2.重要事件），不存在“第3节”。已按章节列表确认并完整读取了最接近的第1节“成立与发展”全文，以下为该节总结：维基百科最初作为Nupedia的辅助wiki项目于2001年1月15日上线。';
  const wiki = () => {
    let url = 'about:blank';
    const sections = () =>
      url === LONG
        ? [
            { index: '1', title: '名称' },
            { index: '2', title: '地理' },
            { index: '3', title: '历史' },
          ]
        : [
            { index: '1', title: '成立与发展' },
            { index: '2', title: '重要事件' },
          ];
    const execute = (async (action: { tool: string; url?: string }) => {
      if (action.tool === 'navigate') url = action.url!;
      if (action.tool === 'sections')
        return { ok: true, url, text: JSON.stringify({ sourceURL: url, sections: sections() }) };
      return {
        ok: true,
        url,
        text: JSON.stringify({
          sourceURL: url,
          text:
            url === LONG
              ? '历史 杭州建城于秦代，隋朝开凿大运河后成为重要商埠。'
              : '成立与发展 维基百科最初作为Nupedia的辅助wiki项目于2001年1月15日上线。',
        }),
      };
    }) as never;
    return { execute, currentPageUrl: () => url };
  };
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    const site = wiki();
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent: INTENT,
      adapter,
      maxSteps: 20,
      observationV2: true,
      execute: site.execute,
      currentPageUrl: site.currentPageUrl,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const SHORT_READ = [
    { name: 'navigate', input: { url: SHORT } },
    { name: 'sections', input: {} },
    { name: 'get_page_text', input: { section: '1' } },
  ];

  it('Deploy-41 core-06: sent back to try a page with a 第3节', async () => {
    const { seen } = await run([...SHORT_READ, finish(CORE_06), finish(CORE_06)]);
    expect(seen).toContain('所选页面正文只有 2 节，没有第3节');
    expect(seen).toContain('换一个正文有第3节的长条目');
  });

  it('the same answer again is delivered as 部分完成, not completed', async () => {
    const { outcome } = await run([...SHORT_READ, finish(CORE_06), finish(CORE_06)]);
    expect(outcome).toMatchObject({
      status: 'completed',
      partial: { found: 0, wanted: 1, missing: '第3节' },
    });
    expect((outcome as { summary: string }).summary).toMatch(/^部分完成：所选页面正文没有第3节/);
  });

  it('a page that has the 第3节, read and named, completes', async () => {
    const { outcome } = await run([
      ...SHORT_READ,
      finish(CORE_06),
      { name: 'navigate', input: { url: LONG } },
      { name: 'sections', input: {} },
      { name: 'get_page_text', input: { section: '3' } },
      finish('第3节「历史」：杭州建城于秦代，隋朝开凿大运河后成为重要商埠。'),
    ]);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(outcome).not.toHaveProperty('partial');
  });
});

describe("FIX-41 #3 · core-08: the-internet's date box is on /large_form", () => {
  it('the core-08 prompt is pointed at /large_form', () => {
    expect(
      siteEntryHint(
        '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图',
      ),
    ).toContain('https://the-internet.herokuapp.com/large_form（Birthday，type=date）');
  });
  it.each([
    '请使用云端浏览器，the-internet.herokuapp.com/download 下载小文件，报告文件名与大小',
    '请使用云端浏览器，httpbin.org/forms/post 填表单，只填不提交并截图',
    '请使用云端浏览器，the-internet.herokuapp.com/large_form 填日期',
  ])('reverse: 「%s」 gets no date hint', (intent) => {
    expect(siteEntryHint(intent) ?? '').not.toContain('large_form（Birthday');
  });
});

describe('FIX-41 #4 · core-01: a title and its link on two lines are one result', () => {
  /** Deploy-41 core-01 (tsk_XkeSpCUjPfKa4AZqYvKPJ), the list as delivered. */
  const CORE_01 = [
    '已从指定的 Brave 搜索接口页面通过 links 工具提取前 5 条搜索结果。',
    '',
    '- 第1条标题：Hola / An AI companion to talk to. Anytime, about anything.',
    '- 第1条链接：https://holaapp.in/',
    '- 第2条标题：Hola: Talk It Out with AI - Apps on Google Play',
    '- 第2条链接：https://play.google.com/store/apps/details?id=ai.holaapp&hl=en_US',
    '- 第3条标题：Tryholo',
    '- 第3条链接：https://tryholo.ai/',
    '- 第4条标题：HolaAI-Chat Dream - Apps on Google Play',
    '- 第4条链接：https://play.google.com/store/apps/details?id=app.ultra.hola.ai.eu',
    '- 第5条标题：Hola: Talk It Out with AI for Android - Free App',
    '- 第5条链接：https://www.appbrain.com/app/hola-talk-it-out-with-ai/ai.holaapp',
  ].join('\n');
  const contract = {
    successCriteria: [
      {
        id: 'c1',
        type: 'list_item_sources',
        description: '',
        data: { minItems: 5, searchResults: true },
      },
    ],
  } as unknown as ExecutionContract;

  it('five results, each with its own link; no 缺少来源链接', () => {
    const items = extractStructuredItems(CORE_01);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.url)).toEqual([
      'https://holaapp.in/',
      'https://play.google.com/store/apps/details?id=ai.holaapp&hl=en_US',
      'https://tryholo.ai/',
      'https://play.google.com/store/apps/details?id=app.ultra.hola.ai.eu',
      'https://www.appbrain.com/app/hola-talk-it-out-with-ai/ai.holaapp',
    ]);
    expect(reviewListAnswer(contract, CORE_01)).toBeNull();
  });

  it('reverse: a title whose link is missing is still flagged', () => {
    const missing = CORE_01.replace('- 第3条链接：https://tryholo.ai/\n', '');
    expect(reviewListAnswer(contract, missing)).toContain('第 3 条缺少来源链接');
  });

  it('reverse: bullets without an ordinal stay one result each', () => {
    expect(
      extractStructuredItems('- Alpha https://a.test/1\n- Beta https://b.test/2'),
    ).toHaveLength(2);
  });
});

describe("FIX-41 #4 · core-07: new tabs' document titles are host facts", () => {
  const TITLES: Record<string, string> = {
    source: 'Web browser - Wikipedia',
    t1: 'Safari (web browser) - Wikipedia',
    t2: 'MacBook - Wikipedia',
    t3: 'Wikipedia - Wikipedia',
  };
  const H1: Record<string, string> = {
    source: 'Web browser',
    t1: 'Safari (web browser)',
    t2: 'MacBook',
    t3: 'Wikipedia',
  };
  const execute = () => {
    let active = 'source';
    let next = 0;
    const calls: string[] = [];
    const fn = (async (action: { tool: string; targetTabId?: string }) => {
      calls.push(action.tool);
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
      // Like a cloud read: the h1, not the document title.
      return {
        ok: true,
        tabId: active,
        text: JSON.stringify({
          tabId: active,
          sourceURL: active === 'source' ? 'https://en.wikipedia.org/wiki/Web_browser' : undefined,
          headings: [{ level: 1, text: H1[active] }],
          tree: `heading "${H1[active]}" [level=1]`,
        }),
      };
    }) as never;
    return { fn, calls };
  };
  /** Deploy-41 core-07: its fields, as the model sent them. */
  const finishWith = (titles: string[]) => ({
    name: 'finish',
    input: {
      status: 'completed',
      summary: CORE_07,
      fields: titles.map((value, i) => ({ name: `新标签${i + 1}标题`, value })),
    },
  });
  /** Deploy-41 core-07, verbatim. */
  const CORE_07 =
    '已从起始页面 https://en.wikipedia.org/wiki/Web_browser 打开3个链接到新标签页，分别读取标题后切回起始页面：\n1. Safari (web browser) - Wikipedia\n2. MacBook - Wikipedia\n3. Wikipedia - Wikipedia\n当前活动标签已回到起始页 Web browser - Wikipedia。';

  it("the answer's three tab titles are not marked 未核实", async () => {
    const { fn, calls } = execute();
    const { adapter } = scriptedLoop([
      { name: 'read_page', input: {} },
      { name: 'click', input: { ref: 'e1', newTab: true } },
      { name: 'read_page', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      { name: 'click', input: { ref: 'e2', newTab: true } },
      { name: 'read_page', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      { name: 'click', input: { ref: 'e3', newTab: true } },
      { name: 'read_page', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      finishWith([
        'Safari (web browser) - Wikipedia',
        'MacBook - Wikipedia',
        'Wikipedia - Wikipedia',
      ]),
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个',
      adapter,
      maxSteps: 20,
      observationV2: true,
      supportedTools: { download: false, upload: false, tabs: true },
      execute: fn,
    });
    expect(calls).toContain('list_tabs');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { summary: string }).summary).not.toContain('未核实');
  });

  it('reverse: a title no tab has is still marked 未核实', async () => {
    const { fn } = execute();
    const { adapter } = scriptedLoop([
      { name: 'read_page', input: {} },
      { name: 'click', input: { ref: 'e1', newTab: true } },
      { name: 'read_page', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      { name: 'click', input: { ref: 'e2', newTab: true } },
      { name: 'read_page', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      { name: 'click', input: { ref: 'e3', newTab: true } },
      { name: 'read_page', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      finishWith([
        'Safari (web browser) - Wikipedia',
        'MacBook Air - Wikipedia',
        'Wikipedia - Wikipedia',
      ]),
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个',
      adapter,
      maxSteps: 20,
      observationV2: true,
      supportedTools: { download: false, upload: false, tabs: true },
      execute: fn,
    });
    expect((outcome as { summary: string }).summary).toContain(
      '新标签2标题「MacBook Air - Wikipedia」',
    );
  });
});
