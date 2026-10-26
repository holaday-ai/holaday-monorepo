import { describe, expect, it } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
  NeutralOutputContentBlock,
} from '../llm/messages-adapter.js';
import type { AkshareClient } from './a-share/akshare-client.js';
import { ashareAfterClose, buildAshareFactCard } from './a-share/ashare-fact-card.js';
import type { AkEnvelope } from './a-share/briefing-types.js';
import { unverifiedNote } from './browser-tools/completion-fields.js';
import { runUnifiedBrowserLoop } from './browser-tools/unified-browser-loop.js';
import { hasInternalRef, stripInternalRefs } from './internal-refs.js';
import { sanitizeFinalText } from './text-sanitizer.js';

/** Deploy-38 core-11 (tsk_cgVLYj7stjkahVtE8H8gL), verbatim. */
const CORE_11 =
  '已在 https://the-internet.herokuapp.com/infinite_scroll 页面完成5次向下滚动（每次滚动后页面高度增长、内容增加），随后读取了当前页面可见内容。页面标题为 "Infinite Scroll"，正文由多段 Lorem ipsum 风格的拉丁文占位文本组成，共读到7个段落块（ref e12、e13、e19–e23），底部显示 "Powered by Elemental Selenium and Sauce Labs"。\n\n- visible_paragraphs：7段拉丁文占位文本（ref e12, e13, e19, e20, e21, e22, e23）\n\n未核实：以下内容未能在已读页面中逐字找到，请自行确认——visible_paragraphs「7段拉丁文占位文本（ref e12, e13, e19, e20, e21, e22, e23）」；visible_paragraphs（括注）「ref e12」';

function scriptedAdapter(turns: Array<() => NeutralOutputContentBlock[]>): MessagesAdapter {
  let index = 0;
  return {
    metadata: { provider: 'anthropic', model: 'scripted' },
    async create(_request: NeutralMessagesRequest): Promise<NeutralMessagesResponse> {
      const turn = turns[index++];
      if (!turn) throw new Error('script exhausted');
      return {
        id: `r${index}`,
        metadata: this.metadata,
        content: turn(),
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
}

const call = (name: string, input: unknown, id = name): NeutralOutputContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});

describe('FIX-38 #1 · core-11: no element ref or tab id reaches the user', () => {
  it('the production answer, its field and its 未核实 note lose every ref', () => {
    const shown = sanitizeFinalText(CORE_11);
    expect(hasInternalRef(CORE_11)).toBe(true);
    expect(hasInternalRef(shown)).toBe(false);
    expect(shown).not.toMatch(/\be\d{1,3}\b/);
    expect(shown).toContain(
      '共读到7个段落块，底部显示 "Powered by Elemental Selenium and Sauce Labs"。',
    );
    expect(shown).toContain('- visible_paragraphs：7段拉丁文占位文本');
    expect(shown).toContain('visible_paragraphs「7段拉丁文占位文本」');
    expect(shown).not.toContain('「」');
  });

  it('the note drops an item that quoted only a ref', () => {
    const note = unverifiedNote([
      'visible_paragraphs「7段拉丁文占位文本（ref e12, e13, e19, e20, e21, e22, e23）」',
      'visible_paragraphs（括注）「ref e12」',
    ]);
    expect(note).toBe(
      '未核实：以下内容未能在已读页面中逐字找到，请自行确认——visible_paragraphs「7段拉丁文占位文本」',
    );
    expect(unverifiedNote(['链接「ref=e5」'])).toBe('');
  });

  it.each([
    ['点击了 [ref=e30] 的按钮', '点击了的按钮'],
    ['我点了按钮 e7 后出现结果', '我点了按钮后出现结果'],
    ['切回 tab_9eff90a8-1234-4abc-8def-0123456789ab 读标题', '切回读标题'],
    ['切回 tab_9eff90a8-… 后读到标题', '切回后读到标题'],
    ['iframe（frame_0a1b2c3d-1111-2222-3333-444455556666）里写着 Hello', 'iframe里写着 Hello'],
    ['共 3 段（e12–e14）', '共 3 段'],
  ])('%s → %s', (input, expected) => {
    expect(stripInternalRefs(input)).toBe(expected);
  });

  it.each([
    'Python 3.12 的 e2e 测试通过',
    'Model E12 售价 ¥99',
    '见第 e3 节',
    'reference e-mail: a@b.com',
    '公式 (e2) 成立',
    'tab_size 设为 4',
    // Codex on PR #301: code next to an 「e2e」 is untouched — empty strings, calls, indentation.
    'e2e example: if (value === "") reset();',
    'Model E12:\n    def f():\n        return ()',
  ])('reverse: 「%s」 is left as written', (text) => {
    expect(stripInternalRefs(text)).toBe(text);
    expect(sanitizeFinalText(text)).toBe(text);
  });

  it('a ref removed next to code leaves the code as written (Codex on PR #301)', () => {
    expect(stripInternalRefs('点击按钮 ref e12 后运行：if (value === "") reset();')).toBe(
      '点击按钮后运行：if (value === "") reset();',
    );
    expect(stripInternalRefs('Clicked [ref=e5] then ran:\n    f("")\n    g()')).toBe(
      'Clicked then ran:\n    f("")\n    g()',
    );
  });

  it('a failure and a pause the loop ends with carry no ref either', async () => {
    const failed = await runUnifiedBrowserLoop({
      intent: '读取页面',
      adapter: scriptedAdapter([
        () => [
          call('finish', { status: 'failed', summary: '按钮 ref e12 点不动（tab_9eff90a8-…）' }),
        ],
      ]),
      execute: async () => ({ ok: true, text: '' }),
    });
    expect(failed).toMatchObject({ status: 'failed', reason: '按钮点不动' });

    const paused = await runUnifiedBrowserLoop({
      intent: '查一下我的订单',
      adapter: scriptedAdapter([
        () => [call('request_human', { reason: 'login', message: '请在 ref e3 的登录框里登录' })],
      ]),
      execute: async () => ({ ok: true, text: '' }),
      requestHuman: async () => false,
    });
    expect(JSON.stringify(paused)).not.toMatch(/ref e\d/);
  });
});

const beijing = (at: string) => new Date(`${at}+08:00`);
const envelope = <T>(data: T[], fetchedAt = '2026-10-26T08:14:00Z'): AkEnvelope<T> =>
  ({ data, count: data.length, source: 'akshare:fake', fetched_at: fetchedAt }) as AkEnvelope<T>;

/**
 * Deploy-38 as-mt (16:14 Monday 10-26): sina's daily K-line still ended at 10-23 (1,335.00)
 * while the 15:00 quote was already 1,349.98 +1.12%.
 */
function akshare(opts: {
  quote: Record<string, unknown>;
  tradingDay?: boolean;
  calls: string[];
}): AkshareClient {
  return {
    getStockAnnouncements: () => Promise.resolve(envelope([])),
    getShareUnlock: () => Promise.resolve(envelope([])),
    getStockKline: () =>
      Promise.resolve(
        envelope([{ 日期: '2026-10-23', 收盘: 1335, 涨跌幅: 1.25, 成交额: 7_677_216_283 }]),
      ),
    getStockQuote: () => {
      opts.calls.push('quote');
      return Promise.resolve(envelope([{ 代码: '600519', ...opts.quote }]));
    },
    getDragonTiger: () => Promise.resolve(envelope([])),
    getNorthboundFlow: () => Promise.resolve(envelope([])),
    getTradingDay: () => Promise.resolve(envelope([{ is_trading_day: opts.tradingDay ?? true }])),
    // biome-ignore lint/suspicious/noExplicitAny: fake
  } as any;
}
const MOUTAI = {
  kind: 'info' as const,
  stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
  dateIso: '2026-10-26',
  dateCompact: '20261026',
};
const CLOSE_QUOTE = { 最新价: 1349.98, 涨跌幅: 1.12, 行情时间: '2026-10-26 15:00:00' };

describe('FIX-38 #2 · after a trading day’s close, the 15:00 quote is that day’s close', () => {
  it('Deploy-38 as-mt replay: 「最近收盘（2026-10-26 15:00） 1,349.98」, not the 10-23 K-line', async () => {
    const calls: string[] = [];
    const md = await buildAshareFactCard(
      { client: akshare({ quote: CLOSE_QUOTE, calls }), now: beijing('2026-10-26T16:14:00') },
      MOUTAI,
    );
    expect(calls).toEqual(['quote']);
    expect(md).toContain('- 最近收盘（2026-10-26 15:00） 1,349.98，涨跌幅 +1.12%（收盘后报价');
    expect(md).not.toContain('最近收盘（2026-10-23）');
    expect(md).not.toMatch(/实时|当前价|最新价/);
  });

  it('reverse: during trading hours the quote is 最新价 with its time, not a close', async () => {
    const calls: string[] = [];
    const md = await buildAshareFactCard(
      {
        client: akshare({
          quote: { 最新价: 1338.92, 涨跌幅: 0.29, 行情时间: '2026-10-26 13:01:00' },
          calls,
        }),
        now: beijing('2026-10-26T13:02:00'),
      },
      MOUTAI,
    );
    expect(md).toContain('最新价 1,338.92，涨跌幅 +0.29%；行情时间 2026-10-26 13:01:00');
    expect(md).not.toContain('最近收盘（2026-10-26');
  });

  it('reverse: a quote from before 15:00 is no close — the dated K-line close stays', async () => {
    const calls: string[] = [];
    const md = await buildAshareFactCard(
      {
        client: akshare({
          quote: { 最新价: 1340, 涨跌幅: 0.37, 行情时间: '2026-10-26 14:30:00' },
          calls,
        }),
        now: beijing('2026-10-26T16:14:00'),
      },
      MOUTAI,
    );
    expect(md).toContain('- 最近收盘（2026-10-23） 1,335.00');
    expect(md).not.toContain('1,340');
  });

  it('reverse: a holiday evening, before the open and a weekend ask for no quote', async () => {
    for (const [now, tradingDay] of [
      [beijing('2026-10-01T16:00:00'), false],
      [beijing('2026-10-26T09:00:00'), true],
      [beijing('2026-10-24T16:00:00'), true],
    ] as const) {
      const calls: string[] = [];
      const md = await buildAshareFactCard(
        { client: akshare({ quote: CLOSE_QUOTE, tradingDay, calls }), now },
        MOUTAI,
      );
      expect(calls).toEqual([]);
      expect(md).toContain('- 最近收盘（2026-10-23） 1,335.00');
    }
    expect(ashareAfterClose(beijing('2026-10-26T14:59:00'))).toBe(false);
    expect(ashareAfterClose(beijing('2026-10-26T15:00:00'))).toBe(true);
    expect(ashareAfterClose(beijing('2026-10-24T16:00:00'))).toBe(false);
  });
});
