export interface SearchSourceLink {
  href: string;
  domain: string;
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
    };
  } catch {
    return null;
  }
}
