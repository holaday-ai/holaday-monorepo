import { describe, expect, it } from 'vitest';
import { fitDesktopViewportForHost } from './browser-workspace-viewport';
import {
  framePixelRatio,
  mapClientPointToBrowserFrame,
  mapClientPointToScreencast,
  placeScreencastActual,
  placeScreencastContainTop,
} from './screencast-fit';

describe('FIX-33 #4 · the task browser shows the whole page', () => {
  it('the remote page lays out at a desktop width shaped like the panel', () => {
    // A 599×835 panel (1280 window, chat open) — not a 599px-wide remote page.
    expect(fitDesktopViewportForHost({ hostWidth: 599, hostHeight: 835 })).toEqual({
      width: 1280,
      height: 1784,
    });
    expect(fitDesktopViewportForHost({ hostWidth: 1500, hostHeight: 900 })).toEqual({
      width: 1500,
      height: 900,
    });
    // FIX-34: a phone sheet gets a mobile viewport at its own size (scale ≈ 1).
    expect(fitDesktopViewportForHost({ hostWidth: 380, hostHeight: 684, mobile: true })).toEqual({
      width: 380,
      height: 684,
    });
    // A narrow desktop panel (1024 window) is still a desktop page.
    expect(fitDesktopViewportForHost({ hostWidth: 471, hostHeight: 835 })?.width).toBe(1280);
    expect(fitDesktopViewportForHost({ hostWidth: 300, hostHeight: 400, mobile: true })).toEqual({
      width: 320,
      height: 480,
    });
    expect(fitDesktopViewportForHost({ hostWidth: 0, hostHeight: 600 })).toBeNull();
  });

  it('fit keeps the aspect ratio and fills the panel width', () => {
    const placed = placeScreencastContainTop({
      hostWidth: 599,
      hostHeight: 835,
      sourceWidth: 2560,
      sourceHeight: 3568,
    });
    expect(placed?.width).toBe(599);
    expect(placed && placed.height <= 835).toBe(true);
    expect(placed && Math.abs(placed.width / placed.height - 2560 / 3568)).toBeLessThan(0.005);
  });

  it('100% shows one page CSS pixel per screen pixel', () => {
    expect(placeScreencastActual({ sourceWidth: 2560, sourceHeight: 1600, pixelRatio: 2 })).toEqual(
      { width: 1280, height: 800, scale: 0.5, offsetX: 0, offsetY: 0 },
    );
    expect(placeScreencastActual({ sourceWidth: 1280, sourceHeight: 800 })?.scale).toBe(1);
  });

  it('a takeover click on the scaled page maps to the same page point (v1 and v2)', () => {
    // 1280×800 frame drawn at 0.468 → a 599×374 rect at (681, 97); click at 90% / 50%.
    const rect = { left: 681, top: 97, width: 599, height: 374.375 };
    const clientX = rect.left + rect.width * 0.9;
    const clientY = rect.top + rect.height * 0.5;
    const v1 = mapClientPointToScreencast({
      clientX,
      clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      sourceWidth: 1280,
      sourceHeight: 800,
    });
    expect(v1.x).toBeCloseTo(1152, 0);
    expect(v1.y).toBeCloseTo(400, 0);
    const v2 = mapClientPointToBrowserFrame({
      clientX,
      clientY,
      rect: { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height } as DOMRect,
      frame: {
        frameId: 'f',
        tabId: 't',
        viewportRevision: 1,
        cssWidth: 1280,
        cssHeight: 800,
        imageWidth: 2560,
        imageHeight: 1600,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffset: { x: 0, y: 0 },
        capturedAt: Date.now(),
      },
    });
    expect(v2?.x).toBeCloseTo(1152, 0);
    expect(v2?.y).toBeCloseTo(400, 0);
  });

  it('FIX-34: 100% without v2 geometry treats a DPR-2 frame as 2× (drawn at half size)', () => {
    expect(framePixelRatio(2560, 1280)).toBe(2);
    expect(framePixelRatio(1280, 1280)).toBe(1);
    expect(framePixelRatio(1440)).toBe(1);
    expect(framePixelRatio(2880, 1440)).toBe(2);
    expect(
      placeScreencastActual({
        sourceWidth: 2560,
        sourceHeight: 1600,
        pixelRatio: framePixelRatio(2560),
      })?.width,
    ).toBe(1280);
  });
});
