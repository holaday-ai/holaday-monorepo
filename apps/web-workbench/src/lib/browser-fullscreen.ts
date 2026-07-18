export type BrowserFullscreenMode = 'native' | 'fallback';

export interface FullscreenDocumentLike {
  fullscreenElement: Element | null;
  exitFullscreen?: () => Promise<void>;
}

export function isBrowserFullscreenActive(
  documentLike: Pick<FullscreenDocumentLike, 'fullscreenElement'>,
  target: HTMLElement | null,
): boolean {
  const fullscreenElement = documentLike.fullscreenElement;
  if (!target || !fullscreenElement) return false;
  return fullscreenElement === target || target.contains(fullscreenElement);
}

export async function enterBrowserFullscreen(
  target: HTMLElement | null,
): Promise<BrowserFullscreenMode> {
  if (!target || typeof target.requestFullscreen !== 'function') return 'fallback';
  try {
    await target.requestFullscreen({ navigationUI: 'hide' });
    return 'native';
  } catch {
    return 'fallback';
  }
}

export async function exitBrowserFullscreen(
  documentLike: FullscreenDocumentLike,
  target: HTMLElement | null,
): Promise<void> {
  if (
    !isBrowserFullscreenActive(documentLike, target) ||
    typeof documentLike.exitFullscreen !== 'function'
  ) {
    return;
  }
  try {
    await documentLike.exitFullscreen();
  } catch {
    // The layout state still exits even if the browser already ended fullscreen.
  }
}
