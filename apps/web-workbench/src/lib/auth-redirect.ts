export const DEFAULT_AUTH_REDIRECT = '/';

const AUTH_ENTRY_PATHS = new Set(['/login', '/register']);

export function authRedirectTarget(search: string | URLSearchParams): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = params.get('next')?.trim();
  if (!raw) return DEFAULT_AUTH_REDIRECT;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\n')) {
    return DEFAULT_AUTH_REDIRECT;
  }

  try {
    const parsed = new URL(raw, 'https://holaday.local');
    if (parsed.origin !== 'https://holaday.local') return DEFAULT_AUTH_REDIRECT;
    if (AUTH_ENTRY_PATHS.has(parsed.pathname)) return DEFAULT_AUTH_REDIRECT;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}
