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
import {
  type BrowserViewportSize,
  browserViewportForHost,
  browserViewportV2ForHost,
  fitDesktopViewportForHost,
  shouldSendBrowserViewport,
} from '@/lib/browser-workspace-viewport';
import { hdDebug } from '@/lib/hd-debug';
import {
  framePixelRatio,
  mapClientPointToBrowserFrame,
  mapClientPointToScreencast,
  placeScreencastActual,
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
 * Renders only a `<canvas>` + an off-screen `<input>` for CJK
 * composition capture. No noVNC, no RFB, no WebSocket subprotocol
 * negotiation — just JSON frames.
 */

export type CdpScreencastStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

/** FIX-61: a user input waiting for control / a fresh frame. Built at delivery time. */
interface DeferredInput {
  at: number;
  build: () => InputPayload | null;
  /** DEPLOY-61 P1-1: the layout (CSS size + scroll) of the frame the user acted on, when known. */
  layout?: string;
}
/** DEPLOY-61 P1-1: what decides where a point on the screen lands on the page. */
function layoutKey(g: BrowserFrameGeometry | null | undefined): string | undefined {
  if (!g?.cssWidth) return undefined;
  return `${g.cssWidth}x${g.cssHeight}@${g.scrollOffset?.x ?? 0},${g.scrollOffset?.y ?? 0}`;
}
const GEOMETRY_FRESH_MS = 5000;
const DEFERRED_INPUT_MS = 4000;
const DEFERRED_INPUT_LIMIT = 64;
const CONTROL_REQUEST_GAP_MS = 1500;

interface Props {
  /** Stable WS URL to /screencast-ws/:taskId, without credentials. */
  wsUrl: string | null;
  /** Latest short-lived credential, read only when a socket is opened. */
  streamToken: string | null;
  /** Block input forwarding when true (mirror VncViewport semantics). */
  viewOnly?: boolean;
  controlLease?: string | null;
  /**
   * FIX-61 P0: when set, pressing or typing on a view-only screen asks for
   * control instead of being ignored. The pressed point / keys wait (in memory,
   * at most a few seconds) and are delivered once control is granted.
   */
  onRequestControl?: () => void;
  /**
   * Deliver the press / keys that asked for control once it is granted. Only
   * for a page nobody else is changing (a finished task): while the assistant
   * is still working the page may change before it pauses, so the first press
   * only asks for control.
   */
  replayAfterControl?: boolean;
  /**
   * DEPLOY-61: held input was not delivered because taking control re-laid the page out at
   * another width (a phone screen) — the same point would now hit something else.
   */
  onHeldInputDropped?: () => void;
  onStatusChange?: (status: CdpScreencastStatus) => void;
  /** Fired after the first real frame is painted for the current viewport. */
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
  /** FIX-34: the phone sheet — the remote page uses its mobile layout. */
  mobileViewport?: boolean;
  viewportV2?: boolean;
  /** Explicit desktop profile; panel size never silently changes it. */
  desktopViewport?: BrowserViewportSize;
  className?: string;
}

interface InputPayload {
  type:
    | 'mouseMove'
    | 'mouseDown'
    | 'mouseUp'
    | 'scroll'
    | 'keyDown'
    | 'keyUp'
    | 'insertText'
    | 'viewport';
  deviceScaleFactor?: number;
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
  width?: number;
  height?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function CdpScreencastViewport({
  wsUrl,
  streamToken,
  viewOnly = true,
  controlLease = null,
  onRequestControl,
  onHeldInputDropped,
  replayAfterControl = true,
  onStatusChange,
  onFrameReady,
  reconnectSignal = 0,
  onUrlChange,
  fitMode = 'contain',
  displayMode = 'fit',
  mobileViewport = false,
  viewportV2 = false,
  desktopViewport,
  className,
}: Props): JSX.Element {
  // Latest onUrlChange ref so the WS onmessage closure stays stable
  // even when the parent passes a fresh handler on every render.
  const desktopWidth = desktopViewport?.width;
  const desktopHeight = desktopViewport?.height;
  const onUrlChangeRef = React.useRef(onUrlChange);
  React.useEffect(() => {
    onUrlChangeRef.current = onUrlChange;
  }, [onUrlChange]);
  const onFrameReadyRef = React.useRef(onFrameReady);
  React.useEffect(() => {
    onFrameReadyRef.current = onFrameReady;
  }, [onFrameReady]);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const writeReadyRef = React.useRef(false);
  const geometryRef = React.useRef<BrowserFrameGeometry | null>(null);
  const observationEpochRef = React.useRef(0);
  const viewportPendingRef = React.useRef(false);
  const requestedViewportRef = React.useRef<BrowserViewportSize | null>(null);
  // FIX-61: freshness is judged by when THIS client painted the frame. The
  // frame's own capturedAt is the server's clock; a user clock a few seconds
  // off made every click look stale and silently dropped.
  const geometryReceivedAtRef = React.useRef(0);
  const deferredInputsRef = React.useRef<DeferredInput[]>([]);
  const onRequestControlRef = React.useRef(onRequestControl);
  onRequestControlRef.current = onRequestControl;
  const onHeldInputDroppedRef = React.useRef(onHeldInputDropped);
  onHeldInputDroppedRef.current = onHeldInputDropped;
  // DEPLOY-61: the layout of the newest painted frame, even while its geometry is not yet
  // accepted for input (a view-only screen whose size the server has not applied).
  const paintedLayoutRef = React.useRef<string | undefined>(undefined);
  const replayAfterControlRef = React.useRef(replayAfterControl);
  replayAfterControlRef.current = replayAfterControl;
  const lastControlRequestRef = React.useRef(0);
  const controlRequestInFlight = (now: number): boolean =>
    lastControlRequestRef.current > 0 && now - lastControlRequestRef.current <= DEFERRED_INPUT_MS;
  const invalidateGeometry = React.useCallback(() => {
    geometryRef.current = null;
    observationEpochRef.current++;
    if (canvasRef.current) delete canvasRef.current.dataset.frameId;
  }, []);
  const hiddenInputRef = React.useRef<HTMLInputElement>(null);
  const inputBridgeStateRef = React.useRef<CdpInputBridgeState>(INITIAL_CDP_INPUT_BRIDGE_STATE);
  /** Host <div> ref — source of truth for the live remote viewport. */
  const hostRef = React.useRef<HTMLDivElement>(null);
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
  const controlLeaseRef = React.useRef(controlLease);
  controlLeaseRef.current = controlLease;
  React.useEffect(() => {
    viewOnlyRef.current = viewOnly;
  }, [viewOnly]);
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

  // Send transport/control messages even in view-only mode. View-only blocks
  // user input, but the remote page still needs the real canvas dimensions so
  // its responsive layout can reflow to this workspace.
  const sendInput = React.useCallback(
    (payload: InputPayload): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      if (payload.type !== 'viewport' && (viewOnlyRef.current || !controlLeaseRef.current))
        return false;
      if (
        (payload.x !== undefined && !Number.isFinite(payload.x)) ||
        (payload.y !== undefined && !Number.isFinite(payload.y))
      )
        return false;
      if (
        viewportV2 &&
        payload.type !== 'viewport' &&
        payload.type !== 'scroll' &&
        payload.type !== 'mouseMove' &&
        !writeReadyRef.current
      )
        return false;
      const geometry = geometryRef.current;
      if (
        viewportV2 &&
        payload.type !== 'viewport' &&
        (!geometry ||
          viewportPendingRef.current ||
          Date.now() - geometryReceivedAtRef.current > GEOMETRY_FRESH_MS)
      ) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'observe' }));
        return false;
      }
      try {
        ws.send(
          JSON.stringify({
            type: 'input',
            payload,
            controlLease: controlLeaseRef.current,
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
    [viewportV2],
  );

  // FIX-61 P0: inputs that cannot be delivered yet (no control, or the frame
  // geometry is being refreshed after a resize) wait here instead of being
  // dropped. Kept only in memory, only for a few seconds, never logged; cleared
  // when the connection or task changes.
  const canDeliverNow = React.useCallback((): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (viewOnlyRef.current || !controlLeaseRef.current) return false;
    if (!viewportV2) return true;
    return (
      writeReadyRef.current &&
      Boolean(geometryRef.current) &&
      !viewportPendingRef.current &&
      Date.now() - geometryReceivedAtRef.current <= GEOMETRY_FRESH_MS
    );
  }, [viewportV2]);
  const flushDeferred = React.useCallback(() => {
    if (deferredInputsRef.current.length === 0 || !canDeliverNow()) return;
    const now = Date.now();
    const pending = deferredInputsRef.current;
    deferredInputsRef.current = [];
    // DEPLOY-61 P1-1: held input is mapped against the frame current when sent. Delivered only
    // when the layout is exactly the one the user acted on; taking control re-laid it out (a
    // phone width, a taller panel that moved Google's centred search box 50px down, a scroll):
    // that point now shows something else, so deliver nothing and let the user press again.
    const current = layoutKey(geometryRef.current);
    if (
      viewportV2 &&
      pending.some(
        (item) =>
          now - item.at <= DEFERRED_INPUT_MS &&
          (item.layout === undefined || current === undefined || item.layout !== current),
      )
    ) {
      onHeldInputDroppedRef.current?.();
      return;
    }
    for (const item of pending) {
      if (now - item.at > DEFERRED_INPUT_MS) continue;
      const payload = item.build();
      if (payload) sendInput(payload);
    }
  }, [canDeliverNow, sendInput, viewportV2]);
  const flushDeferredRef = React.useRef(flushDeferred);
  flushDeferredRef.current = flushDeferred;
  const deliverInput = React.useCallback(
    (build: () => InputPayload | null): void => {
      if (deferredInputsRef.current.length === 0 && canDeliverNow()) {
        const payload = build();
        if (payload) sendInput(payload);
        return;
      }
      const requestControl = onRequestControlRef.current;
      const now = Date.now();
      // Without a way to ask for control, input made without a lease is never
      // kept for later — unless this screen has just asked for it (FIX-61 复审 #2 #2: the
      // panel withdraws onRequestControl while that request is in flight, and the press
      // that asked, and its release, must still land once control arrives).
      if (
        (viewOnlyRef.current || !controlLeaseRef.current) &&
        !requestControl &&
        !controlRequestInFlight(now)
      )
        return;
      const waitingForControl = viewOnlyRef.current || !controlLeaseRef.current;
      if (!waitingForControl || replayAfterControlRef.current) {
        deferredInputsRef.current = [
          ...deferredInputsRef.current.filter((item) => now - item.at <= DEFERRED_INPUT_MS),
          {
            at: now,
            build,
            layout: layoutKey(geometryRef.current) ?? paintedLayoutRef.current,
          },
        ].slice(-DEFERRED_INPUT_LIMIT);
      }
      if (waitingForControl) {
        if (requestControl && now - lastControlRequestRef.current > CONTROL_REQUEST_GAP_MS) {
          lastControlRequestRef.current = now;
          requestControl();
        }
        return;
      }
      const ws = wsRef.current;
      if (viewportV2 && ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'observe' }));
        } catch {
          /* closing */
        }
      }
    },
    [canDeliverNow, sendInput, viewportV2],
  );
  // FIX-61 复审 #2 #2: held input waits for a fresh frame, and a still page (apple.com.cn)
  // sends none by itself — the press that asked for control expired unsent. Ask for one.
  const askFrameForDeferred = React.useCallback((): void => {
    if (!viewportV2 || deferredInputsRef.current.length === 0) return;
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'observe' }));
    } catch {
      /* closing */
    }
  }, [viewportV2]);
  const askFrameForDeferredRef = React.useRef(askFrameForDeferred);
  askFrameForDeferredRef.current = askFrameForDeferred;
  // Control just arrived (or was lost): deliver what waited, or ask for a frame.
  React.useEffect(() => {
    if (viewOnly || !controlLease) {
      if (!onRequestControl && !controlRequestInFlight(Date.now())) deferredInputsRef.current = [];
      return;
    }
    flushDeferredRef.current();
    askFrameForDeferredRef.current();
  }, [viewOnly, controlLease, onRequestControl]);

  const lastDprRef = React.useRef(0);
  const lastViewportRef = React.useRef<BrowserViewportSize | null>(null);
  const [connectionEpoch, setConnectionEpoch] = React.useState(0);
  React.useEffect(() => {
    lastViewportRef.current = null;
    setConnectionEpoch((epoch) => epoch + 1);
  }, [controlLease]);
  React.useEffect(() => {
    const host = hostRef.current;
    // Publish the viewport as soon as the socket is opening/open. Waiting for
    // the first frame would make the fallback capture use the tiny spawn-time
    // viewport, then visibly resize a moment later.
    if (!host || (status !== 'connecting' && status !== 'connected')) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = (): void => {
      const rect = host.getBoundingClientRect();
      const next = viewportV2
        ? browserViewportV2ForHost({
            hostWidth: host.clientWidth,
            hostHeight: host.clientHeight,
            renderMode: 'auto',
            // Without an explicit profile the page lays out at a desktop width
            // shaped like the panel (FIX-33), not at the narrow panel width.
            desktopViewport:
              desktopWidth !== undefined && desktopHeight !== undefined
                ? { width: desktopWidth, height: desktopHeight }
                : (fitDesktopViewportForHost({
                    hostWidth: host.clientWidth,
                    hostHeight: host.clientHeight,
                    mobile: mobileViewport,
                  }) ?? undefined),
          })
        : browserViewportForHost({ hostWidth: rect.width, hostHeight: rect.height });
      const deviceScaleFactor = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      if (
        !next ||
        (!shouldSendBrowserViewport(lastViewportRef.current, next) &&
          lastDprRef.current === deviceScaleFactor)
      ) {
        return;
      }
      if (viewportV2) {
        invalidateGeometry();
        viewportPendingRef.current = true;
        requestedViewportRef.current = next;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (
          sendInput({
            type: 'viewport',
            width: next.width,
            height: next.height,
            ...(viewportV2 ? { deviceScaleFactor } : {}),
          })
        ) {
          lastViewportRef.current = next;
          lastDprRef.current = deviceScaleFactor;
        }
      }, 100);
    };
    publish();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    ro?.observe(host);
    window.addEventListener('resize', publish);
    return () => {
      if (timer) clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener('resize', publish);
    };
  }, [
    connectionEpoch,
    sendInput,
    status,
    wsUrl,
    viewportV2,
    desktopWidth,
    desktopHeight,
    mobileViewport,
    invalidateGeometry,
  ]);
  React.useEffect(() => {
    lastViewportRef.current = null;
  }, [wsUrl]);

  // The backend normally reflows Chromium to the host dimensions. Keep a
  // contain transform as a transient safety net while the first viewport
  // handshake or a renderer-changing navigation is producing a new frame.
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
      const placement =
        displayMode === 'actual'
          ? placeScreencastActual({
              sourceWidth: srcW,
              sourceHeight: srcH,
              // FIX-34: without v2 geometry, a frame wider than the CSS viewport the panel
              // asked for is a device-scale capture (DPR 2 → drawn at half size).
              pixelRatio: geometry?.cssWidth
                ? srcW / geometry.cssWidth
                : framePixelRatio(srcW, lastViewportRef.current?.width),
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
  }, [fitMode, displayMode, status, wsUrl, viewportV2]);

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
      viewportPendingRef.current = viewportV2;
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
        lastViewportRef.current = null;
        setConnectionEpoch((epoch) => epoch + 1);
        // An open socket only proves transport readiness. Keep the public
        // status at `connecting` until a real current-page frame is painted;
        // otherwise BrowserPanel enables takeover against a blank/stale canvas.
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
          width?: number;
          height?: number;
          controlReady?: boolean;
        } | null = null;
        try {
          msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
        } catch {
          return; // swallow malformed
        }
        if (!msg) return;
        if (viewportV2 && msg.type === 'viewport-v2-ready') {
          writeReadyRef.current = msg.controlReady === true;
          return;
        }
        if (viewportV2 && msg.type === 'observation-invalidated') {
          invalidateGeometry();
          return;
        }
        if (viewportV2 && msg.type === 'viewport-applied') {
          const pending = requestedViewportRef.current;
          if (pending && pending.width === msg.width && pending.height === msg.height) {
            viewportPendingRef.current = false;
            askFrameForDeferredRef.current();
          }
          return;
        }
        // Optimization #3 R2 — `Page.frameNavigated` events from
        // the CDP streamer arrive as `{type: 'url-changed', url}`.
        // Forward them to the parent so the address bar tracks
        // remote navigation (user clicked a link, JS pushState,
        // page reloaded, etc.).
        if (msg.type === 'url-changed' && typeof msg.url === 'string') {
          if (viewportV2) invalidateGeometry();
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
      deferredInputsRef.current = [];
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
  }, [hasStreamToken, reconnectSignal, wsUrl, viewportV2, invalidateGeometry]);

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
      if (viewportV2 && geometry?.cssWidth) paintedLayoutRef.current = layoutKey(geometry);
      if (viewportV2) {
        geometryRef.current =
          observationEpoch === observationEpochRef.current &&
          !viewportPendingRef.current &&
          geometry &&
          geometry.imageWidth === img.width &&
          geometry.imageHeight === img.height &&
          (!requestedViewportRef.current ||
            (geometry.cssWidth === requestedViewportRef.current.width &&
              geometry.cssHeight === requestedViewportRef.current.height))
            ? geometry
            : null;
      }
      if (geometryRef.current) geometryReceivedAtRef.current = Date.now();
      if (canvasRef.current) {
        if (geometryRef.current) canvasRef.current.dataset.frameId = geometryRef.current.frameId;
        else delete canvasRef.current.dataset.frameId;
      }
      onPaint();
      setStatus('connected');
      flushDeferredRef.current();
      onFrameReadyRef.current?.();
      // A new renderer can emit one frame at its startup size before the
      // saved viewport is reapplied. Recompute immediately so that frame is
      // still contained without affecting the surrounding flex layout.
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

  /** Map a DOM mouse event's clientX/Y to canvas-pixel space. */
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
  // FIX-61 P0: a view-only screen that may ask for control still accepts the
  // press / keys and hands them to deliverInput, which asks for control.
  // FIX-61 复审 #2 #2: and right after it asked (the panel withdraws onRequestControl while the
  // request is in flight), so the release / keys that follow the asking press are not lost.
  const acceptsInput = (): boolean =>
    !viewOnly || Boolean(onRequestControl) || controlRequestInFlight(Date.now());
  // Mouse handlers
  const onMouseMove = (e: React.MouseEvent) => {
    if (viewOnly || !canDeliverNow()) return;
    const { x, y } = getCoords(e, e.buttons !== 0);
    sendInput({ type: 'mouseMove', x, y });
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
    if (!acceptsInput()) return;
    retainScreencastInputFocus({
      event: e,
      input: hiddenInputRef.current,
    });
    deliverInput(
      pointerPayload('mouseDown', { clientX: e.clientX, clientY: e.clientY }, e.button, e.detail),
    );
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (!acceptsInput()) return;
    deliverInput(
      pointerPayload('mouseUp', { clientX: e.clientX, clientY: e.clientY }, e.button, e.detail),
    );
  };
  const onWheel = (e: React.WheelEvent) => {
    if (viewOnly || !canDeliverNow()) return;
    e.preventDefault();
    const { x, y } = getCoords(e);
    sendInput({ type: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
  };

  // Keyboard handlers — fire on the hidden input so the canvas
  // doesn't fight the browser for default-action handling.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!acceptsInput()) return;
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
    deliverInput(() => payload);
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!acceptsInput()) return;
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
    deliverInput(() => payload);
  };
  // CJK / IME — composition end carries the composed string.
  // We send insertText, NOT a sequence of keys, so the IME's
  // candidate selection lands verbatim in Brave's focused element.
  const onCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    if (!acceptsInput()) return;
    const transition = cdpCompositionEndTransition(inputBridgeStateRef.current, e.data);
    inputBridgeStateRef.current = transition.state;
    const payload = transition.payload;
    if (payload) deliverInput(() => payload);
    // Clear the hidden input so the next composition starts fresh.
    if (hiddenInputRef.current) hiddenInputRef.current.value = '';
  };
  // Catch-all for non-composition typing into the hidden input
  // (e.g. paste). Forward as insertText too.
  const onHiddenInputInput = (e: React.FormEvent<HTMLInputElement>) => {
    if (!acceptsInput()) return;
    const native = e.nativeEvent as InputEvent;
    const target = e.currentTarget;
    const transition = cdpTextInputTransition(inputBridgeStateRef.current, {
      value: target.value,
      inputType: native.inputType,
      isComposing: native.isComposing,
    });
    inputBridgeStateRef.current = transition.state;
    const payload = transition.payload;
    if (payload) deliverInput(() => payload);
    if (transition.clearInput) target.value = '';
  };

  return (
    <div
      className={cn(
        'relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden',
        className,
      )}
    >
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
            if (point)
              sendInput({
                type: 'scroll',
                ...point,
                deltaX: previous.x - t.clientX,
                deltaY: previous.y - t.clientY,
              });
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
            if (!viewportV2 || !acceptsInput() || !touch || touch.moved) return;
            const t = e.changedTouches[0];
            if (!t) return;
            // FIX-61: a tap on a phone takes control the same way a click does.
            // Suppress the compatibility mouse events, which would move focus to
            // the page body and leave the phone keyboard with nowhere to type.
            e.preventDefault();
            const point = { clientX: t.clientX, clientY: t.clientY };
            const input = hiddenInputRef.current;
            input?.focus({ preventScroll: true });
            requestAnimationFrame(() => input?.focus({ preventScroll: true }));
            deliverInput(pointerPayload('mouseDown', point, 0, 1));
            deliverInput(pointerPayload('mouseUp', point, 0, 1));
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
