const TRUSTED_APP_HOSTS = new Set([
  'holaday.ai',
  'www.holaday.ai',
  'app.holaday.ai',
  'hd-app.orangebench.tech',
]);

function relativeDownloadPath(raw: string): string | null {
  if (/^\/api\/files\/[^/?#]+\/download(?:[?#].*)?$/u.test(raw)) return raw;
  if (/^\/files\/[^/?#]+\/download(?:[?#].*)?$/u.test(raw)) return `/api${raw}`;
  return null;
}

/**
 * Attachment links are rendered through the current SPA origin so auth headers,
 * proxy routing, and download behavior stay consistent across production hosts.
 */
export function normaliseAttachmentDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const relative = relativeDownloadPath(trimmed);
  if (relative) return relative;

  let absolute: URL;
  try {
    absolute = new URL(trimmed);
  } catch {
    return null;
  }

  const hostname = absolute.hostname.toLowerCase();
  const currentHostname =
    typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase();
  const localHttp =
    absolute.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  const trustedHttps =
    absolute.protocol === 'https:' &&
    (TRUSTED_APP_HOSTS.has(hostname) || (currentHostname !== '' && hostname === currentHostname));

  if (!localHttp && !trustedHttps) return null;
  return relativeDownloadPath(`${absolute.pathname}${absolute.search}${absolute.hash}`);
}
