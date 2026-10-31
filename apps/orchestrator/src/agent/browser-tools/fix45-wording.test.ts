import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { humanizeToolMentions, sanitizeFinalText } from '../text-sanitizer.js';
import { declinedTargets } from './completion-coverage.js';
import { assessCompletionFacts } from './completion-fields.js';
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

describe('FIX-45 · core-10 (local A/B B): a named part the answer says it did not do is no completed answer', () => {
  /** FIX-45 local A/B, B core-10 (tsk_ibM62QTQwBxXiBHoF5DZC), verbatim but the 未核实 note. */
  const B_CORE_10 =
    '已在 the-internet.herokuapp.com/javascript_alerts 页面依次点击三个按钮触发原生对话框：\n1. Click for JS Alert → 弹出 alert「I am a JS Alert」，自动确认后页面 Result 显示 "You successfully clicked an alert"。\n2. Click for JS Confirm → 弹出 confirm「I am a JS Confirm」，自动取消后页面 Result 显示 "You clicked: Cancel"。\n3. Click for JS Prompt → 弹出 prompt「I am a JS prompt」，未输入直接关闭后页面 Result 显示 "You entered: null"。\n\n注：该页面不包含 iframe；用户提及的 iframe 未在 JavaScript Alerts 页面体现，本次仅按用户明确要求的 JavaScript alerts 交互执行并记录结果。';
  const ALERTS_PAGE = {
    text: 'heading "JavaScript Alerts" button "Click for JS Alert" button "Click for JS Confirm" button "Click for JS Prompt" Result: You entered: null',
    sourceURL: 'https://the-internet.herokuapp.com/javascript_alerts',
  };

  it('verbatim: iframe is a declined part (only the alerts page was read)', () => {
    expect(
      declinedTargets(
        '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts',
        B_CORE_10,
        [ALERTS_PAGE],
      ),
    ).toEqual(['iframe']);
  });
  it('reverse: the iframe page was read — nothing declined', () => {
    expect(
      declinedTargets(
        '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts',
        B_CORE_10,
        [
          ALERTS_PAGE,
          {
            text: 'heading "An iFrame containing the TinyMCE WYSIWYG Editor" iframe',
            sourceURL: 'https://the-internet.herokuapp.com/iframe',
          },
        ],
      ),
    ).toEqual([]);
  });

  // The same shape in the loop, with a part that needs no dialog receipts: 「iframe 与 checkboxes」.
  const INTENT = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 checkboxes';
  const BOXES = 'https://the-internet.herokuapp.com/checkboxes';
  const IFRAME = 'https://the-internet.herokuapp.com/iframe';
  const DECLINED =
    '已在 the-internet.herokuapp.com/checkboxes 页面读取到两个复选框：checkbox 1 未勾选，checkbox 2 已勾选。\n\n注：该页面不包含 iframe；本次仅按 checkboxes 执行并记录结果。';
  const PAGE = (url: string) =>
    url === IFRAME
      ? 'heading "An iFrame containing the TinyMCE WYSIWYG Editor" iframe Rich Text Area Your content goes here.'
      : 'heading "Checkboxes" checkbox 1 checkbox 2 checked';
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    let url = 'about:blank';
    const seen: string[] = [];
    let turn = 0;
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
      intent: INTENT,
      adapter,
      maxSteps: 12,
      observationV2: true,
      currentPageUrl: () => url,
      execute: (async (action: { tool: string; url?: string }) => {
        if (action.tool === 'navigate') url = action.url!;
        return { ok: true, url, text: JSON.stringify({ sourceURL: url, tree: PAGE(url) }) };
      }) as never,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const finish = (summary: string) => ({ name: 'finish', input: { status: 'completed', summary } });

  it('declined once: sent back; still not done: 部分完成 (missing iframe)', async () => {
    const { outcome, seen } = await run([
      { name: 'navigate', input: { url: BOXES } },
      { name: 'snapshot', input: {} },
      finish(DECLINED),
      finish(DECLINED),
    ]);
    expect(seen).toContain('任务点名要做「iframe」');
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: 'iframe' } });
    expect(outcome.status === 'completed' && outcome.summary).toMatch(
      /^部分完成：「iframe」部分未完成/,
    );
  });

  it('sent back, it opens /iframe and finishes both: completed', async () => {
    const both =
      '1. iframe：页面标题为「An iFrame containing the TinyMCE WYSIWYG Editor」，编辑器内容为「Your content goes here.」。\n2. checkboxes：checkbox 1 未勾选，checkbox 2 已勾选。';
    const { outcome } = await run([
      { name: 'navigate', input: { url: BOXES } },
      { name: 'snapshot', input: {} },
      finish(DECLINED),
      { name: 'navigate', input: { url: IFRAME } },
      { name: 'snapshot', input: {} },
      finish(both),
    ]);
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
  });

  it('reverse: an answer that did both parts is not sent back', async () => {
    const both =
      '1. iframe：页面标题为「An iFrame containing the TinyMCE WYSIWYG Editor」。\n2. checkboxes：checkbox 1 未勾选，checkbox 2 已勾选。';
    const { outcome, seen } = await run([
      { name: 'navigate', input: { url: IFRAME } },
      { name: 'snapshot', input: {} },
      { name: 'navigate', input: { url: BOXES } },
      { name: 'snapshot', input: {} },
      finish(both),
    ]);
    expect(seen).not.toContain('任务点名要做');
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
  });
});

describe('FIX-45 #5 · the 未核实 note names a field in Chinese too (local A/B core-10 B rerun)', () => {
  it('「js_confirm_dialog_text「I am a JS Confirm」」 reads as 「JS Confirm对话框文字「I am a JS Confirm」」', () => {
    const facts = assessCompletionFacts({
      summary: '已触发三种原生对话框。',
      fields: [{ name: 'js_confirm_dialog_text', value: 'I am a JS Confirm' }],
      pages: [{ text: 'heading "JavaScript Alerts" Result: You clicked: Cancel' }],
      intent: '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts',
    });
    expect(facts.unverified).toContain('JS Confirm对话框文字「I am a JS Confirm」');
    expect(facts.unverified.join('；')).not.toContain('js_confirm_dialog_text');
  });
});

describe('DEPLOY-46 local A/B · core-11: a field that is only element refs is not listed nor checked', () => {
  /** A core-11 (tsk_UuKT8B5oJHAMfaRtzH7us), the field as delivered. */
  const FIELD = {
    name: 'visible_text_blocks_after_5_scrolls',
    value: 'e12, e13, e19, e20, e21, e22, e23',
  };
  it('not listed', () => {
    expect(fieldLines([FIELD], '已滚动5次并读取内容。')).toBe('');
  });
  it('not in the 未核实 note', () => {
    const facts = assessCompletionFacts({
      summary: '已滚动5次并读取内容。',
      fields: [FIELD],
      pages: [{ text: 'heading "Infinite Scroll" Lorem ipsum' }],
      intent: '请使用云端浏览器，the-internet.herokuapp.com/infinite_scroll 滚动5次后读内容',
    });
    expect(facts.unverified.join('；')).not.toContain('e12');
  });
  it('reverse: a value that merely contains e-numbers stays', () => {
    expect(fieldLines([{ name: '型号', value: 'e12 Pro' }], '')).toBe('- 型号：e12 Pro');
  });
});
