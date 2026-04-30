import * as React from 'react';
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
  className,
}: Props): JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = React.useRef<HTMLInputElement>(null);
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

  // ---- WS lifecycle ----
  React.useEffect(() => {
    if (!wsUrl) {
      setStatus('idle');
      return;
    }
    setStatus('connecting');
    let disposed = false;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (disposed) return;
      setStatus('connected');
    };
    ws.onmessage = (event) => {
      if (disposed) return;
      let msg: { type?: string; data?: string } | null = null;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return; // swallow malformed
      }
      if (!msg || msg.type !== 'frame' || typeof msg.data !== 'string') return;
      drawFrame(msg.data);
    };
    ws.onerror = () => {
      if (disposed) return;
      setStatus('error');
    };
    ws.onclose = () => {
      if (disposed) return;
      setStatus('disconnected');
    };

    return () => {
      disposed = true;
      try {
        ws.close();
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
