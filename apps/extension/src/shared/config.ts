/**
 * Build-time orchestrator endpoint. Override per-environment via Vite envs:
 *   VITE_ORCHESTRATOR_HTTP=https://api.holaday.local
 *   VITE_ORCHESTRATOR_WS=wss://api.holaday.local/ws
 */
export const ORCHESTRATOR_HTTP = import.meta.env.VITE_ORCHESTRATOR_HTTP ?? 'http://127.0.0.1:3001';

export const ORCHESTRATOR_WS = import.meta.env.VITE_ORCHESTRATOR_WS ?? 'ws://127.0.0.1:3002';

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
