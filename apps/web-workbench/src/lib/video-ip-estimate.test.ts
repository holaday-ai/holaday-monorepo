import { describe, expect, it } from 'vitest';
import { estimateIpAudioSec, estimateIpRenderMinutes, ipRenderingHint } from './video-ip-estimate';

describe('estimateIpAudioSec — ~5 字/秒', () => {
  it('185 字 → ~37s (matches the real tsk_k88u ~35-37s)', () => {
    expect(estimateIpAudioSec('字'.repeat(185))).toBe(37);
  });
  it('floors at 1s, ignores surrounding whitespace', () => {
    expect(estimateIpAudioSec('')).toBe(1);
    expect(estimateIpAudioSec('   ')).toBe(1);
    expect(estimateIpAudioSec('  早睡早起  ')).toBe(1); // 4 字 → ceil(0.8)=1
  });
  it('counts CJK code points', () => {
    expect(estimateIpAudioSec('字'.repeat(50))).toBe(10); // 50/5
  });
});

describe('estimateIpRenderMinutes — ceil((audioSec×11+70)/60), 高估, floor 2', () => {
  it('185 字 → 8 分钟 (≥ actual ~7min: over-promises the wait)', () => {
    // audioSec=37 → 37*11+70=477 → ceil(477/60)=8
    expect(estimateIpRenderMinutes('字'.repeat(185))).toBe(8);
  });
  it('short clip floors at 2 分钟', () => {
    expect(estimateIpRenderMinutes('早睡早起身体好')).toBe(2); // 7字→2s→ceil(92/60)=2
    expect(estimateIpRenderMinutes('')).toBe(2);
  });
  it('mid clip rounds up', () => {
    // 100字 → audioSec=20 → 20*11+70=290 → ceil(290/60)=5
    expect(estimateIpRenderMinutes('字'.repeat(100))).toBe(5);
  });
  it('is monotonic non-decreasing in length', () => {
    let prev = 0;
    for (let n = 0; n <= 400; n += 40) {
      const v = estimateIpRenderMinutes('字'.repeat(n));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('ipRenderingHint', () => {
  it('renders the full Chinese hint with the estimate', () => {
    expect(ipRenderingHint('字'.repeat(185))).toBe('真人换口型较慢，预计约 8 分钟，请耐心等待。');
  });
});
