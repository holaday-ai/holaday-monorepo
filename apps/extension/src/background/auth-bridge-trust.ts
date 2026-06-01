/**
 * Phase 25b — sender-trust check for the auth-bridge content-script
 * message.
 *
 * The content script (apps/extension/src/content/auth-bridge.ts) is
 * configured in manifest.config.ts to load ONLY on workbench origins,
 * but content scripts in our extension that happen to live on other
 * pages could in principle send messages of the same type. Defense-
 * in-depth: gate the SW message handler on the sender's URL.
 *
 * Pure function so it can be unit-tested without spinning up the SW.
 * The handler in background/index.ts re-exports a wrapper that calls
 * this with `sender.url` from the chrome.runtime.onMessage callback.
 *
 * Trust criteria (must match the manifest's content_scripts.matches):
 *   - holaday.ai apex
 *   - any *.holaday.ai subdomain (staging, marketing, etc.)
 *   - hd-app.orangebench.tech (China route)
 *   - localhost / 127.0.0.1 (dev)
 *
 * Falsy / malformed URLs are untrusted.
 */
export function isTrustedAuthBridgeSender(senderUrl: string | undefined): boolean {
  if (!senderUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(senderUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'holaday.ai' || host.endsWith('.holaday.ai')) return true;
  if (host === 'hd-app.orangebench.tech') return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return false;
}
