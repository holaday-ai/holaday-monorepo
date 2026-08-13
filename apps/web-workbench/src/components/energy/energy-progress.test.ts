// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completedKindsForDate,
  energyStreak,
  readEnergyProgress,
  recordEnergyCompletion,
  recordLightTestCompletion,
  recordOpenedEnergyContent,
  recordPracticeCompletion,
  saveEnergyCardIds,
  saveLastEnergyTarget,
  saveLightTestAction,
  savePollSelection,
  saveSeenEnergyContentIds,
  toggleFavoriteEnergyContent,
} from './energy-progress';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('energy progress', () => {
  it('counts a completed date once while collecting distinct experience kinds', () => {
    recordEnergyCompletion('usr_a', 'recharge', new Date('2026-08-11T09:00:00'));
    const progress = recordEnergyCompletion('usr_a', 'tarot', new Date('2026-08-11T18:00:00'));

    expect(progress.completedDates).toEqual(['2026-08-11']);
    expect(progress.collectedKinds).toEqual(['recharge', 'tarot']);
  });

  it('keeps progress isolated by storage scope', () => {
    recordEnergyCompletion('usr_a', 'game', new Date('2026-08-11T12:00:00'));

    expect(readEnergyProgress('usr_b')).toEqual({
      completedDates: [],
      collectedKinds: [],
      savedCardIds: [],
      completedTestIds: [],
      savedTestActionIds: [],
      seenContentIds: [],
      completedKindsByDate: {},
      seenContentDateKey: null,
      continuation: {
        dateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        lastTarget: null,
        lastCompletedKind: null,
        completedPracticeIds: [],
        pollSelections: {},
        favoriteContentIds: [],
      },
    });
    expect(readEnergyProgress('usr_a').collectedKinds).toEqual(['game']);
  });

  it('counts only consecutive local dates ending today', () => {
    const progress = {
      completedDates: ['2026-08-07', '2026-08-09', '2026-08-10', '2026-08-11'],
      collectedKinds: ['recharge'] as const,
    };

    expect(energyStreak(progress, new Date('2026-08-11T20:00:00'))).toBe(3);
    expect(energyStreak(progress, new Date('2026-08-12T08:00:00'))).toBe(0);
  });

  it('falls back to an empty record when stored data is malformed', () => {
    window.localStorage.setItem('holaday.energy.progress.v1:usr_a', '{bad-json');

    expect(readEnergyProgress('usr_a')).toEqual({
      completedDates: [],
      collectedKinds: [],
      savedCardIds: [],
      completedTestIds: [],
      savedTestActionIds: [],
      seenContentIds: [],
      completedKindsByDate: {},
      seenContentDateKey: null,
      continuation: {
        dateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        lastTarget: null,
        lastCompletedKind: null,
        completedPracticeIds: [],
        pollSelections: {},
        favoriteContentIds: [],
      },
    });
  });

  it('migrates v1 completion data and stores only bounded stable card ids in v2', () => {
    window.localStorage.setItem(
      'holaday.energy.progress.v1:usr_a',
      JSON.stringify({ completedDates: ['2026-08-10'], collectedKinds: ['tarot'] }),
    );

    expect(readEnergyProgress('usr_a')).toEqual({
      completedDates: ['2026-08-10'],
      collectedKinds: ['tarot'],
      savedCardIds: [],
      completedTestIds: [],
      savedTestActionIds: [],
      seenContentIds: [],
      completedKindsByDate: {},
      seenContentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      continuation: {
        dateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        lastTarget: null,
        lastCompletedKind: null,
        completedPracticeIds: [],
        pollSelections: {},
        favoriteContentIds: [],
      },
    });

    const progress = saveEnergyCardIds('usr_a', ['work-01', 'work-01', 'bad id', 'emotion-03']);
    expect(progress.savedCardIds).toEqual(['work-01', 'emotion-03']);
    expect(readEnergyProgress('usr_b').savedCardIds).toEqual([]);
    expect(storage.get('holaday.energy.progress.v3:usr_a')).toBe(JSON.stringify(progress));
  });

  it('persists only stable light-test ids and skips guest writes', () => {
    recordLightTestCompletion('usr_a', 'emotion-battery');
    const progress = saveLightTestAction('usr_a', 'emotion-battery', 'recover');

    expect(progress.completedTestIds).toEqual(['emotion-battery']);
    expect(progress.savedTestActionIds).toEqual(['emotion-battery:recover']);
    expect(storage.get('holaday.energy.progress.v3:usr_a')).not.toContain('answers');

    recordLightTestCompletion(null, 'emotion-weather');
    expect(storage.has('holaday.energy.progress.v3:guest')).toBe(false);
  });

  it('stores only bounded stable content ids without preview guest writes', () => {
    const ids = Array.from(
      { length: 120 },
      (_, index) => `relax-${String(index).padStart(3, '0')}`,
    );
    const progress = saveSeenEnergyContentIds('usr_a', [...ids, 'private text!', 'relax-119']);

    expect(progress.seenContentIds).toHaveLength(100);
    expect(progress.seenContentIds.at(-1)).toBe('relax-119');
    saveSeenEnergyContentIds(null, ['fortune-001']);
    expect(storage.has('holaday.energy.progress.v3:guest')).toBe(false);
  });

  it('migrates v2 without inventing private continuation data', () => {
    window.localStorage.setItem(
      'holaday.energy.progress.v2:usr_a',
      JSON.stringify({
        completedDates: ['2026-08-13'],
        collectedKinds: ['tarot'],
        savedCardIds: ['work-01'],
        seenContentIds: ['fortune-small-luck'],
      }),
    );

    const progress = readEnergyProgress('usr_a');

    expect(progress).toMatchObject({
      completedDates: ['2026-08-13'],
      collectedKinds: ['tarot'],
      savedCardIds: ['work-01'],
      seenContentIds: ['fortune-small-luck'],
      completedKindsByDate: {},
      seenContentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      continuation: {
        lastTarget: null,
        lastCompletedKind: null,
        completedPracticeIds: [],
        pollSelections: {},
        favoriteContentIds: [],
      },
    });
    expect(storage.has('holaday.energy.progress.v3:usr_a')).toBe(true);
  });

  it('records per-day kinds and bounded public continuation targets', () => {
    const completedAt = new Date(2026, 7, 13, 12);
    recordEnergyCompletion('usr_a', 'tarot', completedAt);
    saveLastEnergyTarget(
      'usr_a',
      { type: 'tarot', mode: 'single', theme: 'confidence' },
      'tarot',
      completedAt,
    );

    const progress = readEnergyProgress('usr_a');
    expect(completedKindsForDate(progress, completedAt)).toEqual(['tarot']);
    expect(progress.continuation).toMatchObject({
      dateKey: '2026-08-13',
      lastTarget: { type: 'tarot', mode: 'single', theme: 'confidence' },
      lastCompletedKind: 'tarot',
    });

    window.localStorage.setItem(
      'holaday.energy.progress.v3:bad',
      JSON.stringify({
        ...progress,
        continuation: {
          ...progress.continuation,
          lastTarget: { type: 'tarot', mode: 'single', question: 'private text' },
        },
      }),
    );
    expect(readEnergyProgress('bad').continuation.lastTarget).toBeNull();
  });

  it('resets daily seen ids and poll choices while preserving favorites and practice history', () => {
    const firstDay = new Date(2026, 7, 13, 12);
    const nextDay = new Date(2026, 7, 14, 12);
    recordOpenedEnergyContent('usr_a', 'relax-breath-window', firstDay);
    recordPracticeCompletion('usr_a', 'breath-window', firstDay);
    savePollSelection('usr_a', 'break-style', 'quiet-eyes', firstDay);
    toggleFavoriteEnergyContent('usr_a', 'relax-breath-window');

    const progress = recordOpenedEnergyContent('usr_a', 'fortune-small-luck', nextDay);

    expect(progress.seenContentIds).toEqual(['fortune-small-luck']);
    expect(progress.seenContentDateKey).toBe('2026-08-14');
    expect(progress.continuation.pollSelections).toEqual({});
    expect(progress.continuation.completedPracticeIds).toEqual(['breath-window']);
    expect(progress.continuation.favoriteContentIds).toEqual(['relax-breath-window']);
    expect(completedKindsForDate(progress, firstDay)).toEqual(['recharge']);
  });

  it('normalizes yesterday-only continuation state on the first read of a new day', () => {
    vi.useFakeTimers();
    const firstDay = new Date(2026, 7, 13, 12);
    const nextDay = new Date(2026, 7, 14, 8);
    vi.setSystemTime(firstDay);
    recordOpenedEnergyContent('usr_a', 'relax-breath-window', firstDay);
    recordPracticeCompletion('usr_a', 'breath-window', firstDay);
    savePollSelection('usr_a', 'break-style', 'quiet', firstDay);
    saveLastEnergyTarget(
      'usr_a',
      { type: 'practice', practiceId: 'breath-window' },
      'recharge',
      firstDay,
    );
    toggleFavoriteEnergyContent('usr_a', 'relax-breath-window');

    vi.setSystemTime(nextDay);
    const progress = readEnergyProgress('usr_a');

    expect(progress.seenContentIds).toEqual([]);
    expect(progress.seenContentDateKey).toBe('2026-08-14');
    expect(progress.continuation).toMatchObject({
      dateKey: '2026-08-14',
      lastTarget: null,
      lastCompletedKind: null,
      completedPracticeIds: ['breath-window'],
      pollSelections: {},
      favoriteContentIds: ['relax-breath-window'],
    });
  });

  it('stores only stable poll option ids and never writes preview state', () => {
    const valid = savePollSelection('usr_a', 'social-battery', 'quiet-alone');
    const invalid = savePollSelection('usr_a', 'social-battery', 'private answer with spaces');
    savePollSelection(null, 'break-style', 'walk');

    expect(valid.continuation.pollSelections).toEqual({ 'social-battery': 'quiet-alone' });
    expect(invalid.continuation.pollSelections).toEqual({ 'social-battery': 'quiet-alone' });
    expect(storage.has('holaday.energy.progress.v3:guest')).toBe(false);
  });

  it('drops unknown poll option slugs from stored continuation data', () => {
    const progress = savePollSelection('usr_a', 'break-style', 'quiet-eyes');
    window.localStorage.setItem(
      'holaday.energy.progress.v3:usr_a',
      JSON.stringify({
        ...progress,
        continuation: {
          ...progress.continuation,
          pollSelections: { 'break-style': 'made-up-option', 'social-battery': 'quiet-alone' },
        },
      }),
    );

    expect(readEnergyProgress('usr_a').continuation.pollSelections).toEqual({
      'social-battery': 'quiet-alone',
    });
  });

  it('keeps preview progress in memory without writing a guest storage record', () => {
    const completedAt = new Date(2026, 7, 14, 10);
    vi.useFakeTimers();
    vi.setSystemTime(completedAt);
    recordOpenedEnergyContent(null, 'fortune-small-luck', completedAt);
    savePollSelection(null, 'break-style', 'walk-stretch', completedAt);
    toggleFavoriteEnergyContent(null, 'fortune-small-luck');

    const progress = readEnergyProgress(null);

    expect(progress.seenContentIds).toEqual(['fortune-small-luck']);
    expect(progress.continuation.pollSelections).toEqual({ 'break-style': 'walk-stretch' });
    expect(progress.continuation.favoriteContentIds).toEqual(['fortune-small-luck']);
    expect(storage.has('holaday.energy.progress.v3:guest')).toBe(false);
  });
});
