/**
 * Phase 19 — CDP Page.startScreencast pump.
 *
 * Drives the user's allocated Brave instance via a parallel CDP
 * session (separate from Playwright's), forwarding JPEG frames and
 * navigation events to a connected WebSocket. Designed to run
 * SIDE BY SIDE with the existing VNC stack — no x11vnc / websockify
 * teardown happens here. The caller (createScreencastProxy) decides
 * which user gets routed to CDP vs VNC based on a request-level
 * opt-in (currently a query param flag set by the SPA from a
 * localStorage feature flag).
 *
 * One CDP session per WebSocket connection. We DON'T reuse
 * Playwright's internal CDP session because:
 *   - The agent-loop already runs Page.enable / Page.disable as part
 *     of its own observe → act cycle. A second consumer toggling
 *     those wouldn't be safe.
 *   - A fresh session via `page.context().newCDPSession(page)` is
 *     a separate channel — Page.enable is idempotent per session,
 *     so screencast frames flow without disturbing Playwright.
 *
 * Lifecycle: caller starts the streamer with a WS, the streamer
 * runs until either the WS closes or stop() is invoked. start()
 * is idempotent; double-start is a no-op + warn.
 *
 * Frame-flow watchdog (phase 19e): Chromium's site-isolation
 * silently orphans our parallel CDP session on cross-origin
 * navigation (Page.frameNavigated stops firing on the orphaned
 * session — empirically observed on taobao.com nav after a Google
 * load). Event-based re-arming can't recover when events stop
 * firing, so a periodic watchdog checks frame timestamps; if no
 * frames have arrived in `stallThresholdMs`, we tear down the old
 * session and open a new one. The new session is bound to the
 * current target via Playwright's `page.context().newCDPSession(
 * page)`, which always returns a fresh session against the live
 * page target. The watchdog is the safety net; the event-based
 * re-arms (frameNavigated / loadEventFired) are kept as a fast
 * path for the cases where events DO fire.
 */

import type { CDPSession, Page } from 'playwright';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';

export interface CdpStreamerOptions {
  /**
   * Resolves to the executor's CURRENT active page. Called once at
   * start() and again on every hard-restart, so we always bind to
   * the live page even after `PlaywrightExecutor.resetPageForTask`
   * closes the page we were holding (it does that at the top of
   * every task — see playwright-executor.ts ~line 918). Holding a
   * stable page reference here would silently die after the first
   * task swap; the new session would then throw "no object with
   * guid page@..." on every retry.
   */
  getPage: () => Promise<Page>;
  /** Connected client socket; the streamer pipes frames to this. */
  ws: WebSocket;
  /** Per-instance logger (already child-tagged with userId). */
  logger: Logger;
  /** JPEG quality 0..100. Default 60. */
  quality?: number;
  /** Cap frame width. Default 1280 — matches the per-user Xvfb. */
  maxWidth?: number;
  /** Cap frame height. Default 800 — matches the per-user Xvfb. */
  maxHeight?: number;
}

export interface ScreencastFrameMessage {
  type: 'frame';
  data: string;
  metadata: {
    offsetTop?: number;
    pageScaleFactor?: number;
    deviceWidth?: number;
    deviceHeight?: number;
    scrollOffsetX?: number;
    scrollOffsetY?: number;
    timestamp?: number;
  };
}

export interface ScreencastUrlMessage {
  type: 'url-changed';
  url: string;
}

export class CdpStreamer {
  private cdpSession: CDPSession | null = null;
  private streaming = false;
  private lastFrameAt = 0;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private restartInFlight = false;
  /** No-frame gap that triggers a hard restart. 5s is generous —
   *  truly idle pages still composite at >1Hz on Brave. */
  private readonly stallThresholdMs = 5000;
  /** How often the watchdog inspects the frame gap. */
  private readonly watchdogIntervalMs = 1000;
  private readonly opts: Required<Omit<CdpStreamerOptions, 'logger'>> & {
    logger: Logger;
  };

  constructor(opts: CdpStreamerOptions) {
    this.opts = {
      quality: 60,
      maxWidth: 1280,
      maxHeight: 800,
      ...opts,
    };
  }

  /**
   * Open a fresh CDP session, enable Page domain, wire frame +
   * navigation listeners, and call Page.startScreencast. Resolves
   * once the screencast command returns; frames start flowing
   * shortly after. Also starts the frame-flow watchdog.
   */
  async start(): Promise<void> {
    if (this.streaming) {
      this.opts.logger.warn('cdp-streamer: start called twice; ignoring');
      return;
    }
    this.streaming = true;
    try {
      const page = await this.opts.getPage();
      this.cdpSession = await page.context().newCDPSession(page);
      this.wireListeners(this.cdpSession);
      await this.cdpSession.send('Page.enable');
      await this.armScreencast('initial-start', null);
      // Start the no-frame counter at "now" so an arm that takes a
      // few hundred ms to produce its first frame doesn't trigger
      // an immediate restart.
      this.lastFrameAt = Date.now();
      this.startWatchdog();
      this.opts.logger.info(
        { quality: this.opts.quality, maxWidth: this.opts.maxWidth },
        'cdp-streamer: started',
      );
    } catch (err) {
      this.streaming = false;
      this.opts.logger.warn({ err: errMsg(err) }, 'cdp-streamer: start failed');
      throw err;
    }
  }

  /**
   * Wire all CDP event listeners on the given session. Extracted so
   * `hardRestart()` can call it on a freshly-opened session without
   * duplicating handler bodies.
   */
  private wireListeners(cdp: CDPSession): void {
    cdp.on('Page.screencastFrame', (params) => {
      if (!this.streaming) return;
      // The CDP wire format wraps the JPEG as a base64 string
      // already — pass through unchanged so the frontend can
      // render via `data:image/jpeg;base64,${data}`.
      this.lastFrameAt = Date.now();
      const frame: ScreencastFrameMessage = {
        type: 'frame',
        data: params.data,
        metadata: params.metadata ?? {},
      };
      try {
        this.opts.ws.send(JSON.stringify(frame));
      } catch (err) {
        // WS already closed in this tick; flush state on next stop.
        this.opts.logger.debug(
          { err: errMsg(err) },
          'cdp-streamer: frame send failed (ws closed?)',
        );
      }
      // Acking is mandatory — without it the streamer waits forever
      // for the previous frame to be consumed and frame flow halts.
      cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(
        (err: Error) => {
          this.opts.logger.debug({ err: err.message }, 'cdp-streamer: ack failed');
        },
      );
    });

    cdp.on('Page.frameNavigated', (params) => {
      if (!this.streaming) return;
      // Only notify on top-level navigation. Subframes fire too
      // but the SPA only cares about the address-bar URL.
      if (params.frame.parentId) return;
      const msg: ScreencastUrlMessage = {
        type: 'url-changed',
        url: params.frame.url,
      };
      try {
        this.opts.ws.send(JSON.stringify(msg));
      } catch {
        /* swallow — same socket-close window as above */
      }
      // Fast-path re-arm. Empirically unreliable across full
      // renderer swaps (the watchdog catches what this misses) but
      // when it does fire it re-arms ~500ms faster than the
      // watchdog can react. Cheap to keep.
      void this.armScreencast('frame-navigated', params.frame.url);
    });

    cdp.on('Page.loadEventFired', () => {
      if (!this.streaming) return;
      void this.armScreencast('load-event-fired', null);
    });
  }

  /**
   * (Re-)issue Page.startScreencast on the current CDP session.
   * Called once at start(), again on top-level navigation / load
   * events (fast path), and after every hard restart. Failures are
   * logged but not propagated — a transient arm failure shouldn't
   * kill the streamer; the next event or watchdog tick retries.
   */
  private async armScreencast(reason: string, url: string | null): Promise<void> {
    const cdp = this.cdpSession;
    if (!cdp || !this.streaming) return;
    try {
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: this.opts.quality,
        maxWidth: this.opts.maxWidth,
        maxHeight: this.opts.maxHeight,
        everyNthFrame: 1,
      });
      this.opts.logger.info({ reason, url }, 'cdp-streamer: armed screencast');
    } catch (err) {
      this.opts.logger.warn(
        { reason, url, err: errMsg(err) },
        'cdp-streamer: arm screencast failed',
      );
    }
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      void this.watchdogTick();
    }, this.watchdogIntervalMs);
  }

  private stopWatchdog(): void {
    if (!this.watchdogTimer) return;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /**
   * One watchdog iteration. If the screencast hasn't produced a
   * frame in `stallThresholdMs`, hard-restart the CDP session.
   * No-ops if a restart is already in flight or if streaming
   * has been stopped. The threshold is intentionally generous
   * (5s) — Brave composites at >1Hz even on idle pages, so a 5s
   * gap means something is genuinely wrong (orphaned session,
   * crashed renderer, navigation that detached us).
   */
  private async watchdogTick(): Promise<void> {
    if (!this.streaming || this.restartInFlight) return;
    const gapMs = Date.now() - this.lastFrameAt;
    if (gapMs < this.stallThresholdMs) return;
    this.opts.logger.warn(
      { gapMs },
      'cdp-streamer: frame stall detected, hard-restarting session',
    );
    this.restartInFlight = true;
    try {
      await this.hardRestart();
    } catch (err) {
      this.opts.logger.warn(
        { err: errMsg(err) },
        'cdp-streamer: hard restart failed',
      );
    } finally {
      this.restartInFlight = false;
      // Reset the frame counter so we don't loop into another
      // restart 1s later if the new arm is still warming up.
      this.lastFrameAt = Date.now();
    }
  }

  /**
   * Tear down the current CDP session and open a fresh one. Used
   * by the watchdog when frames stop arriving — typically because
   * Chromium's site-isolation orphaned us across a cross-origin
   * navigation. The new session is opened via
   * `page.context().newCDPSession(page)` which always binds to the
   * page target's current renderer, so the new session is alive
   * even if the old one was bound to a dead RFH.
   */
  private async hardRestart(): Promise<void> {
    const oldSession = this.cdpSession;
    this.cdpSession = null;
    if (oldSession) {
      try {
        await oldSession.send('Page.stopScreencast');
      } catch {
        /* old session likely orphaned — ignore */
      }
      try {
        await oldSession.detach();
      } catch {
        /* same — best effort */
      }
    }
    // Re-resolve the live page. The page we held at start() may
    // have been closed by `executor.resetPageForTask()` when a new
    // task started — that's the most common cause of a watchdog
    // stall. getPage() returns the executor's current activePage
    // (a fresh ctx.newPage() in the reset case), which is the
    // page the agent is now operating on.
    const page = await this.opts.getPage();
    this.cdpSession = await page.context().newCDPSession(page);
    this.wireListeners(this.cdpSession);
    await this.cdpSession.send('Page.enable');
    await this.armScreencast('hard-restart', page.url());
  }

  /**
   * Stop screencast + close the parallel CDP session. Safe to call
   * multiple times. Errors are logged but never thrown — `stop()`
   * is invariably called from a socket-close handler that should
   * never fail.
   */
  async stop(): Promise<void> {
    this.streaming = false;
    this.stopWatchdog();
    const cdp = this.cdpSession;
    if (!cdp) return;
    this.cdpSession = null;
    try {
      await cdp.send('Page.stopScreencast');
    } catch (err) {
      this.opts.logger.debug({ err: errMsg(err) }, 'cdp-streamer: stopScreencast failed');
    }
    try {
      await cdp.detach();
    } catch (err) {
      this.opts.logger.debug({ err: errMsg(err) }, 'cdp-streamer: detach failed');
    }
    this.opts.logger.info('cdp-streamer: stopped');
  }

  /** True when start() has succeeded and stop() hasn't been called. */
  isStreaming(): boolean {
    return this.streaming;
  }

  /** Exposed for the input handler — same CDP session reuse. */
  getSession(): CDPSession | null {
    return this.cdpSession;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
