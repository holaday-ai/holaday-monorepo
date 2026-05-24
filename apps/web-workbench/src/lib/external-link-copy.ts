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
