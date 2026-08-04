import { describe, expect, it, vi } from 'vitest';
import {
  enterBrowserFullscreen,
  exitBrowserFullscreen,
  isBrowserFullscreenActive,
} from './browser-fullscreen';

describe('browser fullscreen lifecycle', () => {
  it('uses the native fullscreen surface when the browser allows it', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const target = { requestFullscreen } as unknown as HTMLElement;

    await expect(enterBrowserFullscreen(target)).resolves.toBe('native');
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it('falls back to the in-app fullscreen layout when native fullscreen is unavailable', async () => {
    const missingApiTarget = {} as HTMLElement;
    const rejectedTarget = {
      requestFullscreen: vi.fn().mockRejectedValue(new Error('denied')),
    } as unknown as HTMLElement;

    await expect(enterBrowserFullscreen(missingApiTarget)).resolves.toBe('fallback');
    await expect(enterBrowserFullscreen(rejectedTarget)).resolves.toBe('fallback');
  });

  it('only exits the native surface owned by the browser workbench', async () => {
    const target = { contains: () => false } as unknown as HTMLElement;
    const other = {} as HTMLElement;
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);

    await exitBrowserFullscreen({ fullscreenElement: other, exitFullscreen }, target);
    expect(exitFullscreen).not.toHaveBeenCalled();

    await exitBrowserFullscreen({ fullscreenElement: target, exitFullscreen }, target);
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it('treats a nested fullscreen element as part of the browser surface', () => {
    const nested = {} as HTMLElement;
    const target = {
      contains: (node: Node | null) => node === nested,
    } as HTMLElement;

    expect(isBrowserFullscreenActive({ fullscreenElement: nested }, target)).toBe(true);
    expect(isBrowserFullscreenActive({ fullscreenElement: null }, target)).toBe(false);
  });
});
