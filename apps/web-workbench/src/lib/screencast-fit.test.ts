import { describe, expect, it } from 'vitest';
import { fitScreencastContain } from './screencast-fit';

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
