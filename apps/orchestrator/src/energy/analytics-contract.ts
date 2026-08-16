import { z } from 'zod';

const eventId = z.string().uuid().optional();
const eventIdField = { eventId };

export const energyNeed = z.enum(['focus', 'relax', 'confidence', 'uplift']);
export const energyDurationBucket = z.enum([
  'under-60s',
  'one-to-three-minutes',
  'over-three-minutes',
]);
export const energyOutcome = z.enum(['success', 'abandoned', 'error']);

export const lightTestId = z.enum([
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

export const experienceModeId = z.enum([
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

export const energyContentId = z.enum([
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

export const energyTargetType = z.enum([
  'practice',
  'poll',
  'test',
  'tarot',
  'game',
  'astrology',
  'astrology-signs',
]);

const completionKind = z.enum(['recharge', 'tarot', 'game', 'test', 'horoscope']);

const legacyEnergyExperienceEventInput = z
  .object({
    ...eventIdField,
    type: z.enum(['started', 'completed', 'replayed', 'failed']),
    experienceId: z.enum(['recharge', 'tarot', 'light-test', 'horoscope', 'games']),
    energyNeed: energyNeed.nullable(),
    durationBucket: energyDurationBucket.nullable(),
    outcome: energyOutcome.nullable(),
  })
  .strict();

const energyContentHubEventInput = z.discriminatedUnion('type', [
  z.object({ ...eventIdField, type: z.literal('energy_home_viewed') }).strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('energy_need_selected'),
      energyNeed,
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('energy_section_viewed'),
      section: z.enum(['hero', 'experiences', 'astrology', 'feed']),
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('astrology_range_opened'),
      range: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('tarot_mode_started'),
      mode: z.enum(['single', 'yes-no', 'three']),
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('tarot_redrawn'),
      mode: z.enum(['single', 'yes-no', 'three']),
    })
    .strict(),
  z
    .object({ ...eventIdField, type: z.literal('light_test_started'), testId: lightTestId })
    .strict(),
  z
    .object({ ...eventIdField, type: z.literal('light_test_completed'), testId: lightTestId })
    .strict(),
  z.object({ ...eventIdField, type: z.literal('energy_feed_refreshed') }).strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('energy_content_opened'),
      contentId: energyContentId,
      targetType: energyTargetType.optional(),
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.enum([
        'energy_experience_started',
        'energy_experience_replayed',
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
      energyNeed: energyNeed.nullable(),
      durationBucket: energyDurationBucket.nullable(),
      outcome: energyOutcome.nullable(),
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('energy_continuation_opened'),
      fromKind: completionKind.nullable(),
      targetType: energyTargetType,
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('energy_feed_exhausted'),
      energyNeed,
      batchCount: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('energy_section_navigated'),
      section: z.enum(['recharge', 'play', 'astrology', 'today-content']),
    })
    .strict(),
  z
    .object({
      ...eventIdField,
      type: z.literal('running_task_returned'),
      taskStatus: z.enum(['running', 'waiting', 'completed', 'failed', 'multiple']),
    })
    .strict(),
]);

export const energyEventInput = z.union([
  legacyEnergyExperienceEventInput,
  energyContentHubEventInput,
]);

export type EnergyEventInput = z.infer<typeof energyEventInput>;
