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
 */

import type { CDPSession, Page } from 'playwright';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';

export interface CdpStreamerOptions {
  page: Page;
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
   * shortly after.
   */
  async start(): Promise<void> {
    if (this.streaming) {
      this.opts.logger.warn('cdp-streamer: start called twice; ignoring');
      return;
    }
    this.streaming = true;
    try {
      this.cdpSession = await this.opts.page.context().newCDPSession(this.opts.page);
      const cdp = this.cdpSession;

      // Wire listeners BEFORE enabling Page so the first frame /
      // navigation event isn't dropped.
      cdp.on('Page.screencastFrame', (params) => {
        if (!this.streaming) return;
        // The CDP wire format wraps the JPEG as a base64 string
        // already — pass through unchanged so the frontend can
        // render via `data:image/jpeg;base64,${data}`.
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
      });

      await cdp.send('Page.enable');
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: this.opts.quality,
        maxWidth: this.opts.maxWidth,
        maxHeight: this.opts.maxHeight,
        everyNthFrame: 1,
      });
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
   * Stop screencast + close the parallel CDP session. Safe to call
   * multiple times. Errors are logged but never thrown — `stop()`
   * is invariably called from a socket-close handler that should
   * never fail.
   */
  async stop(): Promise<void> {
    this.streaming = false;
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
