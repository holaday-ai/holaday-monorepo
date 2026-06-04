import { describe, expect, it } from 'vitest';
import {
  fitScreencastContain,
  mapClientPointToScreencast,
} from './screencast-fit';

describe('fitScreencastContain', () => {
  it('fits portrait browser frames into short landscape panels without overflow', () => {
    expect(
      fitScreencastContain({
        hostWidth: 560,
        hostHeight: 480,
        sourceWidth: 768,
        sourceHeight: 1024,
      }),
    ).toEqual({ width: 360, height: 480, scale: 0.46875 });
  });

  it('fits wide desktop frames into narrow side panels by width', () => {
    expect(
      fitScreencastContain({
        hostWidth: 300,
        hostHeight: 500,
        sourceWidth: 1280,
        sourceHeight: 800,
      }),
    ).toEqual({ width: 300, height: 187, scale: 0.234375 });
  });

  it('returns null for unmeasured hosts or frames', () => {
    expect(
      fitScreencastContain({
        hostWidth: 0,
        hostHeight: 500,
        sourceWidth: 1280,
        sourceHeight: 800,
      }),
    ).toBeNull();
  });
});

describe('mapClientPointToScreencast', () => {
  it('maps clicks from a scaled side-panel canvas back to source pixels', () => {
    expect(
      mapClientPointToScreencast({
        clientX: 280,
        clientY: 300,
        rectLeft: 100,
        rectTop: 60,
        rectWidth: 360,
        rectHeight: 480,
        sourceWidth: 768,
        sourceHeight: 1024,
      }),
    ).toEqual({ x: 384, y: 512 });
  });

  it('accounts for letterbox offsets in the transformed canvas rect', () => {
    expect(
      mapClientPointToScreencast({
        clientX: 205,
        clientY: 180,
        rectLeft: 100,
        rectTop: 80,
        rectWidth: 300,
        rectHeight: 187.5,
        sourceWidth: 1280,
        sourceHeight: 800,
      }),
    ).toEqual({ x: 448, y: 427 });
  });

  it('falls back to the origin for unmeasured canvas boxes', () => {
    expect(
      mapClientPointToScreencast({
        clientX: 10,
        clientY: 20,
        rectLeft: 0,
        rectTop: 0,
        rectWidth: 0,
        rectHeight: 480,
        sourceWidth: 768,
        sourceHeight: 1024,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});
