import { describe, expect, it } from 'vitest';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import {
  assessCompletionFacts,
  normalizeFact,
  unescapeLiteralBreaks,
} from './completion-fields.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/**
 * BROWSER-AUTOPILOT-1 gate principles: safety (unchanged elsewhere) and
 * integrity only. Prose is not checked, uncontradicted-but-unmatched facts are
 * delivered with a 未核实 note, contradictions block, one rejection per run.
 */
function brain(turns: Array<{ name: string; input: unknown }>) {
  const requests: NeutralMessagesRequest[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      requests.push(request);
      const call = turns[requests.length - 1];
      if (!call) throw Error('fixture exhausted');
      return {
        id: String(requests.length),
        metadata: this.metadata,
        content: [{ type: 'tool_use', id: String(requests.length), ...call }],
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
  return { adapter, requests };
}
const read = { name: 'read_page', input: {} };
const finish = (summary: string, extra: Record<string, unknown> = {}) => ({
  name: 'finish',
  input: { status: 'completed', summary, ...extra },
});
const page =
  'heading "Me at the zoo" [level=1]\nlink "jawed"\ntext: 4.4亿次观看 21年前\n1,024 bytes';

describe('normalization', () => {
  it.each([
    ['ＡＢＣ　１２３', 'abc 123'],
    ['16 years ago', '16年前'],
    ['3 months ago', '3个月前'],
    ['1,024 bytes', '1024 bytes'],
    ['“quoted”', '"quoted"'],
  ])('%s ≡ %s', (a, b) => expect(normalizeFact(a)).toBe(normalizeFact(b)));
  it('restores line breaks a model double-escaped', () => {
    expect(unescapeLiteralBreaks('a\\nb')).toBe('a\nb');
  });
});

describe('fact assessment', () => {
  const assess = (summary: string, fields?: unknown) =>
    assessCompletionFacts({ summary, fields, pages: [{ text: page }] });
  it('checks each labelled fact in a list written with literal \\n', () => {
    expect(
      assess(
        '- 视频标题：Me at the zoo\\n- 频道：jawed\\n- 播放量：4.4亿次观看\\n- 发布日期：21 years ago',
      ),
    ).toEqual({ contradictions: [], unverified: [] });
  });
  it('never checks summary / explanation fields', () => {
    expect(
      assess('完成', [
        { name: 'summary', value: '这是模型自己的总结，页面上没有这句话' },
        { name: '说明', value: '页面以相对时间显示' },
      ]),
    ).toEqual({ contradictions: [], unverified: [] });
  });
  it('labels an unmatched but uncontradicted fact as unverified', () => {
    expect(assess('作者：Somebody Else')).toEqual({
      contradictions: [],
      unverified: ['作者「Somebody Else」'],
    });
  });
  it('blocks a number that contradicts the same context on the page', () => {
    expect(assess('播放量：9.9亿次观看').contradictions).toHaveLength(1);
  });
  it('blocks a fact attributed to a page that was never read', () => {
    expect(
      assessCompletionFacts({
        summary: '1) https://unread.test/ → 标题 "Unread page"',
        pages: [{ text: page, sourceURL: 'https://read.test/' }],
      }).contradictions.join(' '),
    ).toContain('未成功读取');
  });
});

describe('one rejection per run', () => {
  it('delivers an unmatched fact with a visible 未核实 note, without any rejection', async () => {
    const { adapter, requests } = brain([read, finish('作者：Somebody Else')]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取作者',
      observationV2: true,
      maxSteps: 2,
      execute: async () => ({ ok: true, text: page }),
    });
    expect(result).toMatchObject({ status: 'completed' });
    expect(result.status === 'completed' && result.summary).toContain('未核实');
    expect(requests).toHaveLength(2);
  });
  it('a second blocking problem after the single rejection fails instead of looping', async () => {
    const { adapter, requests } = brain([
      read,
      finish('播放量：9.9亿次观看'),
      finish('已切回原标签，播放量：4.4亿次观看'),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取播放量',
      observationV2: true,
      maxSteps: 5,
      execute: async () => ({ ok: true, text: page }),
    });
    expect(result).toMatchObject({ status: 'failed' });
    expect(requests).toHaveLength(3);
  });
  it('a corrected answer after the single rejection is delivered', async () => {
    const { adapter } = brain([read, finish('播放量：9.9亿次观看'), finish('播放量：4.4亿次观看')]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取播放量',
      observationV2: true,
      maxSteps: 5,
      execute: async () => ({ ok: true, text: page }),
    });
    expect(result).toMatchObject({ status: 'completed', summary: '播放量：4.4亿次观看' });
  });
});

describe('page-read integrity without over-blocking (round 1 live findings)', () => {
  it('accepts content read after a load-event timeout (slow assets, DOM present)', async () => {
    const { adapter } = brain([
      { name: 'navigate', input: { url: 'https://slow.test/alerts' } },
      read,
      finish('Result 显示：You successfully clicked an alert'),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '打开页面读取结果',
      observationV2: true,
      maxSteps: 3,
      execute: async (action) =>
        action.tool === 'navigate'
          ? {
              ok: false,
              errorCode: 'browser_timeout',
              text: 'page.goto: Timeout 30000ms exceeded.',
              url: action.url,
            }
          : {
              ok: true,
              text: JSON.stringify({
                tabId: 't1',
                sourceURL: 'https://slow.test/alerts',
                tree: 'Result: You successfully clicked an alert',
              }),
            },
    });
    expect(result).toMatchObject({ status: 'completed' });
  });
  it('accepts titles read in tabs even when the last action switched back to the first tab', async () => {
    const tabs: Record<string, string> = { a: 'Alpha', b: 'Beta' };
    let current = 'a';
    const { adapter } = brain([
      read,
      { name: 'switch_tab', input: { targetTabId: 'b' } },
      read,
      { name: 'switch_tab', input: { targetTabId: 'a' } },
      finish('已读两个标签：Alpha；Beta', {
        fields: [
          { name: '标签标题', value: 'Alpha', tabId: 'a' },
          { name: '标签标题', value: 'Beta', tabId: 'b' },
        ],
      }),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读两个标签的标题后回到第一个',
      observationV2: true,
      maxSteps: 5,
      supportedTools: { download: false, upload: false, tabs: true },
      execute: async (action) => {
        if (action.tool === 'switch_tab') {
          current = action.targetTabId;
          return { ok: true, text: 'switched', tabId: current };
        }
        return {
          ok: true,
          text: JSON.stringify({ tabId: current, tree: `heading "${tabs[current]}" [level=1]` }),
        };
      },
    });
    expect(result).toMatchObject({ status: 'completed' });
  });
});

describe('labelled values (round 1 live findings)', () => {
  const pages = [{ text: 'heading "人工智能 编辑" [level=1]\nlink "发展史"\n发展史' }];
  it('reads a quoted value exactly and does not treat a section title as the page title', () => {
    expect(
      assessCompletionFacts({
        summary: '维基百科《人工智能》第3节标题为“发展史”，系统梳理了人工智能的演进脉络。',
        pages,
      }),
    ).toEqual({ contradictions: [], unverified: [] });
  });
  it('ignores prose after a numeric label that carries no number', () => {
    expect(
      assessCompletionFacts({ summary: '播放量为页面原样字符串，未做数值换算。', pages }),
    ).toEqual({ contradictions: [], unverified: [] });
  });
});
