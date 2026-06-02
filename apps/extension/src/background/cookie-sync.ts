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
import { withDeadline } from '../shared/deadline.js';
import {
  fetchWithDeadline,
  responseJsonWithDeadline,
} from '../shared/http.js';

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

const MAX_COOKIE_VALUE_CHARS = 8192;
const MAX_COOKIE_NAME_CHARS = 256;
const MAX_COOKIE_DOMAIN_CHARS = 253;
const MAX_COOKIE_PATH_CHARS = 1024;
const COOKIE_DOMAIN_READ_TIMEOUT_MS = 1_000;
const COOKIE_SYNC_POST_TIMEOUT_MS = 8_000;
const COOKIE_SYNC_BODY_TIMEOUT_MS = 2_000;
const MAX_SYNC_RESPONSE_DOMAINS = 500;
const MAX_SYNC_RESPONSE_DOMAIN_CHARS = 253;

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

function clip(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

export function normalizeSyncableCookie(c: chrome.cookies.Cookie): SyncableCookie | null {
  const domain = c.domain.trim();
  const name = c.name.trim();
  const path = c.path || '/';
  if (!domain || !name || !path) return null;
  if (c.value.length > MAX_COOKIE_VALUE_CHARS) return null;
  return {
    domain: clip(domain, MAX_COOKIE_DOMAIN_CHARS),
    name: clip(name, MAX_COOKIE_NAME_CHARS),
    value: c.value,
    path: clip(path, MAX_COOKIE_PATH_CHARS),
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite ?? 'unspecified',
    ...(c.expirationDate && Number.isFinite(c.expirationDate)
      ? { expirationDate: c.expirationDate }
      : {}),
  };
}

function cookieIdentity(c: SyncableCookie): string {
  return `${c.domain}\u0000${c.path}\u0000${c.name}`;
}

/**
 * Read every cookie chrome.cookies will hand us for the SYNC_DOMAINS
 * list. Per-domain failures (rare — usually permission revocation
 * mid-call) log + continue so one bad domain doesn't abort the
 * whole sync.
 */
export async function collectCookies(): Promise<SyncableCookie[]> {
  const byDomain = await Promise.all(SYNC_DOMAINS.map(readCookiesForDomain));
  const out = new Map<string, SyncableCookie>();
  for (const cookies of byDomain) {
    for (const c of cookies) {
      const normalized = normalizeSyncableCookie(c);
      if (normalized) out.set(cookieIdentity(normalized), normalized);
    }
  }
  return [...out.values()];
}

async function readCookiesForDomain(domain: string): Promise<chrome.cookies.Cookie[]> {
  try {
    return await withDeadline(
      chrome.cookies.getAll({ domain }),
      COOKIE_DOMAIN_READ_TIMEOUT_MS,
      `cookie_domain_timeout:${domain}`,
    );
  } catch (err) {
    console.warn(`[holaday] cookie-sync: getAll failed for ${domain}`, err);
    return [];
  }
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
  const res = await fetchWithDeadline(
    `${ORCHESTRATOR_HTTP}/cookies/sync`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cookies }),
    },
    COOKIE_SYNC_POST_TIMEOUT_MS,
    'cookie_sync_post_timeout',
  );
  if (!res.ok) {
    throw new Error(`cookie_sync_http_${res.status}`);
  }
  const body = await responseJsonWithDeadline<unknown>(
    res,
    COOKIE_SYNC_BODY_TIMEOUT_MS,
    'cookie_sync_body_timeout',
  );
  const normalized = normalizeSyncResponse(body);
  if (!normalized) throw new Error('cookie_sync_response_invalid');
  return normalized;
}

/**
 * One-shot collect + ship. Returns the server response (or null when
 * no token). Caller swallows errors — sync is best-effort.
 */
export async function runCookieSync(): Promise<SyncResponse | null> {
  const cookies = await collectCookies();
  return syncCookiesToServer(cookies);
}

function normalizeSyncResponse(raw: unknown): SyncResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {
    synced?: unknown;
    domains?: unknown;
    deferred?: unknown;
  };
  if (
    typeof value.synced !== 'number' ||
    !Number.isFinite(value.synced) ||
    value.synced < 0 ||
    typeof value.deferred !== 'boolean'
  ) {
    return null;
  }
  const domains = Array.isArray(value.domains)
    ? value.domains
        .filter((domain): domain is string => typeof domain === 'string')
        .map((domain) => domain.trim().slice(0, MAX_SYNC_RESPONSE_DOMAIN_CHARS))
        .filter(Boolean)
        .slice(0, MAX_SYNC_RESPONSE_DOMAINS)
    : [];
  return {
    synced: Math.floor(value.synced),
    domains,
    deferred: value.deferred,
  };
}
