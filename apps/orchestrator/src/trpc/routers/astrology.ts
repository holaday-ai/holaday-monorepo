import { z } from 'zod';
import {
  divineApiStatus,
  getAstrologyRanking,
  getDailyAstrologyReading,
  getDailyTarotReading,
  getMonthlyAstrologyReading,
  getWeeklyAstrologyReading,
  getYearlyAstrologyReading,
  getYesNoTarotReading,
} from '../../astrology/service.js';
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
  zodiacSignOverride: zodiacSignSchema.optional(),
  locale: z.string().trim().max(16).optional(),
});

export const astrologyRouter = router({
  status: publicProcedure.query(() => {
    const flags = getFeatureFlags();
    const providerStatus = divineApiStatus();
    return {
      enabled: flags.ASTROLOGY,
      ...providerStatus,
    };
  }),
  daily: protectedProcedure
    .input(profileInputSchema)
    .query(({ input }) => getDailyAstrologyReading(input)),
  weekly: protectedProcedure
    .input(profileInputSchema)
    .query(({ input }) => getWeeklyAstrologyReading(input)),
  monthly: protectedProcedure
    .input(profileInputSchema.extend({ month: z.enum(['current', 'next']).default('current') }))
    .query(({ input }) => getMonthlyAstrologyReading(input, input.month)),
  yearly: protectedProcedure
    .input(profileInputSchema)
    .query(({ input }) => getYearlyAstrologyReading(input)),
  ranking: protectedProcedure
    .input(z.object({ locale: z.string().trim().max(16).optional() }))
    .query(({ input }) => getAstrologyRanking(input.locale)),
  tarot: protectedProcedure
    .input(
      z.object({
        zodiacSign: zodiacSignSchema.optional(),
        locale: z.string().trim().max(16).optional(),
      }),
    )
    .query(({ input }) => getDailyTarotReading(input)),
  yesNoTarot: protectedProcedure
    .input(
      z.object({
        zodiacSign: zodiacSignSchema.optional(),
        locale: z.string().trim().max(16).optional(),
      }),
    )
    .query(({ input }) => getYesNoTarotReading(input)),
});
