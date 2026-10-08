import { describe, expect, it } from 'vitest';
import * as viewport from './browser-workspace-viewport';
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
  it('keeps desktop width until panel rendering is explicitly selected', () => {
    expect(
      viewport.browserViewportV2ForHost({ hostWidth: 390, hostHeight: 760, renderMode: 'desktop' }),
    ).toEqual({ width: 1280, height: 800 });
    expect(
      viewport.browserViewportV2ForHost({ hostWidth: 390, hostHeight: 760, renderMode: 'panel' }),
    ).toEqual({ width: 390, height: 760 });
    expect(
      viewport.browserViewportV2ForHost({ hostWidth: 1600, hostHeight: 900, renderMode: 'panel' }),
    ).toEqual({ width: 1600, height: 900 });
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
