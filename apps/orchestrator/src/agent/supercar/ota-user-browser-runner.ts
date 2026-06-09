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
  isHostAllowed,
  isOtaDomain,
  type OtaAuditRecord,
} from './ota-user-browser-policy.js';
import {
  extractCtripFlights,
  formatCtripFlightsTable,
  isCtripFlightResultsUrl,
} from './ctrip-flight-extractor.js';
import {
  bodyMatchesCity,
  dominantSupportedCity,
  extractCtripHotels,
  filterAndFormatHotels,
  resolveCtripHotelUrl,
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

const FLIGHT_URL_DERIVE_SYSTEM =
  '你是携程机票查询 URL 生成器。给定一个中文机票查询意图，只输出**一个**携程机票查询页 URL：' +
  'https://flights.ctrip.com/online/list/oneway-<出发城市码>-<到达城市码>?depdate=<YYYY-MM-DD>&nonstop=1 ' +
  '（直飞需求加 nonstop=1；城市码三字母 bjs/sha/can/szx/hgh/ctu）。' +
  '只输出 URL 本身，不要解释/markdown。绝不输出含 /pay /order /checkout /cashier 的下单或支付页。';

/** Pull the first http(s) URL out of a model response. */
function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>）)】]+/);
  return m ? m[0] : null;
}

const HOTEL_EXTRACT_SYSTEM =
  '你从携程酒店结果页的可见文本中提取酒店。输出 Markdown 表格，列：酒店名 | 评分 | 价格(¥) | 位置 | 档次。' +
  '只用文本里真实出现的数据，不要编造；没有的字段写「未标注」。务必排除价格高于给定上限的酒店。' +
  '按价格升序取最多 N 个。表格后另起一行写「仅查询，未预订」。' +
  '若文本里没有可读的酒店列表（登录页/空白），只回复一行：已进入携程酒店结果页，但未能稳定读取酒店列表。';

function detectTaskKind(intent: string): 'hotel' | 'flight' {
  return /酒店|宾馆|住宿|民宿|客栈|\bhotel\b/i.test(intent) ? 'hotel' : 'flight';
}

/** Parse 价格上限 / top-N out of the intent ("价格低于 800", "给 5 个"). */
function parseHotelFilters(intent: string): { maxPriceCNY?: number; topN: number } {
  const price = intent.match(/(?:低于|不超过|不高于|以内)\s*(\d{2,5})|(\d{2,5})\s*元(?:以内|以下|之内)?/);
  const maxPriceCNY = price ? parseInt(price[1] ?? price[2] ?? '', 10) : undefined;
  const top = intent.match(/(?:给|取|前|top|列)\s*(\d{1,2})/i);
  const topN = top ? Math.min(10, Math.max(1, parseInt(top[1] ?? '5', 10))) : 5;
  return { ...(Number.isFinite(maxPriceCNY) ? { maxPriceCNY } : {}), topN };
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
  deps.onProgress?.('正在使用你的浏览器读取页面…');
  const kind = detectTaskKind(intent);

  // 1. Resolve the query URL.
  //    Hotels: deterministic city→cityId + future dates (NO model URL
  //    invention — the Step-5 wrong-city bug). Flights: model-derived.
  let url: string;
  let targetCity: string | null = null;
  if (kind === 'hotel') {
    const r = resolveCtripHotelUrl({ intent, ...(opts.now ? { now: opts.now } : {}) });
    targetCity = r.city;
    if (!r.knownSchema || !r.url) {
      deps.logger.info(
        { taskId, city: r.city, knownSchema: r.knownSchema, reason: 'unknown-ctrip-hotel-schema' },
        'ota: ctrip hotel schema unknown — not faking a URL',
      );
      return {
        status: 'failed',
        reason: r.city
          ? `「${r.city}」的携程酒店页面地址暂不在已支持范围内（避免读到错误城市），未执行。`
          : '未能从你的描述中识别要查询的城市，请明确城市名后重试。',
        iterations,
        toolsUsed,
      };
    }
    url = r.url;
    iterations += 1;
  } else {
    iterations += 1;
    let derived: string | null = null;
    try {
      derived = firstUrl(await ask(deps.client, model, FLIGHT_URL_DERIVE_SYSTEM, intent, 300));
    } catch (err) {
      deps.logger.warn({ taskId, err: err instanceof Error ? err.message : String(err) }, 'ota-readonly: flight url derive failed');
    }
    if (!derived) {
      return { status: 'failed', reason: '无法为该机票查询生成携程页面地址，请重试或换个说法。', iterations, toolsUsed };
    }
    url = derived;
  }

  // 2. Safety guard — domain allowlist + no pay/order/checkout + canary scope.
  const guard = guardNavigate(deps, taskId, url);
  if (!guard.ok) {
    return { status: 'failed', reason: guard.reason ?? '导航地址被拒绝。', iterations, toolsUsed };
  }

  // 3. Navigate in the user's logged-in Chrome (with stale/early-read retry).
  //    Flights retry until the list actually parses (early-read on the
  //    JS-rendered SPA returns an empty shell); hotels just need content
  //    (the deterministic+model extractors handle parsing downstream).
  iterations += 1;
  const satisfied =
    kind === 'flight' ? (body: string) => extractCtripFlights(body).length > 0 : () => true;
  const read = await navigateWithRetry(deps, taskId, url, targetCity, satisfied);
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

  // 4a. Flights — deterministic extractor (retry already handled above).
  if (kind === 'flight' || isCtripFlightResultsUrl(finalUrl)) {
    const flights = extractCtripFlights(bodyText);
    if (flights.length > 0) {
      return {
        status: 'completed',
        summary: `已用你的浏览器读取携程机票结果页（仅查询，未下单/未预订）：\n\n${formatCtripFlightsTable(flights, { url: finalUrl, topN: 3 })}`,
        iterations,
        toolsUsed,
      };
    }
    return { status: 'failed', reason: '已进入携程结果页，但未能稳定读取航班列表。', iterations, toolsUsed };
  }

  // 4b. Hotels — deterministic extractor + hard price cap; model fallback.
  const filters = parseHotelFilters(intent);
  const hotels = extractCtripHotels(bodyText);
  if (hotels.length > 0) {
    const formatted = filterAndFormatHotels({
      hotels,
      city: targetCity ?? '该城市',
      url: finalUrl,
      ...(filters.maxPriceCNY != null ? { maxPriceCNY: filters.maxPriceCNY } : {}),
      topN: filters.topN,
    });
    if (formatted.table) {
      return {
        status: 'completed',
        summary: `已用你的浏览器读取携程酒店结果页（仅查询，未预订）：\n\n${formatted.table}`,
        iterations,
        toolsUsed,
      };
    }
    // Hotels read but none within the price cap — report honestly.
    return { status: 'failed', reason: formatted.reason ?? '未找到符合筛选的酒店。', iterations, toolsUsed };
  }
  // Deterministic parse found nothing — fall back to model extraction.
  iterations += 1;
  let extracted: string;
  try {
    const userMsg = `目标城市：${targetCity ?? '未知'}；价格上限：${filters.maxPriceCNY ?? '无'}；取前 ${filters.topN} 个。\n\n页面文本：\n${bodyText.slice(0, 12000)}`;
    extracted = await ask(deps.client, model, HOTEL_EXTRACT_SYSTEM, userMsg, 1500);
  } catch (err) {
    deps.logger.warn({ taskId, err: err instanceof Error ? err.message : String(err) }, 'ota-readonly: hotel model extract failed');
    return { status: 'failed', reason: '已进入携程酒店结果页，但未能稳定读取酒店列表。', iterations, toolsUsed };
  }
  if (!extracted || /未能稳定读取/.test(extracted)) {
    return { status: 'failed', reason: '已进入携程酒店结果页，但未能稳定读取酒店列表。', iterations, toolsUsed };
  }
  return {
    status: 'completed',
    summary: `已用你的浏览器读取携程酒店结果页（仅查询，未预订）：\n\n${extracted}`,
    iterations,
    toolsUsed,
  };
}
