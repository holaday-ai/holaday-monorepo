import * as React from 'react';
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
  className,
}: Props): JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const rfbRef = React.useRef<RFBInstance | null>(null);

  React.useEffect(() => {
    if (!wsUrl) {
      onStatusChange?.('idle');
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    onStatusChange?.('connecting');
    let disposed = false;

    // The `RFB` ctor throws synchronously on bad URLs — wrap so the
    // effect never bubbles the error into React's reconciler. The
    // dynamic import itself can also reject (chunk failed to load on
    // flaky networks); treat that as an error state too.
    let rfb: RFBInstance | null = null;
    const onConnect = () => {
      if (disposed) return;
      onStatusChange?.('connected');
    };
    const onDisconnect = () => {
      if (disposed) return;
      onStatusChange?.('disconnected');
    };
    const onError = () => {
      if (disposed) return;
      onStatusChange?.('error');
    };

    loadRFB()
      .then((Ctor) => {
        if (disposed || !containerRef.current) return;
        try {
          rfb = new Ctor(
            containerRef.current,
            wsUrl,
            password ? { credentials: { password } } : undefined,
          );
        } catch (err) {
          console.warn('[VncViewport] RFB construct threw', err);
          onStatusChange?.('error');
          return;
        }
        // Panel UX tuning:
        //   scaleViewport=true   — scale canvas to fit our container
        //                          without resizing the remote X
        //                          session (which would flicker).
        //   resizeSession=false  — match scaleViewport; we don't own
        //                          the remote display geometry.
        //   background='transparent' — let our card surface color
        //                          show through when blank.
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.viewOnly = viewOnly;
        rfb.background = 'transparent';
        rfb.addEventListener('connect', onConnect);
        rfb.addEventListener('disconnect', onDisconnect);
        rfb.addEventListener('securityfailure', onError);
        rfbRef.current = rfb;
      })
      .catch((err) => {
        if (disposed) return;
        console.warn('[VncViewport] noVNC chunk load failed', err);
        onStatusChange?.('error');
      });

    return () => {
      disposed = true;
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
  }, [wsUrl, password, viewOnly, onStatusChange]);

  // Reflect live mode changes without tearing down the whole RFB.
  // Flipping viewOnly on an already-connected instance just gates input
  // forwarding on their end — cheap and flicker-free.
  React.useEffect(() => {
    const rfb = rfbRef.current;
    if (rfb) rfb.viewOnly = viewOnly;
  }, [viewOnly]);

  return (
    <div
      ref={containerRef}
      className={cn('h-full w-full', className)}
      // noVNC inserts a <canvas> as the only child; give it room to
      // breathe and keep our own layout chrome off of it.
    />
  );
}
