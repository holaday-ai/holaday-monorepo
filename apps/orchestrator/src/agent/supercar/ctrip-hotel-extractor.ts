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

/** Canonical Ctrip domestic destination ids (long-standing, stable). */
const CTRIP_CITY_IDS: Readonly<Record<string, number>> = {
  上海: 2,
  北京: 1,
  广州: 32,
  深圳: 30,
  杭州: 17,
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

const HOTEL_NAME_RE = /[一-龥A-Za-z0-9·\- ]{2,30}?(?:酒店|宾馆|度假村|公寓|客栈|旅馆|Hotel|Resort|Inn)/;
const STAR_LABEL_RE = /(五钻|四钻|三钻|豪华型|高档型|舒适型|经济型|五星级?|四星级?|三星级?)/;
const LOCATION_RE = /([一-龥]{2,8}(?:商圈|商业区|新区|开发区|广场|火车站|机场|地铁站|大学|景区|路|街|区))/;

/**
 * Best-effort hotel rows from the page's visible text. Anchored on price
 * tokens (¥587 / ¥1,034); for each price the nearby window yields the
 * hotel name, rating, location, and tier label when present. Conservative:
 * a price with no recognisable hotel name nearby is skipped.
 */
export function extractCtripHotels(bodyText: string | null | undefined): CtripHotel[] {
  const out: CtripHotel[] = [];
  if (!bodyText) return out;
  const text = bodyText.replace(/ /g, ' ');
  const priceRe = /[¥￥]\s?(\d{1,3}(?:,\d{3})+|\d{2,6})/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = priceRe.exec(text)) !== null) {
    const price = parseInt((m[1] ?? '').replace(/,/g, ''), 10);
    if (!Number.isFinite(price) || price < 50 || price > 100000) continue;
    const before = text.slice(Math.max(0, m.index - 80), m.index);
    const after = text.slice(m.index, m.index + 80);
    const window = before + after;
    // Bind to the hotel name CLOSEST to (immediately before) the price —
    // the LAST name match in the before-window — so a page header
    // ("携程酒店") or the previous card's name can't steal the price.
    const nameRe = new RegExp(HOTEL_NAME_RE.source, 'g');
    let last: string | undefined;
    let nm: RegExpExecArray | null;
    while ((nm = nameRe.exec(before)) !== null) last = nm[0];
    if (!last) continue;
    const name = last.trim();
    if (seen.has(name)) continue;
    const ratingMatch = window.match(/\b([1-5]\.\d)\b(?:\s*分)?/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
    const starLabel = window.match(STAR_LABEL_RE)?.[1];
    const location = window.match(LOCATION_RE)?.[1];
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
