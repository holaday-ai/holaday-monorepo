import { describe, expect, it } from 'vitest';
import {
  ENERGY_GAME_IDS,
  ENERGY_POLL_IDS,
  ENERGY_PRACTICE_IDS,
  isEnergyContentTarget,
  targetCompletionKind,
} from './energy-content-target';

describe('energy content targets', () => {
  it('accepts only known target ids and bounded target shapes', () => {
    expect(isEnergyContentTarget({ type: 'practice', practiceId: 'breath-window' })).toBe(true);
    expect(isEnergyContentTarget({ type: 'poll', pollId: 'break-style' })).toBe(true);
    expect(isEnergyContentTarget({ type: 'test', testId: 'work-focus' })).toBe(true);
    expect(isEnergyContentTarget({ type: 'tarot', mode: 'three', theme: 'uplift' })).toBe(true);
    expect(isEnergyContentTarget({ type: 'game', gameId: 'color-memory' })).toBe(true);
    expect(isEnergyContentTarget({ type: 'astrology', period: 'weekly' })).toBe(true);
    expect(isEnergyContentTarget({ type: 'astrology-signs' })).toBe(true);

    expect(isEnergyContentTarget({ type: 'practice', practiceId: 'unknown' })).toBe(false);
    expect(isEnergyContentTarget({ type: 'test', testId: 'private free text' })).toBe(false);
    expect(isEnergyContentTarget({ type: 'tarot', mode: 'three', question: 'private' })).toBe(false);
    expect(isEnergyContentTarget({ type: 'astrology', period: 'tomorrow' })).toBe(false);
  });

  it('maps targets to their honest growth kind without treating polls as completion', () => {
    expect(targetCompletionKind({ type: 'practice', practiceId: 'five-senses' })).toBe('recharge');
    expect(targetCompletionKind({ type: 'test', testId: 'emotion-battery' })).toBe('test');
    expect(targetCompletionKind({ type: 'tarot', mode: 'single' })).toBe('tarot');
    expect(targetCompletionKind({ type: 'game', gameId: 'catch-energy' })).toBe('game');
    expect(targetCompletionKind({ type: 'astrology', period: 'yearly' })).toBe('horoscope');
    expect(targetCompletionKind({ type: 'poll', pollId: 'break-style' })).toBeNull();
    expect(ENERGY_PRACTICE_IDS).toHaveLength(6);
    expect(ENERGY_POLL_IDS).toHaveLength(4);
    expect(ENERGY_GAME_IDS).toHaveLength(3);
  });
});
