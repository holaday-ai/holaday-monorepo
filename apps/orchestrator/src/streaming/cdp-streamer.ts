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

import { randomUUID } from 'node:crypto';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import type { Logger } from 'pino';
import type { CDPSession, Page } from 'playwright';
import sharp from 'sharp';
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
  /** JPEG quality 0..100. V2 defaults to 90, legacy to 60. */
  quality?: number;
  viewportV2?: boolean;
  onFrame?: (frame: BrowserFrameGeometry) => void;
  onObservationInvalidated?: () => void;
  /** Cap frame width. Default 1440 — matches the largest workbench viewport. */
  maxWidth?: number;
  /** Cap frame height. Default 1200 — matches the largest workbench viewport. */
  maxHeight?: number;
  /**
   * Re-applies the latest client viewport after a renderer-changing event.
   * Chromium can discard device metrics during cross-origin navigation even
   * while the CDP socket itself remains connected.
   */
  onViewportMayReset?: () => Promise<void> | void;
}

export interface ScreencastFrameMessage {
  type: 'frame';
  data: string;
  geometry?: BrowserFrameGeometry;
  metadata: {
    cssWidth?: number;
    cssHeight?: number;
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
  private captureScale = 1;
  private pointerHeld = false;
  notePointerInput(type: string): void {
    if (type === 'mouseDown') this.pointerHeld = true;
    if (type === 'mouseUp' || type === 'release') {
      this.pointerHeld = false;
      this.requestFrameRefresh();
    }
  }
  private displayTail: Promise<void> = Promise.resolve();
  private uncertainCaptureSession: CDPSession | null = null;
  /** CDP screenshots temporarily alter emulation: never dispatch input during capture. */
  runWithStableViewport<T>(action: () => Promise<T>): Promise<T> {
    const result = this.displayTail.then(() => {
      if (this.cdpSession && this.uncertainCaptureSession === this.cdpSession)
        throw new Error('browser_capture_unsettled');
      return action();
    });
    this.displayTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private compositorDirty = false;
  private compositorTimer: NodeJS.Timeout | null = null;
  setCaptureScale(scale: number): void {
    this.captureScale = scale;
  }
  private requestHighResolutionFrame(): void {
    this.compositorDirty = true;
    if (this.compositorTimer || this.captureInFlight) return;
    this.compositorTimer = setTimeout(() => {
      this.compositorTimer = null;
      if (!this.streaming || !this.compositorDirty) return;
      this.compositorDirty = false;
      this.queueCurrentFrameCapture('retina-compositor', this.frameSequence);
    }, 16);
  }
  private viewportRevision = 0;
  private observationSequence = 0;
  private tabId = '';
  private mainFrameId: string | undefined;
  private boundPage: Page | null = null;
  matchesPage(page: Page): boolean {
    return this.boundPage === page && !page.isClosed();
  }
  private readonly pageIds = new WeakMap<Page, string>();

  invalidateObservation(): void {
    this.invalidateCaptureRequests();
    this.viewportRevision++;
    this.observationSequence++;
    this.opts.onObservationInvalidated?.();
  }
  private bindPage(page: Page): void {
    this.boundPage = page;
    let id = this.pageIds.get(page);
    if (!id) {
      id = randomUUID();
      this.pageIds.set(page, id);
    }
    this.tabId = id;
    this.invalidateObservation();
  }
  private streaming = false;
  private hasReceivedFrame = false;
  private lastFrameAt = 0;
  private frameSequence = 0;
  private armSequence = 0;
  private captureRequestSequence = 0;
  private captureInFlight = false;
  private pendingCapture: {
    reason: string;
    expectedFrameSequence: number;
    requestSequence: number;
    cdp: CDPSession;
  } | null = null;
  private initialFrameTimer: NodeJS.Timeout | null = null;
  private inputRefreshTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private watchdogCheckInFlight = false;
  private restartInFlight = false;
  /** No-frame gap that triggers a session health check. Static pages may not
   * composite again at all, so the gap alone is never grounds for a restart. */
  private readonly stallThresholdMs = 5000;
  /** How often the watchdog inspects the frame gap. */
  private readonly watchdogIntervalMs = 1000;
  private readonly initialFrameFallbackMs = 1200;
  private readonly inputRefreshDelayMs = 16;
  private readonly captureScreenshotTimeoutMs = 2500;
  private readonly opts: Required<
    Omit<
      CdpStreamerOptions,
      'logger' | 'onViewportMayReset' | 'onFrame' | 'onObservationInvalidated'
    >
  > & {
    logger: Logger;
    onFrame?: CdpStreamerOptions['onFrame'];
    onObservationInvalidated?: CdpStreamerOptions['onObservationInvalidated'];
    onViewportMayReset?: () => Promise<void> | void;
  };

  constructor(opts: CdpStreamerOptions) {
    this.opts = {
      quality: opts.viewportV2 ? 90 : 60,
      viewportV2: false,
      maxWidth: 1440,
      maxHeight: 1200,
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
      this.bindPage(page);
      this.cdpSession = await page.context().newCDPSession(page);
      this.wireListeners(this.cdpSession);
      await this.cdpSession.send('Page.enable');
      const tree = await this.cdpSession.send('Page.getFrameTree');
      this.mainFrameId = tree?.frameTree?.frame?.id;
      this.opts.ws.send(JSON.stringify({ type: 'url-changed', url: page.url() }));
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
      if (!this.streaming || this.cdpSession !== cdp) {
        cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => undefined);
        return;
      }
      // The CDP wire format wraps the JPEG as a base64 string
      // already — pass through unchanged so the frontend can
      // render via `data:image/jpeg;base64,${data}`.
      // Chromium's screencast often emits CSS-resolution JPEGs even with DPR=2.
      // Use compositor damage as the trigger for a coalesced, full-resolution
      // surface capture. Never upscale a 1x JPEG and call it Retina.
      if (this.opts.viewportV2 && this.captureScale > 1 && !this.pointerHeld)
        this.requestHighResolutionFrame();
      else this.publishFrame(params.data, params.metadata ?? {});
      // Acking is mandatory — without it the streamer waits forever
      // for the previous frame to be consumed and frame flow halts.
      cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch((err: Error) => {
        this.opts.logger.debug({ err: err.message }, 'cdp-streamer: ack failed');
      });
    });

    cdp.on('Page.frameNavigated', (params) => {
      if (!this.streaming || this.cdpSession !== cdp) return;
      // Only notify on top-level navigation. Subframes fire too
      // but the SPA only cares about the address-bar URL.
      if (params.frame.parentId) return;
      this.mainFrameId = params.frame.id;
      // A screenshot started on the prior document must never become the first
      // frame of the new page, even when Chromium keeps the same CDP session.
      this.invalidateCaptureRequests();
      this.invalidateObservation();
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
      void this.rearmAfterNavigation('frame-navigated', params.frame.url);
    });

    // Codex Browser-UX #4 — `Page.frameNavigated` fires only on
    // FULL document loads. SPA navigations (history.pushState /
    // replaceState / hash change) keep the same document; the
    // event we get is `Page.navigatedWithinDocument`. Without this
    // listener, clicking a link on a React/Vue/etc. SPA inside the
    // remote browser left the SPA address bar stuck on the
    // original URL until a full reload.
    //
    // We DON'T re-arm the screencast here — the underlying frame
    // didn't actually re-render at the document level, the existing
    // stream stays valid.
    cdp.on('Page.navigatedWithinDocument', (params) => {
      if (!this.streaming || this.cdpSession !== cdp) return;
      if (params.frameId == null || (this.mainFrameId && params.frameId !== this.mainFrameId))
        return;
      this.invalidateCaptureRequests();
      // Only notify on the MAIN frame's pushState/replaceState; the
      // streamer keeps the main frame id implicit via the no-parent
      // check above, but this event doesn't carry parent info.
      // Filter by URL shape instead — a SPA route change keeps the
      // origin, so we trust the runtime to only emit this on the
      // page we're streaming.
      const msg: ScreencastUrlMessage = {
        type: 'url-changed',
        url: params.url,
      };
      try {
        this.opts.ws.send(JSON.stringify(msg));
      } catch {
        /* swallow */
      }
    });

    cdp.on('Page.loadEventFired', () => {
      if (!this.streaming || this.cdpSession !== cdp) return;
      void this.rearmAfterNavigation('load-event-fired', null);
    });
  }

  private async rearmAfterNavigation(reason: string, url: string | null): Promise<void> {
    await this.armScreencast(reason, url);
    try {
      await this.opts.onViewportMayReset?.();
    } catch (err) {
      this.opts.logger.debug({ reason, err: errMsg(err) }, 'cdp-streamer: viewport reapply failed');
    }
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
    const armSequence = ++this.armSequence;
    const frameSequenceBeforeArm = this.frameSequence;
    try {
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: this.opts.quality,
        ...(this.opts.viewportV2
          ? {}
          : { maxWidth: this.opts.maxWidth, maxHeight: this.opts.maxHeight }),
        everyNthFrame: 1,
      });
      if (!this.streaming || this.cdpSession !== cdp || this.armSequence !== armSequence) {
        return;
      }
      const frameArrivedWhileArming = this.frameSequence !== frameSequenceBeforeArm;
      if (!frameArrivedWhileArming) {
        this.hasReceivedFrame = false;
        this.lastFrameAt = Date.now();
        this.scheduleInitialFrameFallback();
      }
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
      if (this.opts.viewportV2 && this.hasReceivedFrame && Date.now() - this.lastFrameAt >= 2000)
        this.requestFrameRefresh();
      void this.watchdogTick();
    }, this.watchdogIntervalMs);
  }

  private stopWatchdog(): void {
    if (this.compositorTimer) clearTimeout(this.compositorTimer);
    this.compositorTimer = null;
    this.compositorDirty = false;
    if (!this.watchdogTimer) return;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private publishFrame(data: string, metadata: ScreencastFrameMessage['metadata']): void {
    this.invalidateCaptureRequests();
    this.hasReceivedFrame = true;
    this.lastFrameAt = Date.now();
    this.frameSequence += 1;
    this.clearInitialFrameTimer();
    const frame: ScreencastFrameMessage = { type: 'frame', data, metadata };
    if (this.opts.viewportV2) {
      void this.publishGeometryFrame(frame, ++this.observationSequence);
      return;
    }
    try {
      this.opts.ws.send(JSON.stringify(frame));
    } catch (err) {
      this.opts.logger.debug({ err: errMsg(err) }, 'cdp-streamer: frame send failed (ws closed?)');
    }
  }

  private async publishGeometryFrame(
    frame: ScreencastFrameMessage,
    sequence: number,
  ): Promise<void> {
    const session = this.cdpSession;
    const revision = this.viewportRevision;
    const tabId = this.tabId;
    const capturedAt = frame.metadata.timestamp ? frame.metadata.timestamp * 1000 : Date.now();
    try {
      const dimensions = await sharp(Buffer.from(frame.data, 'base64')).metadata();
      const m = frame.metadata;
      // Screencast deviceWidth/deviceHeight can be physical pixels under DPR
      // emulation. Only cssLayoutViewport has an unambiguous input coordinate unit.
      const metrics = !m.cssWidth && session ? await session.send('Page.getLayoutMetrics') : null;
      const cssWidth = m.cssWidth ?? metrics?.cssLayoutViewport?.clientWidth;
      const cssHeight = m.cssHeight ?? metrics?.cssLayoutViewport?.clientHeight;
      if (
        !this.streaming ||
        this.cdpSession !== session ||
        sequence !== this.observationSequence ||
        revision !== this.viewportRevision
      )
        return;
      if (!cssWidth || !cssHeight || !dimensions.width || !dimensions.height) return;
      const geometry: BrowserFrameGeometry = {
        frameId: `${tabId}:${revision}:${sequence}`,
        tabId,
        viewportRevision: revision,
        cssWidth,
        cssHeight,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        pageScaleFactor: m.pageScaleFactor ?? metrics?.cssVisualViewport?.scale ?? 1,
        offsetTop: m.offsetTop ?? 0,
        scrollOffset: {
          x: m.scrollOffsetX ?? metrics?.cssLayoutViewport?.pageX ?? 0,
          y: m.scrollOffsetY ?? metrics?.cssLayoutViewport?.pageY ?? 0,
        },
        capturedAt,
      };
      this.opts.onFrame?.(geometry);
      this.opts.ws.send(JSON.stringify({ ...frame, geometry }));
    } catch {
      this.opts.logger.debug('cdp-streamer: V2 frame dimensions unavailable');
    }
  }

  private scheduleInitialFrameFallback(): void {
    this.clearInitialFrameTimer();
    const expectedSequence = this.frameSequence;
    this.initialFrameTimer = setTimeout(() => {
      this.initialFrameTimer = null;
      if (!this.streaming || this.frameSequence !== expectedSequence) return;
      this.queueCurrentFrameCapture('initial-frame-fallback', expectedSequence);
    }, this.initialFrameFallbackMs);
  }

  private clearInitialFrameTimer(): void {
    if (!this.initialFrameTimer) return;
    clearTimeout(this.initialFrameTimer);
    this.initialFrameTimer = null;
  }

  private invalidateCaptureRequests(): void {
    this.captureRequestSequence += 1;
    this.pendingCapture = null;
  }

  private queueCurrentFrameCapture(reason: string, expectedFrameSequence: number): void {
    const cdp = this.cdpSession;
    if (!cdp || !this.streaming) return;
    this.pendingCapture = {
      reason,
      expectedFrameSequence,
      requestSequence: ++this.captureRequestSequence,
      cdp,
    };
    void this.drainCaptureQueue();
  }

  private async drainCaptureQueue(): Promise<void> {
    if (this.captureInFlight) return;
    this.captureInFlight = true;
    try {
      while (this.streaming && this.pendingCapture) {
        const request = this.pendingCapture;
        this.pendingCapture = null;
        if (
          this.cdpSession !== request.cdp ||
          this.frameSequence !== request.expectedFrameSequence
        ) {
          continue;
        }
        try {
          const response = await this.captureCurrentPage(request.cdp);
          if (
            !this.streaming ||
            this.cdpSession !== request.cdp ||
            this.frameSequence !== request.expectedFrameSequence ||
            this.captureRequestSequence !== request.requestSequence
          ) {
            continue;
          }
          const data = (response as { data?: unknown }).data;
          if (typeof data !== 'string' || data.length === 0) continue;
          this.publishFrame(
            data,
            (response as { metadata?: ScreencastFrameMessage['metadata'] }).metadata ?? {},
          );
          const log =
            request.reason === 'initial-frame-fallback'
              ? this.opts.logger.info.bind(this.opts.logger)
              : this.opts.logger.debug.bind(this.opts.logger);
          log({ reason: request.reason }, 'cdp-streamer: published current-page capture');
        } catch (err) {
          this.opts.logger.debug(
            { reason: request.reason, err: errMsg(err) },
            'cdp-streamer: current-page capture failed',
          );
        }
      }
    } finally {
      this.captureInFlight = false;
      if (this.compositorDirty) this.requestHighResolutionFrame();
      if (this.streaming && this.pendingCapture) {
        void this.drainCaptureQueue();
      }
    }
  }

  private captureCurrentPage(cdp: CDPSession): Promise<unknown> {
    const capture = async () => {
      if (this.cdpSession !== cdp) throw new Error('browser_capture_session_changed');
      // A high-DPR screenshot resets Chromium's native drag latch. During a
      // held pointer, keep forwarding compositor frames without emulation.
      if (this.opts.viewportV2 && this.pointerHeld) return {};
      // Read CSS metrics BEFORE screenshot temporarily changes the emulation.
      const metrics = this.opts.viewportV2 ? await cdp.send('Page.getLayoutMetrics') : null;
      let timeout: NodeJS.Timeout | null = null;
      try {
        const response = await Promise.race([
          cdp.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: this.opts.quality,
            fromSurface: true,
            captureBeyondViewport: false,
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              if (this.opts.viewportV2) {
                this.uncertainCaptureSession = cdp;
                void this.restartAfterStall();
              }
              reject(new Error('current-page capture timed out'));
            }, this.captureScreenshotTimeoutMs);
          }),
        ]);
        return {
          ...response,
          metadata: metrics?.cssLayoutViewport
            ? {
                cssWidth: metrics.cssLayoutViewport.clientWidth,
                cssHeight: metrics.cssLayoutViewport.clientHeight,
                pageScaleFactor: metrics.cssVisualViewport?.scale ?? 1,
                scrollOffsetX: metrics.cssLayoutViewport.pageX,
                scrollOffsetY: metrics.cssLayoutViewport.pageY,
              }
            : {},
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    };
    return this.opts.viewportV2 ? this.runWithStableViewport(capture) : capture();
  }

  /**
   * Ensures a user action becomes visible even when Chromium keeps a healthy
   * screencast session quiet. Natural compositor frames win; only an unchanged
   * frame sequence after the short debounce triggers a current-page capture.
   */
  requestFrameRefresh(): void {
    if (!this.streaming) return;
    const expectedSequence = this.frameSequence;
    if (this.inputRefreshTimer) clearTimeout(this.inputRefreshTimer);
    this.inputRefreshTimer = setTimeout(() => {
      this.inputRefreshTimer = null;
      if (!this.streaming || this.frameSequence !== expectedSequence) return;
      if (this.opts.viewportV2 && this.pointerHeld) {
        void this.armScreencast('held-pointer-refresh', null);
        return;
      }
      this.queueCurrentFrameCapture('post-input-fallback', expectedSequence);
    }, this.inputRefreshDelayMs);
  }

  /**
   * One watchdog iteration. A no-frame gap is normal on a static page, so
   * first verify that this CDP session can still evaluate the URL of the
   * Playwright page it is meant to mirror. Restart only when that health check
   * fails or points at a different renderer.
   */
  private async watchdogTick(): Promise<void> {
    if (!this.streaming || this.watchdogCheckInFlight || this.restartInFlight) {
      return;
    }
    const gapMs = Date.now() - this.lastFrameAt;
    if (gapMs < this.stallThresholdMs) return;
    this.watchdogCheckInFlight = true;
    try {
      if (!this.hasReceivedFrame) {
        this.opts.logger.warn(
          { gapMs },
          'cdp-streamer: initial frame missing, hard-restarting session',
        );
        await this.restartAfterStall();
        return;
      }
      const checkedSession = this.cdpSession;
      if (await this.sessionMatchesCurrentPage(checkedSession)) {
        if (!this.streaming || this.cdpSession !== checkedSession) return;
        this.lastFrameAt = Date.now();
        this.opts.logger.debug(
          { gapMs },
          'cdp-streamer: static frame gap; session remains healthy',
        );
        return;
      }
      if (!this.streaming || this.cdpSession !== checkedSession) return;
      this.opts.logger.warn(
        { gapMs },
        'cdp-streamer: frame stall detected, hard-restarting session',
      );
      await this.restartAfterStall();
    } finally {
      this.watchdogCheckInFlight = false;
    }
  }

  private async restartAfterStall(): Promise<void> {
    if (this.restartInFlight) return;
    this.restartInFlight = true;
    try {
      await this.hardRestart();
    } catch (err) {
      this.opts.logger.warn({ err: errMsg(err) }, 'cdp-streamer: hard restart failed');
    } finally {
      this.restartInFlight = false;
      // Reset the frame counter so we don't loop into another
      // restart 1s later if the new arm is still warming up.
      this.lastFrameAt = Date.now();
    }
  }

  private async sessionMatchesCurrentPage(cdp: CDPSession | null): Promise<boolean> {
    if (!cdp) return false;
    try {
      const page = await this.opts.getPage();
      // Matching URLs do not prove target identity: a replacement tab may open
      // the same URL. Only start/restart may bind an observation to its session.
      if (this.opts.viewportV2 && !this.matchesPage(page)) return false;
      const response = await cdp.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      });
      const currentUrl = (response as { result?: { value?: unknown } }).result?.value;
      return typeof currentUrl === 'string' && currentUrl === page.url();
    } catch (err) {
      this.opts.logger.debug({ err: errMsg(err) }, 'cdp-streamer: session health check failed');
      return false;
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
    this.invalidateObservation();
    this.armSequence += 1;
    this.invalidateCaptureRequests();
    this.clearInitialFrameTimer();
    if (this.inputRefreshTimer) {
      clearTimeout(this.inputRefreshTimer);
      this.inputRefreshTimer = null;
    }
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
    this.bindPage(page);
    this.cdpSession = await page.context().newCDPSession(page);
    this.wireListeners(this.cdpSession);
    await this.cdpSession.send('Page.enable');
    const tree = await this.cdpSession.send('Page.getFrameTree');
    this.mainFrameId = tree?.frameTree?.frame?.id;
    this.opts.ws.send(JSON.stringify({ type: 'url-changed', url: page.url() }));
    await this.armScreencast('hard-restart', page.url());
    await this.opts.onViewportMayReset?.();
  }

  /**
   * Stop screencast + close the parallel CDP session. Safe to call
   * multiple times. Errors are logged but never thrown — `stop()`
   * is invariably called from a socket-close handler that should
   * never fail.
   */
  async stop(): Promise<void> {
    this.streaming = false;
    this.boundPage = null;
    this.invalidateObservation();
    this.armSequence += 1;
    this.invalidateCaptureRequests();
    this.stopWatchdog();
    this.clearInitialFrameTimer();
    if (this.inputRefreshTimer) {
      clearTimeout(this.inputRefreshTimer);
      this.inputRefreshTimer = null;
    }
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
