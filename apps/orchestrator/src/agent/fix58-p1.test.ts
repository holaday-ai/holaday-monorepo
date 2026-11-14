/** FIX-58 P1 · FIX-57 收尾 (DEPLOY-57 第 1.5 步 / 第 7 步的观察). */
import { describe, expect, it } from 'vitest';
import { browserCompletionVerdict } from '../execution/execution-pipeline.js';
import { sourceName, sourceTag } from './a-share/ashare-format.js';
import {
  absentLead,
  plainAnswer,
  withoutVerbatimNotes,
} from './browser-tools/unified-browser-loop.js';
import { marketTableAsText } from './market-answer.js';
import {
  isEnglishRequest,
  marketClosedToday,
  withoutTodayWhenClosed,
} from './next-steps-generator.js';

const failed = (criterionType: string, detail: string) =>
  ({
    taskId: 't',
    passed: false,
    tier: 'deterministic',
    failureLevel: 'fixable',
    checks: [{ criterionId: 'c1', criterionType, passed: false, checker: 'deterministic', detail }],
  }) as never;

describe('P1-1 · the check’s own words are not shown', () => {
  const answer =
    '1. UGREEN … — S$12.45\n2. UGREEN … — S$10.92\n3. Belkin … — 价格未获取到（搜索结果列表中该条目未显示价格）';
  it('reg-new-amazon-sg: no 「核验提示」, no 「要求至少 3 条」; the gap in plain words', () => {
    const verdict = browserCompletionVerdict({
      runnerStatus: 'completed',
      verification: failed(
        'ecommerce_rows',
        '第 3 行缺少价格；可核验商品只有 2 条，要求至少 3 条名称/价格完整的结果',
      ),
      verifiedText: answer,
      originalText: answer,
    });
    expect(verdict.status).toBe('partial_success');
    expect(verdict.text).toBe(`${answer}\n\n第 3 款没读到价格。`);
    expect(verdict.notes[0]).toContain('要求至少 3 条');
  });
  it('an answer that already opens with its 部分完成 lead gets no second note', () => {
    const lead = `部分完成：第 3 款页面上没显示价格。\n\n${answer}`;
    const verdict = browserCompletionVerdict({
      runnerStatus: 'completed',
      verification: failed('ecommerce_rows', '第 3 行缺少价格；可核验商品只有 2 条，要求至少 3 条'),
      verifiedText: lead,
      originalText: lead,
    });
    expect(verdict.text).toBe(lead);
  });
});

describe('P1-2 · search answers get the same 「原样 / 原文」 cleanup', () => {
  it('core-01: 「标题与链接均按页面原样提取如下：」', () => {
    expect(
      withoutVerbatimNotes(
        '已从指定的 Brave 搜索接口页面读取「HOLA DAY AI」的前 5 条搜索结果，标题与链接均按页面原样提取如下：',
      ),
    ).toBe(
      '已从指定的 Brave 搜索接口页面读取「HOLA DAY AI」的前 5 条搜索结果，标题与链接提取如下：',
    );
  });
  it.each(['评论区原文照录如下：很好用。', '原文保留了作者的署名。'])(
    'the answer itself stays: %s',
    (text) => expect(withoutVerbatimNotes(text)).toBe(text),
  );
});

describe('P1-3 · long names', () => {
  it('a row without a price is cut too, and so is its 「未核实」 item', () => {
    const out = plainAnswer(
      '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft iPhone Charger Cord — 价格未获取到（搜索结果首屏该条目未显示价格文本）\n\n未核实：以下内容未能在已读页面中逐字找到，请自行确认——条目「Belkin Eco USB C to USB C 60W Braided Cable 3.3ft iPhone Charger Cord — 价格未获取到（搜索结果首屏该条目未显示价格文本）」',
    );
    expect(out).not.toContain('iPhone Charger Cord');
    expect(out).toContain('3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft… — 价格未获取到');
  });
  it('b-p02: 「SGD 11.52」 is a price', () => {
    expect(
      plainAnswer(
        '1. LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT) — SGD 11.52',
      ),
    ).toBe('1. LISEN USB C to USB C Cable, 240W Fast Charging Type C… — SGD 11.52');
  });
  it('two names that cut the same keep what tells them apart', () => {
    const out = plainAnswer(
      [
        '1. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord 2M Compatible with iPhone 15 Pro Max S$12.45',
        '2. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord 1M Compatible with iPhone 15 Pro Max S$10.92',
      ].join('\n'),
    );
    expect(out.split('\n')).toEqual([
      '1. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…2M S$12.45',
      '2. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…1M S$10.92',
    ]);
  });
  it('a long English sentence in a list is not a product name', () => {
    const text =
      '1. The quick brown fox jumps over the lazy dog while the band plays on and on forever.';
    expect(plainAnswer(text)).toBe(text);
  });
});

describe('P1-4 · the partial lead names the item, no stray space', () => {
  it.each([
    [['价格'], '1. A — S$1\n2. B — S$2\n3. Belkin … — 未获取到', '部分完成：第 3 款没读到价格。'],
    [['作者'], '标题：X\n作者：页面未显示', '部分完成：页面上没读到作者。'],
  ])('%s', (absent, answer, lead) => {
    expect(absentLead(absent, answer)).toBe(lead);
  });
});

describe('P1-6 · a field line nobody can place goes', () => {
  it('reg-new-bestbuy: 「- rating：4.8 out of 5 stars」 repeats what was said', () => {
    expect(
      plainAnswer(
        'BestBuy 搜索 "usb c cable" 的第一个结果是：Insignia 8 ft. 240W USB-C Cable，售价 $19.99，评分 4.8/5（107 条评价）。\n\n- rating：4.8 out of 5 stars',
      ),
    ).not.toContain('rating');
  });
  it('after a numbered list it cannot be placed: it goes', () => {
    expect(plainAnswer('1. A — $1\n2. B — $2\n\n- rating：4.5 out of 5 stars')).not.toContain(
      'rating',
    );
  });
  it('a capitalised note after a list stays', () => {
    expect(plainAnswer('1. A — $1\n\n- Note: prices change often')).toContain('Note: prices');
  });
});

describe('P1-7 · a price said before the note is not said again inside it', () => {
  it('Belkin', () => {
    expect(
      plainAnswer('3. Belkin Eco USB C Cable… — S$9.43（这款没有主推价，有 1 个卖家报价 S$9.43）'),
    ).toBe('3. Belkin Eco USB C Cable… — S$9.43（没有主推价，有 1 个卖家报价）');
  });
});

describe('P1-8 · on a weekend the market words say 「上个交易日」', () => {
  const saturday = new Date('2026-11-07T03:00:00Z');
  const monday = new Date('2026-11-09T03:00:00Z');
  it('Saturday in Beijing is closed; Monday is not', () => {
    expect(marketClosedToday(saturday)).toBe(true);
    expect(marketClosedToday(monday)).toBe(false);
  });
  it('「创业板今天也跌了吗」 → 「上个交易日」 on Saturday only', () => {
    const steps = [
      { label: '创业板今天也跌了吗，帮我查下收盘点位?', prompt: '查创业板今天收盘点位' },
    ];
    expect(withoutTodayWhenClosed(steps, saturday)[0]?.label).toBe(
      '创业板上个交易日也跌了吗，帮我查下收盘点位?',
    );
    expect(withoutTodayWhenClosed(steps, monday)).toEqual(steps);
    const other = [{ label: '今天要我帮你订餐厅吗？', prompt: '帮我订今天的餐厅' }];
    expect(withoutTodayWhenClosed(other, saturday)).toEqual(other);
  });
});

describe('P1-5 · English request', () => {
  it.each([
    ['usb c cable prices on amazon.sg', true],
    ['亚马逊新加坡站 USB C 线价格', false],
    ['https://example.com', false],
  ])('%s → %s', (intent, en) => expect(isEnglishRequest(intent)).toBe(en));
});

describe('P1-9 · the stock card names its source in words', () => {
  it.each([
    ['akshare:stock_zh_a_daily(sina,末2行算涨跌幅)', '新浪财经'],
    ['akshare:stock_zh_a_disclosure_report_cninfo', '巨潮资讯'],
    ['akshare:stock_zh_a_spot_em', '东方财富'],
    ['akshare:something_else', '公开行情数据'],
  ])('%s → %s', (source, name) => expect(sourceName(source)).toBe(name));
  it('no interface name in the tag', () => {
    const tag = sourceTag({
      source: 'akshare:stock_zh_a_daily(sina,末2行算涨跌幅)',
      fetched_at: '2026-11-07T03:15:00Z',
    } as never);
    // 复审 #1: no 「抓取」, like the market card.
    expect(tag).toMatch(/^数据来自新浪财经 · \d{2}:\d{2}$/);
    expect(tag).not.toMatch(/akshare|stock_|抓取/i);
  });
});

describe('P1-10 · a market answer’s table is said as a sentence', () => {
  const answer =
    '上证指数报 3649.18，跌 1.10%。\n\n| 项目 | 数值 |\n|------|------|\n| 今开 | 3612.15 |\n| 最高 | 3660.49 |\n\n数据来源：东方财富';
  it('live-sh', () => {
    expect(marketTableAsText(answer, '上证指数现在多少')).toBe(
      '上证指数报 3649.18，跌 1.10%。\n\n今开 3612.15，最高 3660.49。\n\n数据来源：东方财富',
    );
  });
  it('other answers keep their tables', () => {
    expect(marketTableAsText(answer, '帮我整理一个对比表')).toBe(answer);
  });
});
