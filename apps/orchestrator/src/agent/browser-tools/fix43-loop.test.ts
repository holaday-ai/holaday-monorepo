import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { plainInternalWords, sanitizeFinalText } from '../text-sanitizer.js';
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
const finish = (status: 'completed' | 'failed', summary: string) => ({
  name: 'finish',
  input: { status, summary },
});

describe('FIX-43 #2 · core-06: a give-up on a page without 第N节 is sent back to pick another', () => {
  const INTENT = '请使用云端浏览器，维基百科长页面，分段读取并总结第3节';
  const SHORT =
    'https://zh.wikipedia.org/zh-cn/%E7%BB%B4%E5%9F%BA%E7%99%BE%E7%A7%91%E5%8E%86%E5%8F%B2';
  const LONG = 'https://zh.wikipedia.org/wiki/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD';
  /** Deploy-43 core-06 (tsk_CYux6mjstAM8JDXAdSa3f), its failed finish as delivered. */
  const CORE_06 =
    '部分完成：已访问维基百科长页面《维基百科历史》并调用 sections 获取正文章节列表，但该页正文仅有2个一级章节（第1节「成立与发展」、第2节「重要事件」），不存在用户要求的「第3节」。已读取最末的第2节「重要事件」（含「封锁」小节），内容涵盖中国大陆、英国、土耳其对维基百科的封锁事件。由于页面本身没有第3节，无法按用户原话完成「分段读取并总结第3节」的任务。';
  const wiki = (sectionsOf: (url: string) => Array<{ index: string; title: string }>) => {
    let url = 'about:blank';
    const execute = (async (action: { tool: string; url?: string }) => {
      if (action.tool === 'navigate') url = action.url!;
      if (action.tool === 'sections')
        return {
          ok: true,
          url,
          text: JSON.stringify({ sourceURL: url, sections: sectionsOf(url) }),
        };
      return {
        ok: true,
        url,
        text: JSON.stringify({
          sourceURL: url,
          text:
            url === LONG
              ? '研究課題 人工智能的研究可以分为几个技术问题。'
              : '重要事件 封锁 中国大陆、英国、土耳其曾封锁维基百科。',
        }),
      };
    }) as never;
    return { execute, currentPageUrl: () => url };
  };
  const twoOrThree = (url: string) =>
    url === LONG
      ? [
          { index: '1', title: '概要' },
          { index: '2', title: '历史' },
          { index: '3', title: '研究課題' },
        ]
      : [
          { index: '1', title: '成立与发展' },
          { index: '2', title: '重要事件' },
        ];
  const run = (
    calls: Array<{ name: string; input: Record<string, unknown> }>,
    intent = INTENT,
    sectionsOf = twoOrThree,
  ) => {
    const site = wiki(sectionsOf);
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent,
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
    { name: 'get_page_text', input: { section: '2' } },
  ];

  it('Deploy-43 core-06: the failed finish is sent back once to pick a page with a 第3节', async () => {
    const { seen } = await run([
      ...SHORT_READ,
      finish('failed', CORE_06),
      finish('failed', CORE_06),
    ]);
    expect(seen).toContain('所选页面正文只有 2 节，没有第3节');
    expect(seen).toContain('换一个正文有第3节的长条目');
  });

  it('given up again: its own account is delivered as 部分完成, not failed', async () => {
    const { outcome } = await run([
      ...SHORT_READ,
      finish('failed', CORE_06),
      finish('failed', CORE_06),
    ]);
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: '第3节' } });
    expect((outcome as { summary: string }).summary).toMatch(/^部分完成/);
  });

  it('after switching to a page that has it, the answer completes', async () => {
    const { outcome } = await run([
      ...SHORT_READ,
      finish('failed', CORE_06),
      { name: 'navigate', input: { url: LONG } },
      { name: 'sections', input: {} },
      { name: 'get_page_text', input: { section: '3' } },
      finish('completed', '第3节「研究課題」：人工智能的研究可以分为几个技术问题。'),
    ]);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(outcome).not.toHaveProperty('partial');
  });

  it('reverse: a task naming its page is not sent elsewhere — 部分完成 at once', async () => {
    const { outcome, seen } = await run(
      [...SHORT_READ, finish('failed', CORE_06)],
      `请使用云端浏览器，打开 ${SHORT} 总结第3节`,
    );
    expect(seen).not.toContain('换一个正文有第3节的长条目');
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: '第3节' } });
  });

  it('reverse: a page with no sections at all (a wall, an error page) stays a failure', async () => {
    const { outcome } = await run(
      [...SHORT_READ, finish('failed', '页面无法打开，任务未完成。')],
      INTENT,
      () => [],
    );
    expect(outcome.status).toBe('failed');
  });
});

describe('FIX-43 #3 · reg-dy-2: a named field given as absent gets one look even after a screenshot', () => {
  const INTENT =
    '打开 https://www.douyin.com/video/7377304298310389027 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
  const URL = 'https://www.douyin.com/video/7377304298310389027';
  /** Deploy-43 reg-dy-2 (tsk_qtXRmh8ufb29jCdphkwFL): screenshot taken, author still 「页面未显示」. */
  const REG_DY_2 =
    '已打开指定抖音视频页面并读取到所需信息：\n- 视频标题：第52集 | 柠檬巴巴露亚\n- 作者：页面未显示\n- 点赞数：4741\n- 评论数：214\n- 收藏数：4370\n- 分享数：1652';
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    const execute = (async (action: { tool: string }) => ({
      ok: true,
      url: URL,
      text: JSON.stringify({
        sourceURL: URL,
        tree: 'heading "第52集 | 柠檬巴巴露亚"\n4741 214 4370 1652\n小喵麻麻',
      }),
      ...(action.tool === 'screenshot' ? { image: { mediaType: 'image/jpeg', data: 'AA==' } } : {}),
    })) as never;
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent: INTENT,
      adapter,
      maxSteps: 20,
      observationV2: true,
      execute,
      currentPageUrl: () => URL,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };

  it('the original trace (navigate, snapshot, screenshot) is told to close the popup by its × and look again', async () => {
    const { seen } = await run([
      { name: 'navigate', input: { url: URL } },
      { name: 'snapshot', input: {} },
      { name: 'screenshot', input: {} },
      finish('completed', REG_DY_2),
      finish('completed', REG_DY_2.replace('作者：页面未显示', '作者：小喵麻麻（截图读取）')),
    ]);
    expect(seen).toContain('点弹窗自己的关闭按钮（×，不要按 Esc）');
  });

  it('still absent after the look: delivered as 部分完成, as before', async () => {
    const { outcome } = await run([
      { name: 'navigate', input: { url: URL } },
      { name: 'snapshot', input: {} },
      { name: 'screenshot', input: {} },
      finish('completed', REG_DY_2),
      finish('completed', REG_DY_2),
    ]);
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: '作者' } });
  });
});

describe('FIX-43 #4 · internal words in an answer read as words', () => {
  it.each([
    [
      '页面抓取正文里只出现了几个数字（50、2、10、97、20 等），但没有任何 `[互动=…]` 类标签把它们对应到点赞/评论/收藏/分享。',
      '页面抓取正文里只出现了几个数字（50、2、10、97、20 等），但没有任何 互动类型标签把它们对应到点赞/评论/收藏/分享。',
    ],
    [
      '已在云端浏览器中成功打开 google.com。当前页面 sourceURL 为 https://www.google.com/，快照显示 Google 首页完整加载。',
      '已在云端浏览器中成功打开 google.com。当前页面地址为 https://www.google.com/，快照显示 Google 首页完整加载。',
    ],
  ])('Deploy-43 verbatim: %s', (input, expected) => {
    expect(plainInternalWords(input)).toBe(expected);
    expect(sanitizeFinalText(input)).toBe(expected);
  });
  it.each([
    '在代码里写 `sourceURL` 即可',
    '```\nconst sourceURL = x;\n```',
    '见 https://example.org/?sourceURL=1',
  ])('reverse: 「%s」 is left as written', (text) => {
    expect(plainInternalWords(text)).toBe(text);
  });
});
