/**
 * HD-DEBUG instrumentation — gated on `import.meta.env.DEV` so prod
 * builds emit no console output. Vite tree-shakes the inner block
 * out at build time when the constant is false, so the production
 * bundle pays neither a string-literal nor a no-op call.
 *
 * Used by the streaming / screencast / WS code paths where BOSS
 * needs raw timeline traces during a live debug, but where the
 * volume would be noisy and PII-leaky in a logged-in customer's
 * console.
 */
const isDev: boolean = Boolean(import.meta.env.DEV);

export function hdDebug(label: string, payload?: Record<string, unknown>): void {
  if (!isDev) return;
  // biome-ignore lint/suspicious/noConsole: HD-DEBUG instrumentation
  if (payload === undefined) console.warn(`[HD-DEBUG] ${label}`);
  else console.warn(`[HD-DEBUG] ${label}`, payload);
}
