import { describe, expect, it } from 'vitest';
import * as fit from './screencast-fit';

describe('V2 full frame placement and reversible coordinates', () => {
  it('contains every edge in portrait and landscape panels', () => {
    for (const hostWidth of [390, 430, 760, 1440]) {
      for (const sourceWidth of [320, 430, 1280, 1600]) {
        const p = fit.placeScreencastContainTop({
          hostWidth,
          hostHeight: 760,
          sourceWidth,
          sourceHeight: 900,
        });
        if (!p) throw new Error('expected valid contained placement');
        expect(p.offsetX + p.width).toBeLessThanOrEqual(hostWidth);
        expect(p.height).toBeLessThanOrEqual(760);
      }
    }
  });
  // REBUILD-4: the page keeps its fixed 1280x800 layout; the frame is scaled into any panel.
  it('scales the fixed 1280x800 page into phone, side-panel and wide panels without cropping', () => {
    for (const [hostWidth, hostHeight] of [
      [380, 690],
      [599, 835],
      [1440, 800],
    ]) {
      const p = fit.placeScreencastContainTop({
        hostWidth,
        hostHeight,
        sourceWidth: 1280,
        sourceHeight: 800,
      });
      if (!p) throw new Error('expected valid frame placement');
      expect(p.offsetX + p.width).toBeLessThanOrEqual(hostWidth + 0.5);
      expect(p.height).toBeLessThanOrEqual(hostHeight + 0.5);
      expect(Math.abs(p.width / p.height - 1280 / 800)).toBeLessThan(0.01);
    }
  });
  it('maps displayed image coordinates to CSS independently of image resolution, DPR, local zoom and pan', () => {
    for (const imageWidth of [800, 1440, 1600, 3200])
      for (const zoom of [0.8, 1, 1.25, 2]) {
        const f = {
          frameId: '1',
          tabId: 'tab',
          viewportRevision: 2,
          cssWidth: 1600,
          cssHeight: 900,
          imageWidth,
          imageHeight: (imageWidth * 900) / 1600,
          pageScaleFactor: zoom,
          offsetTop: 0,
          scrollOffset: { x: 123, y: 456 },
          capturedAt: 1,
        };
        const rect = { left: -73, top: 41, width: 390 * zoom, height: (390 * zoom * 900) / 1600 };
        const p = fit.mapClientPointToBrowserFrame({
          clientX: rect.left + (rect.width * 850) / 1600,
          clientY: rect.top + (rect.height * 245) / 900,
          rect,
          frame: f,
        });
        if (!p) throw new Error('expected valid mapped point');
        expect(p.x).toBeCloseTo(850 / zoom, 6);
        expect(p.y).toBeCloseTo(245 / zoom, 6);
        expect(
          fit.mapClientPointToBrowserFrame({
            clientX: rect.left - 1,
            clientY: rect.top,
            rect,
            frame: f,
          }),
        ).toBeNull();
      }
  });
  it('uses framebuffer geometry separately for VNC', () => {
    expect(
      fit.mapClientPointToFramebuffer({
        clientX: 250,
        clientY: 150,
        rect: { left: 10, top: 30, width: 480, height: 270 },
        width: 1920,
        height: 1080,
      }),
    ).toEqual({ x: 960, y: 480 });
  });
});
