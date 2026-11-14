/**
 * The stable CDP screencast WebSocket URL for a route argument (`tsk_…` task, legacy user id, or
 * BROWSER-HOME-1 `bhs_<userId>`). Credentials are not part of it: the viewport sends the
 * short-lived stream token (lib/use-stream-token.ts, which only names the user) when it connects.
 */
export function buildScreencastWsUrl(routeArg: string | null | undefined): string | null {
  if (typeof window === 'undefined' || !routeArg) return null;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/screencast-ws/${encodeURIComponent(routeArg)}`;
}
