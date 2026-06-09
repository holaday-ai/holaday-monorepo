/**
 * Ctrip flight-results extraction adapter.
 *
 * QA (task tsk_sjxJEBQavJ5sPzcKeCrwN) showed the supercar agent reaching
 * the real flights.ctrip.com results page (no login wall, nonstop=1
 * applied) but then looping to the 50-iteration cap (~9 min) without
 * producing an answer — because the model only ever sees screenshots
 * (the `computer` tool) and Firecrawl `scrape_website` output, never the
 * page's own visible text, and the dense Ctrip SPA is hard to read from
 * pixels.
 *
 * This adapter, when the agent is parked on a Ctrip flight-results URL,
 * hands the model the page's visible innerText plus an explicit
 * extraction directive (output a Markdown table; mark 未下单/未预订; use
 * a specific "已进入携程结果页，但未能稳定读取航班列表" failure phrasing
 * instead of a generic error). A best-effort, price-anchored text parser
 * pre-structures the flights as a hint, but it is NEVER the sole path —
 * the raw text is always included so the model can extract even when the
 * page layout differs from the parser's assumptions. No fragile DOM
 * selectors; no cookie-sync / extension changes.
 */

export interface CtripFlight {
  readonly airline?: string;
  readonly depTime?: string;
  readonly arrTime?: string;
  /** true = 直飞, false = 经停/中转, undefined = unknown. */
  readonly nonstop?: boolean;
  readonly priceCNY: number;
}

/** True for a Ctrip flight LIST/results page (one-way or round-trip). */
export function isCtripFlightResultsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    const isFlightsHost = host === 'flights.ctrip.com' || host.endsWith('.flights.ctrip.com');
    return isFlightsHost && /\/online\/list\//i.test(u.pathname);
  } catch {
    return false;
  }
}

// Anti-bot / interstitial markers. When the visible text is short AND
// looks like a challenge page, the adapter bows out so the dedicated
// anti-bot path owns it (don't mislabel a block as "no flights").
const BLOCKED_RE =
  /whaleguard|人机验证|滑块|拖动验证|verify you are human|security check|访问验证|异常流量|请完成验证/i;

const KNOWN_AIRLINES: readonly string[] = [
  '中国国际航空', '中国国航', '国航',
  '中国东方航空', '东方航空', '东航',
  '中国南方航空', '南方航空', '南航',
  '海南航空', '海航',
  '厦门航空', '厦航',
  '吉祥航空', '春秋航空',
  '深圳航空', '深航',
  '山东航空', '山航',
  '四川航空', '川航',
  '上海航空', '上航',
  '天津航空', '成都航空', '华夏航空', '西部航空', '首都航空', '青岛航空', '昆明航空',
];

function matchAirline(window: string): string | undefined {
  for (const a of KNOWN_AIRLINES) {
    if (window.includes(a)) return a;
  }
  const m = window.match(/[一-龥]{2,5}航(?:空)?\b/);
  return m ? m[0] : undefined;
}

/**
 * Best-effort flight extraction from the page's visible text. Anchors on
 * price tokens (¥1280 / ￥1,280) and only emits a row when the preceding
 * window also carries two HH:MM times — so promo prices ("立减¥50") and
 * stray numbers don't masquerade as flights. Conservative by design:
 * returns [] when the layout doesn't match, leaving the model to read
 * the raw text directly.
 */
export function extractCtripFlights(pageText: string | null | undefined): CtripFlight[] {
  const out: CtripFlight[] = [];
  if (!pageText) return out;
  const text = pageText.replace(/ /g, ' ');
  // Index every HH:MM time token.
  const timeRe = /(?:[01]\d|2[0-3]):[0-5]\d/g;
  const times: { t: string; i: number }[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = timeRe.exec(text)) !== null) times.push({ t: tm[0], i: tm.index });

  const priceRe = /[¥￥]\s?(\d{1,3}(?:,\d{3})+|\d{3,6})/g;
  const seen = new Set<string>();
  // Forward-bind: a flight card reads "<airline> <dep> … <arr> … ¥price".
  // For each adjacent dep/arr time-pair (≤40 chars apart, same card), take
  // the FIRST price within ~90 chars AFTER the arrival time. Binding the
  // price forward to its own card stops a promo price (立减¥120) from
  // stealing the previous card's times — the bug a naive back-window had.
  for (let k = 0; k + 1 < times.length; k++) {
    const dep = times[k]!;
    const arr = times[k + 1]!;
    if (arr.i - dep.i > 40) continue; // not a dep/arr pair within one card
    priceRe.lastIndex = 0;
    const pm = priceRe.exec(text.slice(arr.i, arr.i + 90));
    if (!pm) continue;
    const price = parseInt((pm[1] ?? '').replace(/,/g, ''), 10);
    if (!Number.isFinite(price) || price < 100 || price > 100000) continue;
    // Detect 直飞/经停 only in the forward span (dep → arr+90), never
    // before dep — reaching back would catch the PREVIOUS card's marker.
    const span = text.slice(dep.i, arr.i + 90);
    const nonstop = /直飞/.test(span) ? true : /经停|中转/.test(span) ? false : undefined;
    const airline = matchAirline(text.slice(Math.max(0, dep.i - 60), dep.i));
    const key = `${dep.t}-${arr.t}-${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ airline, depTime: dep.t, arrTime: arr.t, nonstop, priceCNY: price });
    k++; // consumed arr as the pair's arrival; next card starts after it
  }
  return out;
}

/** Render parsed flights as a Markdown table (price asc, top N) + a
 *  no-booking note + the source link. */
export function formatCtripFlightsTable(
  flights: readonly CtripFlight[],
  opts: { url: string; topN?: number },
): string {
  const topN = opts.topN ?? 3;
  const sorted = [...flights].sort((a, b) => a.priceCNY - b.priceCNY).slice(0, topN);
  const lines: string[] = [
    '| 航空公司 | 出发-到达 | 是否直飞 | 价格(¥) |',
    '| --- | --- | --- | --- |',
  ];
  for (const f of sorted) {
    const airline = f.airline ?? '—';
    const time = f.depTime && f.arrTime ? `${f.depTime}–${f.arrTime}` : '—';
    const stop = f.nonstop === true ? '直飞' : f.nonstop === false ? '经停' : '—';
    lines.push(`| ${airline} | ${time} | ${stop} | ${f.priceCNY.toLocaleString('en-US')} |`);
  }
  lines.push('');
  lines.push(`来源（携程，仅查询，未下单/未预订）：${opts.url}`);
  return lines.join('\n');
}

/**
 * Build the model-facing hint for a Ctrip flight-results page. Returns
 * null when the page isn't ready or looks anti-bot-blocked (let the
 * anti-bot path handle that). Otherwise returns a directive embedding
 * the visible text (and a best-effort parsed table) so the model can
 * finalize a Markdown answer instead of vision-grinding.
 */
export function buildCtripFlightHint(opts: {
  pageText: string | null | undefined;
  url: string;
  topN?: number;
}): string | null {
  const text = (opts.pageText ?? '').trim();
  if (text.length < 40) return null; // page not hydrated yet — retry next turn
  if (BLOCKED_RE.test(text) && text.length < 400) return null; // challenge page
  const topN = opts.topN ?? 3;
  const flights = extractCtripFlights(text);
  const parts: string[] = [];
  parts.push(
    `你已停留在携程机票结果页（${opts.url}）。请**直接从下面的「页面可见文本」中提取航班**整理出最终答复，不要再反复截图/点击。`,
  );
  if (flights.length > 0) {
    parts.push(
      `【初步解析（按价格升序，仅供参考，请以下方原文为准核对）】\n${formatCtripFlightsTable(flights, { url: opts.url, topN })}`,
    );
  }
  parts.push(
    `要求：① 提取「航空公司 / 出发-到达时间 / 是否直飞 / 价格」 ② 按价格升序取最便宜的 ${topN} 个 ③ 用 Markdown 表格输出 ④ 结尾明确「仅查询，未下单/未预订」。\n` +
      `如果下方文本里确实没有可读的航班信息，请回复「已进入携程结果页，但未能稳定读取航班列表」并简述原因（如页面仍在加载/结构异常），**不要**泛化成「任务执行出错」。`,
  );
  parts.push(`【携程结果页可见文本】\n${text.slice(0, 12000)}`);
  return parts.join('\n\n');
}
