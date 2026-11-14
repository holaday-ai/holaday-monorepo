/**
 * BROWSER-HOME-1 — a user's cloud browser that belongs to no task.
 *
 * One per user, keyed `bhs_<userId>` in the BrowserPool (no tasks row). It is allocated like a
 * task browser — same Brave pool, network policy and egress proxy, anonymous session (no login
 * state is kept) — but idles out after 15 minutes instead of the pool-wide default. The last
 * address it showed (the URL only, never page content) is kept in memory so a reopened session
 * goes back there.
 */

import type { Logger } from 'pino';
import {
  defaultBrowserNetworkPolicy,
  staticBrowserUrlSafetyMessage,
} from '../agent/browser-network-policy.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { PageLike } from '../agent/vision-loop/playwright-executor.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import { BROWSER_HOME_SESSION_PREFIX, type BrowserInstance } from '../browser-pool/types.js';

export const BROWSER_HOME_IDLE_TIMEOUT_MS = 15 * 60_000;
const MAX_REMEMBERED_URLS = 10_000;
const MAX_URL_LENGTH = 2048;

export type BrowserHomePool = Pick<
  BrowserPool,
  'allocate' | 'peek' | 'release' | 'touch' | 'setIdleTimeout'
>;

export function browserHomeSessionId(userId: string): string {
  return `${BROWSER_HOME_SESSION_PREFIX}${userId}`;
}

export function isBrowserHomeSessionId(id: string): boolean {
  return id.startsWith(BROWSER_HOME_SESSION_PREFIX);
}

/** Only a public http(s) address is worth remembering (never about:blank or an error page). */
function rememberable(url: string | null | undefined): url is string {
  return (
    typeof url === 'string' &&
    url.length <= MAX_URL_LENGTH &&
    /^https?:\/\//i.test(url) &&
    staticBrowserUrlSafetyMessage(url) === null
  );
}

export interface BrowserHomeOpenResult {
  sessionId: string;
  /** The page the browser shows; null = a blank page (the SPA shows the HOLA DAY home). */
  url: string | null;
}

export class BrowserHomeSessions {
  private readonly lastUrls = new Map<string, string>();
  private readonly opening = new Map<string, Promise<BrowserHomeOpenResult>>();
  private readonly watched = new WeakSet<object>();

  /** The user's ready home browser, or null. */
  instanceFor(pool: Pick<BrowserPool, 'peek'>, userId: string): BrowserInstance | null {
    const instance = pool.peek(browserHomeSessionId(userId));
    if (!instance || instance.userId !== userId || instance.status !== 'ready') return null;
    return instance;
  }

  lastUrl(userId: string): string | null {
    return this.lastUrls.get(userId) ?? null;
  }

  rememberUrl(userId: string, url: string | null | undefined): void {
    if (!rememberable(url)) return;
    this.lastUrls.delete(userId);
    this.lastUrls.set(userId, url);
    while (this.lastUrls.size > MAX_REMEMBERED_URLS) {
      const oldest = this.lastUrls.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.lastUrls.delete(oldest);
    }
  }

  /** Create the user's home browser, or return the one already open (one per user). */
  open(pool: BrowserHomePool, userId: string, logger: Logger): Promise<BrowserHomeOpenResult> {
    const pending = this.opening.get(userId);
    if (pending) return pending;
    const promise = this.openOnce(pool, userId, logger).finally(() => {
      if (this.opening.get(userId) === promise) this.opening.delete(userId);
    });
    this.opening.set(userId, promise);
    return promise;
  }

  private async openOnce(
    pool: BrowserHomePool,
    userId: string,
    logger: Logger,
  ): Promise<BrowserHomeOpenResult> {
    const sessionId = browserHomeSessionId(userId);
    const existing = this.instanceFor(pool, userId);
    if (existing) {
      pool.touch(sessionId);
      openPersonControl(existing);
      const url = await currentUrl(existing);
      this.rememberUrl(userId, url);
      return { sessionId, url: rememberable(url) ? url : null };
    }

    const restoreTo = this.lastUrl(userId);
    const instance = await pool.allocate(sessionId, userId, undefined, {
      targetUrl: restoreTo,
      // Login state is not kept for the home browser (a resident profile is later work).
      sessionPolicy: 'anonymous',
    });
    pool.setIdleTimeout(sessionId, BROWSER_HOME_IDLE_TIMEOUT_MS);
    await this.watchNavigations(instance, userId);
    let url: string | null = null;
    if (restoreTo) url = await this.restore(instance, restoreTo, userId, logger);
    openPersonControl(instance);
    return { sessionId, url };
  }

  private async restore(
    instance: BrowserInstance,
    target: string,
    userId: string,
    logger: Logger,
  ): Promise<string | null> {
    try {
      const decision = await defaultBrowserNetworkPolicy.check(target);
      if (!decision.allowed) {
        this.lastUrls.delete(userId);
        return null;
      }
      const page = (await instance.executor.getPage()) as unknown as PageLike;
      const navigation = await instance.executor.navigate(page, decision.url);
      if (!navigation.ok) return null;
      const url = await currentUrl(instance);
      this.rememberUrl(userId, url);
      return rememberable(url) ? url : null;
    } catch (error) {
      logger.warn(
        { userId, err: error instanceof Error ? error.message : String(error) },
        'browser-home: restoring the last page failed',
      );
      return null;
    }
  }

  /**
   * Keep the last address current while the person clicks around, so an idle release (the pool
   * GC, which does not call back) still reopens where they were. Best effort: a page or adapter
   * without events just falls back to the addresses seen by open / nav / close.
   */
  private async watchNavigations(instance: BrowserInstance, userId: string): Promise<void> {
    try {
      const page = (await instance.executor.getPage()) as unknown as {
        context?: () => {
          pages?: () => unknown[];
          on?: (event: 'page', listener: (page: unknown) => void) => void;
        };
      };
      const context = page.context?.();
      if (!context?.on || !context.pages) return;
      const watchPage = (candidate: unknown) => {
        const p = candidate as {
          on?: (event: 'framenavigated', listener: (frame: unknown) => void) => void;
          mainFrame?: () => unknown;
        };
        if (!p?.on || !p.mainFrame || this.watched.has(p)) return;
        this.watched.add(p);
        p.on('framenavigated', (frame) => {
          if (frame !== p.mainFrame?.()) return;
          this.rememberUrl(userId, (frame as { url?: () => string }).url?.());
        });
      };
      for (const existing of context.pages()) watchPage(existing);
      context.on('page', watchPage);
    } catch {
      // Best effort only (see above).
    }
  }

  /** Release the user's home browser (remembering where it was). False when none was open. */
  async close(pool: BrowserHomePool, userId: string): Promise<boolean> {
    await this.opening.get(userId)?.catch(() => {});
    const instance = this.instanceFor(pool, userId);
    if (!instance) return false;
    this.rememberUrl(userId, await currentUrl(instance));
    return pool.release(instance.taskId, 'browser-home-close');
  }
}

/**
 * The person uses this browser directly: open its (review) control so screencast input and
 * address-bar navigation go through it, exactly as on a finished task's browser. A browser whose
 * control failed (outcome unknown) is being stopped; nothing to open then.
 */
function openPersonControl(instance: BrowserInstance): void {
  try {
    browserControlSessions.openForViewer(instance) ?? browserControlSessions.review(instance);
  } catch {
    // See above.
  }
}

async function currentUrl(instance: BrowserInstance): Promise<string | null> {
  try {
    return (await instance.executor.getPage()).url();
  } catch {
    return null;
  }
}

export const browserHomeSessions = new BrowserHomeSessions();
