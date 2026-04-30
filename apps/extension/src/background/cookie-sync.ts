/**
 * Phase 17 — extension cookie sync.
 *
 * Reads chrome.cookies for a curated list of high-frequency sites
 * the agent commonly drives, then POSTs the values to
 * `${ORCHESTRATOR_HTTP}/cookies/sync`. The orchestrator either
 * injects them into the user's live Brave instance immediately or
 * parks them in `pending_cookies` for the next allocate.
 *
 * Sister module of `cookie-bridge.ts`: that one ships a domain →
 * boolean login-state map (no values) so the orchestrator's
 * playbook router can hint "user has Chrome login for X". This
 * module ships the actual cookie VALUES so the user's logged-in
 * sessions transfer to the agent's browser.
 */

import { getAccessToken } from '../shared/storage.js';
import { ORCHESTRATOR_HTTP } from '../shared/config.js';

/**
 * Curated list of domains we care about. Leading dot matches both
 * apex and subdomains via chrome.cookies.getAll. Order doesn't
 * matter functionally; grouped by region for readability.
 */
const SYNC_DOMAINS: readonly string[] = [
  // Chinese e-commerce
  '.taobao.com',
  '.tmall.com',
  '.jd.com',
  '.pinduoduo.com',
  // Chinese video / social
  '.bilibili.com',
  '.weibo.com',
  '.zhihu.com',
  '.douyin.com',
  '.xiaohongshu.com',
  '.douban.com',
  // Chinese travel / lifestyle
  '.ctrip.com',
  '.meituan.com',
  '.alipay.com',
  // Chinese search / portal
  '.baidu.com',
  // Western dev / search / video
  '.github.com',
  '.google.com',
  '.youtube.com',
  '.twitter.com',
  '.x.com',
  '.linkedin.com',
  // Western shopping
  '.amazon.com',
  '.amazon.co.jp',
];

export interface SyncableCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expirationDate?: number;
}

/**
 * Read every cookie chrome.cookies will hand us for the SYNC_DOMAINS
 * list. Per-domain failures (rare — usually permission revocation
 * mid-call) log + continue so one bad domain doesn't abort the
 * whole sync.
 */
export async function collectCookies(): Promise<SyncableCookie[]> {
  const out: SyncableCookie[] = [];
  for (const domain of SYNC_DOMAINS) {
    let cookies: chrome.cookies.Cookie[];
    try {
      cookies = await chrome.cookies.getAll({ domain });
    } catch (err) {
      console.warn(`[holaday] cookie-sync: getAll failed for ${domain}`, err);
      continue;
    }
    for (const c of cookies) {
      out.push({
        domain: c.domain,
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite ?? 'unspecified',
        ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
      });
    }
  }
  return out;
}

interface SyncResponse {
  synced: number;
  domains: string[];
  deferred: boolean;
}

/**
 * POST the collected cookies to the orchestrator. Returns null when
 * unauthenticated (no access token in storage) so the caller can
 * skip silently — sync is best-effort and shouldn't block on auth
 * state.
 */
export async function syncCookiesToServer(
  cookies: readonly SyncableCookie[],
): Promise<SyncResponse | null> {
  if (cookies.length === 0) return { synced: 0, domains: [], deferred: false };
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(`${ORCHESTRATOR_HTTP}/cookies/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cookies }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`cookie-sync HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as SyncResponse;
}

/**
 * One-shot collect + ship. Returns the server response (or null when
 * no token). Caller swallows errors — sync is best-effort.
 */
export async function runCookieSync(): Promise<SyncResponse | null> {
  const cookies = await collectCookies();
  return syncCookiesToServer(cookies);
}
