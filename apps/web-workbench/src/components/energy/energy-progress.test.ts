// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completedKindsForDate,
  energyStreak,
  readEnergyProgress,
  recordCompletedEnergyExperience,
  recordEnergyCompletion,
  recordLightTestCompletion,
  recordOpenedEnergyContent,
  recordPracticeCompletion,
  removeSavedEnergyCard,
  removeSavedLightTestAction,
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
      shelf: { recentExperiences: [] },
    });
    expect(readEnergyProgress('usr_a').collectedKinds).toEqual(['game']);
  });

  it('keeps scoped progress in memory when local storage is unavailable', () => {
    const completedAt = new Date('2026-08-14T03:00:00.000Z');
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('storage unavailable');
        },
        setItem: () => {
          throw new Error('storage unavailable');
        },
      },
    });

    recordCompletedEnergyExperience(
      'usr_a',
      {
        experienceId: 'games',
        launchTarget: { type: 'game', gameId: 'catch-energy' },
        kind: 'game',
      },
      completedAt,
    );

    expect(readEnergyProgress('usr_a', completedAt)).toMatchObject({
      completedDates: ['2026-08-14'],
      collectedKinds: ['game'],
      shelf: {
        recentExperiences: [
          {
            experienceId: 'games',
            launchTarget: { type: 'game', gameId: 'catch-energy' },
            kind: 'game',
            completedAt: '2026-08-14T03:00:00.000Z',
          },
        ],
      },
    });
    expect(readEnergyProgress('usr_b', completedAt).collectedKinds).toEqual([]);
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
      shelf: { recentExperiences: [] },
    });
  });

  it('migrates v1 completion data and stores only bounded stable card ids in v4', () => {
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
      shelf: { recentExperiences: [] },
    });

    const progress = saveEnergyCardIds('usr_a', ['work-01', 'work-01', 'bad id', 'emotion-03']);
    expect(progress.savedCardIds).toEqual(['work-01', 'emotion-03']);
    expect(readEnergyProgress('usr_b').savedCardIds).toEqual([]);
    expect(storage.get('holaday.energy.progress.v4:usr_a')).toBe(JSON.stringify(progress));
  });

  it('persists only stable light-test ids and skips guest writes', () => {
    recordLightTestCompletion('usr_a', 'emotion-battery');
    const progress = saveLightTestAction('usr_a', 'emotion-battery', 'recover');

    expect(progress.completedTestIds).toEqual(['emotion-battery']);
    expect(progress.savedTestActionIds).toEqual(['emotion-battery:recover']);
    expect(storage.get('holaday.energy.progress.v4:usr_a')).not.toContain('answers');

    recordLightTestCompletion(null, 'emotion-weather');
    expect(storage.has('holaday.energy.progress.v4:guest')).toBe(false);
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
    expect(storage.has('holaday.energy.progress.v4:guest')).toBe(false);
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
    expect(storage.has('holaday.energy.progress.v4:usr_a')).toBe(true);
  });

  it('migrates v3 progress into v4 without losing completion or favorites', () => {
    window.localStorage.setItem(
      'holaday.energy.progress.v3:usr_a',
      JSON.stringify({
        completedDates: ['2026-08-14'],
        collectedKinds: ['tarot'],
        savedCardIds: ['work-01'],
        completedTestIds: ['work-focus'],
        savedTestActionIds: ['work-focus:steady'],
        seenContentIds: ['relax-breath-window'],
        completedKindsByDate: { '2026-08-14': ['tarot'] },
        seenContentDateKey: '2026-08-14',
        continuation: {
          dateKey: '2026-08-14',
          lastTarget: { type: 'tarot', mode: 'single', theme: 'work' },
          lastCompletedKind: 'tarot',
          completedPracticeIds: [],
          pollSelections: {},
          favoriteContentIds: ['relax-breath-window'],
        },
      }),
    );

    const progress = readEnergyProgress('usr_a', new Date(2026, 7, 14, 12));

    expect(progress.shelf.recentExperiences).toEqual([]);
    expect(progress.savedCardIds).toEqual(['work-01']);
    expect(progress.savedTestActionIds).toEqual(['work-focus:steady']);
    expect(progress.continuation.favoriteContentIds).toEqual(['relax-breath-window']);
    expect(window.localStorage.getItem('holaday.energy.progress.v4:usr_a')).not.toBeNull();
  });

  it('keeps only recent privacy-safe experience references and dedupes the newest target', () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-14T03:00:00.000Z');
    vi.setSystemTime(now);
    const base = recordEnergyCompletion('usr_a', 'game', now);
    window.localStorage.setItem(
      'holaday.energy.progress.v4:usr_a',
      JSON.stringify({
        ...base,
        shelf: {
          recentExperiences: [
            {
              experienceId: 'games',
              launchTarget: { type: 'game', gameId: 'color-memory' },
              kind: 'game',
              completedAt: '2026-08-14T02:00:00.000Z',
            },
            {
              experienceId: 'games',
              launchTarget: { type: 'game', gameId: 'color-memory' },
              kind: 'game',
              completedAt: '2026-08-14T02:30:00.000Z',
            },
            {
              experienceId: 'tarot',
              launchTarget: null,
              kind: 'tarot',
              completedAt: '2026-08-14T01:00:00.000Z',
            },
            {
              experienceId: 'tarot',
              launchTarget: { type: 'tarot', mode: 'single', question: 'private text' },
              kind: 'tarot',
              completedAt: '2026-08-14T02:45:00.000Z',
            },
            {
              experienceId: 'practice',
              launchTarget: null,
              kind: 'recharge',
              completedAt: '2026-08-14T02:40:00.000Z',
            },
            {
              experienceId: 'tarot',
              launchTarget: { type: 'tarot', mode: 'single' },
              kind: 'game',
              completedAt: '2026-08-14T02:35:00.000Z',
            },
            {
              experienceId: 'tarot',
              launchTarget: { type: 'tarot', mode: 'single' },
              kind: 'tarot',
              completedAt: '2026-07-01T03:00:00.000Z',
            },
            {
              experienceId: 'games',
              launchTarget: null,
              kind: 'game',
              completedAt: '2026-08-14T03:06:00.000Z',
            },
          ],
        },
      }),
    );

    const progress = readEnergyProgress('usr_a', now);

    expect(progress.shelf.recentExperiences).toEqual([
      {
        experienceId: 'games',
        launchTarget: { type: 'game', gameId: 'color-memory' },
        kind: 'game',
        completedAt: '2026-08-14T02:30:00.000Z',
      },
      {
        experienceId: 'tarot',
        launchTarget: null,
        kind: 'tarot',
        completedAt: '2026-08-14T01:00:00.000Z',
      },
    ]);
    expect(
      JSON.parse(storage.get('holaday.energy.progress.v4:usr_a') ?? '{}').shelf.recentExperiences,
    ).toEqual(progress.shelf.recentExperiences);
  });

  it('records completion and recent history atomically with retention, dedupe and a twelve-item cap', () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-14T03:00:00.000Z');
    vi.setSystemTime(now);
    recordCompletedEnergyExperience(
      'usr_a',
      {
        experienceId: 'tarot',
        launchTarget: { type: 'tarot', mode: 'single', theme: 'work' },
        kind: 'tarot',
      },
      new Date('2026-07-01T03:00:00.000Z'),
    );

    const completions = [
      { experienceId: 'recharge', launchTarget: null, kind: 'recharge' },
      { experienceId: 'tarot', launchTarget: null, kind: 'tarot' },
      { experienceId: 'light-test', launchTarget: null, kind: 'test' },
      { experienceId: 'horoscope', launchTarget: null, kind: 'horoscope' },
      { experienceId: 'games', launchTarget: null, kind: 'game' },
      {
        experienceId: 'practice',
        launchTarget: { type: 'practice', practiceId: 'breath-window' },
        kind: 'recharge',
      },
      {
        experienceId: 'practice',
        launchTarget: { type: 'practice', practiceId: 'shoulder-release' },
        kind: 'recharge',
      },
      {
        experienceId: 'practice',
        launchTarget: { type: 'practice', practiceId: 'five-senses' },
        kind: 'recharge',
      },
      {
        experienceId: 'practice',
        launchTarget: { type: 'practice', practiceId: 'water-pause' },
        kind: 'recharge',
      },
      {
        experienceId: 'practice',
        launchTarget: { type: 'practice', practiceId: 'desk-reset' },
        kind: 'recharge',
      },
      {
        experienceId: 'practice',
        launchTarget: { type: 'practice', practiceId: 'distance-gaze' },
        kind: 'recharge',
      },
      {
        experienceId: 'games',
        launchTarget: { type: 'game', gameId: 'catch-energy' },
        kind: 'game',
      },
      {
        experienceId: 'games',
        launchTarget: { type: 'game', gameId: 'breath-rhythm' },
        kind: 'game',
      },
      {
        experienceId: 'games',
        launchTarget: { type: 'game', gameId: 'color-memory' },
        kind: 'game',
      },
    ] as const;

    completions.forEach((completion, index) => {
      recordCompletedEnergyExperience(
        'usr_a',
        completion,
        new Date(`2026-08-14T01:${String(index).padStart(2, '0')}:00.000Z`),
      );
    });
    recordCompletedEnergyExperience(
      'usr_a',
      {
        experienceId: 'games',
        launchTarget: { type: 'game', gameId: 'color-memory' },
        kind: 'game',
      },
      new Date('2026-08-14T02:30:00.000Z'),
    );

    const progress = readEnergyProgress('usr_a', now);
    expect(progress.shelf.recentExperiences).toHaveLength(12);
    expect(progress.shelf.recentExperiences[0]).toEqual({
      experienceId: 'games',
      launchTarget: { type: 'game', gameId: 'color-memory' },
      kind: 'game',
      completedAt: '2026-08-14T02:30:00.000Z',
    });
    expect(
      progress.shelf.recentExperiences.some((item) => item.completedAt.startsWith('2026-07')),
    ).toBe(false);
    expect(completedKindsForDate(progress, now)).toEqual([
      'recharge',
      'tarot',
      'test',
      'horoscope',
      'game',
    ]);
    expect(progress.continuation.lastTarget).toEqual({
      type: 'game',
      gameId: 'color-memory',
    });
  });

  it('rejects a completion whose target or kind does not match the experience', () => {
    const now = new Date('2026-08-14T03:00:00.000Z');
    recordEnergyCompletion('usr_a', 'tarot', now);
    const before = storage.get('holaday.energy.progress.v4:usr_a');

    const invalidPractice = recordCompletedEnergyExperience(
      'usr_a',
      { experienceId: 'practice', launchTarget: null, kind: 'recharge' },
      now,
    );
    const invalidKind = recordCompletedEnergyExperience(
      'usr_a',
      {
        experienceId: 'tarot',
        launchTarget: { type: 'tarot', mode: 'single' },
        kind: 'game',
      },
      now,
    );

    expect(invalidPractice.shelf.recentExperiences).toEqual([]);
    expect(invalidKind.shelf.recentExperiences).toEqual([]);
    expect(storage.get('holaday.energy.progress.v4:usr_a')).toBe(before);
  });

  it('removes saved cards and test actions without deleting completion history', () => {
    const completedAt = new Date('2026-08-14T02:00:00.000Z');
    recordEnergyCompletion('usr_a', 'tarot', completedAt);
    saveEnergyCardIds('usr_a', ['work-01']);
    saveLightTestAction('usr_a', 'work-focus', 'steady');

    removeSavedEnergyCard('usr_a', 'work-01');
    removeSavedLightTestAction('usr_a', 'work-focus', 'steady');

    const progress = readEnergyProgress('usr_a', completedAt);
    expect(progress.savedCardIds).toEqual([]);
    expect(progress.savedTestActionIds).toEqual([]);
    expect(progress.completedKindsByDate['2026-08-14']).toEqual(['tarot']);
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

    const progress = readEnergyProgress('usr_a', completedAt);
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
    expect(storage.has('holaday.energy.progress.v4:guest')).toBe(false);
  });

  it('drops unknown poll option slugs from stored continuation data', () => {
    const progress = savePollSelection('usr_a', 'break-style', 'quiet-eyes');
    window.localStorage.setItem(
      'holaday.energy.progress.v4:usr_a',
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
    expect(storage.has('holaday.energy.progress.v4:guest')).toBe(false);
  });
});
