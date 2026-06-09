/**
 * B-专项 — safety + lane policy for running China-OTA QUERY tasks in the
 * user's own logged-in browser (extension "Mode B": chrome.tabs /
 * chrome.scripting navigate+read+screenshot — NOT the disabled
 * chrome.debugger vision-loop, and NO click/type/order capability).
 *
 * This module is the SAFETY + DECISION layer only. It does not itself
 * drive any browser — it answers two pure questions:
 *
 *   1. decideOtaLane / resolveOtaLaneForIntent
 *      Should this task use the user-browser lane, the server Brave, or
 *      neither (unchanged routing)? Gated by the OTA_USER_BROWSER flag.
 *
 *   2. classifyOtaAction
 *      Is a proposed in-page action allowed (read/search/filter/
 *      navigate) or BLOCKED (下单/预订/支付/提交订单/保存支付/改资料/
 *      发消息/评论)? Returns an audit-ready reason either way.
 *
 * The whole point is "查询/筛选/提取, never 下单/预订/支付". v1 of the
 * transport is navigate+read+screenshot only, which structurally cannot
 * place an order; classifyOtaAction is the belt-and-suspenders guard so
 * that even if a future transport adds click/type, the forbidden
 * actions are rejected with an audit trail.
 */

import { matchPlaybooks } from './playbook-service.js';

/** Domains in scope for the user-browser OTA path. */
const OTA_BASE_DOMAINS: readonly string[] = [
  'ctrip.com',
  'qunar.com',
  'fliggy.com',
  'ly.com',
  'meituan.com',
];

export type OtaLane = 'user-browser' | 'server-browser';

/** True when a URL/host belongs to a whitelisted China-OTA site. */
export function isOtaDomain(urlOrHost: string | null | undefined): boolean {
  if (!urlOrHost) return false;
  let host = urlOrHost.trim().toLowerCase();
  if (!host) return false;
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).host.toLowerCase();
  } catch {
    return false;
  }
  // Strip a leading dot (cookie-style) but reject embedded slashes/spaces.
  host = host.replace(/^\./, '');
  if (/[^a-z0-9.-]/.test(host)) return false;
  return OTA_BASE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

// ---------------------------------------------------------------------------
// Lane decision
// ---------------------------------------------------------------------------

export interface OtaLaneInputs {
  /** From the matched SitePlaybook — true for the 5 OTA sites. */
  readonly preferUserBrowser: boolean;
  /** Is the user's Chrome extension connected right now? */
  readonly extensionOnline: boolean;
  /** OTA_USER_BROWSER feature flag. */
  readonly flagEnabled: boolean;
}

/**
 * Decide the lane for an OTA-preferring task:
 *   - flag off OR not an OTA-prefer site → null (routing unchanged;
 *     server Brave runs exactly as today)
 *   - OTA-prefer + extension online  → 'user-browser'
 *   - OTA-prefer + extension offline → 'server-browser' (graceful fallback)
 */
export function decideOtaLane(inputs: OtaLaneInputs): OtaLane | null {
  if (!inputs.flagEnabled || !inputs.preferUserBrowser) return null;
  return inputs.extensionOnline ? 'user-browser' : 'server-browser';
}

/**
 * Convenience: resolve the lane straight from a task intent by matching
 * the OTA playbook (preferUserBrowser) first. Returns null for non-OTA
 * intents (e.g. "打开 example.com", "查今天股价") so they keep their
 * normal routing. Non-execution OTA topics ("携程营销策略") never reach
 * here — they classify as `generate` upstream — but if one did, it has
 * no preferUserBrowser playbook match in a browser context, so null.
 */
export function resolveOtaLaneForIntent(opts: {
  intent: string;
  extensionOnline: boolean;
  flagEnabled: boolean;
}): OtaLane | null {
  const preferUserBrowser = matchPlaybooks(opts.intent).some((p) => p.preferUserBrowser === true);
  return decideOtaLane({
    preferUserBrowser,
    extensionOnline: opts.extensionOnline,
    flagEnabled: opts.flagEnabled,
  });
}

// ---------------------------------------------------------------------------
// Canary rollout gate (Step 2.5)
// ---------------------------------------------------------------------------

/**
 * Parse a comma-separated env allowlist into a trimmed Set. Case is
 * PRESERVED — userIds (usr_…) are case-sensitive, so lowercasing them
 * would break the match. Host comparison handles case-insensitivity
 * itself (see isHostAllowed).
 */
export function parseOtaAllowlist(envValue: string | null | undefined): Set<string> {
  return new Set(
    (envValue ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** host ∈ allowlist (exact or subdomain of a listed base), case-insensitive. Empty list ⇒ false. */
export function isHostAllowed(host: string | null | undefined, allowed: ReadonlySet<string>): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase().replace(/^\./, '');
  if (!h || /[^a-z0-9.-]/.test(h)) return false;
  for (const d of allowed) {
    const dl = d.trim().toLowerCase().replace(/^\./, '');
    if (!dl) continue;
    if (h === dl || h.endsWith(`.${dl}`)) return true;
  }
  return false;
}

export type OtaIntentSubtype = 'hotel' | 'flight' | 'train' | 'maps' | 'unknown';

const FLIGHT_RE = /机票|航班|直飞|航司|航空公司|起飞|到达|机场|flight/i;
const TRAIN_RE = /火车票|高铁|动车|车次|train/i;
const MAPS_RE = /路线|导航|怎么走|公交|地铁线|地图|maps/i;
const HOTEL_RE = /酒店|宾馆|住宿|入住|星级|房价|客栈|民宿|hotel|check[\s-]?in|check[\s-]?out/i;

/**
 * Classify an OTA intent's subtype. flight/train/maps are checked BEFORE
 * hotel so a mixed prompt (or a flight that happens to mention a hotel
 * word) is forced to the safe server lane. Only 'hotel' is user-browser
 * eligible — Ctrip flights have a proven server-Brave adapter, and the
 * extension's read-only body text can't surface the flight list.
 */
export function classifyOtaIntentSubtype(intent: string | null | undefined): OtaIntentSubtype {
  const t = intent ?? '';
  if (FLIGHT_RE.test(t)) return 'flight';
  if (TRAIN_RE.test(t)) return 'train';
  if (MAPS_RE.test(t)) return 'maps';
  if (HOTEL_RE.test(t)) return 'hotel';
  return 'unknown';
}

export interface OtaCanaryInputs {
  readonly intent: string;
  readonly userId: string;
  readonly extensionOnline: boolean;
  /** Master flag (OTA_USER_BROWSER) AND any other prereqs (e.g. model client present). */
  readonly masterEnabled: boolean;
  /** OTA_USER_BROWSER_ALLOWED_USER_IDS. */
  readonly allowedUserIds: ReadonlySet<string>;
  /** OTA_USER_BROWSER_ALLOWED_DOMAINS. */
  readonly allowedDomains: ReadonlySet<string>;
}

export interface OtaCanaryDecision {
  /** 'user-browser' only when EVERY gate passes; 'server-browser' when an
   *  OTA-prefer task fails a gate; null for non-OTA (routing unchanged). */
  readonly lane: OtaLane | null;
  readonly matchedDomain: string | null;
  readonly userAllowed: boolean;
  readonly domainAllowed: boolean;
  readonly intentSubtype: OtaIntentSubtype;
  readonly reason: string;
}

/**
 * Canary-scoped lane decision. user-browser-readonly fires ONLY when:
 *   master flag on  +  intent matches an OTA preferUserBrowser playbook
 *   +  userId in the user allowlist  +  matched domain in the domain
 *   allowlist  +  extension online.
 * Any miss on an OTA task → 'server-browser' (runs on server Brave as
 * today). Non-OTA intent → null (untouched). Both empty allowlists →
 * nobody is canaried, so production default stays server Brave.
 */
export function resolveOtaCanaryLane(inputs: OtaCanaryInputs): OtaCanaryDecision {
  const intentSubtype = classifyOtaIntentSubtype(inputs.intent);
  const pb = matchPlaybooks(inputs.intent).find((p) => p.preferUserBrowser === true);
  if (!pb) {
    return {
      lane: null,
      matchedDomain: null,
      userAllowed: false,
      domainAllowed: false,
      intentSubtype,
      reason: 'non-OTA: no preferUserBrowser playbook match',
    };
  }
  const matchedDomain = pb.domain;
  const userAllowed = inputs.allowedUserIds.has(inputs.userId);
  const domainAllowed = isHostAllowed(matchedDomain, inputs.allowedDomains);
  const base = { matchedDomain, userAllowed, domainAllowed, intentSubtype } as const;
  if (!inputs.masterEnabled) return { lane: 'server-browser', ...base, reason: 'master flag off' };
  if (!userAllowed) return { lane: 'server-browser', ...base, reason: 'user not in canary allowlist' };
  if (!domainAllowed) return { lane: 'server-browser', ...base, reason: 'domain not in canary allowlist' };
  // Subtype gate — ONLY hotels use the read-only user browser. Flights
  // have a proven server-Brave adapter (the extension's read-only body
  // text can't surface the flight list); trains/maps/unknown also stay
  // on the server lane for now.
  if (intentSubtype !== 'hotel') {
    return {
      lane: 'server-browser',
      ...base,
      reason:
        intentSubtype === 'flight'
          ? 'flight-prefers-server-brave-adapter'
          : `${intentSubtype}-prefers-server-browser`,
    };
  }
  if (!inputs.extensionOnline) return { lane: 'server-browser', ...base, reason: 'extension offline' };
  return { lane: 'user-browser', ...base, reason: 'canary: hotel + user+domain allowlisted, extension online' };
}

// ---------------------------------------------------------------------------
// Action safety classifier
// ---------------------------------------------------------------------------

export type OtaActionKind = 'navigate' | 'screenshot' | 'read' | 'click' | 'type' | 'submit';

export interface OtaAction {
  readonly kind: OtaActionKind;
  /** Visible label / accessible name of the control (for click/type/submit). */
  readonly label?: string;
  /** Target URL (for navigate). */
  readonly url?: string;
}

export interface OtaActionVerdict {
  readonly allowed: boolean;
  /** Machine + human readable reason, suitable for the audit log. */
  readonly reason: string;
}

// Forbidden control labels — placing/paying for an order, saving payment,
// editing the account, or posting messages/reviews. Matched case-insensitively
// against the control's visible label.
const BLOCKED_LABEL_RE =
  /(?:提交订单|去支付|立即支付|马上支付|确认支付|确认下单|立即下单|确认订单|去结算|去付款|立即预订|确认预订|马上抢|提交预订|绑定银行卡|添加银行卡|保存银行卡|保存支付|实名认证|修改密码|账号设置|账户设置|修改资料|发表评论|发布评论|写点评|发送|私信|关注)|(?:place\s*order|pay\s*now|submit\s*order|confirm\s*(?:and\s*)?pay|book\s*now|checkout|complete\s*booking|add\s*card|save\s*card)/i;

// Forbidden navigation targets — pay/cashier/order-submit/checkout pages.
const BLOCKED_URL_RE =
  /\/(?:pay|payment|cashier|checkout|order\/(?:submit|create|pay)|trade|settlement)\b|订单提交|booking\/confirm|\/orderpay|\/cashier/i;

/**
 * Classify a proposed OTA in-page action. read/screenshot/navigate (to a
 * non-payment URL) are always allowed; click/type/submit are allowed only
 * when the control label is NOT a forbidden order/payment/account/message
 * action. Navigation to a payment/checkout/order URL is blocked too.
 */
export function classifyOtaAction(action: OtaAction): OtaActionVerdict {
  switch (action.kind) {
    case 'read':
    case 'screenshot':
      return { allowed: true, reason: `${action.kind}: read-only, allowed` };
    case 'navigate': {
      const url = action.url ?? '';
      if (!isOtaDomain(url)) {
        return { allowed: false, reason: `navigate blocked: off-whitelist url (${url.slice(0, 80)})` };
      }
      if (BLOCKED_URL_RE.test(url)) {
        return { allowed: false, reason: `navigate blocked: payment/order url (${url.slice(0, 80)})` };
      }
      return { allowed: true, reason: 'navigate: whitelisted OTA query url, allowed' };
    }
    case 'click':
    case 'type':
    case 'submit': {
      const label = (action.label ?? '').trim();
      if (action.kind === 'submit') {
        return { allowed: false, reason: `submit blocked: form submission is never allowed (label="${label.slice(0, 40)}")` };
      }
      if (BLOCKED_LABEL_RE.test(label)) {
        return { allowed: false, reason: `${action.kind} blocked: forbidden action label ("${label.slice(0, 40)}")` };
      }
      return { allowed: true, reason: `${action.kind}: benign control ("${label.slice(0, 40)}"), allowed` };
    }
    default:
      return { allowed: false, reason: `unknown action kind blocked` };
  }
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface OtaAuditRecord {
  readonly event: 'ota.user_browser.action';
  readonly taskId: string;
  readonly domain: string;
  readonly lane: OtaLane;
  readonly actionType: OtaActionKind;
  /** Selector or visible label the action targeted. */
  readonly target: string;
  readonly decision: 'allowed' | 'blocked';
  readonly reason: string;
}

/** Build a structured audit record for one OTA user-browser action. */
export function buildOtaAuditRecord(opts: {
  taskId: string;
  domain: string;
  lane: OtaLane;
  action: OtaAction;
  verdict: OtaActionVerdict;
}): OtaAuditRecord {
  return {
    event: 'ota.user_browser.action',
    taskId: opts.taskId,
    domain: opts.domain,
    lane: opts.lane,
    actionType: opts.action.kind,
    target: (opts.action.label ?? opts.action.url ?? '').slice(0, 120),
    decision: opts.verdict.allowed ? 'allowed' : 'blocked',
    reason: opts.verdict.reason,
  };
}
