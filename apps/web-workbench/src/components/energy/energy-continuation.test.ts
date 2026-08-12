import { describe, expect, it } from 'vitest';
import { targetCompletionKind } from './energy-content-target';
import { recommendNextEnergyTarget } from './energy-continuation';
import type { EnergyCompletionKind } from './energy-progress';

describe('energy continuation recommendations', () => {
  it('prefers an unfinished kind and does not repeat the just-completed kind', () => {
    const next = recommendNextEnergyTarget({
      energyNeed: 'relax',
      completedKinds: ['recharge'],
      lastCompletedKind: 'recharge',
    });

    expect(next).not.toBeNull();
    expect(targetCompletionKind(next?.target ?? null)).not.toBe('recharge');
    expect(next?.reason).toContain('因为你选择了放松');
  });

  it.each([
    ['focus', 'test', 'work-focus'],
    ['relax', 'game', 'breath-rhythm'],
    ['confidence', 'tarot', 'single'],
    ['uplift', 'game', 'color-memory'],
  ] as const)(
    'maps %s to an explainable target when it is the next unfinished kind',
    (need, type, id) => {
      const completedKinds: EnergyCompletionKind[] =
        type === 'test'
          ? ['recharge']
          : type === 'tarot'
            ? ['recharge', 'test', 'game']
            : ['recharge', 'tarot', 'test'];
      const next = recommendNextEnergyTarget({
        energyNeed: need,
        completedKinds,
        lastCompletedKind: completedKinds.at(-1) ?? null,
      });

      expect(next?.target.type).toBe(type);
      expect(JSON.stringify(next?.target)).toContain(id);
    },
  );

  it('skips unavailable target types and returns null after all five kinds are complete', () => {
    const skipped = recommendNextEnergyTarget({
      energyNeed: 'relax',
      completedKinds: ['recharge'],
      lastCompletedKind: 'recharge',
      unavailableTypes: ['tarot', 'test', 'game'],
    });
    expect(skipped?.target).toEqual({ type: 'astrology', period: 'daily' });

    expect(
      recommendNextEnergyTarget({
        energyNeed: 'focus',
        completedKinds: ['recharge', 'tarot', 'test', 'game', 'horoscope'],
        lastCompletedKind: 'horoscope',
      }),
    ).toBeNull();
  });
});
