/**
 * BROWSER-HOME-1 — a user's cloud browser that belongs to no task.
 *
 * One per user, keyed `bhs_<userId>` in the BrowserPool (no tasks row). It is allocated like a
 * task browser — same Brave pool, network policy and egress proxy, personal identity scope —
 * but idles out after 15 minutes instead of the pool-wide default. No saved identity is loaded
 * unless the server explicitly selects an owned profile. The last
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
/**
 * A page that leaves (unmount) does not release at once: the last viewer leaving starts this
 * grace, and any open() within it (the same tab coming back, a reload) cancels the release.
 */
export const BROWSER_HOME_CLOSE_GRACE_MS = 5_000;
const MAX_VIEWERS_PER_USER = 32;
const MAX_REMEMBERED_URLS = 10_000;
const MAX_URL_LENGTH = 2048;

export type BrowserHomePool = Pick<
  BrowserPool,
  | 'allocate'
  | 'peek'
  | 'release'
  | 'touch'
  | 'setIdleTimeout'
  | 'browserHomeHolder'
  | 'peekBrowserHome'
  | 'endBrowserHomeLoan'
>;

/**
 * Step 4: a task sent from the floating input runs in this browser. Between the request's checks
 * and the moment the pool lends the browser to the task, this claim keeps a second send out (after
 * that the pool's loan does). A claim never handed over is dropped by its request; one handed over
 * but never lent (the dispatch never ran) stops counting after CLAIM_STALE_MS.
 */
const CLAIM_STALE_MS = 2 * 60_000;

export interface BrowserHomeTaskClaim {
  /** The server-owned browser present when this task was admitted. */
  readonly instance: BrowserInstance;
  /** A superseded claim or replacement browser may never inherit this task. */
  isCurrent(): boolean;
  /** The request hands the claim to the task's dispatch, which lends the browser. */
  handOver(): void;
  /** Drop it (the browser is lent, or the task never got that far). Idempotent. */
  release(): void;
  /** The request ends: drop the claim unless it was handed over. */
  settle(): void;
}

export type BrowserHomeClaimResult =
  | { kind: 'claimed'; claim: BrowserHomeTaskClaim }
  | { kind: 'busy' }
  | { kind: 'closed' };

/** Where the user's cloud browser is: in its session, or lent to one of their tasks. */
export interface BrowserHomeLocation {
  instance: BrowserInstance;
  /** The task holding it, or null when it is in the session. */
  heldBy: string | null;
}

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
  cloudProfileId?: string;
}
export interface BrowserHomeProfileSelection {
  id: string;
  origin: string;
}

/** What leave() did: other pages still use it, its release was scheduled, or none was open. */
export type BrowserHomeLeaveResult = 'kept' | 'scheduled' | 'none';

export class BrowserHomeSessions {
  private readonly lastUrls = new Map<string, string>();
  private readonly opening = new Map<
    string,
    {
      profileId: string | null;
      promise: Promise<BrowserHomeOpenResult>;
    }
  >();
  private readonly watched = new WeakSet<object>();
  private readonly taskClaims = new Map<string, { token: object; at: number }>();
  /**
   * P2-4: the open /browser pages of each user (one id per page mount). Only the last one leaving
   * releases the browser, and only after the close grace. A page that vanished without leaving
   * (a crashed tab) keeps its id until the browser is gone; the 15-minute idle still applies,
   * since only a page showing the screen keeps the browser active.
   */
  private readonly viewers = new Map<string, Set<string>>();
  private readonly pendingReleases = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly closeGraceMs: number;

  constructor(options: { closeGraceMs?: number } = {}) {
    this.closeGraceMs = options.closeGraceMs ?? BROWSER_HOME_CLOSE_GRACE_MS;
  }

  /** The user's ready home browser while it is in the session (not lent to a task), or null. */
  instanceFor(pool: Pick<BrowserPool, 'peek'>, userId: string): BrowserInstance | null {
    const instance = pool.peek(browserHomeSessionId(userId));
    if (!instance || instance.userId !== userId || instance.status !== 'ready') return null;
    return instance;
  }

  /** The user's ready cloud browser wherever it is (in the session or held by their task). */
  locate(
    pool: Pick<BrowserPool, 'peek' | 'browserHomeHolder' | 'peekBrowserHome'>,
    userId: string,
  ): BrowserHomeLocation | null {
    const home = this.instanceFor(pool, userId);
    if (home) return { instance: home, heldBy: null };
    const heldBy = pool.browserHomeHolder(userId);
    if (!heldBy) return null;
    const instance = pool.peekBrowserHome(userId);
    if (!instance || instance.userId !== userId || instance.taskId !== heldBy) return null;
    if (instance.status !== 'ready') return null;
    return { instance, heldBy };
  }

  /**
   * Step 4: reserve the user's cloud browser for one new task. `busy` while a task holds it (or
   * another send is being created); `closed` when there is no open browser to run in.
   */
  claimTask(
    pool: Pick<BrowserPool, 'peek' | 'browserHomeHolder'>,
    userId: string,
    now = Date.now(),
  ): BrowserHomeClaimResult {
    const existing = this.taskClaims.get(userId);
    if (existing && now - existing.at < CLAIM_STALE_MS) return { kind: 'busy' };
    if (pool.browserHomeHolder(userId)) return { kind: 'busy' };
    const instance = this.instanceFor(pool, userId);
    if (!instance || instance.executor.sessionInterruption) return { kind: 'closed' };
    const token = {};
    this.taskClaims.set(userId, { token, at: now });
    let handedOver = false;
    const release = () => {
      if (this.taskClaims.get(userId)?.token === token) this.taskClaims.delete(userId);
    };
    return {
      kind: 'claimed',
      claim: {
        instance,
        isCurrent: () =>
          this.taskClaims.get(userId)?.token === token &&
          this.instanceFor(pool, userId) === instance &&
          !instance.executor.sessionInterruption &&
          !pool.browserHomeHolder(userId),
        handOver: () => {
          handedOver = true;
        },
        release,
        settle: () => {
          if (!handedOver) release();
        },
      },
    };
  }

  /**
   * Step 4 hand-back: the task holding the user's browser ended (any terminal state). The browser
   * goes back to `bhs_<userId>` with its 15-minute idle and the person's review control. False when
   * there is nothing to give back (see BrowserPool.returnBrowserHome).
   */
  giveBack(pool: Pick<BrowserPool, 'returnBrowserHome'>, taskId: string, userId: string): boolean {
    const instance = pool.returnBrowserHome(taskId, userId);
    if (!instance) return false;
    openPersonControl(instance);
    void currentUrl(instance).then((url) => this.rememberUrl(userId, url));
    return true;
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

  /**
   * Create the user's home browser, or return the one already open (one per user). `viewerId`
   * names the page opening it (see leave()); any open cancels a release still in its grace.
   */
  open(
    pool: BrowserHomePool,
    userId: string,
    logger: Logger,
    viewerId?: string,
    profile?: BrowserHomeProfileSelection,
  ): Promise<BrowserHomeOpenResult> {
    this.cancelPendingRelease(userId);
    const pending = this.opening.get(userId);
    if (pending && profile && pending.profileId !== profile.id)
      throw new Error('home_profile_switch_required');
    // A fresh browser: pages recorded for an earlier one (gone by idle or a crash) do not count.
    if (!pending && !this.locate(pool, userId)) this.viewers.delete(userId);
    if (viewerId) this.addViewer(userId, viewerId);
    if (pending) return pending.promise;
    const promise = this.openOnce(pool, userId, logger, profile).finally(() => {
      if (this.opening.get(userId)?.promise === promise) this.opening.delete(userId);
    });
    this.opening.set(userId, { promise, profileId: profile?.id ?? null });
    return promise;
  }

  private async openOnce(
    pool: BrowserHomePool,
    userId: string,
    logger: Logger,
    profile?: BrowserHomeProfileSelection,
  ): Promise<BrowserHomeOpenResult> {
    const sessionId = browserHomeSessionId(userId);
    const existing = this.locate(pool, userId);
    if (existing) {
      if (profile && existing.instance.cloudProfileId !== profile.id)
        throw new Error('home_profile_switch_required');
      pool.touch(existing.instance.taskId);
      // While a task holds it, the person's input already goes through the task's control.
      if (!existing.heldBy) openPersonControl(existing.instance);
      const url = await currentUrl(existing.instance, true);
      this.rememberUrl(userId, url);
      return {
        sessionId,
        url: rememberable(url) ? url : null,
        ...(existing.instance.cloudProfileId
          ? { cloudProfileId: existing.instance.cloudProfileId }
          : {}),
      };
    }

    const remembered = this.lastUrl(userId);
    const restoreTo =
      profile && (!remembered || new URL(remembered).origin !== profile.origin)
        ? profile.origin
        : remembered;
    const instance = await pool.allocate(sessionId, userId, undefined, {
      targetUrl: restoreTo,
      sessionPolicy: 'personal_home',
      ...(profile ? { cloudProfileId: profile.id } : {}),
    });
    pool.setIdleTimeout(sessionId, BROWSER_HOME_IDLE_TIMEOUT_MS);
    await this.watchNavigations(instance, userId);
    let url: string | null = null;
    if (restoreTo) url = await this.restore(instance, restoreTo, userId, logger);
    // Best-effort URL restoration may fail, but a stopped context is never a ready Home.
    await currentUrl(instance, true);
    openPersonControl(instance);
    return { sessionId, url, ...(profile ? { cloudProfileId: profile.id } : {}) };
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

  /**
   * P2-4: one page stops using the browser (it unmounted). Other open pages keep it; the last one
   * leaving schedules the release after the close grace, which a new open() cancels — so leaving
   * and coming back within a few seconds keeps the same browser.
   */
  leave(pool: BrowserHomePool, userId: string, viewerId: string): BrowserHomeLeaveResult {
    const viewers = this.viewers.get(userId);
    viewers?.delete(viewerId);
    if (viewers && viewers.size > 0) return 'kept';
    this.viewers.delete(userId);
    if (!this.opening.has(userId) && !this.locate(pool, userId)) return 'none';
    this.cancelPendingRelease(userId);
    const timer = setTimeout(() => {
      if (this.pendingReleases.get(userId) !== timer) return;
      this.pendingReleases.delete(userId);
      void this.close(pool, userId, { onlyIfUnused: true }).catch(() => undefined);
    }, this.closeGraceMs);
    timer.unref?.();
    this.pendingReleases.set(userId, timer);
    return 'scheduled';
  }

  private addViewer(userId: string, viewerId: string): void {
    let viewers = this.viewers.get(userId);
    if (!viewers) {
      viewers = new Set();
      this.viewers.set(userId, viewers);
    }
    viewers.add(viewerId);
    // Bounded: the oldest ids (likely pages that vanished without leaving) go first.
    while (viewers.size > MAX_VIEWERS_PER_USER) {
      const oldest = viewers.values().next().value as string | undefined;
      if (oldest === undefined) break;
      viewers.delete(oldest);
    }
  }

  private cancelPendingRelease(userId: string): void {
    const timer = this.pendingReleases.get(userId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingReleases.delete(userId);
  }

  /**
   * Release the user's home browser (remembering where it was). False when none was open. While a
   * task holds it, the session ends instead: nothing is given back when that task ends, and the
   * task's normal release applies to the browser.
   */
  async close(
    pool: BrowserHomePool,
    userId: string,
    options: { onlyIfUnused?: boolean } = {},
  ): Promise<boolean> {
    // A page opened since the last one left keeps it (the grace path re-checks after each await).
    const reused = () => options.onlyIfUnused === true && (this.viewers.get(userId)?.size ?? 0) > 0;
    if (reused()) return false;
    if (!options.onlyIfUnused) {
      this.cancelPendingRelease(userId);
      this.viewers.delete(userId);
    }
    await this.opening.get(userId)?.promise.catch(() => {});
    const seen = this.locate(pool, userId);
    if (!seen) return false;
    this.rememberUrl(userId, await currentUrl(seen.instance));
    // Located again after the await: the task may have given it back meanwhile.
    const location = this.locate(pool, userId);
    if (!location || reused()) return false;
    if (location.heldBy) {
      // Leaving the viewer is not an instruction to end the ongoing task's workspace.
      if (options.onlyIfUnused) return false;
      return pool.endBrowserHomeLoan(userId) !== null;
    }
    return pool.release(location.instance.taskId, 'browser-home-close');
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

async function currentUrl(instance: BrowserInstance, requireLive = false): Promise<string | null> {
  try {
    if (requireLive && instance.executor.sessionInterruption)
      throw new Error('home_session_interrupted');
    const page = await instance.executor.getPage();
    if (requireLive && instance.executor.sessionInterruption)
      throw new Error('home_session_interrupted');
    return page.url();
  } catch (error) {
    if (requireLive) throw error;
    return null;
  }
}

export const browserHomeSessions = new BrowserHomeSessions();
