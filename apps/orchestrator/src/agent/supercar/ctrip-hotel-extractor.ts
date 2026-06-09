/**
 * Ctrip hotel user-browser stabilization (Step 6).
 *
 * Step-5 QA exposed two failure modes on the read-only user-browser lane:
 *   1. the model freely invented hotel URLs ("?city=北京") + past dates,
 *      so a Beijing query read a stale Shanghai page and returned the
 *      WRONG city's hotels with full confidence.
 *   2. the extracted table was weak (star "未标注", price filter ignored).
 *
 * This pure module fixes both:
 *   - resolveCtripHotelUrl: deterministic city→cityId + future dates
 *     (no model URL invention). Cities outside the supported set return
 *     knownSchema=false so the caller can log it and bail instead of
 *     faking a result.
 *   - bodyMatchesCity: stale/mismatch guard — the page body must mention
 *     the target city; otherwise we refuse to output a table.
 *   - extractCtripHotels + filterAndFormatHotels: price-anchored parse +
 *     a hard "≤ maxPrice" filter (high-only pages report "未找到符合").
 *
 * No DOM selectors, no click/type — text in, structured out.
 */

/** Canonical Ctrip domestic destination ids (long-standing, stable).
 *  Only mainland-China cities — international schema is different and
 *  intentionally out of scope (returns knownSchema=false). */
const CTRIP_CITY_IDS: Readonly<Record<string, number>> = {
  上海: 2,
  北京: 1,
  广州: 32,
  深圳: 30,
  杭州: 17,
  成都: 28,
  重庆: 4,
  南京: 12,
  苏州: 14,
  武汉: 477,
  西安: 10,
  厦门: 25,
  青岛: 29,
  三亚: 43,
};

/** Cities QA targets but whose Ctrip hotel URL schema we are NOT sure of. */
const UNKNOWN_SCHEMA_CITIES: readonly string[] = ['大阪'];

const SUPPORTED_CITIES: readonly string[] = [
  ...Object.keys(CTRIP_CITY_IDS),
  ...UNKNOWN_SCHEMA_CITIES,
];

export interface CtripHotelUrlResult {
  /** The target city resolved from the intent, or null if none recognised. */
  readonly city: string | null;
  /** True only when we have a trusted cityId-based URL. */
  readonly knownSchema: boolean;
  /** The navigate URL, or null when the schema is unknown. */
  readonly url: string | null;
  readonly cityId: number | null;
  readonly checkin: string | null;
  readonly checkout: string | null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

/** First supported city name mentioned in the intent. */
export function extractCityFromIntent(intent: string | null | undefined): string | null {
  const t = intent ?? '';
  for (const c of SUPPORTED_CITIES) {
    if (t.includes(c)) return c;
  }
  return null;
}

/**
 * Resolve a deterministic Ctrip hotel-list URL for the intent's city.
 * Dates are ALWAYS in the future (checkin = now+1, checkout = now+3),
 * derived from `now` (default current time) — never a model-invented or
 * past date. Star/price filters are intentionally NOT encoded in the URL
 * (Ctrip's filter params are unstable); filtering happens on the read
 * text in filterAndFormatHotels.
 */
export function resolveCtripHotelUrl(opts: {
  intent: string;
  now?: Date;
}): CtripHotelUrlResult {
  const city = extractCityFromIntent(opts.intent);
  const now = opts.now ?? new Date();
  const checkin = fmtDate(addDays(now, 1));
  const checkout = fmtDate(addDays(now, 3));
  if (!city) {
    return { city: null, knownSchema: false, url: null, cityId: null, checkin: null, checkout: null };
  }
  const cityId = CTRIP_CITY_IDS[city];
  if (cityId == null) {
    // Supported-but-unknown-schema (e.g. 大阪, international) — do NOT fake a URL.
    return { city, knownSchema: false, url: null, cityId: null, checkin, checkout };
  }
  const url = `https://hotels.ctrip.com/hotels/list?city=${cityId}&checkin=${checkin}&checkout=${checkout}`;
  return { city, knownSchema: true, url, cityId, checkin, checkout };
}

/**
 * Stale/mismatch guard. True when the page body plausibly belongs to the
 * target city: the city name appears AND no OTHER supported domestic city
 * dominates the text. Used to refuse a confidently-wrong table when a
 * navigate read a stale tab.
 */
export function bodyMatchesCity(bodyText: string | null | undefined, city: string | null): boolean {
  if (!city) return false;
  const text = bodyText ?? '';
  const targetCount = countOccurrences(text, city);
  if (targetCount === 0) return false;
  for (const other of Object.keys(CTRIP_CITY_IDS)) {
    if (other === city) continue;
    if (countOccurrences(text, other) > targetCount) return false; // another city dominates
  }
  return true;
}

/** The supported city most frequently mentioned in the body, for audit. */
export function dominantSupportedCity(bodyText: string | null | undefined): string | null {
  const text = bodyText ?? '';
  let best: string | null = null;
  let bestCount = 0;
  for (const c of Object.keys(CTRIP_CITY_IDS)) {
    const n = countOccurrences(text, c);
    if (n > bestCount) {
      bestCount = n;
      best = c;
    }
  }
  return best;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Hotel extraction
// ---------------------------------------------------------------------------

export interface CtripHotel {
  readonly name: string;
  readonly priceCNY: number;
  readonly rating?: number;
  readonly location?: string;
  /** Coarse tier label if the page states one (未标注 when absent — never invented). */
  readonly starLabel?: string;
}

const STAR_LABEL_RE = /(五钻|四钻|三钻|二钻|豪华型|高档型|舒适型|经济型|五星级?|四星级?|三星级?)/;
const LOCATION_RE =
  /([一-龥]{2,10}(?:商圈|商业区|cbd|CBD|新区|开发区|度假区|广场|火车站|高铁站|机场|地铁站|大学|景区|步行街|古镇|老街|湾|路|街|区|附近))/;
// A "hotel card" must carry at least one of these signals; a bare price
// (promo "立减¥120", a ranking-card price) without any of them is skipped.
const HOTEL_SIGNAL_RE =
  /[1-5]\.\d\s*分?|[五四三二]钻|豪华型|高档型|舒适型|经济型|\d+\s*条(?:点评|评价)|星级|含早|早餐|大床|双床|入住/;
// Ad / ranking / coupon cards — never extract these as hotels.
const AD_CARD_RE = /广告|榜单|必住榜|口碑榜|金榜|银榜|领券|立减|满减|超值券|限时(?:抢|秒)|会员日|大促|专享券/;
// First metadata token that ends the hotel-name prefix in a card chunk.
const NAME_END_RE =
  /[1-5]\.\d|[五四三二]钻|豪华型|高档型|舒适型|经济型|星级|\d+\s*条(?:点评|评价)|[¥￥]|预订|[一-龥]{2,10}(?:商圈|cbd|CBD|新区|开发区|度假区|广场|火车站|高铁站|机场|地铁站|大学|景区|步行街|古镇|老街)|\d{2,}(?:人|条)/;
// Leading page-noise to strip off a candidate name.
const NAME_NOISE_RE =
  /^(?:.*?(?:共找到[\d,]+家|找到[\d,]+家|推荐排序|价格排序|好评优先|低价优先|智能排序|距离优先|综合排序|筛选|清空|携程(?:旅行|酒店)?|hotels?\.ctrip|广告|榜单|排名第?\d*|第\d+名|猜你喜欢))\s*/i;

/** Pull a hotel name from a price-anchored card. Does NOT require a
 *  "酒店/宾馆" suffix — brand names (亚朵/丽思卡尔顿/柏悦/W) are accepted:
 *  it's the leading run before the first metadata token, page-noise
 *  stripped. Returns '' when nothing name-like remains. */
function extractName(card: string): string {
  const chunk = card.split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean).pop() ?? card.trim();
  const end = chunk.search(NAME_END_RE);
  let name = (end > 0 ? chunk.slice(0, end) : chunk).trim();
  name = name.replace(NAME_NOISE_RE, '').trim();
  name = name.replace(/^[\s|·,，、.。:：\-]+/, '').replace(/[\s|·,，、.。:：\-]+$/, '').trim();
  if (name.length < 2 || name.length > 34) return '';
  if (!/[一-龥A-Za-z]/.test(name)) return '';
  return name;
}

/**
 * Best-effort hotel rows from the page's visible text (v2). Anchors on
 * price tokens; the CARD is the text between the previous price and this
 * one. A card must carry a hotel signal (rating / tier / 点评 / room
 * words) and not be an ad/ranking/coupon card; the name is the leading
 * run before the first metadata token (no suffix required).
 */
export function extractCtripHotels(bodyText: string | null | undefined): CtripHotel[] {
  const out: CtripHotel[] = [];
  if (!bodyText) return out;
  const text = bodyText.replace(/ /g, ' ');
  const priceRe = /[¥￥]\s?(\d{1,3}(?:,\d{3})+|\d{2,6})/g;
  const seen = new Set<string>();
  let prevEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = priceRe.exec(text)) !== null) {
    const price = parseInt((m[1] ?? '').replace(/,/g, ''), 10);
    const cardStart = Math.max(prevEnd, m.index - 120);
    const card = text.slice(cardStart, m.index);
    prevEnd = m.index + m[0].length;
    if (!Number.isFinite(price) || price < 50 || price > 100000) continue;
    if (AD_CARD_RE.test(card)) continue; // ad / ranking / coupon — skip
    if (!HOTEL_SIGNAL_RE.test(card)) continue; // no hotel signal — skip promo / bare price
    const name = extractName(card);
    if (!name || seen.has(name)) continue;
    const ratingMatch = card.match(/\b([1-5]\.\d)\b(?:\s*分)?/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
    const starLabel = card.match(STAR_LABEL_RE)?.[1];
    const location = card.match(LOCATION_RE)?.[1];
    seen.add(name);
    out.push({
      name,
      priceCNY: price,
      ...(rating != null && rating >= 1 && rating <= 5 ? { rating } : {}),
      ...(location ? { location } : {}),
      ...(starLabel ? { starLabel } : {}),
    });
  }
  return out;
}

export interface HotelFilterResult {
  /** Markdown table when ≥1 hotel passes the filter. */
  readonly table?: string;
  /** Reason string when nothing qualifies (e.g. all over the price cap). */
  readonly reason?: string;
}

/**
 * Filter + format hotels. Hard price cap: a hotel ABOVE maxPriceCNY never
 * appears in a "≤ maxPrice" result. If nothing qualifies, returns a
 * reason that states the lowest price actually seen (no fabrication).
 * Star is NOT used to drop rows (Ctrip text often omits it) — it is only
 * displayed; minStar is advisory.
 */
export function filterAndFormatHotels(opts: {
  hotels: readonly CtripHotel[];
  city: string;
  url: string;
  maxPriceCNY?: number;
  topN?: number;
}): HotelFilterResult {
  const topN = opts.topN ?? 5;
  const cap = opts.maxPriceCNY ?? Infinity;
  const within = opts.hotels.filter((h) => h.priceCNY <= cap);
  if (within.length === 0) {
    const lowest = opts.hotels.length > 0 ? Math.min(...opts.hotels.map((h) => h.priceCNY)) : null;
    const capStr = Number.isFinite(cap) ? `≤¥${cap}` : '该价格';
    return {
      reason:
        lowest != null
          ? `${opts.city}：页面读到的酒店最低价为 ¥${lowest.toLocaleString('en-US')}，未找到符合「${capStr}」筛选的酒店。`
          : `${opts.city}：未从页面读到可解析的酒店列表。`,
    };
  }
  const sorted = [...within].sort((a, b) => a.priceCNY - b.priceCNY).slice(0, topN);
  const lines: string[] = [
    '| 酒店名 | 评分 | 价格(¥) | 位置 | 档次 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const h of sorted) {
    lines.push(
      `| ${h.name} | ${h.rating != null ? h.rating : '未标注'} | ${h.priceCNY.toLocaleString('en-US')} | ${h.location ?? '未标注'} | ${h.starLabel ?? '未标注'} |`,
    );
  }
  lines.push('');
  lines.push(`来源（携程，仅查询，未下单/未预订）：${opts.url}`);
  return { table: lines.join('\n') };
}
