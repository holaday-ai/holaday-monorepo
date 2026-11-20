import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { WRAP_UP_NOTE, runUnifiedBrowserLoop } from './unified-browser-loop.js';

/**
 * FIX-61 DEPLOY-61 P1-3: 「iPhone 16 Pro Max 256GB 多少钱」 ran to the 302s limit while still
 * opening pages and failed as a timeout with nothing. Once ~80% of the time is used the run
 * stops exploring: the next turn may only finish, and it is told to hand over what it has.
 */
describe('FIX-61 DEPLOY-61 P1-3: the run wraps up before the time limit', () => {
  const PAGE =
    'heading "iPhone 16 Pro Max" [level=1]\ntext: 于授权经销商处有售\nlink "购买 iPhone 18 Pro"';
  const URL = 'https://www.apple.com.cn/iphone/compare/';
  const PARTIAL =
    '部分完成：Apple 官网的机型比较页显示 iPhone 16 Pro Max「于授权经销商处有售」，官网已不再直接销售这款，没有列出 256GB 的价格；还缺具体售价。';

  function run(wrapAt: number) {
    let turn = 0;
    const requests: Array<{ tools: string[]; last: string }> = [];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request) {
        requests.push({
          tools: (request.tools ?? []).map((t) => t.name),
          last: JSON.stringify(request.messages.at(-1)),
        });
        turn += 1;
        const finishOnly = (request.tools ?? []).every((t) => t.name === 'finish');
        // The model would keep exploring; it only finishes when finish is all it has.
        const call = finishOnly
          ? { name: 'finish', input: { status: 'completed', summary: PARTIAL } }
          : turn === 1
            ? { name: 'navigate', input: { url: URL } }
            : { name: 'snapshot', input: {} };
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
    const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> =>
      action.tool === 'navigate'
        ? { ok: true, text: `已打开 ${action.url}`, url: action.url }
        : { ok: true, text: `${PAGE} @ ${URL}`, url: URL };
    let checks = 0;
    return runUnifiedBrowserLoop({
      intent: 'iPhone 16 Pro Max 256GB 多少钱',
      adapter,
      maxSteps: 12,
      execute: execute as never,
      currentPageUrl: () => URL,
      wrapUp: () => ++checks >= wrapAt,
    }).then((outcome) => ({ outcome, requests }));
  }

  it('after the wrap-up point the next turn may only finish, and says what it found', async () => {
    const { outcome, requests } = await run(2);
    const wrapped = requests.findIndex((r) => r.tools.length === 1 && r.tools[0] === 'finish');
    expect(wrapped).toBeGreaterThan(0);
    expect(requests[wrapped]?.last).toContain('时间快用完了');
    expect(requests.slice(0, wrapped).every((r) => r.tools.includes('navigate'))).toBe(true);
    expect(outcome.status).toBe('completed');
    expect((outcome as { summary?: string }).summary).toMatch(/^部分完成：/);
    expect(WRAP_UP_NOTE).toMatch(/不要猜价格/);
  });

  it('without the signal nothing is cut short by it', async () => {
    const { requests } = await run(Number.POSITIVE_INFINITY);
    expect(requests.some((r) => r.last.includes('时间快用完了'))).toBe(false);
    // (Five reads with nothing new still end in finish-only, as before — not this rule.)
    expect(requests.slice(0, 4).every((r) => r.tools.includes('navigate'))).toBe(true);
  });
});
