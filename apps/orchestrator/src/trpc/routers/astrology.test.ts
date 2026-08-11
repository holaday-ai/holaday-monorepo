import { describe, expect, it } from 'vitest';
import { astrologyRouter } from './astrology.js';

describe('astrology router', () => {
  it('exposes daily, weekly, daily tarot, and on-demand yes/no tarot procedures', () => {
    expect(Object.keys(astrologyRouter._def.procedures)).toEqual(
      expect.arrayContaining(['daily', 'weekly', 'tarot', 'yesNoTarot']),
    );
  });
});
