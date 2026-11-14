import type { Page } from 'playwright';
/** Panel size affects display scaling, never the minimum cloud execution surface. */
export async function ensureExecutionViewport(page: Page): Promise<void> {
  const size = page.viewportSize();
  if (!size || size.width < 1280 || size.height < 800)
    await page.setViewportSize({
      width: Math.max(1280, size?.width ?? 1280),
      height: Math.max(800, size?.height ?? 800),
    });
}
