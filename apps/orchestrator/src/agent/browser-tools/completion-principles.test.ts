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
      }).contradictions,
    ).toHaveLength(1);
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
