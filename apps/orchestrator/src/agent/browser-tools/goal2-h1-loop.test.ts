import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

vi.mock('./browser-replay-service.js', () => ({ browserReplayStore: {} }));

/**
 * GOAL2 H1 复审 P0: the last-chance delivery of a pairing-only answer settles it on the pages the
 * checks read — a tool result is JSON (`{"tree": "…\n…"}`), so the raw text paired nothing and the
 * halls' 5 元 went out as the main ticket's.
 */
function scripted(calls: Array<{ name: string; input: Record<string, unknown> }>) {
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

const list = (ref: number, student: string, elder: string) =>
  [
    `      - generic [ref=e${ref}]: 1.未满18周岁的中国公民免费参观，但须预约。`,
    `      - generic [ref=e${ref + 1}]: 2.18周岁以上、本科及以下学历，可购学生票，淡旺季均为${student}/人。`,
    `      - generic [ref=e${ref + 2}]: 3.60周岁以上老年人门票半价优惠，${elder}。`,
  ].join('\n');
const tree = [
  '- heading "导览" [level=1] [ref=e1]',
  '  - generic [ref=e2]: 每年11月1日至次年3月31日为淡季，大门票40元/人； 珍宝馆门票：10元/人； 钟表馆门票：10元/人；',
  '  - generic [ref=e3]: 票价及优惠政策',
  '    - generic [ref=e4] [cursor=pointer]: 大门票优惠政策',
  '    - generic [ref=e5] [cursor=pointer]: 钟表馆、珍宝馆票价优惠政策',
  '    - generic [ref=e6]:',
  '      - button "上一项"',
  list(20, '5元', '即5元/人'),
  list(30, '20元', '即旺季30元/人；淡季20元/人'),
  list(40, '5元', '即5元/人'),
].join('\n');

describe('H1 loop: a tab’s price under another tab never goes out as that price', () => {
  it('twice misattributed: delivered with 未能核实 in its place, the right prices kept', async () => {
    const url = 'https://www.dpm.org.cn/Visit.html';
    const execute = async (action: { tool: string }): Promise<UnifiedToolResult> =>
      action.tool === 'navigate'
        ? ({ ok: true, text: '已打开', url } as UnifiedToolResult)
        : ({ ok: true, text: JSON.stringify({ tree, sourceURL: url }), url } as UnifiedToolResult);
    const wrong = {
      name: 'finish',
      input: {
        status: 'completed',
        summary:
          '故宫门票：淡季大门票40元/人，珍宝馆10元/人，钟表馆10元/人。\n\n**大门票优惠**\n- 学生票：淡旺季均为5元/人。',
      },
    };
    const outcome = await runUnifiedBrowserLoop({
      intent: '故宫门票多少钱？有哪些票种',
      adapter: scripted([
        { name: 'navigate', input: { url } },
        { name: 'snapshot', input: {} },
        wrong,
        wrong,
        wrong,
      ]),
      maxSteps: 12,
      execute: execute as never,
      currentPageUrl: () => url,
    });
    expect(outcome).toMatchObject({ status: 'completed' });
    const summary = outcome.status === 'completed' ? outcome.summary : '';
    expect(summary).toContain('大门票40元/人');
    expect(summary).toContain('学生票：淡旺季均为未能核实');
    expect(summary).not.toMatch(/学生票：淡旺季均为5元/);
    expect(summary).toContain('未能核实：1 处票价——页面上它属于另一个标签页或小节');
  });
});
