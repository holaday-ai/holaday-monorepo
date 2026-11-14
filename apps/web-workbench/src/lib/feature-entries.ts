/**
 * HIDE-1 (BOSS 2026-11-13): 「A 股」and「今日能量」entries are hidden by default. The code stays;
 * a build with `VITE_FEATURE_ASHARE_ENTRY=true` / `VITE_FEATURE_DAILY_ENERGY_ENTRY=true` shows them
 * again. Only entries are hidden: an A-share question asked in a task still takes the usual route.
 */
import { isCosmicEnabled } from '@/lib/astrology';

type EntryEnv = Partial<
  Record<'VITE_FEATURE_ASHARE_ENTRY' | 'VITE_FEATURE_DAILY_ENERGY_ENTRY', string>
>;

function env(): EntryEnv {
  return import.meta.env as EntryEnv;
}

/** 股市任务 (/stocks, /stocks/discovery), the A-share skill card and the daily A-share briefing setting. */
export function isAshareEntryEnabled(source: EntryEnv = env()): boolean {
  return source.VITE_FEATURE_ASHARE_ENTRY === 'true';
}

/** 今日能量 (/cosmic, /cosmic-preview). Also off when the cosmic feature itself is off. */
export function isDailyEnergyEntryEnabled(source: EntryEnv = env()): boolean {
  return source.VITE_FEATURE_DAILY_ENERGY_ENTRY === 'true' && isCosmicEnabled();
}

/** Skills whose card is an A-share entry. */
export const ASHARE_ENTRY_SKILL_IDS: ReadonlySet<string> = new Set(['a-share-market-briefing']);

/** The skill list without the cards of hidden entries. */
export function withoutHiddenEntrySkills<T extends { id: string }>(
  skills: readonly T[],
  ashareEnabled = isAshareEntryEnabled(),
): T[] {
  return ashareEnabled
    ? [...skills]
    : skills.filter((skill) => !ASHARE_ENTRY_SKILL_IDS.has(skill.id));
}
