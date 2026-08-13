import { z } from 'zod';
import { buildEnergyHome } from '../../energy/catalog.js';
import { protectedProcedure, router } from '../trpc.js';

const energyExperienceEventInput = z
  .object({
    type: z.enum(['started', 'completed', 'replayed', 'failed']),
    experienceId: z.enum(['recharge', 'tarot', 'light-test', 'horoscope', 'games']),
    energyNeed: z.enum(['focus', 'relax', 'confidence', 'uplift']).nullable(),
    durationBucket: z.enum(['under-60s', 'one-to-three-minutes', 'over-three-minutes']).nullable(),
    outcome: z.enum(['success', 'abandoned', 'error']).nullable(),
  })
  .strict();

const lightTestId = z.enum([
  'emotion-battery',
  'emotion-weather',
  'emotion-recovery',
  'stress-signal',
  'stress-rhythm',
  'stress-boundary',
  'work-start',
  'work-focus',
  'work-finish',
  'relationship-expression',
  'relationship-distance',
  'relationship-listening',
  'social-energy',
  'social-boundary',
  'social-recharge',
  'daily-number-action',
  'daily-number-relationship',
  'daily-number-rest',
]);
const experienceModeId = z.enum([
  'breath-window',
  'shoulder-release',
  'five-senses',
  'water-pause',
  'desk-reset',
  'distance-gaze',
  'break-style',
  'focus-sound',
  'small-reward',
  'social-battery',
  ...lightTestId.options,
  'single',
  'yes-no',
  'three',
  'catch-energy',
  'breath-rhythm',
  'color-memory',
]);
const energyContentId = z.enum([
  'relax-breath-window',
  'relax-shoulder-release',
  'relax-five-senses',
  'relax-water-pause',
  'relax-desk-reset',
  'relax-distance-gaze',
  'fortune-small-luck',
  'fortune-kind-reply',
  'fortune-open-window',
  'fortune-clear-choice',
  'fortune-slow-answer',
  'fortune-finish-line',
  'zodiac-fire-recharge',
  'zodiac-earth-rhythm',
  'zodiac-air-connection',
  'zodiac-water-boundary',
  'zodiac-sun-sign',
  'zodiac-periods',
  'relationship-reply-speed',
  'relationship-listen-or-solve',
  'relationship-space-signal',
  'relationship-small-invite',
  'poll-break-style',
  'poll-focus-sound',
  'poll-small-reward',
  'poll-social-battery',
  'test-recommend-emotion',
  'test-recommend-focus',
  'test-recommend-boundary',
  'test-recommend-social',
  'card-recommend-single',
  'card-recommend-yes-no',
  'card-recommend-three',
  'game-recommend-catch',
  'game-recommend-slow-round',
  'game-recommend-focus-round',
]);
const targetType = z.enum([
  'practice',
  'poll',
  'test',
  'tarot',
  'game',
  'astrology',
  'astrology-signs',
]);
const completionKind = z.enum(['recharge', 'tarot', 'game', 'test', 'horoscope']);
const energyContentHubEventInput = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('energy_section_viewed'),
      section: z.enum(['hero', 'experiences', 'astrology', 'feed']),
    })
    .strict(),
  z
    .object({
      type: z.literal('astrology_range_opened'),
      range: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    })
    .strict(),
  z
    .object({ type: z.literal('tarot_mode_started'), mode: z.enum(['single', 'yes-no', 'three']) })
    .strict(),
  z
    .object({ type: z.literal('tarot_redrawn'), mode: z.enum(['single', 'yes-no', 'three']) })
    .strict(),
  z.object({ type: z.literal('light_test_started'), testId: lightTestId }).strict(),
  z.object({ type: z.literal('light_test_completed'), testId: lightTestId }).strict(),
  z.object({ type: z.literal('energy_feed_refreshed') }).strict(),
  z
    .object({
      type: z.literal('energy_content_opened'),
      contentId: energyContentId,
      targetType: targetType.optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        'energy_experience_started',
        'energy_experience_completed',
        'energy_experience_failed',
      ]),
      experienceId: z.enum([
        'recharge',
        'practice',
        'poll',
        'tarot',
        'light-test',
        'horoscope',
        'games',
      ]),
      modeId: experienceModeId.nullable(),
      energyNeed: z.enum(['focus', 'relax', 'confidence', 'uplift']).nullable(),
      durationBucket: z
        .enum(['under-60s', 'one-to-three-minutes', 'over-three-minutes'])
        .nullable(),
      outcome: z.enum(['success', 'abandoned', 'error']).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('energy_continuation_opened'),
      fromKind: completionKind.nullable(),
      targetType,
    })
    .strict(),
  z
    .object({
      type: z.literal('energy_feed_exhausted'),
      energyNeed: z.enum(['focus', 'relax', 'confidence', 'uplift']),
      batchCount: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('energy_section_navigated'),
      section: z.enum(['recharge', 'play', 'astrology', 'today-content']),
    })
    .strict(),
  z
    .object({
      type: z.literal('running_task_returned'),
      taskStatus: z.enum(['running', 'waiting', 'completed', 'failed', 'multiple']),
    })
    .strict(),
]);

const energyEventInput = z.union([energyExperienceEventInput, energyContentHubEventInput]);

export const energyRouter = router({
  home: protectedProcedure.query(() => buildEnergyHome()),
  reportEvent: protectedProcedure.input(energyEventInput).mutation(({ ctx, input }) => {
    if (!('experienceId' in input)) {
      ctx.logger.info({ event: 'energy_content_hub_event', ...input }, 'energy content hub event');
      return { ok: true as const };
    }
    ctx.logger.info(
      {
        event: 'energy_experience_event',
        type: input.type,
        experienceId: input.experienceId,
        ...('modeId' in input ? { modeId: input.modeId } : {}),
        energyNeed: input.energyNeed,
        durationBucket: input.durationBucket,
        outcome: input.outcome,
      },
      'energy experience event',
    );

    return { ok: true as const };
  }),
});
