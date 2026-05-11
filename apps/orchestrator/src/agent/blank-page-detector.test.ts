import { describe, expect, it, vi } from 'vitest';

import { detectBlankPage } from './blank-page-detector.js';

interface FakePage {
  evaluate: ReturnType<typeof vi.fn>;
}

function pageWithDiagnostics(d: {
  textLength: number;
  images: number;
  iframes: number;
  inputs: number;
  buttons: number;
}): FakePage {
  return {
    evaluate: vi.fn(async () => d),
  };
}

describe('detectBlankPage', () => {
  it('chrome-error page (no text, no images, no inputs, no buttons) → blank', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 0,
      images: 0,
      iframes: 0,
      inputs: 0,
      buttons: 0,
    }));
    expect(r.blank).toBe(true);
    expect(r.reason).toContain('几乎无内容');
  });

  it('empty SPA shell (only an empty root div) → blank', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 3, // brand initial maybe
      images: 0,
      iframes: 0,
      inputs: 0,
      buttons: 0,
    }));
    expect(r.blank).toBe(true);
  });

  it('example.com — "Example Domain" h1 + paragraphs → NOT blank', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      // "Example Domain\nThis domain is for use in illustrative..." — way over 10 chars
      textLength: 200,
      images: 0,
      iframes: 0,
      inputs: 0,
      buttons: 0,
    }));
    expect(r.blank).toBe(false);
  });

  it('login page (minimal text but has form inputs) → NOT blank', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 5, // just "登录"
      images: 0,
      iframes: 0,
      inputs: 3, // username / password / captcha
      buttons: 1, // submit
    }));
    expect(r.blank).toBe(false);
  });

  it('page with an image but no text → NOT blank (image carrier)', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 0,
      images: 5,
      iframes: 0,
      inputs: 0,
      buttons: 0,
    }));
    expect(r.blank).toBe(false);
  });

  it('iframe-only page → NOT blank', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 0,
      images: 0,
      iframes: 1,
      inputs: 0,
      buttons: 0,
    }));
    expect(r.blank).toBe(false);
  });

  it('text just under floor (9 chars) + no media → blank (boundary)', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 9,
      images: 0,
      iframes: 0,
      inputs: 0,
      buttons: 0,
    }));
    expect(r.blank).toBe(true);
  });

  it('text at floor (10 chars) + no media → NOT blank (strict <)', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 10,
      images: 0,
      iframes: 0,
      inputs: 0,
      buttons: 0,
    }));
    expect(r.blank).toBe(false);
  });

  it('evaluate throws → returns { blank: false } (false-negative preferred)', async () => {
    const page: FakePage = {
      evaluate: vi.fn(async () => {
        throw new Error('frame detached');
      }),
    };
    const r = await detectBlankPage(page);
    expect(r.blank).toBe(false);
    expect(r.diagnostics.textLength).toBe(-1);
  });

  it('all signals zero EXCEPT one button → NOT blank', async () => {
    const r = await detectBlankPage(pageWithDiagnostics({
      textLength: 0,
      images: 0,
      iframes: 0,
      inputs: 0,
      buttons: 1,
    }));
    expect(r.blank).toBe(false);
  });
});
