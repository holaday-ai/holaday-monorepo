import * as React from 'react';
import { hdDebug } from '@/lib/hd-debug';
import {
  browserViewportForHost,
  shouldSendBrowserViewport,
  type BrowserViewportSize,
} from '@/lib/browser-workspace-viewport';
import {
  mapClientPointToScreencast,
  placeScreencastContainTop,
  placeScreencastReadableTop,
  readableScreencastAutoScrollKey,
  readableScreencastStartScrollLeft,
} from '@/lib/screencast-fit';
import { retainScreencastInputFocus } from '@/lib/screencast-input-focus';
import { cn } from '@/lib/utils';

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

export type CdpScreencastStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

interface Props {
  /** WS URL to /screencast-ws/:userId?token=… . Null disables. */
  wsUrl: string | null;
  /** Block input forwarding when true (mirror VncViewport semantics). */
  viewOnly?: boolean;
  onStatusChange?: (status: CdpScreencastStatus) => void;
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
  viewOnly = true,
  onStatusChange,
  onUrlChange,
  fitMode = 'contain',
  className,
}: Props): JSX.Element {
  // Latest onUrlChange ref so the WS onmessage closure stays stable
  // even when the parent passes a fresh handler on every render.
  const onUrlChangeRef = React.useRef(onUrlChange);
  React.useEffect(() => {
    onUrlChangeRef.current = onUrlChange;
  }, [onUrlChange]);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = React.useRef<HTMLInputElement>(null);
  /** Host <div> ref — source of truth for the live remote viewport. */
  const hostRef = React.useRef<HTMLDivElement>(null);
  /** Imperative hook the frame-paint path uses to nudge the scale
   *  effect when canvas.width/height changes (a new source size). */
  const sourceDimsRecomputeRef = React.useRef<(() => void) | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  // Cached <img> + frame sequence guard so async image loads cannot
  // paint stale frames after a newer frame, wsUrl change, or unmount.
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const frameSeqRef = React.useRef(0);
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
  React.useEffect(() => {
    viewOnlyRef.current = viewOnly;
  }, [viewOnly]);
  React.useEffect(() => {
    readableAutoScrollKeyRef.current = null;
    hostRef.current?.scrollTo({ left: 0, top: 0 });
  }, [fitMode, wsUrl]);

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
  const sendInput = React.useCallback((payload: InputPayload): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (payload.type !== 'viewport' && viewOnlyRef.current) return false;
    try {
      ws.send(JSON.stringify({ type: 'input', payload }));
      return true;
    } catch {
      /* socket closing in this tick — drop */
      return false;
    }
  }, []);

  const lastViewportRef = React.useRef<BrowserViewportSize | null>(null);
  const [connectionEpoch, setConnectionEpoch] = React.useState(0);
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== 'connected') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = (): void => {
      const rect = host.getBoundingClientRect();
      const next = browserViewportForHost({
        hostWidth: rect.width,
        hostHeight: rect.height,
      });
      if (!next || !shouldSendBrowserViewport(lastViewportRef.current, next)) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (
          sendInput({ type: 'viewport', width: next.width, height: next.height })
        ) {
          lastViewportRef.current = next;
        }
      }, 100);
    };
    publish();
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(publish);
    ro?.observe(host);
    window.addEventListener('resize', publish);
    return () => {
      if (timer) clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener('resize', publish);
    };
  }, [connectionEpoch, sendInput, status, wsUrl]);
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
        fitMode === 'readable'
          ? placeScreencastReadableTop
          : placeScreencastContainTop;
      const placement = place({
        hostWidth: rect.width,
        hostHeight: rect.height,
        sourceWidth: srcW,
        sourceHeight: srcH,
      });
      if (!placement) return;
      // Keep the remote page pinned to the top. Portrait readable
      // mode may make wide desktop pages horizontally scrollable, so
      // center the first view on the readable region and recompute it
      // when the host changes size.
      canvas.style.setProperty('--hd-scale', String(placement.scale));
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
  }, [fitMode, status, wsUrl]);

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
  // The viewport tears down only on unmount or `wsUrl` change
  // (e.g. user logged out, switched accounts).
  React.useEffect(() => {
    if (!wsUrl) {
      setStatus('idle');
      return;
    }
    let disposed = false;
    let attempt = 0;
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
      attempt += 1;
      setStatus('connecting');
      const ws = new WebSocket(wsUrl!);
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        attempt = 0; // reset backoff on a successful connect
        lastViewportRef.current = null;
        setConnectionEpoch((epoch) => epoch + 1);
        setStatus('connected');
        hdDebug('screencast WS', {
          event: 'open',
          readyState: ws.readyState,
          attempt,
        });
      };
      ws.onmessage = (event) => {
        if (disposed) return;
        let msg: { type?: string; data?: string; url?: string } | null = null;
        try {
          msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
        } catch {
          return; // swallow malformed
        }
        if (!msg) return;
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
        drawFrame(msg.data);
      };
      ws.onerror = () => {
        if (disposed) return;
        hdDebug('screencast WS', {
          event: 'error',
          readyState: ws.readyState,
          attempt,
        });
        setStatus('error');
      };
      ws.onclose = (event) => {
        if (disposed) return;
        hdDebug('screencast WS', {
          event: 'close',
          readyState: ws.readyState,
          attempt,
          code: event.code,
          reason: event.reason || '(none)',
        });
        setStatus('disconnected');
        // Backoff: doubles up to a 5 s ceiling, then stays at 5 s
        // forever. Browser hibernation is the expected steady state;
        // the viewport keeps trying so a wake (task submit, manual
        // wake button) attaches within 5 s without any external
        // trigger.
        const delay = Math.min(5_000, 500 * 2 ** Math.min(attempt - 1, 4));
        retryTimer = setTimeout(() => connect(), delay);
      };
    }

    connect();

    return () => {
      disposed = true;
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
    };
  }, [wsUrl]);

  // Decode a base64 JPEG and paint into the canvas. The img +
  // canvas are reused; canvas is resized to match the source so the
  // `object-contain` style on the host element handles letterboxing.
  function drawFrame(base64: string): void {
    if (!imgRef.current) imgRef.current = new Image();
    const img = imgRef.current;
    const frameSeq = ++frameSeqRef.current;
    img.onload = () => {
      if (!mountedRef.current || frameSeq !== frameSeqRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const sizeChanged =
        canvas.width !== img.width || canvas.height !== img.height;
      if (canvas.width !== img.width) canvas.width = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      // A new renderer can emit one frame at its startup size before the
      // saved viewport is reapplied. Recompute immediately so that frame is
      // still contained without affecting the surrounding flex layout.
      if (sizeChanged) sourceDimsRecomputeRef.current?.();
      requestAnimationFrame(() => sourceDimsRecomputeRef.current?.());
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  }

  /** Map a DOM mouse event's clientX/Y to canvas-pixel space. */
  function getCoords(e: React.MouseEvent | React.WheelEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
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

  // Mouse handlers
  const onMouseMove = (e: React.MouseEvent) => {
    if (viewOnly) return;
    const { x, y } = getCoords(e);
    sendInput({ type: 'mouseMove', x, y });
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (viewOnly) return;
    retainScreencastInputFocus({
      event: e,
      input: hiddenInputRef.current,
    });
    const { x, y } = getCoords(e);
    sendInput({
      type: 'mouseDown',
      x,
      y,
      button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
      clickCount: e.detail || 1,
    });
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (viewOnly) return;
    const { x, y } = getCoords(e);
    sendInput({
      type: 'mouseUp',
      x,
      y,
      button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
      clickCount: e.detail || 1,
    });
  };
  const onWheel = (e: React.WheelEvent) => {
    if (viewOnly) return;
    e.preventDefault();
    const { x, y } = getCoords(e);
    sendInput({ type: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
  };

  // Keyboard handlers — fire on the hidden input so the canvas
  // doesn't fight the browser for default-action handling.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    // Don't preventDefault on Tab — that lets the user escape the
    // capture if focus gets stuck.
    if (e.key !== 'Tab') e.preventDefault();
    sendInput({
      type: 'keyDown',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    });
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    if (e.key !== 'Tab') e.preventDefault();
    sendInput({
      type: 'keyUp',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    });
  };
  // CJK / IME — composition end carries the composed string.
  // We send insertText, NOT a sequence of keys, so the IME's
  // candidate selection lands verbatim in Brave's focused element.
  const onCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    const text = e.data;
    if (text) sendInput({ type: 'insertText', text });
    // Clear the hidden input so the next composition starts fresh.
    if (hiddenInputRef.current) hiddenInputRef.current.value = '';
  };
  // Catch-all for non-composition typing into the hidden input
  // (e.g. paste). Forward as insertText too.
  const onHiddenInputInput = (e: React.FormEvent<HTMLInputElement>) => {
    if (viewOnly) return;
    // composition events fire `onInput` mid-composition — ignore
    // those (the keyDown/keyUp + final compositionend cover it).
    const native = e.nativeEvent as InputEvent;
    if (native.isComposing) return;
    const target = e.currentTarget;
    if (target.value) {
      sendInput({ type: 'insertText', text: target.value });
      target.value = '';
    }
  };

  return (
    <div
      ref={hostRef}
      className={cn(
        'cdp-screencast-host relative h-full w-full min-h-0 min-w-0',
        fitMode === 'readable' ? 'overflow-auto' : 'overflow-hidden',
        className,
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
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        /* Absolute positioning keeps a transient source-frame size from
         * expanding the surrounding flex columns during a resize or renderer
         * swap. The host remains the layout authority. */
        className="absolute left-0 top-0 block origin-top-left will-change-transform"
        style={{
          cursor: viewOnly ? 'default' : 'crosshair',
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
        onCompositionEnd={onCompositionEnd}
        onInput={onHiddenInputInput}
        aria-hidden="true"
        tabIndex={-1}
        className="absolute h-px w-px opacity-0"
        style={{ pointerEvents: 'none', top: 0, left: 0 }}
      />
    </div>
  );
}
