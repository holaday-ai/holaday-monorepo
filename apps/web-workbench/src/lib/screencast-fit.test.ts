import { describe, expect, it } from 'vitest';
import {
  centeredScreencastScrollLeft,
  fitScreencastContain,
  fitScreencastReadable,
  mapClientPointToScreencast,
  placeScreencastContainTop,
  placeScreencastReadableTop,
} from './screencast-fit';

describe('centeredScreencastScrollLeft', () => {
  it('centres wide readable browser content inside portrait sheets', () => {
    expect(
      centeredScreencastScrollLeft({
        contentWidth: 896,
        hostWidth: 540,
      }),
    ).toBe(178);
  });

  it('keeps non-overflowing browser content pinned to the start', () => {
    expect(
      centeredScreencastScrollLeft({
        contentWidth: 332,
        hostWidth: 390,
      }),
    ).toBe(0);
  });
});

describe('fitScreencastContain', () => {
  it('fits portrait browser frames into short landscape panels without overflow', () => {
    expect(
      fitScreencastContain({
        hostWidth: 560,
        hostHeight: 480,
        sourceWidth: 430,
        sourceHeight: 760,
      }),
    ).toEqual({ width: 271, height: 480, scale: 0.631578947368421 });
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

describe('fitScreencastReadable', () => {
  it('keeps desktop-only pages readable in portrait sheets', () => {
    expect(
      fitScreencastReadable({
        hostWidth: 540,
        hostHeight: 760,
        sourceWidth: 1280,
        sourceHeight: 800,
      }),
    ).toEqual({ width: 1049, height: 656, scale: 0.82 });
  });

  it('keeps normal portrait browser frames on contain sizing', () => {
    expect(
      fitScreencastReadable({
        hostWidth: 390,
        hostHeight: 720,
        sourceWidth: 390,
        sourceHeight: 844,
      }),
    ).toEqual({ width: 332, height: 720, scale: 0.8530805687203792 });
  });
});

describe('placeScreencastContainTop', () => {
  it('centres narrow frames horizontally but keeps them pinned to the top', () => {
    expect(
      placeScreencastContainTop({
        hostWidth: 560,
        hostHeight: 720,
        sourceWidth: 430,
        sourceHeight: 760,
      }),
    ).toEqual({
      width: 407,
      height: 720,
      scale: 0.9473684210526315,
      offsetX: 76.5,
      offsetY: 0,
    });
  });

  it('does not add vertical letterbox above wide desktop frames', () => {
    expect(
      placeScreencastContainTop({
        hostWidth: 560,
        hostHeight: 720,
        sourceWidth: 1280,
        sourceHeight: 800,
      }),
    ).toEqual({
      width: 560,
      height: 350,
      scale: 0.4375,
      offsetX: 0,
      offsetY: 0,
    });
  });
});

describe('placeScreencastReadableTop', () => {
  it('pins wide desktop frames to the top and lets portrait sheets scroll horizontally', () => {
    expect(
      placeScreencastReadableTop({
        hostWidth: 540,
        hostHeight: 760,
        sourceWidth: 1280,
        sourceHeight: 800,
      }),
    ).toEqual({
      width: 1049,
      height: 656,
      scale: 0.82,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('still centres portrait frames when they fit inside the sheet', () => {
    expect(
      placeScreencastReadableTop({
        hostWidth: 390,
        hostHeight: 720,
        sourceWidth: 390,
        sourceHeight: 844,
      }),
    ).toEqual({
      width: 332,
      height: 720,
      scale: 0.8530805687203792,
      offsetX: 29,
      offsetY: 0,
    });
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
        rectWidth: 271,
        rectHeight: 480,
        sourceWidth: 430,
        sourceHeight: 760,
      }),
    ).toEqual({ x: 286, y: 380 });
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
        sourceWidth: 430,
        sourceHeight: 760,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});
