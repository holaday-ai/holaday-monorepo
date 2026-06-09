import { describe, expect, it } from 'vitest';
import {
  buildCtripFlightHint,
  extractCtripFlights,
  formatCtripFlightsTable,
  isCtripFlightResultsUrl,
} from './ctrip-flight-extractor.js';

describe('isCtripFlightResultsUrl', () => {
  it('matches one-way and round-trip flight list URLs', () => {
    expect(
      isCtripFlightResultsUrl('https://flights.ctrip.com/online/list/oneway-bjs-sha?depdate=2026-08-01'),
    ).toBe(true);
    expect(
      isCtripFlightResultsUrl('https://flights.ctrip.com/online/list/round-bjs-sha?depdate=2026-08-01&rdate=2026-08-05'),
    ).toBe(true);
  });

  it('does NOT match hotels / homepage / other sites', () => {
    expect(isCtripFlightResultsUrl('https://hotels.ctrip.com/hotels/list?city=2')).toBe(false);
    expect(isCtripFlightResultsUrl('https://www.ctrip.com/')).toBe(false);
    expect(isCtripFlightResultsUrl('https://flights.ctrip.com/itinerary/oneway')).toBe(false);
    expect(isCtripFlightResultsUrl('https://flights.qunar.com/online/list/oneway')).toBe(false);
    expect(isCtripFlightResultsUrl('')).toBe(false);
    expect(isCtripFlightResultsUrl(null)).toBe(false);
  });
});

// Synthetic-but-realistic Ctrip flight-list visible text: chrome + cards.
const PAGE_TEXT = [
  '携程旅行 机票 北京 → 上海 2026-08-01 经济舱 筛选 直飞 推荐排序 价格排序',
  '东方航空 MU5101 08:00 北京首都T2 10:15 上海虹桥T1 2小时15分 直飞 经济舱 ¥1,280 订',
  '中国国航 CA1858 13:30 北京首都T3 15:50 上海浦东T2 2小时20分 直飞 经济舱 ¥980 订',
  '春秋航空 9C8888 21:05 北京大兴 23:25 上海浦东T1 2小时20分 直飞 ¥760 订',
  '南方航空 CZ3456 09:00 北京大兴 12:40 上海虹桥T2 3小时40分 经停西安 ¥1,520 订',
  '领券中心 立减¥120 会员专享 客服热线 4008-100-999',
].join('\n');

describe('extractCtripFlights', () => {
  it('parses flight rows (airline / times / nonstop / price) from visible text', () => {
    const flights = extractCtripFlights(PAGE_TEXT);
    expect(flights.length).toBe(4); // 4 cards; the 立减¥120 promo is excluded (no times)
    const cheapest = [...flights].sort((a, b) => a.priceCNY - b.priceCNY)[0]!;
    expect(cheapest.priceCNY).toBe(760);
    expect(cheapest.airline).toBe('春秋航空');
    expect(cheapest.depTime).toBe('21:05');
    expect(cheapest.arrTime).toBe('23:25');
    expect(cheapest.nonstop).toBe(true);
  });

  it('handles comma prices and detects 经停 as non-direct', () => {
    const flights = extractCtripFlights(PAGE_TEXT);
    const cz = flights.find((f) => f.airline === '南方航空');
    expect(cz?.priceCNY).toBe(1520);
    expect(cz?.nonstop).toBe(false);
  });

  it('excludes promo / non-flight prices that lack two times nearby', () => {
    const flights = extractCtripFlights(PAGE_TEXT);
    expect(flights.some((f) => f.priceCNY === 120)).toBe(false);
  });

  it('returns [] for empty / blocked text', () => {
    expect(extractCtripFlights('')).toEqual([]);
    expect(extractCtripFlights('whaleguard block')).toEqual([]);
  });
});

describe('formatCtripFlightsTable', () => {
  it('sorts by price asc, caps at topN, marks no-booking + source', () => {
    const flights = extractCtripFlights(PAGE_TEXT);
    const md = formatCtripFlightsTable(flights, { url: 'https://flights.ctrip.com/online/list/oneway-bjs-sha', topN: 3 });
    expect(md).toContain('| 航空公司 | 出发-到达 | 是否直飞 | 价格(¥) |');
    expect(md).toContain('春秋航空'); // cheapest in
    expect(md).not.toContain('南方航空'); // 4th by price, dropped at topN=3
    expect(md).toContain('未下单/未预订');
    expect(md).toContain('flights.ctrip.com/online/list/oneway-bjs-sha');
    // cheapest row appears before the more expensive one
    expect(md.indexOf('760')).toBeLessThan(md.indexOf('980'));
  });
});

describe('buildCtripFlightHint', () => {
  const url = 'https://flights.ctrip.com/online/list/oneway-bjs-sha?depdate=2026-08-01';

  it('returns null when the page is not hydrated yet (too short)', () => {
    expect(buildCtripFlightHint({ pageText: '加载中', url })).toBeNull();
  });

  it('returns null on a short anti-bot challenge page', () => {
    expect(buildCtripFlightHint({ pageText: 'whaleguard block', url })).toBeNull();
  });

  it('builds a directive with table + raw text + no-booking + specific failure wording', () => {
    const hint = buildCtripFlightHint({ pageText: PAGE_TEXT, url, topN: 3 })!;
    expect(hint).toContain('携程机票结果页');
    expect(hint).toContain('Markdown 表格');
    expect(hint).toContain('未下单/未预订');
    // the specific failure phrasing the model must use instead of a generic error
    expect(hint).toContain('已进入携程结果页，但未能稳定读取航班列表');
    // best-effort parsed table present
    expect(hint).toContain('初步解析');
    expect(hint).toContain('春秋航空');
    // raw page text included so the model can extract directly
    expect(hint).toContain('携程结果页可见文本');
    expect(hint).toContain('CA1858');
  });

  it('still builds a directive (raw-text path) when the parser finds nothing', () => {
    // Real flight page text the parser doesn't recognize (no ¥ + times pairing),
    // but long enough to be a real page — model should still get the text.
    const oddText =
      '携程旅行 机票搜索结果 北京到上海 共找到 42 个航班 '.repeat(8) +
      ' 航班信息以图形卡片展示，价格区间 700-1600 元，含直飞与经停选项。';
    const hint = buildCtripFlightHint({ pageText: oddText, url })!;
    expect(hint).toBeTruthy();
    expect(hint).not.toContain('初步解析'); // no parsed rows
    expect(hint).toContain('携程结果页可见文本');
    expect(hint).toContain('已进入携程结果页，但未能稳定读取航班列表');
  });
});
