import { describe, expect, it } from 'vitest';
import { astrologyRouter } from './astrology.js';

describe('astrology router', () => {
  it('exposes normalized period, ranking, and card procedures', () => {
    expect(Object.keys(astrologyRouter._def.procedures)).toEqual(
      expect.arrayContaining([
        'daily',
        'weekly',
        'monthly',
        'yearly',
        'ranking',
        'tarot',
        'yesNoTarot',
      ]),
    );
  });
});
