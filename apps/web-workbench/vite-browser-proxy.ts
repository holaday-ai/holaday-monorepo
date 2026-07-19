/**
 * Browser streams are upgraded by the orchestrator HTTP server, not the
 * task-event WebSocket server. Keep the default coupled to the API target so
 * local and custom dev environments cannot silently split the two routes.
 */
export function resolveBrowserStreamProxyTarget(
  apiProxyTarget: string,
  explicitTarget?: string,
): string {
  const override = explicitTarget?.trim();
  if (override) return override;

  const target = new URL(apiProxyTarget);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  return target.toString().replace(/\/$/, '');
}
