import * as React from 'react';
import {
  placeScreencastReadableTop,
  readableScreencastAutoScrollKey,
  readableScreencastStartScrollLeft,
} from '@/lib/screencast-fit';
import { cn } from '@/lib/utils';

// @novnc/novnc's lib/util/browser.js uses top-level await (for
// WebCodecs capability detection), which Rollup's CJS resolver
// rejects at static-import time. Dynamic import routes the module
// through Vite's dep pre-bundler (esbuild), which handles TLA cleanly
// and emits a plain ESM chunk. The trade-off: first RFB construction
// waits on one extra network fetch for the chunk — about 120 KB
// gzipped, loaded after the rest of the app is interactive.
let rfbCtorPromise: Promise<RFBCtor> | null = null;
function loadRFB(): Promise<RFBCtor> {
  if (!rfbCtorPromise) {
    // @ts-expect-error — no bundled types; typed via RFBCtor below.
    rfbCtorPromise = import('@novnc/novnc/lib/rfb.js').then(
      (mod: { default?: unknown }) => (mod.default ?? mod) as unknown as RFBCtor,
    );
  }
  return rfbCtorPromise;
}

/**
 * Minimal type surface of the noVNC RFB class. We only touch the
 * properties and events the viewport actually uses — adding more here
 * is a one-liner when we reach for a new capability (clipboard, power,
 * etc.).
 */
interface RFBInstance {
  scaleViewport: boolean;
  resizeSession: boolean;
  viewOnly: boolean;
  background: string;
  addEventListener: (name: 'connect' | 'disconnect' | 'credentialsrequired' | 'securityfailure', handler: (ev: Event) => void) => void;
  removeEventListener: (name: 'connect' | 'disconnect' | 'credentialsrequired' | 'securityfailure', handler: (ev: Event) => void) => void;
  disconnect: () => void;
  sendCredentials: (creds: { username?: string; password?: string }) => void;
}

type RFBCtor = new (
  target: HTMLElement,
  url: string,
  options?: { credentials?: { password?: string } },
) => RFBInstance;

interface Props {
  /** WebSocket URL to the VNC bridge. Absolute (`wss://host/vnc/websockify`)
   *  or relative-to-page — noVNC handles either. Null disables the viewport. */
  wsUrl: string | null;
  /** View-only mode — input events are NOT forwarded to the remote server. */
  viewOnly?: boolean;
  /** Optional VNC password if the server requires one. Usually null — our
   *  x11vnc runs with `-nopw` and the only auth is the nginx path. */
  password?: string | null;
  /** Called whenever the RFB connection state flips. Lets the parent
   *  show "connecting…" / retry banners without reaching inside. */
  onStatusChange?: (status: VncStatus) => void;
  fitMode?: 'contain' | 'readable';
  className?: string;
}

export type VncStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * noVNC live viewport. Mounts an empty `<div>` and hands it to
 * `new RFB(...)` — noVNC inserts its own canvas inside and takes over
 * rendering + input. The component manages:
 *
 *   - **One-shot construction per (wsUrl, password) pair**: effect runs
 *     when the target URL changes; the prior RFB is disconnected first.
 *   - **Unmount cleanup**: RFB.disconnect() releases the socket + DOM.
 *   - **Status reporting**: upstream banners decide whether to show
 *     "连接中" / "已断开" / "连接错误" — the component itself stays
 *     chrome-free so it fits HOLA DAY's glass aesthetic.
 *
 * Explicitly NOT using `iframe http(s)://.../vnc.html` — that ships
 * noVNC's default settings bar + connect modal that look nothing like
 * the rest of the workbench. RFB + our own overlay is the only way to
 * hold the design budget.
 */
export function VncViewport({
  wsUrl,
  viewOnly = false,
  password = null,
  onStatusChange,
  fitMode = 'contain',
  className,
}: Props): JSX.Element {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const targetRef = React.useRef<HTMLDivElement | null>(null);
  const rfbRef = React.useRef<RFBInstance | null>(null);
  const onStatusChangeRef = React.useRef(onStatusChange);
  const readableAutoScrollKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  // Ref mirror of viewOnly so the async RFB construction can read
  // the current value without caring about stale closures.
  const viewOnlyRef = React.useRef(viewOnly);
  // Exponential-backoff reconnect. Bumped whenever RFB emits a
  // 'disconnect' event; the main effect's deps include this value so
  // bumping re-runs the effect with a fresh WebSocket. Rest stays at
  // 0 when the connection is healthy.
  const [reconnectEpoch, setReconnectEpoch] = React.useState(0);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Attempt count scoped to the current gap — resets to 0 on every
  // 'connect' event so a fresh disconnect starts backoff over.
  const attemptRef = React.useRef(0);

  // Main effect: construct RFB when wsUrl / password change. Do NOT
  // include `viewOnly` in deps — flipping it should never rebuild the
  // WebSocket. The secondary effect below syncs viewOnly live.
  React.useEffect(() => {
    const emitStatus = (status: VncStatus): void => {
      onStatusChangeRef.current?.(status);
    };
    if (!wsUrl) {
      emitStatus('idle');
      return;
    }
    const target = targetRef.current;
    if (!target) return;

    emitStatus('connecting');
    let disposed = false;

    let rfb: RFBInstance | null = null;
    const onConnect = () => {
      if (disposed) return;
      attemptRef.current = 0;
      emitStatus('connected');
    };
    const onDisconnect = () => {
      if (disposed) return;
      emitStatus('disconnected');
      // Schedule an auto-reconnect with exponential backoff. Attempt
      // 1 → 500ms, 2 → 1s, 3 → 2s, ... capped at 30s. Keeps retrying
      // indefinitely; user tearing down the component disposes the
      // timer via the cleanup return.
      attemptRef.current += 1;
      const delay = Math.min(30_000, 500 * 2 ** (attemptRef.current - 1));
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (disposed) return;
        setReconnectEpoch((n) => n + 1);
      }, delay);
    };
    const onError = () => {
      if (disposed) return;
      emitStatus('error');
    };

    loadRFB()
      .then((Ctor) => {
        if (disposed || !targetRef.current) return;
        try {
          rfb = new Ctor(
            targetRef.current,
            wsUrl,
            password ? { credentials: { password } } : undefined,
          );
        } catch (err) {
          console.warn('[VncViewport] RFB construct threw', err);
          emitStatus('error');
          return;
        }
        // Panel UX tuning:
        //   scaleViewport=true   — noVNC fits the canvas to the
        //                          container via CSS transform without
        //                          resizing the remote X session.
        //   resizeSession=false  — we don't own the remote display
        //                          geometry; Xvfb :98 is sized by
        //                          holaday-chromium-headed start.sh.
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        // Read viewOnly off the current prop at construction time.
        // Later flips are handled by the secondary effect.
        rfb.viewOnly = viewOnlyRef.current;
        rfb.background = 'transparent';
        rfb.addEventListener('connect', onConnect);
        rfb.addEventListener('disconnect', onDisconnect);
        rfb.addEventListener('securityfailure', onError);
        rfbRef.current = rfb;
      })
      .catch((err) => {
        if (disposed) return;
        console.warn('[VncViewport] noVNC chunk load failed', err);
        emitStatus('error');
      });

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (rfb) {
        rfb.removeEventListener('connect', onConnect);
        rfb.removeEventListener('disconnect', onDisconnect);
        rfb.removeEventListener('securityfailure', onError);
        try {
          rfb.disconnect();
        } catch {
          // noVNC sometimes throws on disconnect if the socket's
          // already dead. Swallow — the component is going away.
        }
      }
      rfbRef.current = null;
    };
    // Deliberate: `viewOnly` is NOT in deps — we'd otherwise tear
    // down the socket every time the user toggles interactive mode.
    // `reconnectEpoch` IS — bumping it forces a fresh RFB with the
    // same wsUrl, which is how auto-reconnect lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl, password, reconnectEpoch]);

  React.useEffect(() => {
    viewOnlyRef.current = viewOnly;
    const rfb = rfbRef.current;
    if (rfb) rfb.viewOnly = viewOnly;
  }, [viewOnly]);

  const recomputeReadableFrame = React.useCallback((): void => {
    const viewport = viewportRef.current;
    const target = targetRef.current;
    if (!viewport || !target) return;

    if (fitMode !== 'readable') {
      target.style.width = '100%';
      target.style.height = '100%';
      target.style.marginLeft = '';
      target.style.marginRight = '';
      readableAutoScrollKeyRef.current = null;
      return;
    }

    const canvas = target.querySelector('canvas');
    const sourceWidth = canvas?.width ?? 0;
    const sourceHeight = canvas?.height ?? 0;
    const rect = viewport.getBoundingClientRect();
    if (sourceWidth <= 0 || sourceHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const placement = placeScreencastReadableTop({
      hostWidth: rect.width,
      hostHeight: rect.height,
      sourceWidth,
      sourceHeight,
    });
    if (!placement) return;

    target.style.width = `${placement.width}px`;
    target.style.height = `${placement.height}px`;
    target.style.marginLeft =
      placement.width < rect.width ? `${placement.offsetX}px` : '0px';
    target.style.marginRight =
      placement.width < rect.width ? `${placement.offsetX}px` : '0px';

    const key = readableScreencastAutoScrollKey({
      frameKey: `${wsUrl ?? 'none'}:${sourceWidth}x${sourceHeight}`,
      hostWidth: rect.width,
      hostHeight: rect.height,
      contentWidth: placement.width,
      viewMode: fitMode,
    });
    if (viewOnlyRef.current && readableAutoScrollKeyRef.current !== key) {
      readableAutoScrollKeyRef.current = key;
      viewport.scrollTo({
        left: readableScreencastStartScrollLeft({
          contentWidth: placement.width,
          hostWidth: rect.width,
        }),
        top: 0,
      });
    }
  }, [fitMode, wsUrl]);

  // Re-trigger noVNC's scale calculation whenever the container
  // resizes. noVNC only recomputes on window 'resize' and on
  // `scaleViewport` setter writes — Panel drag-resize changes our
  // container bounding box without firing window resize, so without
  // this ResizeObserver the remote frame stays at whatever size it
  // was when the first 'resize' happened (usually fullscreen at
  // mount), and the canvas overflows or letterboxes.
  //
  // Toggling scaleViewport from true to true writes to the setter,
  // which is exactly what triggers the internal _resize(). That's a
  // documented pattern in noVNC issues.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    const target = targetRef.current;
    if (!viewport || !target || typeof ResizeObserver === 'undefined') return;
    // noVNC's internal _resize is async; the canvas recomputes its
    // transform but can land on the prior container box if we're
    // mid-drag. We fire twice — once on the raw observer tick and
    // again after a rAF+timeout — so the final scale always reflects
    // the settled container width. Without the second pass users
    // see the right edge of the viewport clipped during drag resize.
    let raf = 0;
    let t = 0;
    let mutationTimer = 0;
    const forceScale = () => {
      recomputeReadableFrame();
      const rfb = rfbRef.current;
      if (rfb) rfb.scaleViewport = true;
    };
    const ro = new ResizeObserver(() => {
      forceScale();
      cancelAnimationFrame(raf);
      clearTimeout(t);
      raf = requestAnimationFrame(() => {
        t = window.setTimeout(() => {
          forceScale();
        }, 120);
      });
    });
    ro.observe(viewport);
    ro.observe(target);
    const mo = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(forceScale, 0);
    });
    mo.observe(target, { childList: true, subtree: true });
    forceScale();
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(t);
      clearTimeout(mutationTimer);
    };
  }, [recomputeReadableFrame]);

  return (
    <div
      ref={viewportRef}
      data-fit-mode={fitMode}
      // `min-h-0 min-w-0` — needed so this div can SHRINK inside a
      // flex parent; without them the intrinsic size of the canvas
      // child would push the parent wider than intended, defeating
      // the whole draggable-split layout.
      // `overflow-hidden` — canvas has fixed intrinsic dimensions
      // (remote Xvfb geometry), and without overflow clipping a
      // brief sizing gap at mount shows a full 1920x1080 canvas
      // bleeding out of the panel.
      className={cn(
        'vnc-viewport-host relative h-full w-full min-h-0 min-w-0',
        fitMode === 'readable' ? 'overflow-auto' : 'overflow-hidden',
        className,
      )}
    >
      <div
        ref={targetRef}
        className="vnc-viewport-target relative h-full w-full min-h-0 min-w-0"
      />
    </div>
  );
}
