/**
 * Item 6 — short-lived JWT for screencast / VNC WebSocket auth.
 *
 * The orchestrator mints a 60-second token via POST /api/stream-token
 * (auth'd with the long-lived workbench JWT). The SPA swaps that
 * short token into the WS URL so failed-connect URLs in browser
 * console / shared screenshares only ever leak something that
 * expires in under a minute, instead of the 7-day session JWT.
 *
 * Refresh cadence: every 45s (15s safety margin under the 60s TTL).
 * The fetch is fire-and-forget — if it fails we keep the previous
 * token; the viewport's reconnect loop will retry. When token is
 * still null on first render the URL builders return null and the
 * viewports park in `idle` state until the token arrives.
 */

import * as React from 'react';
import { getAccessToken } from '@/lib/auth';
import { hdDebug } from '@/lib/hd-debug';

const REFRESH_MS = 45_000;

interface StreamTokenState {
  token: string | null;
  refresh: () => Promise<void>;
}

export function useStreamToken(enabled = true): StreamTokenState {
  const [token, setToken] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  const refresh = React.useCallback(async (): Promise<void> => {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    try {
      const res = await fetch('/api/stream-token', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      if (!res.ok) {
        hdDebug('stream-token fetch failed', { status: res.status });
        return;
      }
      const json = (await res.json()) as { token?: string };
      if (cancelledRef.current) return;
      if (typeof json.token === 'string' && json.token.length > 0) {
        setToken(json.token);
      }
    } catch (err) {
      hdDebug('stream-token fetch threw', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      cancelledRef.current = true;
      // Drop any token held while we were enabled — when the consumer
      // disables this hook (no active task), keeping a stale token in
      // state would feed URL builders that should now produce null.
      setToken(null);
      return;
    }
    cancelledRef.current = false;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);

  return { token, refresh };
}
