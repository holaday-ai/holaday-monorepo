import type { Frame } from 'playwright-crx';

/** Exact origin authority, including documents inheriting their parent's origin. */
export function grantedFrameOrigin(frame: Frame, origins: readonly string[]): string {
  let current: Frame | null = frame;
  while (current && /^(about:blank|about:srcdoc)$/.test(current.url()))
    current = current.parentFrame();
  try {
    const url = new URL(current?.url() || '');
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      !origins.includes(url.origin)
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('origin_grant_required');
  }
}
