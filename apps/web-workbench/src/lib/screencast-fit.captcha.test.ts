import { describe, expect, it } from 'vitest';
import { CAPTCHA_ZOOM_MARGIN, placeScreencastCaptchaZoom } from './screencast-fit';

// A 1280×800 page captured at 1280×800; the reCAPTCHA grid at (100, 120), 400×580 CSS px.
const base = { sourceWidth: 1280, sourceHeight: 800, cssWidth: 1280 };
const box = { x: 100, y: 120, width: 400, height: 580 };
const shown = (p: { scale: number; offsetX: number; offsetY: number }, x: number, y: number) => ({
  x: p.offsetX + x * p.scale,
  y: p.offsetY + y * p.scale,
});

describe('CAPTCHA-UX-1 captcha zoom placement', () => {
  it('desktop: the box plus its margin fills the panel and sits in the middle', () => {
    const p = placeScreencastCaptchaZoom({ hostWidth: 900, hostHeight: 700, ...base, box })!;
    const m = CAPTCHA_ZOOM_MARGIN;
    expect(p.scale).toBeCloseTo(700 / (580 + 2 * m));
    const tl = shown(p, box.x - m, box.y - m);
    const br = shown(p, box.x + box.width + m, box.y + box.height + m);
    expect(tl.y).toBeCloseTo(0);
    expect(br.y).toBeCloseTo(700);
    expect((tl.x + br.x) / 2).toBeCloseTo(450);
    expect(p.scale).toBeGreaterThan(900 / 1280); // larger than the whole-page fit
  });
  it('phone: the box fills the width, top-aligned', () => {
    const p = placeScreencastCaptchaZoom({ hostWidth: 375, hostHeight: 700, ...base, box })!;
    const m = CAPTCHA_ZOOM_MARGIN;
    const tl = shown(p, box.x - m, box.y - m);
    const br = shown(p, box.x + box.width + m, box.y);
    expect(tl.x).toBeCloseTo(0);
    expect(br.x).toBeCloseTo(375);
    expect(tl.y).toBeCloseTo(0);
  });
  it('a device-scale capture (frame twice the CSS width) zooms on the same CSS box', () => {
    const p1 = placeScreencastCaptchaZoom({ hostWidth: 900, hostHeight: 700, ...base, box })!;
    const p2 = placeScreencastCaptchaZoom({
      hostWidth: 900,
      hostHeight: 700,
      sourceWidth: 2560,
      sourceHeight: 1600,
      cssWidth: 1280,
      box,
    })!;
    expect(shown(p2, (box.x + 10) * 2, (box.y + 10) * 2).x).toBeCloseTo(
      shown(p1, box.x + 10, box.y + 10).x,
    );
  });
  it('a small checkbox is not blown up past the cap; nothing to place without a box size', () => {
    const p = placeScreencastCaptchaZoom({
      hostWidth: 2000,
      hostHeight: 1500,
      ...base,
      box: { x: 10, y: 10, width: 60, height: 40 },
    })!;
    expect(p.scale).toBeLessThanOrEqual(6);
    expect(
      placeScreencastCaptchaZoom({
        hostWidth: 900,
        hostHeight: 700,
        ...base,
        box: { x: 0, y: 0, width: 0, height: 10 },
      }),
    ).toBeNull();
  });
});
