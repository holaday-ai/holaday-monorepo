import { describe, expect, it } from 'vitest';
import { resolveEnergyContentTarget } from './content-target-controller';

describe('content target controller', () => {
  it('resolves an exact test target to the light-test player', () => {
    expect(resolveEnergyContentTarget({ type: 'test', testId: 'work-focus' })).toEqual({
      type: 'experience',
      experienceId: 'light-test',
      launchTarget: { type: 'test', testId: 'work-focus' },
    });
  });

  it('resolves target-only practice and poll players', () => {
    expect(resolveEnergyContentTarget({ type: 'practice', practiceId: 'desk-reset' })).toEqual({
      type: 'experience',
      experienceId: 'practice',
      launchTarget: { type: 'practice', practiceId: 'desk-reset' },
    });
    expect(resolveEnergyContentTarget({ type: 'poll', pollId: 'social-battery' })).toEqual({
      type: 'experience',
      experienceId: 'poll',
      launchTarget: { type: 'poll', pollId: 'social-battery' },
    });
  });

  it('keeps astrology periods and sign browsing as navigation commands', () => {
    expect(resolveEnergyContentTarget({ type: 'astrology', period: 'weekly' })).toEqual({
      type: 'astrology',
      period: 'weekly',
    });
    expect(resolveEnergyContentTarget({ type: 'astrology-signs' })).toEqual({
      type: 'astrology-signs',
    });
  });
});
