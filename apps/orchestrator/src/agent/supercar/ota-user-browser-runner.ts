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
  isOtaDomain,
  type OtaAuditRecord,
} from './ota-user-browser-policy.js';
import {
  extractCtripFlights,
  formatCtripFlightsTable,
  isCtripFlightResultsUrl,
} from './ctrip-flight-extractor.js';

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

const URL_DERIVE_SYSTEM =
  '你是携程查询 URL 生成器。给定一个中文出行查询意图，只输出**一个**携程查询页 URL，' +
  '机票用 https://flights.ctrip.com/online/list/oneway-<出发城市码>-<到达城市码>?depdate=<YYYY-MM-DD>&nonstop=1 ' +
  '（如直飞需求加 nonstop=1；城市码用三字母如 bjs/sha/can/szx/hgh/ctu）；' +
  '酒店用 https://hotels.ctrip.com/hotels/list?city=<城市名>&checkin=<YYYY-MM-DD>&checkout=<YYYY-MM-DD>&star=4,5。' +
  '只输出 URL 本身，不要解释、不要 markdown、不要多余文字。绝不输出包含 /pay /order /checkout /cashier 的下单或支付页。';

/** Pull the first http(s) URL out of a model response. */
function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>）)】]+/);
  return m ? m[0] : null;
}

const HOTEL_EXTRACT_SYSTEM =
  '你从携程酒店结果页的可见文本中提取酒店。输出 Markdown 表格，列：酒店名 | 星级 | 价格(¥) | 评分。' +
  '按价格升序取最多 5 个；只用文本里真实出现的数据，不要编造。表格后另起一行写「仅查询，未预订」。' +
  '如果文本里没有可读的酒店列表（例如还是登录页/空白），只回复一行：' +
  '已进入携程酒店结果页，但未能稳定读取酒店列表。';

/**
 * Run a read-only OTA query in the user's browser. Returns a
 * SupercarOutcome so the existing tasks.ts terminal handler consumes it
 * unchanged.
 */
export async function runOtaUserBrowserReadonly(opts: {
  taskId: string;
  intent: string;
  deps: OtaReadonlyDeps;
}): Promise<SupercarOutcome> {
  const { taskId, intent, deps } = opts;
  const model = deps.model ?? DEFAULT_MODEL;
  const toolsUsed: string[] = [];
  let iterations = 0;
  deps.onProgress?.('正在使用你的浏览器读取页面…');

  // 1. Derive the query URL (model), then hard-guard it.
  iterations += 1;
  let url: string | null = null;
  try {
    url = firstUrl(await ask(deps.client, model, URL_DERIVE_SYSTEM, intent, 300));
  } catch (err) {
    deps.logger.warn({ taskId, err: err instanceof Error ? err.message : String(err) }, 'ota-readonly: url derive failed');
    return { status: 'failed', reason: '无法为该查询生成携程页面地址，请重试或换个说法。', iterations, toolsUsed };
  }
  if (!url) {
    return { status: 'failed', reason: '无法为该查询生成携程页面地址，请重试或换个说法。', iterations, toolsUsed };
  }

  // 2. Safety guard — domain allowlist + no pay/order/checkout.
  const navAction = { kind: 'navigate' as const, url };
  const verdict = classifyOtaAction(navAction);
  const domain = (() => {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid';
    }
  })();
  deps.audit(buildOtaAuditRecord({ taskId, domain, lane: 'user-browser', action: navAction, verdict }));
  if (!verdict.allowed) {
    return {
      status: 'failed',
      reason: `只读模式拒绝打开该地址（${verdict.reason}）。仅允许携程等 OTA 的查询页，不触达下单/支付页。`,
      iterations,
      toolsUsed,
    };
  }

  // 3. Navigate in the user's logged-in Chrome via the extension.
  iterations += 1;
  const nav = await deps.dispatchNavigate(url);
  toolsUsed.push('navigate');
  if (!nav.ok || !nav.result) {
    return {
      status: 'failed',
      reason: `无法在你的浏览器中打开携程页面（${nav.error?.message ?? '扩展无响应'}）。请确认浏览器扩展在线后重试。`,
      iterations,
      toolsUsed,
    };
  }
  const { finalUrl, bodyText } = nav.result;
  // Best-effort screenshot for evidence (no result needed).
  if (deps.dispatchScreenshot) {
    try {
      await deps.dispatchScreenshot();
      toolsUsed.push('screenshot');
    } catch {
      /* evidence only */
    }
  }

  // Guard the URL the page actually landed on too (redirects).
  if (!isOtaDomain(finalUrl)) {
    return {
      status: 'failed',
      reason: '页面跳转到了非 OTA 白名单地址，已停止读取。',
      iterations,
      toolsUsed,
    };
  }

  // 4. Login wall → awaiting_user (don't fake a result).
  if (LOGIN_WALL_RE.test(bodyText) && bodyText.length < 600) {
    return {
      status: 'awaiting_user',
      question: '该携程页面需要登录态。请在你的 Chrome 中登录携程后告诉我继续，我会用你的登录状态读取页面（仅查询，不下单/不预订）。',
      iterations,
      toolsUsed,
    };
  }

  // 5. Flights — deterministic extractor.
  if (isCtripFlightResultsUrl(finalUrl)) {
    const flights = extractCtripFlights(bodyText);
    if (flights.length > 0) {
      const table = formatCtripFlightsTable(flights, { url: finalUrl, topN: 3 });
      return {
        status: 'completed',
        summary: `已用你的浏览器读取携程机票结果页（仅查询，未下单/未预订）：\n\n${table}`,
        iterations,
        toolsUsed,
      };
    }
    return {
      status: 'failed',
      reason: '已进入携程结果页，但未能稳定读取航班列表。',
      iterations,
      toolsUsed,
    };
  }

  // 6. Hotels (or other OTA) — model extracts a table from the readable text.
  iterations += 1;
  let extracted: string;
  try {
    extracted = await ask(deps.client, model, HOTEL_EXTRACT_SYSTEM, bodyText.slice(0, 12000), 1500);
  } catch (err) {
    deps.logger.warn({ taskId, err: err instanceof Error ? err.message : String(err) }, 'ota-readonly: hotel extract failed');
    return { status: 'failed', reason: '已进入携程酒店结果页，但未能稳定读取酒店列表。', iterations, toolsUsed };
  }
  if (!extracted || /未能稳定读取/.test(extracted)) {
    return {
      status: 'failed',
      reason: '已进入携程酒店结果页，但未能稳定读取酒店列表。',
      iterations,
      toolsUsed,
    };
  }
  return {
    status: 'completed',
    summary: `已用你的浏览器读取携程酒店结果页（仅查询，未预订）：\n\n${extracted}`,
    iterations,
    toolsUsed,
  };
}
