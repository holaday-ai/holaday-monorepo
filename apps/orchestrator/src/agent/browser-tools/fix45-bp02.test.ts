import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { declaredAbsentFields } from './completion-fields.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

const INTENT = '请使用云端浏览器，amazon.com 搜 usb c cable 前3个商品名和价格';
/** Deploy-45 b-p02 (tsk_dZzeYapsyXeb6t4ATUWHR), the answer 0b sent back, verbatim. */
const B_P02 =
  '在 amazon.com 搜索 "usb c cable"，前3个商品名称与价格（照页面原样）如下：\n\n1. Anker USB C to USB C Cable, 100W Fast Charging Cable (2-Pack, 6 ft, Black) — SGD 12.80\n2. LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT) — SGD 11.49\n3. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black) — S$12.80\n\n说明：第3条商品在搜索结果页快照中未显示价格，已打开其详情页读取到价格为 S$12.80；前两条价格为搜索结果页显示的 SGD 格式，第三条为详情页显示的 S$ 格式，均按页面原样保留。';

describe('FIX-45 #1 · b-p02: a gap told and then filled is not a field given as absent', () => {
  it('Deploy-45 verbatim: no field is absent', () => {
    expect(declaredAbsentFields(INTENT, B_P02)).toEqual([]);
  });
  it.each([
    '第3条商品快照中未显示价格。详情页上价格为 S$12.80。',
    '第3条未显示价格，打开详情页后读到价格：S$12.80。',
  ])('the value in the next sentence, or after a colon: 「%s」', (text) => {
    expect(declaredAbsentFields(INTENT, text)).toEqual([]);
  });
  it.each([
    '第3条商品在搜索结果页快照中未显示价格，详情页也没有读到。',
    '第3条商品在搜索结果页快照中未显示价格，已打开其详情页，价格为页面未显示。',
    '第3条未显示价格。前两条为 SGD 格式。',
  ])('reverse: really not got — 「%s」', (text) => {
    expect(declaredAbsentFields(INTENT, text)).toEqual(['价格']);
  });

  it('in the loop: the verbatim answer, its prices on the pages read, is completed — not 部分完成', async () => {
    let turn = 0;
    const calls = [
      { name: 'navigate', input: { url: 'https://www.amazon.com/s?k=usb+c+cable' } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'completed', summary: B_P02 } },
    ];
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
    const URL = 'https://www.amazon.com/s?k=usb+c+cable';
    const outcome = await runUnifiedBrowserLoop({
      intent: INTENT,
      adapter,
      maxSteps: 8,
      observationV2: true,
      currentPageUrl: () => URL,
      execute: (async () => ({
        ok: true,
        url: URL,
        text: JSON.stringify({
          sourceURL: URL,
          tree: 'Anker USB C to USB C Cable, 100W Fast Charging Cable (2-Pack, 6 ft, Black) SGD 12.80\nLISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT) SGD 11.49\nAnker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black) S$12.80',
        }),
      })) as never,
    });
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
    expect(outcome.status === 'completed' && outcome.summary).not.toMatch(/^部分完成/);
  });
});
