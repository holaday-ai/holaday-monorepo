/**
 * Build-time orchestrator endpoint. Override per-environment via Vite envs:
 *   VITE_ORCHESTRATOR_HTTP=https://api.holaday.local
 *   VITE_ORCHESTRATOR_WS=wss://api.holaday.local/ws
 */
export const ORCHESTRATOR_HTTP = import.meta.env.VITE_ORCHESTRATOR_HTTP ?? 'http://127.0.0.1:3001';

export const ORCHESTRATOR_WS = import.meta.env.VITE_ORCHESTRATOR_WS ?? 'ws://127.0.0.1:3002';
