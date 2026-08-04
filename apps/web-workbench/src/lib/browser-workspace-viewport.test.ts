import { describe, expect, it } from 'vitest';
import {
  browserViewportForHost,
  shouldSendBrowserViewport,
} from './browser-workspace-viewport';

describe('browser workspace viewport', () => {
  it('uses the actual browser canvas instead of a fixed desktop screenshot size', () => {
    expect(browserViewportForHost({ hostWidth: 612.4, hostHeight: 844.8 })).toEqual({
      width: 612,
      height: 845,
    });
  });

  it('clamps tiny and oversized canvases to supported remote browser limits', () => {
    expect(browserViewportForHost({ hostWidth: 120, hostHeight: 180 })).toEqual({
      width: 320,
      height: 360,
    });
    expect(browserViewportForHost({ hostWidth: 2400, hostHeight: 1800 })).toEqual({
      width: 1440,
      height: 1200,
    });
  });

  it('ignores invalid measurements and sub-pixel resize noise', () => {
    expect(browserViewportForHost({ hostWidth: 0, hostHeight: 800 })).toBeNull();
    expect(
      shouldSendBrowserViewport(
        { width: 612, height: 844 },
        { width: 616, height: 849 },
      ),
    ).toBe(false);
    expect(
      shouldSendBrowserViewport(
        { width: 612, height: 844 },
        { width: 680, height: 844 },
      ),
    ).toBe(true);
  });
});
