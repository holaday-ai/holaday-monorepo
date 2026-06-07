import { describe, expect, it } from 'vitest';
import {
  fitScreencastContain,
  fitScreencastReadable,
  mapClientPointToScreencast,
  placeScreencastContainTop,
  placeScreencastReadableTop,
  readableScreencastAutoScrollKey,
  readableScreencastStartScrollLeft,
} from './screencast-fit';

describe('readableScreencastStartScrollLeft', () => {
  it('opens wide readable browser content around the center in portrait sheets', () => {
    expect(
      readableScreencastStartScrollLeft({
        contentWidth: 896,
        hostWidth: 540,
      }),
    ).toBe(178);
  });

  it('keeps readable browser content pinned when it already fits', () => {
    expect(
      readableScreencastStartScrollLeft({
        contentWidth: 390,
        hostWidth: 540,
      }),
    ).toBe(0);
  });

  it('keeps invalid or unmeasured content pinned to the start', () => {
    expect(
      readableScreencastStartScrollLeft({
        contentWidth: 0,
        hostWidth: 540,
      }),
    ).toBe(0);
  });
});

describe('readableScreencastAutoScrollKey', () => {
  it('changes when the sheet geometry changes for the same browser frame', () => {
    const frameKey = 'frame-1';

    expect(
      readableScreencastAutoScrollKey({
        frameKey,
        hostWidth: 390,
        hostHeight: 720,
        contentWidth: 1152,
        viewMode: 'readable',
      }),
    ).not.toBe(
      readableScreencastAutoScrollKey({
        frameKey,
        hostWidth: 720,
        hostHeight: 390,
        contentWidth: 720,
        viewMode: 'readable',
      }),
    );
  });

  it('keeps invalid geometry keyed to the frame and mode', () => {
    expect(
      readableScreencastAutoScrollKey({
        frameKey: 'frame-1',
        hostWidth: 0,
        hostHeight: 720,
        contentWidth: 1152,
        viewMode: 'readable',
      }),
    ).toBe('readable:frame-1');
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
    ).toEqual({ width: 1216, height: 760, scale: 0.95 });
  });

  it('fills phone-height sheets instead of shrinking desktop pages to a tiny strip', () => {
    const contain = fitScreencastContain({
      hostWidth: 390,
      hostHeight: 720,
      sourceWidth: 1280,
      sourceHeight: 800,
    });
    const readable = fitScreencastReadable({
      hostWidth: 390,
      hostHeight: 720,
      sourceWidth: 1280,
      sourceHeight: 800,
    });

    expect(contain).toEqual({ width: 390, height: 243, scale: 0.3046875 });
    expect(readable).toEqual({ width: 1152, height: 720, scale: 0.9 });
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

  it('keeps portrait browser frames readable in short landscape sheets', () => {
    const contain = fitScreencastContain({
      hostWidth: 836,
      hostHeight: 260,
      sourceWidth: 390,
      sourceHeight: 844,
    });
    const readable = fitScreencastReadable({
      hostWidth: 836,
      hostHeight: 260,
      sourceWidth: 390,
      sourceHeight: 844,
    });

    expect(contain).toEqual({
      width: 120,
      height: 260,
      scale: 0.3080568720379147,
    });
    expect(readable).toEqual({ width: 390, height: 844, scale: 1 });
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
      width: 1216,
      height: 760,
      scale: 0.95,
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

  it('pins readable portrait frames in short landscape sheets for vertical scrolling', () => {
    expect(
      placeScreencastReadableTop({
        hostWidth: 836,
        hostHeight: 260,
        sourceWidth: 390,
        sourceHeight: 844,
      }),
    ).toEqual({
      width: 390,
      height: 844,
      scale: 1,
      offsetX: 223,
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
