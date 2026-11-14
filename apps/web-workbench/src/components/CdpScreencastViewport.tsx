import {
  type CdpInputBridgeState,
  INITIAL_CDP_INPUT_BRIDGE_STATE,
  INITIAL_CDP_RECONNECT_STATE,
  cdpCompositionEndTransition,
  cdpCompositionStartTransition,
  cdpKeyTransition,
  cdpReconnectTransition,
  cdpTextInputTransition,
  shouldPaintCdpFrame,
} from '@/components/cdp-screencast-state';
import { appendBrowserStreamToken } from '@/lib/browser-stream-url';
import { hdDebug } from '@/lib/hd-debug';
import {
  type ScreencastCaptchaBox,
  framePixelRatio,
  mapClientPointToBrowserFrame,
  mapClientPointToScreencast,
  placeScreencastActual,
  placeScreencastCaptchaZoom,
  placeScreencastContainTop,
  placeScreencastReadableTop,
  readableScreencastAutoScrollKey,
  readableScreencastStartScrollLeft,
} from '@/lib/screencast-fit';
import { retainScreencastInputFocus } from '@/lib/screencast-input-focus';
import { cn } from '@/lib/utils';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import * as React from 'react';

/**
 * Phase 19 — CDP screencast viewport.
 *
 * Drop-in replacement for VncViewport with the same prop surface
 * (wsUrl + viewOnly + onStatusChange + className) so BrowserPanel
 * can swap between transports via a single ternary. The major
 * mechanical differences vs the noVNC viewport:
 *
 *   - One layer of indirection only (CDP frame WS → canvas) instead
 *     of x11vnc → websockify → noVNC. Lower latency, smaller code.
 *   - Mouse + key + scroll dispatch as JSON over the same WS;
 *     orchestrator routes to `Input.dispatchMouseEvent` /
 *     `Input.dispatchKeyEvent`.
 *   - CJK input via composition events + `Input.insertText` —
 *     bypasses keyDown/keyUp so the IME's composed text lands
 *     verbatim. This is the headline fix for the long-standing
 *     "VNC eats Chinese characters" bug.
 *
 * REBUILD-4 共同操作: the screen is a browser the person and the assistant share. There is no
 * takeover and no lease — while the assistant works, the person's clicks, keys and scrolls go
 * straight to the page; the server waits until they have been still for a moment, re-reads the
 * page and continues. The page is never resized for this screen: the frame of the fixed page is
 * scaled to fit, and each point is mapped from the displayed frame back to page coordinates.
 * Every input names the frame it was made on (`observation`) so the server can refuse one made
 * on a picture that is no longer current.
 *
 * Renders only a `<canvas>` + an off-screen `<input>` for CJK
 * composition capture. No noVNC, no RFB, no WebSocket subprotocol
 * negotiation — just JSON frames.
 */

export type CdpScreencastStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

/** What kind of input the server refused (the page changed under it). */
export type CdpRefusedInput = 'key' | 'pointer' | 'closed';

/** Ask for a fresh frame while the person is about to act on a still page (display only). */
const GEOMETRY_REFRESH_MS = 3000;
const OBSERVE_GAP_MS = 1000;
const REFUSED_NOTICE_GAP_MS = 2000;

interface Props {
  /** Stable WS URL to /screencast-ws/:taskId, without credentials. */
  wsUrl: string | null;
  /** Latest short-lived credential, read only when a socket is opened. */
  streamToken: string | null;
  /** Block input forwarding when true (mirror VncViewport semantics). */
  viewOnly?: boolean;
  /**
   * The server refused an input because the page changed under it (or an input that waited
   * for a fresh frame no longer matches what was pressed on). Said once per burst — never
   * dropped without a word.
   */
  onInputRefused?: (input: CdpRefusedInput) => void;
  /** The person clicked, typed or scrolled on the page (plain hovering does not count). */
  onUserInput?: () => void;
  /**
   * FIX-62 P1-4: a channel for the panel's text bar (中文 / 任意文本输入). Set to a sender that returns
   * false when this screen cannot send now (only watching, or not connected).
   */
  textChannel?: React.MutableRefObject<((text: string) => boolean) | null>;
  onStatusChange?: (status: CdpScreencastStatus) => void;
  /** Fired after the first real frame is painted. */
  onFrameReady?: () => void;
  /** Restarts the transport without remounting or clearing the canvas. */
  reconnectSignal?: number;
  /**
   * Optimization #3 R2 — fired on every top-level
   * `Page.frameNavigated` (the CDP streamer already publishes
   * `type: 'url-changed'`; we just consume it now). Parent uses
   * this to keep the BrowserPanel's address bar in sync with what
   * the user can see on the remote page. Optional — older parents
   * that ignore navigation events still work fine.
   */
  onUrlChange?: (url: string) => void;
  fitMode?: 'contain' | 'readable';
  /**
   * FIX-33 「适应面板 / 100% 原尺寸」: `fit` (default) scales the whole page into the
   * panel keeping its aspect ratio; `actual` shows it 1:1 and the panel scrolls.
   */
  displayMode?: 'fit' | 'actual';
  viewportV2?: boolean;
  className?: string;
}

interface InputPayload {
  type: 'mouseMove' | 'mouseDown' | 'mouseUp' | 'scroll' | 'keyDown' | 'keyUp' | 'insertText';
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  keyCode?: number;
  text?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function CdpScreencastViewport({
  wsUrl,
  streamToken,
  viewOnly = true,
  onInputRefused,
  onUserInput,
  textChannel,
  onStatusChange,
  onFrameReady,
  reconnectSignal = 0,
  onUrlChange,
  fitMode = 'contain',
  displayMode = 'fit',
  viewportV2 = false,
  className,
}: Props): JSX.Element {
  // Latest onUrlChange ref so the WS onmessage closure stays stable
  // even when the parent passes a fresh handler on every render.
  const onUrlChangeRef = React.useRef(onUrlChange);
  React.useEffect(() => {
    onUrlChangeRef.current = onUrlChange;
  }, [onUrlChange]);
  const onFrameReadyRef = React.useRef(onFrameReady);
  React.useEffect(() => {
    onFrameReadyRef.current = onFrameReady;
  }, [onFrameReady]);
  const onInputRefusedRef = React.useRef(onInputRefused);
  onInputRefusedRef.current = onInputRefused;
  const onUserInputRef = React.useRef(onUserInput);
  onUserInputRef.current = onUserInput;
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  /** The server is ready for input: `viewport-v2-ready` arrived, or a frame with geometry did. */
  const writeReadyRef = React.useRef(false);
  const geometryRef = React.useRef<BrowserFrameGeometry | null>(null);
  const observationEpochRef = React.useRef(0);
  // FIX-61: freshness is judged by when THIS client painted the frame. The
  // frame's own capturedAt is the server's clock; a user clock a few seconds
  // off made every click look stale and silently dropped.
  const geometryReceivedAtRef = React.useRef(0);
  const lastObserveAtRef = React.useRef(0);
  const refusedNoticeAtRef = React.useRef(0);
  const invalidateGeometry = React.useCallback(() => {
    geometryRef.current = null;
    observationEpochRef.current++;
    if (canvasRef.current) delete canvasRef.current.dataset.frameId;
  }, []);
  const hiddenInputRef = React.useRef<HTMLInputElement>(null);
  const inputBridgeStateRef = React.useRef<CdpInputBridgeState>(INITIAL_CDP_INPUT_BRIDGE_STATE);
  /** Host <div> ref — the box the fixed-size page frame is scaled into. */
  const hostRef = React.useRef<HTMLDivElement>(null);
  /**
   * CAPTCHA-UX-1 第 2 条: the captcha box the server reports while a verification is waited for
   * (CSS px of the page), and whether this screen zooms in on it (the person can switch it off).
   */
  const [captchaBox, setCaptchaBox] = React.useState<ScreencastCaptchaBox | null>(null);
  const [captchaZoom, setCaptchaZoom] = React.useState(true);
  const captchaBoxRef = React.useRef<ScreencastCaptchaBox | null>(null);
  /** Imperative hook the frame-paint path uses to nudge the scale
   *  effect when canvas.width/height changes (a new source size). */
  const sourceDimsRecomputeRef = React.useRef<(() => void) | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const streamTokenRef = React.useRef(streamToken);
  React.useEffect(() => {
    streamTokenRef.current = streamToken;
  }, [streamToken]);
  const hasStreamToken = Boolean(streamToken);
  // Per-frame <img> + connection/frame sequence guards so async decodes cannot
  // paint stale pixels after a newer frame, reconnect, wsUrl change, or unmount.
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  // FIX-61 复审 #2 #2: one decode at a time, the newest waiting frame next. Each new frame
  // used to cancel the decode in flight, so a page animating faster than one decode (a
  // carousel at ~50fps, a 1280x1747 JPEG) painted nothing until it stopped: the screen and
  // the observation its input names fell behind, and the server refused that input.
  const decodingImgRef = React.useRef<HTMLImageElement | null>(null);
  const pendingFrameRef = React.useRef<{
    base64: string;
    connectionSeq: number;
    geometry: BrowserFrameGeometry | undefined;
    onPaint: () => void;
  } | null>(null);
  const frameSeqRef = React.useRef(0);
  const connectionSeqRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const readableAutoScrollKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      frameSeqRef.current += 1;
      if (imgRef.current) {
        imgRef.current.onload = null;
        imgRef.current.onerror = null;
      }
    };
  }, []);
  // Throttled "viewOnly" reference so the keyDown handler reads
  // the latest value without re-attaching listeners on every flip.
  const viewOnlyRef = React.useRef(viewOnly);
  viewOnlyRef.current = viewOnly;
  React.useEffect(() => {}, [viewOnly]);
  React.useEffect(() => {
    readableAutoScrollKeyRef.current = null;
    hostRef.current?.scrollTo({ left: 0, top: 0 });
    inputBridgeStateRef.current = INITIAL_CDP_INPUT_BRIDGE_STATE;
    if (hiddenInputRef.current) hiddenInputRef.current.value = '';
  }, [fitMode, displayMode, wsUrl]);

  const [status, setStatus] = React.useState<CdpScreencastStatus>('idle');
  const onStatusChangeRef = React.useRef(onStatusChange);
  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  React.useEffect(() => {
    onStatusChangeRef.current?.(status);
  }, [status]);

  const socketOpen = (): boolean => wsRef.current?.readyState === WebSocket.OPEN;
  /** Ask the server for a fresh frame (a still page sends none by itself). */
  const requestObservation = React.useCallback((): void => {
    const ws = wsRef.current;
    if (!viewportV2 || !ws || ws.readyState !== WebSocket.OPEN) return;
    lastObserveAtRef.current = Date.now();
    try {
      ws.send(JSON.stringify({ type: 'observe' }));
    } catch {
      /* socket closing in this tick */
    }
  }, [viewportV2]);
  /**
   * There is a picture to map an input onto (v2). HOTFIX-R4A（协调方改）: its age no longer
   * matters — the input goes where the person sees it.
   */
  const frameUsable = React.useCallback((): boolean => {
    if (!viewportV2) return true;
    return writeReadyRef.current && geometryRef.current !== null;
  }, [viewportV2]);
  /** Keep the newest frame fresh while the person is about to act (hovering, touching). */
  const keepFrameFresh = React.useCallback((): void => {
    if (!viewportV2 || viewOnlyRef.current) return;
    const now = Date.now();
    if (now - lastObserveAtRef.current < OBSERVE_GAP_MS) return;
    if (geometryRef.current && now - geometryReceivedAtRef.current < GEOMETRY_REFRESH_MS) return;
    requestObservation();
  }, [requestObservation, viewportV2]);
  const notifyRefused = React.useCallback((input: CdpRefusedInput): void => {
    const now = Date.now();
    if (now - refusedNoticeAtRef.current <= REFUSED_NOTICE_GAP_MS) return;
    refusedNoticeAtRef.current = now;
    onInputRefusedRef.current?.(input);
  }, []);

  // Input goes out whenever the socket is open and this screen is not view-only. No lease, no
  // waiting for control: the person and the assistant share the page.
  const sendInput = React.useCallback(
    (payload: InputPayload): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || viewOnlyRef.current) return false;
      if (
        (payload.x !== undefined && !Number.isFinite(payload.x)) ||
        (payload.y !== undefined && !Number.isFinite(payload.y))
      )
        return false;
      const geometry = geometryRef.current;
      if (viewportV2 && (!frameUsable() || !geometry)) {
        // No picture yet (the stream is starting): nothing to map this input onto.
        requestObservation();
        return false;
      }
      try {
        ws.send(
          JSON.stringify({
            type: 'input',
            payload,
            ...(viewportV2 && geometry
              ? {
                  observation: {
                    frameId: geometry.frameId,
                    tabId: geometry.tabId,
                    viewportRevision: geometry.viewportRevision,
                  },
                }
              : {}),
          }),
        );
        return true;
      } catch {
        /* socket closing in this tick — drop */
        return false;
      }
    },
    [frameUsable, requestObservation, viewportV2],
  );

  /**
   * A press, a key or text from the person. HOTFIX-R4A（协调方改）: sent at once, like a remote
   * desktop — no waiting for a fresher frame, no replay, no 「再点一次」.
   */
  const deliverInput = React.useCallback(
    (build: () => InputPayload | null, _pointer: boolean): boolean => {
      if (viewOnlyRef.current || !socketOpen()) return false;
      onUserInputRef.current?.();
      // No picture yet (the stream is starting): nothing to map it onto — ask for one.
      if (!frameUsable()) {
        requestObservation();
        return false;
      }
      const payload = build();
      return payload ? sendInput(payload) : false;
    },
    [frameUsable, requestObservation, sendInput],
  );

  // The backend lays the page out at a fixed size; this screen only scales the frame.
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const recompute = (): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const srcW = canvas.width;
      const srcH = canvas.height;
      if (srcW <= 0 || srcH <= 0) return;
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const place =
        !viewportV2 && fitMode === 'readable'
          ? placeScreencastReadableTop
          : placeScreencastContainTop;
      const geometry = geometryRef.current;
      const zoomBox = viewportV2 && captchaZoom && displayMode !== 'actual' ? captchaBox : null;
      const zoomed =
        zoomBox && geometry?.cssWidth
          ? placeScreencastCaptchaZoom({
              hostWidth: host.clientWidth,
              hostHeight: host.clientHeight,
              sourceWidth: srcW,
              sourceHeight: srcH,
              cssWidth: geometry.cssWidth,
              box: zoomBox,
            })
          : null;
      const placement = zoomed
        ? zoomed
        : displayMode === 'actual'
          ? placeScreencastActual({
              sourceWidth: srcW,
              sourceHeight: srcH,
              // FIX-34: without v2 geometry, a frame wider than the page's CSS width is a
              // device-scale capture (DPR 2 → drawn at half size).
              pixelRatio: geometry?.cssWidth ? srcW / geometry.cssWidth : framePixelRatio(srcW),
            })
          : place({
              hostWidth: viewportV2 ? host.clientWidth : rect.width,
              hostHeight: viewportV2 ? host.clientHeight : rect.height,
              sourceWidth: srcW,
              sourceHeight: srcH,
            });
      if (!placement) return;
      // Keep the remote page pinned to the top. Portrait readable
      // mode may make wide desktop pages horizontally scrollable, so
      // center the first view on the readable region and recompute it
      // when the host changes size.
      const scale = placement.scale;
      canvas.style.setProperty('--hd-scale', String(scale));
      canvas.style.setProperty('--hd-offset-x', `${placement.offsetX}px`);
      canvas.style.setProperty('--hd-offset-y', `${placement.offsetY}px`);
      host.style.setProperty('--hd-content-width', `${placement.width}px`);
      host.style.setProperty('--hd-content-height', `${placement.height}px`);
      const autoScrollKey = readableScreencastAutoScrollKey({
        frameKey: `${wsUrl ?? 'none'}:${srcW}x${srcH}`,
        hostWidth: rect.width,
        hostHeight: rect.height,
        contentWidth: placement.width,
        viewMode: fitMode,
      });
      if (
        fitMode === 'readable' &&
        viewOnlyRef.current &&
        readableAutoScrollKeyRef.current !== autoScrollKey
      ) {
        readableAutoScrollKeyRef.current = autoScrollKey;
        const startLeft = readableScreencastStartScrollLeft({
          contentWidth: placement.width,
          hostWidth: rect.width,
        });
        host.scrollTo({ left: startLeft, top: 0 });
      }
    };
    recompute();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(recompute);
      ro.observe(host);
    }
    const onWindowResize = () => recompute();
    window.addEventListener('resize', onWindowResize);
    // Frame arrivals also change canvas.width/height; the existing
    // per-frame paint path calls recompute via a one-shot
    // setSourceDimsTick below.
    sourceDimsRecomputeRef.current = recompute;
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      sourceDimsRecomputeRef.current = null;
    };
  }, [fitMode, displayMode, status, wsUrl, viewportV2, captchaBox, captchaZoom]);

  const drawFrameRef = React.useRef(drawFrame);
  drawFrameRef.current = drawFrame;

  // ---- WS lifecycle: always-be-trying-to-connect ----
  // Browser hibernation is a normal state — the per-user pool's idle
  // GC reaps Brave after 5 min of inactivity, and the user can wake
  // it any time by submitting a task. The screencast WS must be
  // ready to attach the moment a fresh instance comes up, so we
  // retry indefinitely instead of capping attempts.
  //
  // Backoff: 0.5s, 1s, 2s, 4s, capped at 5s. Beyond the cap the
  // viewport polls /screencast-ws/ every 5 s — a few hundred bytes
  // per attempt, negligible cost, but means "user wakes browser"
  // → screencast attaches within ≤ 5 s without any explicit
  // event-coupling between the BrowserPanel's wake button and
  // this viewport.
  //
  // The viewport tears down only on unmount, target change, or auth being
  // removed. Rotating the 60-second token does not interrupt a healthy socket;
  // the latest token ref is consumed by the next genuine reconnect.
  React.useEffect(() => {
    if (!wsUrl || !hasStreamToken) {
      setStatus('idle');
      return;
    }
    let disposed = false;
    let reconnectState = INITIAL_CDP_RECONNECT_STATE;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let activeWs: WebSocket | null = null;
    // One-time mount diagnostic so BOSS can confirm in DevTools
    // which transport the panel actually picked. Gated through
    // hdDebug — prod builds drop it.
    hdDebug('CDP screencast viewport mounted', {
      wsUrl: wsUrl.replace(/token=[^&]+/, 'token=…'),
    });

    function connect(): void {
      if (disposed) return;
      const negotiatedUrl =
        viewportV2 && wsUrl ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}viewportV2=1` : wsUrl;
      const socketUrl = appendBrowserStreamToken(negotiatedUrl, streamTokenRef.current);
      if (!socketUrl) {
        setStatus('idle');
        return;
      }
      writeReadyRef.current = false;
      invalidateGeometry();
      const connectionSeq = ++connectionSeqRef.current;
      setStatus('connecting');
      const ws = new WebSocket(socketUrl);
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || connectionSeq !== connectionSeqRef.current || activeWs !== ws) {
          return;
        }
        reconnectState = cdpReconnectTransition(reconnectState, 'socket-opened').state;
        // An open socket only proves transport readiness. Keep the public
        // status at `connecting` until a real current-page frame is painted;
        // otherwise BrowserPanel enables input against a blank/stale canvas.
        setStatus('connecting');
        hdDebug('screencast WS', {
          event: 'open',
          readyState: ws.readyState,
          attempt: reconnectState.consecutiveFailures + 1,
        });
      };
      ws.onmessage = (event) => {
        if (disposed || connectionSeq !== connectionSeqRef.current || activeWs !== ws) {
          return;
        }
        let msg: {
          type?: string;
          data?: string;
          url?: string;
          geometry?: BrowserFrameGeometry;
          /** FIX-61B P1-5: which kind of input the server refused. */
          input?: string;
          /** CAPTCHA-UX-1: the captcha box, or null when there is none. */
          rect?: ScreencastCaptchaBox | null;
        } | null = null;
        try {
          msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
        } catch {
          return; // swallow malformed
        }
        if (!msg) return;
        if (viewportV2 && msg.type === 'viewport-v2-ready') {
          // The stream runs: input can go out as soon as a frame names it.
          writeReadyRef.current = true;
          return;
        }
        if (viewportV2 && msg.type === 'captcha-box') {
          const r = msg.rect;
          const box =
            r && [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n)) && r.width > 0
              ? { x: r.x, y: r.y, width: r.width, height: r.height }
              : null;
          // A new verification zooms in again even if the last one was zoomed out.
          if (box && !captchaBoxRef.current) setCaptchaZoom(true);
          captchaBoxRef.current = box;
          setCaptchaBox(box);
          return;
        }
        if (viewportV2 && msg.type === 'input-expired') {
          // HOTFIX-R4A: the one refusal left — an Enter / Space right after the page navigated.
          if (msg.input === 'key') notifyRefused('key');
          return;
        }
        // 复审 #1 (建议修 #3): the task is stopping (or a run is starting) — the input was not sent.
        if (viewportV2 && msg.type === 'input-closed') {
          notifyRefused('closed');
          return;
        }
        // HOTFIX-R4A（复审 P1-1）: the page changed (a navigation, a replaceState). The picture
        // on screen still maps the person's input until the next one arrives — like a remote
        // desktop; nothing is dropped meanwhile.
        if (viewportV2 && msg.type === 'observation-invalidated') return;
        // Older servers confirm a size this screen no longer sends; nothing to do.
        if (msg.type === 'viewport-applied') return;
        // Optimization #3 R2 — `Page.frameNavigated` events from
        // the CDP streamer arrive as `{type: 'url-changed', url}`.
        // Forward them to the parent so the address bar tracks
        // remote navigation (user clicked a link, JS pushState,
        // page reloaded, etc.).
        if (msg.type === 'url-changed' && typeof msg.url === 'string') {
          onUrlChangeRef.current?.(msg.url);
          return;
        }
        if (msg.type !== 'frame' || typeof msg.data !== 'string') return;
        drawFrameRef.current(msg.data, connectionSeq, msg.geometry, () => {
          reconnectState = cdpReconnectTransition(reconnectState, 'frame-ready').state;
        });
      };
      ws.onerror = () => {
        if (disposed || connectionSeq !== connectionSeqRef.current || activeWs !== ws) {
          return;
        }
        hdDebug('screencast WS', {
          event: 'error',
          readyState: ws.readyState,
          attempt: reconnectState.consecutiveFailures + 1,
        });
        setStatus('error');
      };
      ws.onclose = (event) => {
        if (disposed || connectionSeq !== connectionSeqRef.current || activeWs !== ws) {
          return;
        }
        // CAPTCHA-UX-1: a new connection reports its own box; never keep zooming on an old one.
        captchaBoxRef.current = null;
        setCaptchaBox(null);
        hdDebug('screencast WS', {
          event: 'close',
          readyState: ws.readyState,
          attempt: reconnectState.consecutiveFailures + 1,
          code: event.code,
          reason: event.reason || '(none)',
        });
        invalidateGeometry();
        setStatus('disconnected');
        // Backoff: doubles up to a 5 s ceiling, then stays at 5 s
        // forever. Browser hibernation is the expected steady state;
        // the viewport keeps trying so a wake (task submit, manual
        // wake button) attaches within 5 s without any external
        // trigger.
        const transition = cdpReconnectTransition(reconnectState, 'socket-closed');
        reconnectState = transition.state;
        retryTimer = setTimeout(() => connect(), transition.delayMs ?? 500);
      };
    }

    connect();

    return () => {
      disposed = true;
      invalidateGeometry();
      connectionSeqRef.current += 1;
      frameSeqRef.current += 1;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        if (activeWs?.readyState === WebSocket.CONNECTING) {
          const ws = activeWs;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.onopen = () => {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          };
        } else {
          activeWs?.close();
        }
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      decodingImgRef.current = null;
      pendingFrameRef.current = null;
    };
  }, [hasStreamToken, reconnectSignal, wsUrl, viewportV2, invalidateGeometry, notifyRefused]);

  // Decode a base64 JPEG and paint into the reused canvas. Each frame gets a
  // fresh Image so a delayed decode cannot inherit another frame's handlers.
  function drawFrame(
    base64: string,
    connectionSeq: number,
    geometry: BrowserFrameGeometry | undefined,
    onPaint: () => void,
  ): void {
    if (decodingImgRef.current) {
      pendingFrameRef.current = { base64, connectionSeq, geometry, onPaint };
      return;
    }
    if (imgRef.current) {
      imgRef.current.onload = null;
      imgRef.current.onerror = null;
    }
    const img = new Image();
    imgRef.current = img;
    decodingImgRef.current = img;
    const frameSeq = ++frameSeqRef.current;
    const observationEpoch = observationEpochRef.current;
    const settle = (): void => {
      if (decodingImgRef.current !== img) return;
      decodingImgRef.current = null;
      const next = pendingFrameRef.current;
      pendingFrameRef.current = null;
      if (next) drawFrameRef.current(next.base64, next.connectionSeq, next.geometry, next.onPaint);
    };
    img.onload = () => {
      try {
        paintDecoded();
      } finally {
        settle();
      }
    };
    const paintDecoded = (): void => {
      if (
        !shouldPaintCdpFrame({
          mounted: mountedRef.current,
          connectionSeq,
          currentConnectionSeq: connectionSeqRef.current,
          frameSeq,
          currentFrameSeq: frameSeqRef.current,
          socketOpen: wsRef.current?.readyState === WebSocket.OPEN,
        })
      ) {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const sizeChanged = canvas.width !== img.width || canvas.height !== img.height;
      if (canvas.width !== img.width) canvas.width = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      if (viewportV2) {
        // Every frame is accepted and scaled to fit, whatever its size: the page keeps its own
        // fixed layout. Its geometry maps input when it matches the image painted (and the
        // connection it came on is still this one); otherwise the last picture's geometry stays.
        // 复审 #2 P2-b: a geometry that does not fit its own picture maps nothing (better an input
        // not sent than one sent to the wrong place).
        if (observationEpoch === observationEpochRef.current)
          geometryRef.current =
            geometry && geometry.imageWidth === img.width && geometry.imageHeight === img.height
              ? geometry
              : null;
        if (geometryRef.current) writeReadyRef.current = true;
      }
      if (geometryRef.current) geometryReceivedAtRef.current = Date.now();
      if (canvasRef.current) {
        if (geometryRef.current) canvasRef.current.dataset.frameId = geometryRef.current.frameId;
        else delete canvasRef.current.dataset.frameId;
      }
      onPaint();
      setStatus('connected');
      onFrameReadyRef.current?.();
      // A new renderer can emit one frame at its startup size. Recompute
      // immediately so that frame is still contained without affecting the
      // surrounding flex layout.
      if (sizeChanged) sourceDimsRecomputeRef.current?.();
      requestAnimationFrame(() => sourceDimsRecomputeRef.current?.());
    };
    img.onerror = () => {
      settle();
      if (
        !shouldPaintCdpFrame({
          mounted: mountedRef.current,
          connectionSeq,
          currentConnectionSeq: connectionSeqRef.current,
          frameSeq,
          currentFrameSeq: frameSeqRef.current,
          socketOpen: wsRef.current?.readyState === WebSocket.OPEN,
        })
      ) {
        return;
      }
      setStatus('error');
      try {
        wsRef.current?.close(1011, 'frame-decode-failed');
      } catch {
        /* the close handler will retry if the transport is already closing */
      }
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  }

  /** Map a DOM pointer's clientX/Y on the displayed frame to page coordinates. */
  function getCoords(
    e: { clientX: number; clientY: number },
    clampDrag = false,
  ): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (viewportV2) {
      const frame = geometryRef.current;
      const point = frame
        ? mapClientPointToBrowserFrame({
            clientX: clampDrag
              ? Math.max(rect.left, Math.min(rect.right - 0.01, e.clientX))
              : e.clientX,
            clientY: clampDrag
              ? Math.max(rect.top, Math.min(rect.bottom - 0.01, e.clientY))
              : e.clientY,
            rect,
            frame,
          })
        : null;
      return point ?? { x: Number.NaN, y: Number.NaN };
    }
    return mapClientPointToScreencast({
      clientX: e.clientX,
      clientY: e.clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      sourceWidth: canvas.width,
      sourceHeight: canvas.height,
    });
  }

  const touchRef = React.useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  // FIX-62 P1-4: the text bar's words go the same way as typed text — insertText.
  if (textChannel)
    textChannel.current = (text: string): boolean => {
      if (!text || viewOnlyRef.current) return false;
      return deliverInput(() => ({ type: 'insertText', text }), false);
    };
  // Mouse handlers
  const onMouseMove = (e: React.MouseEvent) => {
    if (viewOnly) return;
    // Hovering on a still page: refresh the frame now so the click that follows names a
    // current picture instead of waiting for one.
    keepFrameFresh();
    if (!frameUsable()) return;
    const { x, y } = getCoords(e, e.buttons !== 0);
    if (sendInput({ type: 'mouseMove', x, y }) && e.buttons !== 0) onUserInputRef.current?.();
  };
  const pointerPayload = (
    type: 'mouseDown' | 'mouseUp',
    point: { clientX: number; clientY: number },
    button: number,
    detail: number,
  ) => {
    // Mapped when sent, against the frame that is current at that moment.
    return (): InputPayload | null => {
      const { x, y } = getCoords(point, type === 'mouseUp');
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        type,
        x,
        y,
        button: button === 2 ? 'right' : button === 1 ? 'middle' : 'left',
        clickCount: detail || 1,
      };
    };
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (viewOnly) return;
    retainScreencastInputFocus({
      event: e,
      input: hiddenInputRef.current,
    });
    deliverInput(
      pointerPayload('mouseDown', { clientX: e.clientX, clientY: e.clientY }, e.button, e.detail),
      true,
    );
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (viewOnly) return;
    deliverInput(
      pointerPayload('mouseUp', { clientX: e.clientX, clientY: e.clientY }, e.button, e.detail),
      true,
    );
  };
  const onWheel = (e: React.WheelEvent) => {
    if (viewOnly) return;
    e.preventDefault();
    if (!frameUsable()) {
      keepFrameFresh();
      return;
    }
    const { x, y } = getCoords(e);
    if (sendInput({ type: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY }))
      onUserInputRef.current?.();
  };

  // Keyboard handlers — fire on the hidden input so the canvas
  // doesn't fight the browser for default-action handling.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    const transition = cdpKeyTransition(inputBridgeStateRef.current, {
      phase: 'down',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      isComposing: e.nativeEvent.isComposing,
    });
    inputBridgeStateRef.current = transition.state;
    if (!transition.payload) return;
    // Don't preventDefault on Tab — that lets the user escape the
    // capture if focus gets stuck.
    if (e.key !== 'Tab') e.preventDefault();
    const payload = transition.payload;
    deliverInput(() => payload, false);
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    const transition = cdpKeyTransition(inputBridgeStateRef.current, {
      phase: 'up',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      isComposing: e.nativeEvent.isComposing,
    });
    inputBridgeStateRef.current = transition.state;
    if (!transition.payload) return;
    if (e.key !== 'Tab') e.preventDefault();
    const payload = transition.payload;
    deliverInput(() => payload, false);
  };
  // CJK / IME — composition end carries the composed string.
  // We send insertText, NOT a sequence of keys, so the IME's
  // candidate selection lands verbatim in Brave's focused element.
  const onCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    const transition = cdpCompositionEndTransition(inputBridgeStateRef.current, e.data);
    inputBridgeStateRef.current = transition.state;
    const payload = transition.payload;
    if (payload) deliverInput(() => payload, false);
    // Clear the hidden input so the next composition starts fresh.
    if (hiddenInputRef.current) hiddenInputRef.current.value = '';
  };
  // Catch-all for non-composition typing into the hidden input
  // (e.g. paste). Forward as insertText too.
  const onHiddenInputInput = (e: React.FormEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    const native = e.nativeEvent as InputEvent;
    const target = e.currentTarget;
    const transition = cdpTextInputTransition(inputBridgeStateRef.current, {
      value: target.value,
      inputType: native.inputType,
      isComposing: native.isComposing,
    });
    inputBridgeStateRef.current = transition.state;
    const payload = transition.payload;
    if (payload) deliverInput(() => payload, false);
    if (transition.clearInput) target.value = '';
  };

  return (
    <div
      className={cn(
        'relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden',
        className,
      )}
    >
      {viewportV2 && captchaBox && displayMode !== 'actual' ? (
        // CAPTCHA-UX-1 第 2 条 (复审 P1-4): above the picture, never over it — the hint must not
        // cover the challenge's Verify button. Zoom on / off; the picture follows the box and
        // restores itself when the verification is gone. Outside the canvas: never sent to the page.
        <div className="flex shrink-0 items-center gap-2 border-b bg-background px-2 py-1.5">
          <p
            role="status"
            data-testid="captcha-zoom-hint"
            className="min-w-0 flex-1 text-xs leading-5 text-foreground"
          >
            请在放大的画面里完成验证；看不清可以点验证框里的耳机图标改听语音
          </p>
          <button
            type="button"
            data-testid="captcha-zoom-toggle"
            aria-pressed={captchaZoom}
            onClick={() => setCaptchaZoom((on) => !on)}
            className="shrink-0 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm"
          >
            {captchaZoom ? '缩小' : '放大'}
          </button>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={cn(
          'cdp-screencast-host relative w-full min-h-0 min-w-0 flex-1',
          displayMode === 'actual' || (!viewportV2 && fitMode === 'readable')
            ? 'overflow-auto'
            : 'overflow-hidden',
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none"
          style={{
            width: 'var(--hd-content-width, 100%)',
            height: 'var(--hd-content-height, 100%)',
          }}
        />
        <canvas
          ref={canvasRef}
          onMouseMove={viewportV2 ? undefined : onMouseMove}
          onMouseDown={viewportV2 ? undefined : onMouseDown}
          onMouseUp={viewportV2 ? undefined : onMouseUp}
          onPointerMove={
            viewportV2
              ? (e) => {
                  if (e.pointerType !== 'touch') onMouseMove(e);
                }
              : undefined
          }
          onPointerDown={
            viewportV2
              ? (e) => {
                  if (e.pointerType !== 'touch') {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    onMouseDown(e);
                  }
                }
              : undefined
          }
          onPointerUp={
            viewportV2
              ? (e) => {
                  if (e.pointerType !== 'touch') {
                    onMouseUp(e);
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                }
              : undefined
          }
          onPointerCancel={viewportV2 ? onMouseUp : undefined}
          onWheel={onWheel}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t)
              touchRef.current = {
                x: t.clientX,
                y: t.clientY,
                startX: t.clientX,
                startY: t.clientY,
                moved: false,
              };
            // The tap that follows names the newest frame: make sure it is fresh.
            keepFrameFresh();
          }}
          onTouchMove={(e) => {
            if (!viewportV2 || viewOnly) return;
            const t = e.touches[0];
            const previous = touchRef.current;
            if (!t || !previous) return;
            e.preventDefault();
            const canvas = canvasRef.current;
            const frame = geometryRef.current;
            const point =
              canvas && frame
                ? mapClientPointToBrowserFrame({
                    clientX: t.clientX,
                    clientY: t.clientY,
                    rect: canvas.getBoundingClientRect(),
                    frame,
                  })
                : null;
            if (
              point &&
              sendInput({
                type: 'scroll',
                ...point,
                deltaX: previous.x - t.clientX,
                deltaY: previous.y - t.clientY,
              })
            )
              onUserInputRef.current?.();
            touchRef.current = {
              ...previous,
              x: t.clientX,
              y: t.clientY,
              moved:
                previous.moved ||
                Math.hypot(t.clientX - previous.startX, t.clientY - previous.startY) > 5,
            };
          }}
          onTouchEnd={(e) => {
            const touch = touchRef.current;
            touchRef.current = null;
            if (!viewportV2 || viewOnly || !touch || touch.moved) return;
            const t = e.changedTouches[0];
            if (!t) return;
            // A tap on a phone is a click. Suppress the compatibility mouse events, which would
            // move focus to the page body and leave the phone keyboard with nowhere to type.
            e.preventDefault();
            const point = { clientX: t.clientX, clientY: t.clientY };
            const input = hiddenInputRef.current;
            input?.focus({ preventScroll: true });
            requestAnimationFrame(() => input?.focus({ preventScroll: true }));
            deliverInput(pointerPayload('mouseDown', point, 0, 1), true);
            deliverInput(pointerPayload('mouseUp', point, 0, 1), true);
          }}
          onTouchCancel={() => {
            touchRef.current = null;
          }}
          onContextMenu={(e) => e.preventDefault()}
          /* Absolute positioning keeps a transient source-frame size from
           * expanding the surrounding flex columns during a resize or renderer
           * swap. The host remains the layout authority. */
          className="absolute left-0 top-0 block origin-top-left will-change-transform"
          style={{
            cursor: 'default',
            touchAction: viewportV2 ? 'none' : undefined,
            transform:
              'translate(var(--hd-offset-x, 0px), var(--hd-offset-y, 0px)) scale(var(--hd-scale, 1))',
          }}
        />
        {/* Off-screen input — collects keyboard + composition so the
          canvas itself doesn't have to be focusable. */}
        <input
          ref={hiddenInputRef}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onCompositionStart={() => {
            inputBridgeStateRef.current = cdpCompositionStartTransition(
              inputBridgeStateRef.current,
            );
          }}
          onCompositionEnd={onCompositionEnd}
          onInput={onHiddenInputInput}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute h-px w-px opacity-0"
          style={{ pointerEvents: 'none', top: 0, left: 0 }}
        />
      </div>
    </div>
  );
}
