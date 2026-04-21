import { describe, expect, it } from 'vitest';
import {
  type AntiBotSignal,
  describeSignal,
  detectAntiBot,
  detectFromError,
  detectFromSnapshot,
} from './anti-bot-detector.js';

describe('detectFromError — high-confidence signals', () => {
  const HIGH: Array<[string, AntiBotSignal['type']]> = [
    ['Just a moment...', 'cloudflare'],
    ['Checking your browser before accessing', 'cloudflare'],
    ['<title>Cloudflare</title> 403', 'cloudflare'],
    ['locator timeout on recaptcha iframe', 'captcha'],
    ['hCaptcha challenge not completed', 'captcha'],
    ['captcha required', 'captcha'],
    ['geetest validation failed', 'captcha'],
    ['请先拖动滑块完成验证', 'captcha'],
    ['页面要求人机验证', 'captcha'],
    ['请完成验证后继续', 'verify'],
    ['请完成安全验证', 'verify'],
    ['access denied (you are blocked)', 'block'],
    ['HTTP 403 Forbidden', 'block'],
    ['blocked by security policy', 'block'],
    ['your IP has been blocked', 'block'],
  ];
  for (const [text, expected] of HIGH) {
    it(`"${text.slice(0, 40)}" → ${expected} (high)`, () => {
      const sig = detectFromError(text);
      expect(sig?.type).toBe(expected);
      expect(sig?.confidence).toBe('high');
    });
  }
});

describe('detectFromError — medium-confidence signals', () => {
  it('"verify" alone → medium', () => {
    const sig = detectFromError('Please verify your email address.');
    expect(sig?.type).toBe('verify');
    expect(sig?.confidence).toBe('medium');
  });

  it('"验证码" → medium', () => {
    expect(detectFromError('验证码已过期')?.confidence).toBe('medium');
  });

  it('"开启读屏标签" (Douyin overlay) → verify/medium', () => {
    const sig = detectFromError('clickByRoleName: 开启读屏标签');
    expect(sig?.type).toBe('verify');
    expect(sig?.confidence).toBe('medium');
  });
});

describe('detectFromError — negative cases', () => {
  const NEGATIVE = [
    '',
    'network error: ECONNREFUSED',
    'click failed: element not visible',
    'typing 5 characters into textbox',
    'page.goto timed out after 15000ms',
  ];
  for (const text of NEGATIVE) {
    it(`"${text}" → null`, () => {
      expect(detectFromError(text)).toBeNull();
    });
  }
});

describe('detectFromSnapshot', () => {
  it('detects reCAPTCHA text in a snapshot', () => {
    const snap = `- button "I'm not a robot" [ref=e4]\n- iframe /recaptcha/api2`;
    const sig = detectFromSnapshot(snap);
    expect(sig?.type).toBe('captcha');
  });

  it('detects Cloudflare interstitial', () => {
    expect(detectFromSnapshot('- heading "Just a moment"')?.type).toBe('cloudflare');
  });

  it('returns null for a normal snapshot', () => {
    const snap = `- heading "百度一下" [level=1]\n- textbox "搜索" [ref=e5]`;
    expect(detectFromSnapshot(snap)).toBeNull();
  });
});

describe('detectAntiBot — error + snapshot combination', () => {
  it('high-confidence error trumps medium-confidence snapshot', () => {
    const sig = detectAntiBot({
      errorMessage: 'Cloudflare protection triggered',
      snapshotText: '- button "Verify email"',
    });
    expect(sig?.type).toBe('cloudflare');
    expect(sig?.confidence).toBe('high');
  });

  it('high-confidence snapshot used when error is absent', () => {
    const sig = detectAntiBot({
      errorMessage: null,
      snapshotText: '- iframe /recaptcha/api2',
    });
    expect(sig?.type).toBe('captcha');
    expect(sig?.confidence).toBe('high');
  });

  it('no signal when both sources are clean', () => {
    expect(
      detectAntiBot({
        errorMessage: 'ECONNRESET',
        snapshotText: '- heading "Welcome"',
      }),
    ).toBeNull();
  });

  it('error signal wins on confidence tie', () => {
    const sig = detectAntiBot({
      errorMessage: 'verify yourself',
      snapshotText: '- button "Verify"',
    });
    // Both are medium; error path is checked first.
    expect(sig?.confidence).toBe('medium');
  });
});

describe('describeSignal', () => {
  it('returns distinct Chinese labels per kind', () => {
    const rawMatch = 'x';
    expect(
      describeSignal({ type: 'captcha', confidence: 'high', rawMatch }),
    ).toMatch(/验证码/);
    expect(describeSignal({ type: 'verify', confidence: 'high', rawMatch })).toMatch(/人机/);
    expect(describeSignal({ type: 'block', confidence: 'high', rawMatch })).toMatch(/拦截/);
    expect(
      describeSignal({ type: 'cloudflare', confidence: 'high', rawMatch }),
    ).toMatch(/Cloudflare/);
  });
});
