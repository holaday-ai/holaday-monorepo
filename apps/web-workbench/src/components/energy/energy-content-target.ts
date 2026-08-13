import type { EnergyCompletionKind } from './energy-progress';
import type { EnergyAstrologyPeriod } from './energy-types';
import { REQUIRED_TEST_IDS, type LightTestId } from './experiences/test-content';
import type { HoladayCardTheme } from './experiences/energy-card-content';

export const ENERGY_PRACTICE_IDS = [
  'breath-window',
  'shoulder-release',
  'five-senses',
  'water-pause',
  'desk-reset',
  'distance-gaze',
] as const;
export type EnergyPracticeId = (typeof ENERGY_PRACTICE_IDS)[number];

export const ENERGY_POLL_IDS = [
  'break-style',
  'focus-sound',
  'small-reward',
  'social-battery',
] as const;
export type EnergyPollId = (typeof ENERGY_POLL_IDS)[number];

export const ENERGY_GAME_IDS = ['catch-energy', 'breath-rhythm', 'color-memory'] as const;
export type EnergyGameId = (typeof ENERGY_GAME_IDS)[number];

const TAROT_MODES = ['single', 'yes-no', 'three'] as const;
const CARD_THEMES = ['work', 'relationship', 'emotion', 'space', 'confidence', 'uplift'] as const;
const ASTROLOGY_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type EnergyContentTarget =
  | { type: 'practice'; practiceId: EnergyPracticeId }
  | { type: 'poll'; pollId: EnergyPollId }
  | { type: 'test'; testId: LightTestId }
  | { type: 'tarot'; mode: (typeof TAROT_MODES)[number]; theme?: HoladayCardTheme }
  | { type: 'game'; gameId: EnergyGameId }
  | { type: 'astrology'; period: EnergyAstrologyPeriod }
  | { type: 'astrology-signs' };

export type EnergyExperienceLaunchTarget = Extract<
  EnergyContentTarget,
  { type: 'practice' | 'poll' | 'test' | 'tarot' | 'game' }
>;

export function isEnergyContentTarget(value: unknown): value is EnergyContentTarget {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'practice':
      return hasOnlyKeys(value, ['type', 'practiceId']) && includes(ENERGY_PRACTICE_IDS, value.practiceId);
    case 'poll':
      return hasOnlyKeys(value, ['type', 'pollId']) && includes(ENERGY_POLL_IDS, value.pollId);
    case 'test':
      return hasOnlyKeys(value, ['type', 'testId']) && includes(REQUIRED_TEST_IDS, value.testId);
    case 'tarot':
      return (
        hasOnlyKeys(value, ['type', 'mode', 'theme']) &&
        includes(TAROT_MODES, value.mode) &&
        (value.theme === undefined || includes(CARD_THEMES, value.theme))
      );
    case 'game':
      return hasOnlyKeys(value, ['type', 'gameId']) && includes(ENERGY_GAME_IDS, value.gameId);
    case 'astrology':
      return hasOnlyKeys(value, ['type', 'period']) && includes(ASTROLOGY_PERIODS, value.period);
    case 'astrology-signs':
      return hasOnlyKeys(value, ['type']);
    default:
      return false;
  }
}

export function targetCompletionKind(
  target: EnergyContentTarget | null,
): EnergyCompletionKind | null {
  if (!target || target.type === 'poll') return null;
  if (target.type === 'practice') return 'recharge';
  if (target.type === 'tarot') return 'tarot';
  if (target.type === 'test') return 'test';
  if (target.type === 'game') return 'game';
  return 'horoscope';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}
