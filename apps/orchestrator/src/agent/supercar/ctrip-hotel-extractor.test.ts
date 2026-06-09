import { describe, expect, it } from 'vitest';
import {
  bodyMatchesCity,
  extractCityFromIntent,
  extractCtripHotels,
  filterAndFormatHotels,
  isValidHotelName,
  parseHotelJson,
  resolveCtripHotelUrl,
  validateHotelJson,
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
  it('v2 city map: 成都/重庆/南京/苏州/武汉/西安/厦门/青岛/三亚 resolve to ids', () => {
    const ids: Record<string, number> = {
      成都: 28, 重庆: 4, 南京: 12, 苏州: 14, 武汉: 477, 西安: 10, 厦门: 25, 青岛: 29, 三亚: 43,
    };
    for (const [city, id] of Object.entries(ids)) {
      const r = resolveCtripHotelUrl({ intent: `携程查${city}酒店`, now: NOW });
      expect(r.cityId, city).toBe(id);
      expect(r.knownSchema, city).toBe(true);
      expect(r.url, city).toContain(`city=${id}`);
    }
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

// ── v2 extractor: suffix-free brands, ad filtering, dominant city ──
const SH_V2_BODY = [
  '携程酒店 上海 共找到 1380 家 推荐排序 价格排序',
  '广告 上海必住榜 口碑榜单 领券立减 ¥99 会员专享',
  '上海素凯泰酒店 豪华型 4.9分 1024条点评 静安寺商圈 ¥1,880 起',
  '上海外滩亚朵S酒店 舒适型 4.7分 312条点评 南京东路步行街 ¥669 起',
  '上海虹桥全季酒店 经济型 4.5分 880条点评 虹桥火车站 ¥420 起',
  '上海陆家嘴柏悦酒店 豪华型 4.8分 506条点评 陆家嘴CBD ¥2,180 起',
  '上海五角场汉庭酒店 经济型 4.3分 1500条点评 五角场商圈 ¥389 起',
].join('\n');

describe('extractCtripHotels v2 — suffix-free brands + ad filtering', () => {
  it('parses brand names incl. 亚朵S/全季/汉庭/素凯泰/柏悦; ignores the ad/榜单/领券 card', () => {
    const hotels = extractCtripHotels(SH_V2_BODY);
    const names = hotels.map((h) => h.name);
    expect(hotels.length).toBe(5); // ad card excluded
    expect(names.some((n) => n.includes('亚朵S'))).toBe(true);
    expect(names.some((n) => n.includes('全季'))).toBe(true);
    expect(names.some((n) => n.includes('素凯泰'))).toBe(true);
    // the ad/ranking/coupon line must NOT become a hotel
    expect(names.some((n) => /必住榜|榜单|广告|领券/.test(n))).toBe(false);
    expect(hotels.some((h) => h.priceCNY === 99)).toBe(false);
  });

  it('binds price/rating/location to the right card', () => {
    const all = extractCtripHotels(SH_V2_BODY);
    const quanji = all.find((h) => h.name.includes('全季'));
    expect(quanji?.priceCNY).toBe(420);
    expect(quanji?.rating).toBe(4.5);
    expect(quanji?.location).toContain('虹桥');
    expect(quanji?.starLabel).toBe('经济型');
  });

  it('上海 ≤800 filter keeps 全季/亚朵S/汉庭, drops 素凯泰/柏悦', () => {
    const r = filterAndFormatHotels({ hotels: extractCtripHotels(SH_V2_BODY), city: '上海', url: 'https://hotels.ctrip.com/hotels/list?city=2', maxPriceCNY: 800, topN: 5 });
    expect(r.table).toContain('全季');
    expect(r.table).toContain('亚朵S');
    expect(r.table).toContain('汉庭');
    expect(r.table).not.toContain('素凯泰'); // ¥1880
    expect(r.table).not.toContain('柏悦'); // ¥2180
  });
});

const HZ_V2_BODY = [
  '携程酒店 杭州 共找到 920 家',
  '杭州西湖国宾馆 豪华型 4.8分 西湖景区 ¥760 起',
  '杭州武林银泰亚朵酒店 舒适型 4.6分 武林广场 ¥560 起',
  '杭州西溪喜来登度假大酒店 豪华型 4.7分 西溪湿地 ¥980 起',
  '杭州滨江星程酒店 经济型 4.4分 滨江开发区 ¥320 起',
].join('\n');

describe('extractCtripHotels v2 — 杭州 fixture (3-5 rows)', () => {
  it('reads 杭州 hotels and applies the ≤800 cap', () => {
    const hotels = extractCtripHotels(HZ_V2_BODY);
    expect(hotels.length).toBe(4);
    const r = filterAndFormatHotels({ hotels, city: '杭州', url: 'https://hotels.ctrip.com/hotels/list?city=17', maxPriceCNY: 800, topN: 5 });
    expect(r.table).toContain('星程'); // ¥320 in
    expect(r.table).toContain('亚朵'); // ¥560 in
    expect(r.table).toContain('国宾馆'); // ¥760 in
    expect(r.table).not.toContain('喜来登'); // ¥980 over cap
    expect(r.table).toContain('未下单/未预订');
  });
});

describe('Step 9 — isValidHotelName (promo-label blacklist)', () => {
  it('rejects the exact Step-8 junk names', () => {
    for (const n of ['百达屋会员价', '优惠74', '特惠一口价', '比收藏时降价', '连续39位住客好评', '立减200', '3项优惠192', '券后价']) {
      expect(isValidHotelName(n), n).toBe(false);
    }
  });
  it('accepts real hotel / brand names (suffix or not)', () => {
    for (const n of ['上海五角场希尔顿花园酒店', '亚朵', '全季', '柏悦', '上海素凯泰', '汉庭酒店']) {
      expect(isValidHotelName(n), n).toBe(true);
    }
  });
  it('rejects empty / pure-digit / over-long', () => {
    expect(isValidHotelName('')).toBe(false);
    expect(isValidHotelName('12345')).toBe(false);
    expect(isValidHotelName('x'.repeat(50))).toBe(false);
    expect(isValidHotelName(123)).toBe(false);
  });
});

describe('Step 9 — parseHotelJson + validateHotelJson', () => {
  it('parses a fenced JSON array', () => {
    expect(parseHotelJson('```json\n[{"hotelName":"亚朵","price":420}]\n```').length).toBe(1);
    expect(parseHotelJson('garbage')).toEqual([]);
    expect(parseHotelJson(null)).toEqual([]);
  });
  it('good case: real hotels pass through, sorted + capped', () => {
    const items = [
      { hotelName: '上海外滩亚朵酒店', rating: '4.7', price: 678, location: '外滩', starOrTier: '舒适型' },
      { hotelName: '上海虹桥全季酒店', rating: 4.5, price: 420, location: '虹桥', starOrTier: '经济型' },
    ];
    const v = validateHotelJson({ items, priceLimit: 800, topN: 5 });
    expect(v.map((h) => h.name)).toEqual(['上海虹桥全季酒店', '上海外滩亚朵酒店']); // price asc
    expect(v[0]!.rating).toBe(4.5);
    expect(v[0]!.location).toBe('虹桥');
  });
  it('mixed: junk names + over-cap dropped, only real in-budget kept', () => {
    const items = [
      { hotelName: '上海外滩亚朵酒店', price: 678 },
      { hotelName: '特惠一口价', price: 420 }, // blacklisted name
      { hotelName: '上海静安香格里拉大酒店', price: 1164 }, // over cap
      { hotelName: '连续39位住客好评', price: 300 }, // blacklisted
    ];
    const v = validateHotelJson({ items, priceLimit: 800, topN: 5 });
    expect(v.map((h) => h.name)).toEqual(['上海外滩亚朵酒店']);
  });
  it('price-cap: nothing under cap → empty', () => {
    const items = [{ hotelName: '上海王府酒店', price: 1500 }, { hotelName: '上海国贸酒店', price: 1800 }];
    expect(validateHotelJson({ items, priceLimit: 800 })).toEqual([]);
  });
});

describe('bodyMatchesCity v2 — dominant city among recommendations', () => {
  it('Shanghai page with a few Beijing recommendations still matches 上海', () => {
    const mixed = SH_V2_BODY + '\n猜你喜欢 北京王府井希尔顿酒店 ¥1,200 北京三里屯洲际 ¥1,400';
    expect(bodyMatchesCity(mixed, '上海')).toBe(true); // 上海 dominates
    expect(bodyMatchesCity(mixed, '北京')).toBe(false); // not the result city
  });
});
