import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import type { NeutralResponsesRequest, ResponsesAdapter } from '../llm/responses-adapter.js';
import {
  knownMonthDays,
  marketDatePrompt,
  marketDates,
  unsupportedDateSentences,
  withoutSentences,
} from './market-date-context.js';
import { answerNotObtained, runScrapeTask } from './scrape-runner.js';

/** Deploy-36 b-n06 (tsk_L5YWgfXacP8WXhaWm9dwc), verbatim. Monday after 10-24 is 10-26. */
const B_N06 =
  '上证指数最新收盘 **3690.48** 点，涨 **0.89%**（+32.45 点），成交额 8987 亿元。数据时间为 2026 年 10 月 23 日（周五）收盘 [搜狐证券](https://q.stock.sohu.com/zs/000001/index.shtml)。\n\n今天周日，A 股休市，下一个交易日是周一（10 月 27 日）。';
const SOHU =
  '# 上证指数(000001)\n\n3690.48 +32.45 +0.89%\n\n2026-10-23 15:00:00 成交额 8987亿 最高 3691.40 最低 3574.27';
/** Sunday 2026-10-25 01:20 Beijing, as the run was. */
const NOW = new Date('2026-10-24T17:20:00Z');
const CALENDAR: Record<string, boolean> = {
  '2026-10-23': true,
  '2026-10-24': false,
  '2026-10-25': false,
  '2026-10-26': true,
};
const calendar = async (iso: string) => CALENDAR[iso] ?? true;

function logger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => logger(),
  } as unknown as Logger;
}

function run(
  answer: string,
  tradingDay?: (iso: string) => Promise<boolean | null>,
  extra: Partial<Parameters<typeof runScrapeTask>[0]> = {},
) {
  const requests: NeutralResponsesRequest[] = [];
  const adapter: ResponsesAdapter = {
    metadata: {
      provider: 'alibaba-model-studio',
      region: 'cn',
      deploymentScope: 'china_mainland',
      model: 'qwen3.8-plus',
      endpointKind: 'public',
      protocol: 'responses',
    },
    stream: vi.fn(async (request: NeutralResponsesRequest) => {
      requests.push(request);
      return {
        id: 'r',
        metadata: adapter.metadata,
        text: answer,
        sources: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        status: 'completed' as const,
      };
    }),
  } as unknown as ResponsesAdapter;
  const firecrawl: FirecrawlLane = {
    scrape: vi.fn(),
    search: vi.fn(async () => ({
      ok: true as const,
      results: [
        {
          url: 'https://q.stock.sohu.com/zs/000001/index.shtml',
          markdown: SOHU,
          title: '上证指数',
        },
      ],
    })),
  } as unknown as FirecrawlLane;
  return runScrapeTask({
    taskId: 't',
    userId: 'u',
    intent: '上证指数现在多少点',
    responsesAdapter: adapter,
    firecrawl,
    logger: logger(),
    now: () => NOW,
    ...(tradingDay ? { tradingDay } : {}),
    ...extra,
  }).then((outcome) => ({ outcome, requests }));
}

describe('FIX-36 #1 · b-n06: dates are given, a date no page carries is not delivered', () => {
  it('the trading days come from the calendar: next is Monday 10-26', async () => {
    const dates = await marketDates(NOW, calendar);
    expect(dates).toEqual({
      today: '2026-10-25',
      todayTrading: false,
      previousTradingDay: '2026-10-23',
      nextTradingDay: '2026-10-26',
    });
    expect(marketDatePrompt(dates)).toContain('下一个交易日：2026-10-26（星期一）');
    expect(marketDatePrompt(dates)).toContain('今天：2026-10-25（星期日，北京时间）');
  });

  it('a calendar that cannot answer gives no trading-day dates and says not to work them out', async () => {
    const prompt = marketDatePrompt(await marketDates(NOW, async () => null));
    expect(prompt).toContain('交易日历本次不可用');
    expect(prompt).not.toMatch(/下一个交易日：/);
  });

  it('the production answer: the invented 「周一（10 月 27 日）」 sentence goes, the close stays', async () => {
    const { outcome, requests } = await run(B_N06, calendar);
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).not.toContain('10 月 27 日');
    expect(outcome.summary).toContain('3690.48');
    expect(outcome.summary).toContain('2026 年 10 月 23 日（周五）收盘');
    expect(requests[0]?.instructions).toContain('下一个交易日：2026-10-26（星期一）');
  });

  it('the given next trading day may be quoted', async () => {
    const answer =
      '上证指数最近收盘（2026-10-23）3690.48 点。今天休市，下一个交易日是 10 月 26 日（周一）。';
    const { outcome } = await run(answer, calendar);
    expect(outcome.summary).toContain('下一个交易日是 10 月 26 日（周一）');
  });

  it('without a calendar the next-trading-day date is not invented either', async () => {
    const { outcome, requests } = await run(B_N06);
    expect(requests[0]?.instructions).toContain('交易日历本次不可用');
    expect(outcome.summary).not.toContain('10 月 27 日');
  });

  it('「最近收盘（2026-10-23）」 and other dates the page carries are untouched', () => {
    const known = knownMonthDays(SOHU);
    const answer = '最近收盘（2026-10-23）3690.48 点，2026年10月23日成交额 8987 亿元。';
    expect(unsupportedDateSentences(answer, known)).toEqual([]);
  });

  it('numbers that are not dates are not taken for one (prices, percentages, 10/27)', () => {
    const known = knownMonthDays(SOHU);
    const answer = '价格 SGD 12.77，涨 0.89%，比例 10/27，版本 3.5。';
    expect(unsupportedDateSentences(answer, known)).toEqual([]);
  });

  it('a date from an attached text is evidence too (Codex P2 on PR #299)', async () => {
    const answer = '上证指数最近收盘 3690.48 点。项目将于2026年11月12日上线。';
    const { outcome } = await run(answer, calendar, {
      attachments: [{ type: 'text', text: '项目计划：2026年11月12日上线。' }],
    });
    expect(outcome.summary).toContain('2026年11月12日上线');
  });

  it('with an attached image the dates cannot be checked, so none is dropped', async () => {
    const answer = '上证指数最近收盘 3690.48 点。项目将于2026年11月12日上线。';
    const { outcome } = await run(answer, calendar, {
      attachments: [{ type: 'image', source: { media_type: 'image/png', data: 'AA==' } }],
    });
    expect(outcome.summary).toContain('2026年11月12日上线');
  });

  it('an answer that was only invented dates is no answer: the browser gets its try (Codex P2)', async () => {
    const { outcome } = await run(
      '下一个交易日是 10 月 27 日。\n\n[搜狐证券](https://q.stock.sohu.com/zs/000001/index.shtml)',
      calendar,
    );
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'empty' });
  });

  it('withoutSentences leaves no empty paragraph behind', () => {
    const answer = 'A。\n\n今天休市，下一个交易日是 10 月 27 日。\n\nB。';
    const drop = unsupportedDateSentences(answer, new Set());
    expect(withoutSentences(answer, drop)).toBe('A。\n\nB。');
  });
});

/** Deploy-36 b-v06 (tsk_r6zqiq4R5w3k3T7hdavFm), verbatim. */
const B_V06 =
  "根据 [QQ音乐热歌榜](https://y.qq.com/n/ryqq/toplist/26)（2026-10-24数据），第一名是 **TF家族-张函瑞** 演唱的歌曲，时长03:03。\n\n页面未显示具体歌曲名称。\n\n不过根据 [腾讯音乐榜](https://yobang.tencentmusic.com/) 2026年第42期数据，TF家族-张函瑞的《**Baby's Horizon**》排名第一（得分99.18），可能是同一首歌。";
/** Deploy-36 fc-jd (tsk_bnGiAqeRAiNV6gn6fFZDm), verbatim. */
const FC_JD =
  '京东需要登录才能查看该商品页面，请你自己登录后告诉我继续（我不会代填账号密码）。\n\n来源：https://item.jd.com/100142621606.html';

describe('FIX-36 #2 · b-v06: 「页面未显示」 then a guess is not an answer', () => {
  it('the production answer is not obtained → browser retry', () => {
    expect(answerNotObtained(B_V06, 'QQ音乐热歌榜第一名是啥')).toBe(true);
  });
  it('the name first, as its own sentence (local reg-new-qq): 「歌曲名称页面未显示。」', () => {
    expect(
      answerNotObtained(
        'QQ音乐热歌榜（2026-10-25）第1名的歌手是**许嵩**，时长 04:24。\n\n歌曲名称页面未显示。\n\n来源：https://y.qq.com/n/ryqq/toplist/26',
        '在 QQ 音乐看热歌榜第一名',
      ),
    ).toBe(true);
  });
  it('the full answer from the chart page is an answer', () => {
    expect(
      answerNotObtained(
        "QQ音乐热歌榜（2026-10-24）第一名是《Baby's Horizon》，歌手为 TF家族-张函瑞。",
        'QQ音乐热歌榜第一名是啥',
      ),
    ).toBe(false);
  });
  it('a side field the page lacks (成交额) is not the asked value missing', () => {
    expect(
      answerNotObtained(
        '上证指数最近收盘 3690.48 点（2026-10-23）。\n\n成交额页面未显示。',
        '上证指数现在多少点',
      ),
    ).toBe(false);
  });
  it('a field the user named, given as 页面未显示, goes to the browser (as 0b there)', () => {
    const xhs = '- **标题**：📍杭州｜西湖一日游攻略\n- **作者**：Clara\n- **点赞数**：页面未显示。';
    expect(
      answerNotObtained(
        xhs,
        '打开 https://www.xiaohongshu.com/explore/x 读这篇笔记的标题、作者和点赞数',
      ),
    ).toBe(true);
    expect(
      answerNotObtained(
        '- **标题**：📍杭州｜西湖一日游攻略\n- **作者**：Clara\n- **点赞数**：1.2万',
        '打开 https://www.xiaohongshu.com/explore/x 读这篇笔记的标题、作者和点赞数',
      ),
    ).toBe(false);
  });
});

describe('FIX-36 #4 · fc-jd: a login wall the scrape met is the browser’s to hand over', () => {
  it('the production answer is not a completed answer', () => {
    expect(
      answerNotObtained(
        FC_JD,
        '打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格',
      ),
    ).toBe(true);
  });
  it.each([
    '页面要求登录后才能看完整评论，但商品标题是 Apple iPhone 16 Pro，价格 ¥7999。',
    '登录按钮在右上角；商品标题为 Apple iPhone 16 Pro，页面价格 ¥7999。',
  ])('an answer that only mentions login in passing is an answer: %s', (answer) => {
    expect(answerNotObtained(answer, '读商品标题和价格')).toBe(false);
  });
});
