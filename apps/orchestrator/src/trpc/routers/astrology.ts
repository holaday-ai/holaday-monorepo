import { z } from 'zod';
import { buildDailyAstrologyReading, hasAstrologyApiCredentials } from '../../astrology/service.js';
import { getFeatureFlags } from '../../execution/feature-flags.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const zodiacSignSchema = z.enum([
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
]);

const profileInputSchema = z.object({
  name: z.string().trim().max(128).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthTime: z.string().trim().max(16).optional(),
  birthPlace: z.string().trim().max(128).optional(),
  zodiacSign: zodiacSignSchema.optional(),
  locale: z.string().trim().max(16).optional(),
});

export const astrologyRouter = router({
  status: publicProcedure.query(() => {
    const flags = getFeatureFlags();
    const apiConfigured = hasAstrologyApiCredentials();
    return {
      enabled: flags.ASTROLOGY,
      provider: apiConfigured ? 'astrologyapi' : 'mock',
      apiConfigured,
    };
  }),
  daily: protectedProcedure.input(profileInputSchema).query(({ input }) =>
    buildDailyAstrologyReading(input),
  ),
});
