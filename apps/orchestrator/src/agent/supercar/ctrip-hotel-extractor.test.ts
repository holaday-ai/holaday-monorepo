import { describe, expect, it } from 'vitest';
import {
  bodyMatchesCity,
  extractCityFromIntent,
  extractCtripHotels,
  filterAndFormatHotels,
  resolveCtripHotelUrl,
} from './ctrip-hotel-extractor.js';

const NOW = new Date('2026-08-10T00:00:00Z');

describe('resolveCtripHotelUrl — deterministic city/date schema', () => {
  it('北京 resolves to cityId 1 (NOT Shanghai 2) with future dates', () => {
    const r = resolveCtripHotelUrl({ intent: '打开携程查北京酒店，4 星以上 800 以内', now: NOW });
    expect(r.city).toBe('北京');
    expect(r.cityId).toBe(1);
    expect(r.knownSchema).toBe(true);
    expect(r.url).toContain('city=1');
    expect(r.url).not.toContain('city=2');
    expect(r.checkin).toBe('2026-08-11');
    expect(r.checkout).toBe('2026-08-13');
  });
  it('上海/杭州/广州/深圳resolve to their own ids', () => {
    expect(resolveCtripHotelUrl({ intent: '携程上海酒店', now: NOW }).cityId).toBe(2);
    expect(resolveCtripHotelUrl({ intent: '携程杭州酒店', now: NOW }).cityId).toBe(17);
    expect(resolveCtripHotelUrl({ intent: '携程广州酒店', now: NOW }).cityId).toBe(32);
    expect(resolveCtripHotelUrl({ intent: '携程深圳酒店', now: NOW }).cityId).toBe(30);
  });
  it('dates are never in the past', () => {
    const r = resolveCtripHotelUrl({ intent: '携程北京酒店', now: NOW });
    expect(r.checkin! > '2026-08-10').toBe(true);
    expect(r.checkout! > r.checkin!).toBe(true);
  });
  it('大阪 (international) → knownSchema=false, no faked URL', () => {
    const r = resolveCtripHotelUrl({ intent: '携程查大阪酒店', now: NOW });
    expect(r.city).toBe('大阪');
    expect(r.knownSchema).toBe(false);
    expect(r.url).toBeNull();
  });
  it('unrecognised city → city null, knownSchema false', () => {
    expect(resolveCtripHotelUrl({ intent: '查个酒店', now: NOW }).city).toBeNull();
  });
  it('extractCityFromIntent picks the first supported city', () => {
    expect(extractCityFromIntent('打开携程查北京酒店')).toBe('北京');
    expect(extractCityFromIntent('随便')).toBeNull();
  });
});

describe('bodyMatchesCity — stale/mismatch guard', () => {
  it('target city present + dominant → match', () => {
    expect(bodyMatchesCity('北京王府井希尔顿 北京三里屯洲际 北京国贸大酒店', '北京')).toBe(true);
  });
  it('Beijing query reading a STALE Shanghai page → mismatch', () => {
    // the exact Step-5 bug: target 北京 but body is all 上海
    expect(bodyMatchesCity('上海五角场希尔顿 上海外滩亚朵 上海静安洲际', '北京')).toBe(false);
  });
  it('city absent → mismatch; null city → false', () => {
    expect(bodyMatchesCity('some english hotel page', '北京')).toBe(false);
    expect(bodyMatchesCity('北京', null)).toBe(false);
  });
});

const SH_BODY = [
  '携程酒店 上海 共找到 1200 家',
  '上海五角场希尔顿花园酒店 高档型 4.5分 1280条点评 五角场商圈 ¥587 起',
  '上海外滩南京东路亚朵酒店 舒适型 4.7分 外滩商圈 ¥734 起',
  '上海静安香格里拉大酒店 豪华型 4.8分 静安寺地铁站 ¥1,164 起',
  '上海虹桥维也纳酒店 经济型 4.3分 虹桥火车站 ¥468 起',
  '上海陆家嘴丽思卡尔顿酒店 豪华型 4.9分 陆家嘴商圈 ¥2,180 起',
].join('\n');

describe('extractCtripHotels', () => {
  it('parses name / price / rating / location / tier from visible text', () => {
    const hotels = extractCtripHotels(SH_BODY);
    expect(hotels.length).toBe(5);
    const hilton = hotels.find((h) => h.name.includes('希尔顿'));
    expect(hilton?.priceCNY).toBe(587);
    expect(hilton?.rating).toBe(4.5);
    expect(hilton?.location).toContain('五角场');
    expect(hilton?.starLabel).toBe('高档型');
  });
  it('handles comma prices', () => {
    expect(extractCtripHotels(SH_BODY).find((h) => h.name.includes('香格里拉'))?.priceCNY).toBe(1164);
  });
  it('returns [] for empty / no-hotel text', () => {
    expect(extractCtripHotels('')).toEqual([]);
    expect(extractCtripHotels('登录后查看')).toEqual([]);
  });
});

describe('filterAndFormatHotels — hard price cap', () => {
  it('drops hotels above the cap, sorts asc, caps topN, marks no-booking', () => {
    const hotels = extractCtripHotels(SH_BODY);
    const r = filterAndFormatHotels({ hotels, city: '上海', url: 'https://hotels.ctrip.com/hotels/list?city=2', maxPriceCNY: 800, topN: 5 });
    expect(r.table).toBeTruthy();
    expect(r.table).toContain('| 酒店名 | 评分 | 价格(¥) | 位置 | 档次 |');
    expect(r.table).toContain('维也纳'); // ¥468 in
    expect(r.table).toContain('亚朵'); // ¥734 in
    expect(r.table).not.toContain('香格里拉'); // ¥1164 over cap, dropped
    expect(r.table).not.toContain('丽思卡尔顿'); // ¥2180 dropped
    expect(r.table).toContain('未下单/未预订');
    // cheapest first
    expect(r.table!.indexOf('468')).toBeLessThan(r.table!.indexOf('587'));
  });
  it('all-over-cap → reason stating the lowest price seen, no fake table', () => {
    const expensive = extractCtripHotels('北京王府井希尔顿酒店 豪华型 4.8分 王府井商圈 ¥1,500 起\n北京国贸洲际酒店 豪华型 4.7分 国贸商圈 ¥1,800 起');
    const r = filterAndFormatHotels({ hotels: expensive, city: '北京', url: 'u', maxPriceCNY: 800 });
    expect(r.table).toBeUndefined();
    expect(r.reason).toContain('最低价为 ¥1,500');
    expect(r.reason).toContain('未找到符合');
  });
});
