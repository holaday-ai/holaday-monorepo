import { describe, expect, it } from 'vitest';
import { RESULT_SOURCE_BADGES, matchResultSourceBadgePrefix } from './result-source-badges';

describe('result-source-badges', () => {
  it('matches bracketed source markers and removes the marker from visible text', () => {
    expect(matchResultSourceBadgePrefix('[系统计算] 转化率环比提升 12%')).toEqual({
      marker: '[系统计算]',
      rest: '转化率环比提升 12%',
    });
  });

  it('maps legacy color markers without leaking the raw marker', () => {
    expect(matchResultSourceBadgePrefix('🔴 来自竞品官网')).toEqual({
      marker: '[外部来源]',
      rest: '来自竞品官网',
    });
  });

  it('keeps result badge tones inside the Holaday brand palette', () => {
    const tones = Object.values(RESULT_SOURCE_BADGES).map((badge) => badge.tone).join(' ');

    expect(tones).toContain('#EA1F59');
    expect(tones).toContain('#57479C');
    expect(tones).toContain('#42C0EF');
    expect(tones).toContain('#FFC910');
    expect(tones).not.toMatch(/\b(cyan|green|red|emerald|lime)-/);
  });
});
