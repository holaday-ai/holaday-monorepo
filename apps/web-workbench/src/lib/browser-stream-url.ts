export function appendBrowserStreamToken(
  baseUrl: string | null,
  token: string | null,
): string | null {
  if (!baseUrl || !token) return null;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}
