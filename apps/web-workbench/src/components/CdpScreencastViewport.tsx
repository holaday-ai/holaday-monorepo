import * as React from 'react';
import { hdDebug } from '@/lib/hd-debug';
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
    | 'insertText';
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
  viewOnly = true,
  onStatusChange,
  onUrlChange,
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
  /** Host <div> ref — ResizeObserver target for BUG-11 viewport sync. */
  const hostRef = React.useRef<HTMLDivElement>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  // Cached <img> + the most-recent JPEG src so the decode pipeline
  // doesn't re-allocate per frame. Image.decode() is async and
  // returns a promise — chaining via .then keeps frames in order
  // without blocking the WS receive loop.
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  // Throttled "viewOnly" reference so the keyDown handler reads
  // the latest value without re-attaching listeners on every flip.
  const viewOnlyRef = React.useRef(viewOnly);
  React.useEffect(() => {
    viewOnlyRef.current = viewOnly;
  }, [viewOnly]);

  const [status, setStatus] = React.useState<CdpScreencastStatus>('idle');
  const onStatusChangeRef = React.useRef(onStatusChange);
  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  React.useEffect(() => {
    onStatusChangeRef.current?.(status);
  }, [status]);

  // BUG-11 — compute + send the effective viewport. "Effective"
  // because the panel's flex-basis can be larger than the OS
  // window (BOSS drags panel to 533px → shrinks window to 390px →
  // panel is still 533px but clipped by the window). The user's
  // mental model is "what does this look like on screen", so we
  // use `min(panel.width, window.innerWidth)` as the canonical
  // width. < 500 → mobile emulation; ≥ 500 → desktop matching the
  // effective width. Memoised; duplicate signatures are no-ops.
  const lastSentSigRef = React.useRef<string | null>(null);
  const computeEffectiveDims = React.useCallback((): {
    width: number;
    height: number;
  } | null => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (typeof window === 'undefined') {
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }
    const w = Math.max(0, Math.round(Math.min(rect.width, window.innerWidth)));
    const h = Math.max(
      0,
      Math.round(Math.min(rect.height, window.innerHeight)),
    );
    return { width: w, height: h };
  }, []);
  const sendViewport = React.useCallback((): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const dims = computeEffectiveDims();
    if (!dims || dims.width === 0 || dims.height === 0) return;
    const mobile = dims.width < 500;
    const payload = mobile
      ? { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }
      : {
          width: dims.width,
          height: dims.height,
          deviceScaleFactor: 1,
          mobile: false,
        };
    const sig = `${payload.width}x${payload.height}@${payload.deviceScaleFactor}${payload.mobile ? 'm' : 'd'}`;
    if (lastSentSigRef.current === sig) return;
    lastSentSigRef.current = sig;
    try {
      ws.send(JSON.stringify({ type: 'viewport', payload }));
    } catch {
      /* socket closing — drop */
    }
  }, [computeEffectiveDims]);

  // Track viewport changes from THREE sources: ResizeObserver on
  // the host (panel-divider drag), window resize (OS window drag /
  // mobile rotate), and the WS open hook (initial sync). All
  // route through the same debounced flush so a flick that
  // triggers all three only sends one CDP override.
  React.useEffect(() => {
    if (status !== 'connected') return;
    const host = hostRef.current;
    if (!host) return;
    let timer: number | null = null;
    const flush = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        sendViewport();
        timer = null;
      }, 200);
    };
    // Initial flush — sync once on (re)attach.
    sendViewport();
    // ResizeObserver tracks panel-divider drags + layout changes
    // that don't touch the OS window (sidebar collapse, etc.).
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => flush());
      ro.observe(host);
    }
    // window resize: catches the case where the panel's flex-basis
    // is fixed but the OS window shrunk past it, so the effective
    // (visible) viewport is smaller than the panel container.
    const onWindowResize = () => flush();
    window.addEventListener('resize', onWindowResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [status, sendViewport]);

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
        setStatus('connected');
        hdDebug('screencast WS', {
          event: 'open',
          readyState: ws.readyState,
          attempt,
        });
        // BUG-11 — push the current effective viewport on connect.
        // The effect below also fires sendViewport on attach, but
        // doing it here too avoids a 200ms debounce delay on the
        // very first frame after WS open.
        sendViewport();
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
      if (retryTimer) clearTimeout(retryTimer);
      try {
        activeWs?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
    // sendViewport is stable (useCallback with deps that never
    // change) so adding it to deps would just clutter; we'd rather
    // not reconnect the WS if a future refactor accidentally makes
    // sendViewport unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // Decode a base64 JPEG and paint into the canvas. The img +
  // canvas are reused; canvas is resized to match the source so the
  // `object-contain` style on the host element handles letterboxing.
  function drawFrame(base64: string): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!imgRef.current) imgRef.current = new Image();
    const img = imgRef.current;
    img.onload = () => {
      if (canvas.width !== img.width) canvas.width = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  }

  // ---- Input dispatch helpers ----
  const sendInput = React.useCallback((payload: InputPayload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (viewOnlyRef.current) return;
    try {
      ws.send(JSON.stringify({ type: 'input', payload }));
    } catch {
      /* socket closing in this tick — drop */
    }
  }, []);

  // (sendViewport is defined earlier — before the WS effect — so
  // ws.onopen can call it without a TDZ issue.)

  /** Map a DOM mouse event's clientX/Y to canvas-pixel space. */
  function getCoords(e: React.MouseEvent | React.WheelEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  // Mouse handlers
  const onMouseMove = (e: React.MouseEvent) => {
    if (viewOnly) return;
    const { x, y } = getCoords(e);
    sendInput({ type: 'mouseMove', x, y });
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (viewOnly) return;
    // Focus the hidden input so subsequent keys + IME flow through us.
    hiddenInputRef.current?.focus();
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
        'cdp-screencast-host relative h-full w-full min-h-0 min-w-0 overflow-hidden',
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        className="block h-full w-full object-contain"
        style={{ cursor: viewOnly ? 'default' : 'crosshair' }}
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
