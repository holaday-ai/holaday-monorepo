/**
 * Build-time orchestrator endpoints. Resolution order (first match wins):
 *
 *   1. Explicit env override (VITE_ORCHESTRATOR_*) — set in a build
 *      .env file or on the `vite build` command line.
 *   2. Vite-mode-aware default:
 *        production build → prod endpoints (hd-app.orangebench.tech)
 *        development build → localhost endpoints (PoC dev setup)
 *
 * Phase 25b fix: the previous default was UNCONDITIONALLY localhost,
 * so a `pnpm --filter @holaday/extension build` (production mode) shipped
 * an extension that tried to talk to 127.0.0.1:3001 / 3002. Users in
 * Chrome saw WS connection-refused on every reconnect attempt. The
 * mode-aware default means the standard build command produces a
 * working production extension without needing an .env file.
 *
 * Override is still respected for staging / non-default routes — set
 * VITE_ORCHESTRATOR_HTTP/WS at build time to override.
 *
 * Nginx layout on prod (from reference_deploy.md): /api/ + /trpc/ → 4001,
 * /ws → 4002. The HTTP base is the bare origin (fetches append /trpc/...).
 * The WS URL points at the /ws path which nginx strips before forwarding.
 */
const IS_PROD = import.meta.env.PROD;

const PROD_HTTP = 'https://hd-app.orangebench.tech';
const PROD_WS = 'wss://hd-app.orangebench.tech/ws';
const DEV_HTTP = 'http://127.0.0.1:3001';
const DEV_WS = 'ws://127.0.0.1:3002';

export const ORCHESTRATOR_HTTP =
  import.meta.env.VITE_ORCHESTRATOR_HTTP ?? (IS_PROD ? PROD_HTTP : DEV_HTTP);

export const ORCHESTRATOR_WS =
  import.meta.env.VITE_ORCHESTRATOR_WS ?? (IS_PROD ? PROD_WS : DEV_WS);

/**
 * Phase 25b — the canonical web URL the extension's popup directs
 * users to when they need to log in. The auth-bridge content script
 * runs there + on hd-app.orangebench.tech + on localhost; opening
 * any one of them lets the user log in and have the token auto-sync
 * back to the extension.
 *
 * Default: hd-app.orangebench.tech (Aliyun route, works in China).
 * Override via env when shipping a public-build to holaday.ai.
 */
export const WORKBENCH_URL =
  import.meta.env.VITE_WORKBENCH_URL ?? 'https://hd-app.orangebench.tech/';
