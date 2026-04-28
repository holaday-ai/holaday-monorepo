/**
 * Phase 14 — Cookie bridge.
 *
 * Reads chrome.cookies for a curated list of "login-aware" domains
 * (aligned with apps/orchestrator/src/agent/supercar/site-playbooks.ts)
 * and ships a domain → boolean map to the orchestrator over the
 * existing WS connection. The orchestrator stashes the map per-user
 * so the playbook router can log "user is logged into X on Chrome"
 * for tasks that match a login-required playbook.
 *
 * Privacy: we only ship the BOOLEAN — never the cookie names or
 * values. Detection is best-effort (presence of one or more known
 * auth-cookie names; falls back to a coarse "≥6 cookies = probably
 * signed in" heuristic when the site isn't in the keyed map).
 */

import type { ClientMessage } from '@holaday/shared-types';

/**
 * Curated list. Each entry is the BARE root domain (no scheme, no
 * www / m / wap prefixes) — chrome.cookies.getAll matches all
 * subdomains with `domain:` filter. Keep in sync with the
 * site-playbooks catalogue, but only sites where login state
 * meaningfully changes the routing decision belong here. Pure
 * search portals (baidu.com, bing.com) are excluded — login state
 * doesn't gate their content.
 */
const TRACKED_DOMAINS = [
  'jd.com',
  'taobao.com',
  'tmall.com',
  'pinduoduo.com',
  'ctrip.com',
  'qunar.com',
  'fliggy.com',
  'zhipin.com',
  'liepin.com',
  'lagou.com',
  'xiaohongshu.com',
  'weibo.com',
  'zhihu.com',
  'meituan.com',
  'dianping.com',
  'xueqiu.com',
  'tianyancha.com',
  'qcc.com',
  'github.com',
] as const;

/**
 * Per-domain auth-cookie names. When ANY of the listed names is
 * present in the cookie jar, we consider the user logged in. Names
 * are public knowledge — they're set on the login response and have
 * to be sent on every authenticated request. Misses on this map fall
 * back to the cookie-count heuristic (see `isLoggedInFallback`).
 */
const LOGIN_COOKIE_MAP: Record<string, readonly string[]> = {
  'jd.com': ['thor', 'pin'],
  'taobao.com': ['_tb_token_', 'cookie2'],
  'tmall.com': ['_tb_token_', 'cookie2'],
  'pinduoduo.com': ['PDDAccessToken'],
  'ctrip.com': ['cticket'],
  'qunar.com': ['QN1', 'QN271'],
  'zhipin.com': ['wt2', 'bst'],
  'liepin.com': ['__session_seq', 'lp-account'],
  'lagou.com': ['_putrc'],
  'xiaohongshu.com': ['web_session', 'a1'],
  'weibo.com': ['SUB', 'SUBP'],
  'zhihu.com': ['z_c0'],
  'meituan.com': ['token', 'lt'],
  'dianping.com': ['dper', 'lxsdk_s'],
  'xueqiu.com': ['xq_a_token'],
  'tianyancha.com': ['auth_token'],
  'qcc.com': ['qcc_token'],
  'github.com': ['user_session', 'logged_in'],
};

/** Conservative fallback for sites without an explicit auth-cookie list. */
const FALLBACK_COOKIE_COUNT_THRESHOLD = 6;

async function isLoggedIn(domain: string): Promise<boolean> {
  let cookies: chrome.cookies.Cookie[];
  try {
    cookies = await chrome.cookies.getAll({ domain });
  } catch {
    // Permission revoked or storage error — treat as unknown/false
    // rather than throwing; the orchestrator never sees this site.
    return false;
  }
  if (cookies.length === 0) return false;

  const required = LOGIN_COOKIE_MAP[domain];
  if (required && required.length > 0) {
    const names = new Set(cookies.map((c) => c.name));
    return required.some((n) => names.has(n));
  }
  return cookies.length >= FALLBACK_COOKIE_COUNT_THRESHOLD;
}

/**
 * Snapshot login states for every tracked domain. Best-effort: any
 * single read failure leaves that domain at `false` rather than
 * tearing down the whole snapshot. Returns a plain Record so the
 * caller can pass it straight into the WS message envelope.
 */
export async function readLoginStates(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  await Promise.all(
    TRACKED_DOMAINS.map(async (d) => {
      out[d] = await isLoggedIn(d);
    }),
  );
  return out;
}

/**
 * Build the WS payload. Sender wraps it; we shape the envelope so
 * the type system catches schema drift if shared-types changes.
 */
export function buildLoginStatesMessage(
  states: Record<string, boolean>,
): Extract<ClientMessage, { type: 'client.extension.login_states' }> {
  return { type: 'client.extension.login_states', states };
}

/** For tests / debugging. */
export const _internals = {
  TRACKED_DOMAINS,
  LOGIN_COOKIE_MAP,
  FALLBACK_COOKIE_COUNT_THRESHOLD,
};
