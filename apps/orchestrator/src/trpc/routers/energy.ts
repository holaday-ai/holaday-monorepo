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

const stableId = z.string().regex(/^[a-z0-9-]{1,64}$/);
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
  z.object({ type: z.literal('light_test_started'), testId: stableId }).strict(),
  z.object({ type: z.literal('light_test_completed'), testId: stableId }).strict(),
  z.object({ type: z.literal('energy_feed_refreshed') }).strict(),
  z
    .object({
      type: z.literal('energy_content_opened'),
      contentId: stableId,
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
      modeId: stableId.nullable(),
      energyNeed: z.enum(['focus', 'relax', 'confidence', 'uplift']).nullable(),
      durationBucket: z.enum(['under-60s', 'one-to-three-minutes', 'over-three-minutes']).nullable(),
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
        energyNeed: input.energyNeed,
        durationBucket: input.durationBucket,
        outcome: input.outcome,
      },
      'energy experience event',
    );

    return { ok: true as const };
  }),
});
