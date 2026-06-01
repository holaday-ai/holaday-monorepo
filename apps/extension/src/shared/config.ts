/**
 * Build-time orchestrator endpoints. Resolution order (first match wins):
 *
 *   1. Explicit env override (VITE_ORCHESTRATOR_*) — set in a build
 *      .env file or on the `vite build` command line.
 *   2. Vite-mode-aware default:
 *        production build → prod endpoint (holaday.ai)
 *        development build → localhost endpoints (PoC dev setup)
 *
 * Phase 25b fix: the previous default was UNCONDITIONALLY localhost,
 * so `pnpm --filter @holaday/extension build` (production mode) shipped
 * an extension that tried to talk to 127.0.0.1:3001 / 3002.
 *
 * Phase 25b fix #2: ORCHESTRATOR_HTTP now includes the `/api` path
 * segment. The SPA's host (hd-app.orangebench.tech, Aliyun) ONLY
 * proxies the `/api/*` and `/ws` paths through to Vultr's orchestrator;
 * everything else falls back to the SPA shell. Without the `/api`
 * prefix, the extension's fetches hit `/trpc/...` and `/cookies/sync`
 * directly on Aliyun, got the SPA index.html back as text/html, and
 * JSON.parse threw downstream. With the prefix every endpoint resolves
 * via the existing `${ORCHESTRATOR_HTTP}/trpc/...` / `${ORCHESTRATOR_HTTP}/cookies/sync`
 * / `${ORCHESTRATOR_HTTP}/extension/browsing-history` call sites — no
 * changes needed at the fetch site.
 *
 * Why HTTP still defaults to hd-app while WS uses holaday.ai only:
 *   - hd-app.orangebench.tech remains the China-route HTTP/API entry.
 *   - holaday.ai is the steadier WebSocket entry for the extension.
 *     When hd-app has a transient WS proxy 502, Chrome records a noisy
 *     extension error.
 *   - Teams that need a different WS route can still ship an explicit
 *     VITE_ORCHESTRATOR_WS override; the production default avoids an
 *     automatic fallback to an endpoint that is known to emit 502s.
 *
 * Nginx behaviour (verified by curl 2026-05-16):
 *   /api/trpc/auth.me       → 401 JSON (proxied)
 *   /api/cookies/sync       → 401 JSON (proxied)
 *   /api/extension/...      → 401 JSON (proxied)
 *   /trpc/auth.me           → 200 HTML (SPA fallback) ← previously bug
 *   /ws                     → WS handshake → 4002 (proxied)
 */
const IS_PROD = import.meta.env.PROD;

const PROD_HTTP = 'https://hd-app.orangebench.tech/api';
const PROD_WS_ENDPOINTS = [
  'wss://holaday.ai/ws',
] as const;
const DEV_HTTP = 'http://127.0.0.1:3001';
const DEV_WS = 'ws://127.0.0.1:3002';

export const ORCHESTRATOR_HTTP =
  import.meta.env.VITE_ORCHESTRATOR_HTTP ?? (IS_PROD ? PROD_HTTP : DEV_HTTP);

export const ORCHESTRATOR_WS =
  import.meta.env.VITE_ORCHESTRATOR_WS ?? (IS_PROD ? PROD_WS_ENDPOINTS[0] : DEV_WS);

export const ORCHESTRATOR_WS_ENDPOINTS = import.meta.env.VITE_ORCHESTRATOR_WS
  ? [import.meta.env.VITE_ORCHESTRATOR_WS]
  : IS_PROD
    ? [...PROD_WS_ENDPOINTS]
    : [DEV_WS];

/**
 * Phase 25b — the canonical web URL the extension's popup directs
 * users to when they need to log in. The auth-bridge content script
 * runs there + on hd-app.orangebench.tech + on localhost; opening
 * any one of them lets the user log in and have the token auto-sync
 * back to the extension.
 *
 * Default: hd-app.orangebench.tech/app (Aliyun route, works in China).
 * Override via env when shipping a public-build to holaday.ai.
 */
export const WORKBENCH_URL =
  import.meta.env.VITE_WORKBENCH_URL ?? 'https://hd-app.orangebench.tech/app';
