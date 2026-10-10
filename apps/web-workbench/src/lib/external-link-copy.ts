const MAX_EXTERNAL_LINK_DISPLAY = 96;

export function safeExternalHttpHref(href: string | null | undefined): string | null {
  const trimmed = href?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function externalLinkConfirmDescription(href: string): string {
  return `部分外部页面可能需要登录或无法正常访问。确认打开？\n\n${displayExternalHref(href)}`;
}

export function displayExternalHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return '未知链接';

  try {
    const parsed = new URL(trimmed);
    const queryHint = parsed.search ? '?…' : '';
    const base = `${parsed.origin}${parsed.pathname}${queryHint}${parsed.hash}`;
    return truncateMiddle(base, MAX_EXTERNAL_LINK_DISPLAY);
  } catch {
    return truncateMiddle(trimmed, MAX_EXTERNAL_LINK_DISPLAY);
  }
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const keepHead = Math.ceil((maxLength - 1) * 0.64);
  const keepTail = Math.floor((maxLength - 1) * 0.36);
  return `${value.slice(0, keepHead)}…${value.slice(-keepTail)}`;
}

// Deliberately narrow: trusted publisher hosts, HTTPS, no embedded credentials
// or redirect parameters. Unknown links retain the existing confirmation.
export function needsExternalLinkConfirmation(href: string): boolean {
  const safe = safeExternalHttpHref(href);
  if (!safe) return true;
  const url = new URL(safe);
  const publishers = ['eastmoney.com', 'cninfo.com.cn', 'sse.com.cn', 'szse.cn', 'gov.cn', 'holaday.ai'];
  return url.protocol !== 'https:' || Boolean(url.username || url.password) ||
    [...url.searchParams.keys()].some(key => /redirect|url|target|return|next|continue/i.test(key)) ||
    !publishers.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function openExternalLink(
  href: string,
  opener: (url: string, target: string, features: string) => unknown = window.open.bind(window),
): void {
  const safe = safeExternalHttpHref(href);
  if (safe) opener(safe, '_blank', 'noopener,noreferrer');
}
