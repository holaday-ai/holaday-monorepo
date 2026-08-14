import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
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

  it('accepts timezone boundaries and omission while rejecting invalid offsets', () => {
    const dailyInput = astrologyRouter._def.procedures.daily._def.inputs[0] as z.ZodType;
    const baseProfile = { birthday: '1996-03-21' };

    expect(dailyInput.parse(baseProfile)).toEqual(baseProfile);
    expect(dailyInput.parse({ ...baseProfile, timezoneOffsetMinutes: -720 })).toMatchObject({
      timezoneOffsetMinutes: -720,
    });
    expect(dailyInput.parse({ ...baseProfile, timezoneOffsetMinutes: 840 })).toMatchObject({
      timezoneOffsetMinutes: 840,
    });
    expect(() => dailyInput.parse({ ...baseProfile, timezoneOffsetMinutes: -721 })).toThrow();
    expect(() => dailyInput.parse({ ...baseProfile, timezoneOffsetMinutes: 841 })).toThrow();
    expect(() => dailyInput.parse({ ...baseProfile, timezoneOffsetMinutes: 330.5 })).toThrow();
  });
});
