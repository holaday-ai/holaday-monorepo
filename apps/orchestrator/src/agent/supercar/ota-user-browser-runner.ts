/**
 * B-专项 Step 2 — read-only OTA user-browser lane runner.
 *
 * Runs a China-OTA QUERY task (查询/筛选/提取) in the user's OWN logged-in
 * Chrome via the extension's Mode B `server.extension.tool_call` channel —
 * `navigate` (+ body-text read) and `screenshot` ONLY. It does NOT touch
 * the disabled vision-loop P0 functions, does NOT use chrome.debugger, and
 * has NO click / type / form-submit path, so it structurally cannot place
 * an order or pay.
 *
 * Flow (no agent loop, ≤2 model calls — deterministic + testable):
 *   1. derive a Ctrip query URL for the intent (model, then guarded)
 *   2. classifyOtaAction(navigate) — block pay/order/off-whitelist URLs
 *   3. extension navigate → user's logged-in page body text + title
 *   4. login-wall? → awaiting_user (don't fake a result)
 *   5. flights → ctrip-flight-extractor → Markdown table
 *   6. hotels → model extracts a table from the readable body text,
 *      or the specific "已进入携程结果页，但未能稳定读取..." failure
 *
 * Every navigate is audited (allowed/blocked + reason). All deps are
 * injected so the lane is unit-testable without a live extension/model.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { SupercarOutcome } from './agent-loop.js';
import {
  buildOtaAuditRecord,
  classifyOtaAction,
  classifyOtaIntentSubtype,
  isHostAllowed,
  isOtaDomain,
  type OtaAuditRecord,
} from './ota-user-browser-policy.js';
import {
  bodyMatchesCity,
  dominantSupportedCity,
  filterAndFormatHotels,
  lowestDeterministicPrice,
  parseHotelJson,
  parseHotelPriceLimit,
  resolveCtripHotelUrl,
  validateHotelJson,
} from './ctrip-hotel-extractor.js';

/** Result shape the extension returns for a `navigate` tool call. */
export interface ExtensionNavigateResult {
  readonly finalUrl: string;
  readonly title: string;
  readonly bodyText: string;
}

export interface OtaReadonlyDeps {
  /** Anthropic client — used to derive the query URL + extract hotels. */
  readonly client: Anthropic;
  /** Dispatch a `navigate` tool call to the user's Chrome via the extension. */
  readonly dispatchNavigate: (
    url: string,
  ) => Promise<{ ok: boolean; result?: ExtensionNavigateResult; error?: { message: string; code?: string } }>;
  /** Best-effort screenshot for evidence (optional; result ignored). */
  readonly dispatchScreenshot?: () => Promise<unknown>;
  /** Emit one structured audit record per attempted action. */
  readonly audit: (record: OtaAuditRecord) => void;
  /** User-visible progress line ("正在使用你的浏览器读取页面…"). */
  readonly onProgress?: (message: string) => void;
  readonly logger: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };
  readonly model?: string;
  /**
   * Step 2.5 canary scope — the navigate URL host must be in this set
   * (e.g. {ctrip.com}). Defence-in-depth on top of the lane decision:
   * even if the model derives a non-canary OTA URL (qunar/fliggy/...),
   * navigate is blocked. Omit/empty ⇒ no canary narrowing (the broad
   * OTA whitelist + classifyOtaAction still apply).
   */
  readonly allowedDomains?: ReadonlySet<string>;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const LOGIN_WALL_RE = /需要登录|请登录|登录后(?:查看|继续)|扫码登录|未登录|whaleguard|请完成验证|账号登录/i;

function textFromMessage(msg: Anthropic.Message): string {
  return (msg.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function ask(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
  maxTokens = 1500,
): Promise<string> {
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return textFromMessage(msg);
}

const HOTEL_JSON_SYSTEM =
  '你从携程酒店结果页的可见文本中提取酒店，输出**严格 JSON 数组**，每项：' +
  '{"hotelName":"","rating":"","price":678,"location":"","starOrTier":""}。规则：' +
  '① hotelName 必须是真实的酒店/宾馆/公寓/品牌名（如「上海五角场希尔顿花园酒店」「亚朵」「全季」「柏悦」）。' +
  '② 严禁把优惠/促销/徽章标签当作酒店名，包括但不限于：会员价、特惠、一口价、降价、优惠XX、' +
  '「连续XX位住客好评」、立减、满减、折扣、券、套餐、限时、比收藏时降价。不确定酒店名就丢弃该项，绝不编造。' +
  '③ 只返回目标城市的酒店；④ 只返回 price ≤ 给定上限的酒店；⑤ 最多 topN 个，按价格升序；' +
  '⑥ price 为纯数字（人民币元）；缺失字段用空字符串。' +
  '⑦ 只输出 JSON，不要 Markdown、不要解释。若读不到任何真实酒店，输出 []。';

/** Parse 价格上限 / top-N out of the intent ("价格低于 800", "给 5 个").
 *  Price parsing delegates to the pure parseHotelPriceLimit helper (unit
 *  tested) so phrasings like "800 以内" (no 元) are honoured; null → no cap. */
function parseHotelFilters(intent: string): { maxPriceCNY?: number; topN: number } {
  const maxPriceCNY = parseHotelPriceLimit(intent);
  const top = intent.match(/(?:给|取|前|top|列)\s*(\d{1,2})/i);
  const topN = top ? Math.min(10, Math.max(1, parseInt(top[1] ?? '5', 10))) : 5;
  return { ...(maxPriceCNY != null ? { maxPriceCNY } : {}), topN };
}

interface GuardResult {
  ok: boolean;
  host: string;
  reason?: string;
}

/** classifyOtaAction + canary-domain guard for a navigate URL, with audit. */
function guardNavigate(deps: OtaReadonlyDeps, taskId: string, url: string): GuardResult {
  const action = { kind: 'navigate' as const, url };
  const verdict = classifyOtaAction(action);
  let host = 'invalid';
  try {
    host = new URL(url).host;
  } catch {
    /* keep invalid */
  }
  deps.audit(buildOtaAuditRecord({ taskId, domain: host, lane: 'user-browser', action, verdict }));
  if (!verdict.allowed) {
    return { ok: false, host, reason: `只读模式拒绝打开该地址（${verdict.reason}）。仅允许携程查询页，不触达下单/支付页。` };
  }
  if (deps.allowedDomains && deps.allowedDomains.size > 0 && !isHostAllowed(host, deps.allowedDomains)) {
    deps.audit(
      buildOtaAuditRecord({
        taskId,
        domain: host,
        lane: 'user-browser',
        action,
        verdict: { allowed: false, reason: `navigate blocked: host not in canary allowlist (${host})` },
      }),
    );
    return { ok: false, host, reason: '该 OTA 域名暂不在灰度范围内，已停止读取。' };
  }
  return { ok: true, host };
}

interface ReadResult {
  nav: Awaited<ReturnType<OtaReadonlyDeps['dispatchNavigate']>>;
  bodyText: string;
  finalUrl: string;
  attempts: number;
  stale: boolean;
}

/**
 * Navigate (up to 3×) until the page body is content-bearing AND — when a
 * target city is given — actually belongs to that city. A stale tab that
 * still shows the previous city's hotels is detected and retried; never
 * accepted as a result. Logs targetCity / observedCity / readAttempt /
 * staleDetected per attempt.
 */
async function navigateWithRetry(
  deps: OtaReadonlyDeps,
  taskId: string,
  url: string,
  targetCity: string | null,
  satisfied: (bodyText: string) => boolean = () => true,
  maxAttempts = 3,
): Promise<ReadResult> {
  let last: Awaited<ReturnType<OtaReadonlyDeps['dispatchNavigate']>> = { ok: false };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await deps.dispatchNavigate(url);
    if (!last.ok || !last.result) {
      deps.logger.info(
        { event: 'ota.user_browser.read', taskId, targetCity, observedCity: null, readAttempt: attempt, staleDetected: false, navOk: false },
        'ota: read attempt',
      );
      continue;
    }
    const bodyText = last.result.bodyText ?? '';
    const observedCity = dominantSupportedCity(bodyText);
    const isLoginWall = LOGIN_WALL_RE.test(bodyText) && bodyText.length < 600;
    const stale = targetCity ? !bodyMatchesCity(bodyText, targetCity) : false;
    const thin = bodyText.length < 40;
    deps.logger.info(
      { event: 'ota.user_browser.read', taskId, targetCity, observedCity, readAttempt: attempt, staleDetected: stale, navOk: true },
      'ota: read attempt',
    );
    // Accept a login wall (handled upstream as awaiting_user) OR a
    // content-bearing, non-stale page that the caller's predicate is
    // happy with (flights: parseable list; hotels: any content).
    if (isLoginWall || (!stale && !thin && satisfied(bodyText))) {
      return { nav: last, bodyText, finalUrl: last.result.finalUrl ?? '', attempts: attempt, stale };
    }
    // unsatisfied / stale / thin → re-navigate (extension reloads the tab).
  }
  return {
    nav: last,
    bodyText: last.ok && last.result ? last.result.bodyText ?? '' : '',
    finalUrl: last.ok && last.result ? last.result.finalUrl ?? '' : '',
    attempts: maxAttempts,
    stale: true,
  };
}

/**
 * Run a read-only OTA query in the user's browser. Returns a
 * SupercarOutcome so the existing tasks.ts terminal handler consumes it
 * unchanged.
 */
export async function runOtaUserBrowserReadonly(opts: {
  taskId: string;
  intent: string;
  deps: OtaReadonlyDeps;
  now?: Date;
}): Promise<SupercarOutcome> {
  const { taskId, intent, deps } = opts;
  const model = deps.model ?? DEFAULT_MODEL;
  const toolsUsed: string[] = [];
  let iterations = 0;

  // 0. Subtype guard (Step 7) — the read-only user browser handles HOTELS
  //    ONLY. Flights have a proven server-Brave adapter and can't be read
  //    from the extension's body text; trains/maps/unknown also belong on
  //    the server lane. tasks.ts already avoids routing non-hotel intents
  //    here; this is defence-in-depth so a mis-route fails fast (and is
  //    re-runnable on server Brave) instead of grinding.
  const subtype = classifyOtaIntentSubtype(intent);
  if (subtype !== 'hotel') {
    deps.logger.info(
      { taskId, intentSubtype: subtype, reason: 'non-hotel-rejected-by-readonly-runner' },
      'ota: readonly runner only handles hotels — rejecting',
    );
    return {
      status: 'failed',
      reason: `只读用户浏览器仅支持酒店查询（本次为 ${subtype}）；机票/火车票/路线等请走服务器浏览器执行，本次未执行。`,
      iterations,
      toolsUsed,
    };
  }
  deps.onProgress?.('正在使用你的浏览器读取页面…');

  // 1. Resolve the hotel query URL deterministically: city→cityId + future
  //    dates (NO model URL invention — the Step-5 wrong-city bug).
  const resolved = resolveCtripHotelUrl({ intent, ...(opts.now ? { now: opts.now } : {}) });
  const targetCity = resolved.city;
  iterations += 1;
  if (!resolved.knownSchema || !resolved.url) {
    deps.logger.info(
      { taskId, city: resolved.city, knownSchema: resolved.knownSchema, reason: 'unknown-ctrip-hotel-schema' },
      'ota: ctrip hotel schema unknown — not faking a URL',
    );
    return {
      status: 'failed',
      reason: resolved.city
        ? `「${resolved.city}」的携程酒店页面地址暂不在已支持范围内（避免读到错误城市），未执行。`
        : '未能从你的描述中识别要查询的城市，请明确城市名后重试。',
      iterations,
      toolsUsed,
    };
  }
  const url = resolved.url;

  // 2. Safety guard — domain allowlist + no pay/order/checkout + canary scope.
  const guard = guardNavigate(deps, taskId, url);
  if (!guard.ok) {
    return { status: 'failed', reason: guard.reason ?? '导航地址被拒绝。', iterations, toolsUsed };
  }

  // 3. Navigate in the user's logged-in Chrome (with stale/early-read retry
  //    + city-match guard so a stale tab can't yield a wrong-city table).
  iterations += 1;
  const read = await navigateWithRetry(deps, taskId, url, targetCity);
  toolsUsed.push('navigate');
  if (!read.nav.ok || !read.nav.result) {
    return {
      status: 'failed',
      reason: `无法在你的浏览器中打开携程页面（${read.nav.error?.message ?? '扩展无响应'}）。请确认浏览器扩展在线后重试。`,
      iterations,
      toolsUsed,
    };
  }
  const { finalUrl, bodyText } = read;
  if (deps.dispatchScreenshot) {
    try {
      await deps.dispatchScreenshot();
      toolsUsed.push('screenshot');
    } catch {
      /* evidence only */
    }
  }
  if (!isOtaDomain(finalUrl)) {
    return { status: 'failed', reason: '页面跳转到了非 OTA 白名单地址，已停止读取。', iterations, toolsUsed };
  }
  if (LOGIN_WALL_RE.test(bodyText) && bodyText.length < 600) {
    return {
      status: 'awaiting_user',
      question: '该携程页面需要登录态。请在你的 Chrome 中登录携程后告诉我继续，我会用你的登录状态读取页面（仅查询，不下单/不预订）。',
      iterations,
      toolsUsed,
    };
  }
  // Stale/mismatch after all retries → refuse to output a (wrong-city) table.
  if (read.stale) {
    deps.logger.info(
      { taskId, targetCity, attempts: read.attempts, staleDetected: true },
      'ota: stale/mismatch after retries — refusing table',
    );
    return {
      status: 'failed',
      reason: targetCity
        ? `多次读取后页面仍未稳定到「${targetCity}」（可能是浏览器标签停留在上一个城市的页面），未输出结果以免给出错误城市。请稍后重试。`
        : '多次读取后页面仍未稳定，未输出结果。',
      iterations,
      toolsUsed,
    };
  }

  // 4. Hotels — MODEL-PRIMARY extraction (Step 9). The model reads the
  //    real page text and returns strict JSON; the deterministic extractor
  //    is demoted to validation only (it grabbed promo labels like
  //    「优惠74」/「特惠一口价」as names on real Ctrip text). A validator
  //    drops any item whose name is a promo/badge label or whose price is
  //    over the cap; nothing reaches the table unless the name is real.
  const filters = parseHotelFilters(intent);
  const city = targetCity ?? '该城市';
  iterations += 1;
  let modelText: string;
  try {
    const userMsg =
      `目标城市：${city}；价格上限：${filters.maxPriceCNY ?? '无'} 元；最多 ${filters.topN} 个。\n\n` +
      `页面可见文本：\n${bodyText.slice(0, 12000)}`;
    modelText = await ask(deps.client, model, HOTEL_JSON_SYSTEM, userMsg, 2000);
  } catch (err) {
    deps.logger.warn({ taskId, err: err instanceof Error ? err.message : String(err) }, 'ota-readonly: hotel model extract failed');
    return { status: 'failed', reason: `已读取${city}携程酒店页面，但未能稳定识别符合条件的酒店名。`, iterations, toolsUsed };
  }
  const valid = validateHotelJson({
    items: parseHotelJson(modelText),
    ...(filters.maxPriceCNY != null ? { priceLimit: filters.maxPriceCNY } : {}),
    topN: filters.topN,
  });
  deps.logger.info(
    { taskId, city, modelItems: parseHotelJson(modelText).length, validHotels: valid.length, priceLimit: filters.maxPriceCNY ?? null },
    'ota: hotel model extraction validated',
  );
  if (valid.length > 0) {
    const formatted = filterAndFormatHotels({ hotels: valid, city, url: finalUrl, topN: filters.topN });
    return {
      status: 'completed',
      summary: `已用你的浏览器读取携程酒店结果页（仅查询，未预订）：\n\n${formatted.table ?? ''}`,
      iterations,
      toolsUsed,
    };
  }
  // 0 valid hotels — be honest, never dump promo-label rows.
  const lowest = lowestDeterministicPrice(bodyText);
  if (filters.maxPriceCNY != null && lowest != null && lowest > filters.maxPriceCNY) {
    return {
      status: 'failed',
      reason: `${city}：页面读到的酒店最低价为 ¥${lowest.toLocaleString('en-US')}，未找到符合「≤¥${filters.maxPriceCNY}」筛选的酒店。`,
      iterations,
      toolsUsed,
    };
  }
  return {
    status: 'failed',
    reason: `已读取${city}携程酒店页面，但未能稳定识别符合条件的酒店名（仅查询，未预订）。`,
    iterations,
    toolsUsed,
  };
}
