export interface SearchSourceLink {
  href: string;
  domain: string;
  pathLabel: string;
}

export function buildSearchSourceLink(url: string): SearchSourceLink | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname) return null;
    return {
      href: parsed.href,
      domain: parsed.hostname.replace(/^www\./, ''),
      pathLabel: sourcePathLabel(parsed),
    };
  } catch {
    return null;
  }
}

function sourcePathLabel(url: URL): string {
  const path = url.pathname.replace(/\/+$/g, '');
  if (!path || path === '/') return '首页';
  const segments = path
    .split('/')
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => safeDecode(segment))
    .map((segment) => segment.replace(/[-_]+/g, ' ').trim())
    .filter(Boolean);
  if (segments.length === 0) return '页面';
  const label = segments.join(' / ');
  return label.length > 42 ? `${label.slice(0, 39)}...` : label;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
