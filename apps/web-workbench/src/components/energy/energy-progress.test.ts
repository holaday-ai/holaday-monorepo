// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  energyStreak,
  readEnergyProgress,
  recordEnergyCompletion,
  saveEnergyCardIds,
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
    });

    const progress = saveEnergyCardIds('usr_a', ['work-01', 'work-01', 'bad id', 'emotion-03']);
    expect(progress.savedCardIds).toEqual(['work-01', 'emotion-03']);
    expect(readEnergyProgress('usr_b').savedCardIds).toEqual([]);
    expect(storage.get('holaday.energy.progress.v2:usr_a')).toBe(JSON.stringify(progress));
  });
});
