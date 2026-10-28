import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { humanizeToolMentions, sanitizeFinalText } from '../text-sanitizer.js';
import { fieldLabel, fieldLines, runUnifiedBrowserLoop } from './unified-browser-loop.js';

function scriptedLoop(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  let turn = 0;
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create() {
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
  return adapter;
}

describe('FIX-45 #5 · call arguments and the snapshot tool name in prose', () => {
  it.each([
    [
      // Deploy-45 core-11 (tsk_GCYCX5X8zRQPoqdciTUyk)
      '已在 https://the-internet.herokuapp.com/infinite_scroll 页面连续向下滚动5次（每次 amount=5），页面高度从1091增长到3107，确认内容持续增长。',
      '已在 https://the-internet.herokuapp.com/infinite_scroll 页面连续向下滚动5次，页面高度从1091增长到3107，确认内容持续增长。',
    ],
    [
      // Deploy-45 core-10 (tsk_LX6BZ6j8EvdogCd7FDv8k)
      '最后一次 snapshot 显示 Result 文本为 "You entered: null"（Prompt 取消未输入的结果）。',
      '最后一次 页面读取 显示 Result 文本为 "You entered: null"（Prompt 取消未输入的结果）。',
    ],
  ])('Deploy-45 verbatim: %s', (input, expected) => {
    expect(humanizeToolMentions(input)).toBe(expected);
  });
  it.each([
    '每页显示（每次 3 个）结果',
    'Jest snapshot testing compares output',
    '在代码里调用 `snapshot()` 即可',
    '方程的解（x=2）成立',
  ])('reverse: 「%s」 is left as written', (text) => {
    expect(humanizeToolMentions(text)).toBe(text);
  });
});

describe('FIX-45 #5 · snake_case field names read in Chinese', () => {
  it.each([
    ['video_title', '视频标题'],
    ['author_name', '作者名称'],
    ['like_count', '点赞数'],
    ['collect_count', '收藏数'],
    ['latest_version', '最新版本'],
    ['macos_compatibility', 'macOS适用系统'],
    ['js_alert_result', 'JS Alert结果'],
    ['original_page_title', '起始页面标题'],
    ['latestVersion', '最新版本'],
  ])('%s → %s', (name, label) => {
    expect(fieldLabel(name)).toBe(label);
  });
  it.each(['价格', '作者', 'SKU', 'iPhone', 'macOS', 'URL'])('reverse: 「%s」 is kept', (name) => {
    expect(fieldLabel(name)).toBe(name);
  });
  it('Deploy-45 dy-1 fields as listed', () => {
    expect(
      fieldLines(
        [
          { name: 'video_title', value: '仙桥洞 真的好美' },
          { name: 'author_name', value: '利利的旅行盲盒' },
          { name: 'like_count', value: '20' },
        ],
        '已读取抖音视频页（未播放），获取到标题、作者及四项互动数据。',
      ),
    ).toBe('- 视频标题：仙桥洞 真的好美\n- 作者名称：利利的旅行盲盒\n- 点赞数：20');
  });
});

describe('FIX-45 #5 · core-03: the wall notice is not said twice, and points up', () => {
  const URL = 'https://www.youtube.com/watch?v=MaISfxEQmLM';
  const NOTICE = '播放器需登录验证，未主动播放，以下为页面公开信息。';
  const run = (summary: string) =>
    runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，YouTube 公开视频页读标题/频道/播放量/发布日期（不播放）',
      adapter: scriptedLoop([
        { name: 'navigate', input: { url: URL } },
        { name: 'snapshot', input: {} },
        { name: 'finish', input: { status: 'completed', summary } },
      ]),
      maxSteps: 6,
      currentPageUrl: () => URL,
      probeBlocker: async () =>
        ({ reason: 'login', disposition: 'continue', message: NOTICE }) as never,
      execute: (async () => ({
        ok: true,
        url: URL,
        text: JSON.stringify({
          sourceURL: URL,
          tree: 'heading "Gaggle" The White House 85K views 6d ago',
        }),
      })) as never,
    });

  it('Deploy-45 core-03: the answer already tells of the login popup — no second notice', async () => {
    const outcome = await run(
      '已从 YouTube 公开视频页（未播放）读取到：标题 Gaggle；频道 The White House；播放量 85K views；发布日期 6d ago。\n\n注：页面存在登录验证弹窗，但未影响上述公开字段读取；未进行任何播放或登录操作。',
    );
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && sanitizeFinalText(outcome.summary)).not.toContain(
      '播放器需登录验证',
    );
  });

  it('reverse: an answer that does not tell of it gets the notice, pointing up', async () => {
    const outcome = await run(
      '已从 YouTube 公开视频页（未播放）读取到：标题 Gaggle；频道 The White House；播放量 85K views；发布日期 6d ago。',
    );
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.summary).toContain(
      '播放器需登录验证，未主动播放，以上为页面公开信息。',
    );
  });
});
