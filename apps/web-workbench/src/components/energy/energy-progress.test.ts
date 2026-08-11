// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  energyStreak,
  readEnergyProgress,
  recordEnergyCompletion,
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
    });
  });
});
