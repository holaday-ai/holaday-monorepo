/**
 * BROWSER-HOME-1 — the address bar of the person's own cloud browser (`browserHome.nav`).
 *
 * Kept apart from tasks.browserNav on purpose: a task browser's navigation keeps its mainline rules
 * (a failed load has an unknown outcome and the browser is stopped). Here the person drives their
 * own browser and sees the screen, so a page that does not load is just an error message:
 *
 * - The browser is kept (no quarantine, no release) — also while one of their tasks holds it: the
 *   person's input goes through that task's control, and the assistant re-reads the page after
 *   any input of theirs before it acts again.
 * - Safety does not depend on the load outcome. Every request the browser makes (the target and
 *   every redirect hop) goes through the pool's egress proxy, which checks the same network policy
 *   per request: plain http to a refused address gets a 403 text page, https gets its CONNECT
 *   refused (net::ERR_TUNNEL_CONNECTION_FAILED). The refused address's content never loads.
 *   On top of that, when the page ends up on a refused address (a redirect the proxy answered with
 *   its 403 page) it is moved to about:blank, so the screen never shows that address either.
 */

import {
  type BrowserNetworkPolicy,
  defaultBrowserNetworkPolicy,
  staticBrowserUrlSafetyMessage,
} from '../agent/browser-network-policy.js';
import { translateNavError } from '../agent/nav-error-translator.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../browser-pool/types.js';

export type BrowserHomeNavDirection = 'back' | 'forward' | 'reload' | 'goto';
export type BrowserHomeNavResult = { ok: true } | { ok: false; reason: string; message?: string };

const NAV_TIMEOUT_MS = 15_000;
const BLANK_TIMEOUT_MS = 5_000;

export const BROWSER_HOME_NAV_COPY = {
  blockedRedirect: '这个网页跳转到了本机、内网或云服务元数据地址，为保护安全已停止打开。',
  tunnelRefused: '网页没有打开：这个地址不允许访问，或暂时无法连接。',
  loadFailed: '网页没有打开，请检查网址或稍后重试。',
} as const;

/** The Chinese message for a page that did not load (never the raw browser error). */
export function browserHomeLoadFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/err_tunnel_connection_failed|err_proxy_connection_failed/i.test(raw))
    return BROWSER_HOME_NAV_COPY.tunnelRefused;
  const translated = translateNavError(error);
  return translated.kind === 'generic' ? BROWSER_HOME_NAV_COPY.loadFailed : translated.friendly;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

interface NavPage {
  url(): string;
  goto(url: string, options: { timeout: number; waitUntil: 'domcontentloaded' }): Promise<unknown>;
  goBack(options: { timeout: number; waitUntil: 'domcontentloaded' }): Promise<unknown>;
  goForward(options: { timeout: number; waitUntil: 'domcontentloaded' }): Promise<unknown>;
  reload(options: { timeout: number; waitUntil: 'domcontentloaded' }): Promise<unknown>;
}

/**
 * When the page ended on an address the policy refuses (only a redirect can get it there: the
 * typed target was checked first), move it to about:blank. True when it did.
 */
async function leaveRefusedAddress(
  page: NavPage,
  checkedTarget: string | null,
  failed: boolean,
  policy: Pick<BrowserNetworkPolicy, 'check'>,
): Promise<boolean> {
  let current: string;
  try {
    current = page.url();
  } catch {
    return false;
  }
  if (!/^https?:\/\//i.test(current)) return false;
  // Still on the address that was checked before loading: nothing new to check.
  if (!failed && checkedTarget && sameOrigin(current, checkedTarget)) return false;
  let refused: boolean;
  try {
    const decision = await policy.check(current);
    refused =
      !decision.allowed &&
      (decision.reason === 'private_network' ||
        decision.reason === 'embedded_credentials' ||
        decision.reason === 'bad_scheme');
  } catch {
    refused = false;
  }
  if (!refused) return false;
  try {
    await page.goto('about:blank', { timeout: BLANK_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
  } catch {
    // The proxy already kept the refused address's content out; the blank page is extra.
  }
  return true;
}

/**
 * The person's back / forward / reload / goto on their cloud browser. `reviewAllowed`: the browser
 * is in the session (no task holds it), so the person's own review control may be opened. A goto
 * target must pass the browser network policy. A page that does not load returns its Chinese
 * message and keeps the browser.
 */
export async function navigateBrowserHome(args: {
  pool: Pick<BrowserPool, 'peek'>;
  instance: BrowserInstance;
  reviewAllowed: boolean;
  direction: BrowserHomeNavDirection;
  url?: string;
  policy?: Pick<BrowserNetworkPolicy, 'check'>;
}): Promise<BrowserHomeNavResult> {
  const { pool, instance } = args;
  const policy = args.policy ?? defaultBrowserNetworkPolicy;
  const session =
    browserControlSessions.openForViewer(instance) ??
    (args.reviewAllowed ? browserControlSessions.review(instance) : null);
  if (!session) return { ok: false, reason: 'browser_control_not_owned' };
  try {
    return await session.control.runHuman(async (signal): Promise<BrowserHomeNavResult> => {
      const page = (await instance.executor.getPage()) as unknown as NavPage;
      const options = { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' as const };
      let target = args.url?.trim() ?? '';
      let checkedTarget: string | null = null;
      if (args.direction === 'goto') {
        if (!target) return { ok: false, reason: 'missing_url' };
        if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
        if (!/^https?:\/\//i.test(target))
          return {
            ok: false,
            reason: 'bad_scheme',
            message: staticBrowserUrlSafetyMessage(target) ?? '只能访问 http 或 https 网页。',
          };
        const decision = await policy.check(target);
        if (!decision.allowed)
          return { ok: false, reason: 'blocked_target', message: decision.message };
        checkedTarget = target;
      }
      signal.throwIfAborted();
      // Still this user's browser (its key may move between the session and their task).
      if (pool.peek(instance.taskId) !== instance || instance.status !== 'ready')
        throw new Error('browser_session_changed');
      let loadError: unknown = null;
      try {
        if (args.direction === 'back') {
          if (!(await page.goBack(options))) return { ok: false, reason: 'no_history' };
        } else if (args.direction === 'forward') {
          if (!(await page.goForward(options))) return { ok: false, reason: 'no_history' };
        } else if (args.direction === 'goto') await page.goto(target, options);
        else await page.reload(options);
      } catch (error) {
        loadError = error;
      }
      if (await leaveRefusedAddress(page, checkedTarget, loadError !== null, policy))
        return {
          ok: false,
          reason: 'blocked_redirect',
          message: BROWSER_HOME_NAV_COPY.blockedRedirect,
        };
      if (loadError !== null)
        return {
          ok: false,
          reason: 'load_failed',
          message: browserHomeLoadFailureMessage(loadError),
        };
      return { ok: true };
    }, 'navigate');
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'nav_failed' };
  }
}
