import { describe, expect, it } from 'vitest';
import { HOLADAY_ENERGY_CARDS } from './energy-card-content';
import { drawEnergyCards } from './energy-card-selection';

describe('Holaday energy card catalog and selector', () => {
  it('contains 36 complete cards across six primary themes', () => {
    expect(HOLADAY_ENERGY_CARDS).toHaveLength(36);
    expect(new Set(HOLADAY_ENERGY_CARDS.map((card) => card.id)).size).toBe(36);
    for (const theme of [
      'work',
      'relationship',
      'emotion',
      'space',
      'confidence',
      'uplift',
    ] as const) {
      expect(HOLADAY_ENERGY_CARDS.filter((card) => card.primaryTheme === theme)).toHaveLength(6);
    }
    expect(
      HOLADAY_ENERGY_CARDS.every((card) =>
        [card.title, card.subtitle, card.body, card.action].every(
          (value) => value.trim().length > 0,
        ),
      ),
    ).toBe(true);
    expect(
      HOLADAY_ENERGY_CARDS.every((card) => card.body.length >= 35 && card.body.length <= 90),
    ).toBe(true);
  });

  it('is deterministic for the same seed and draws three distinct cards', () => {
    const input = {
      mode: 'three' as const,
      theme: 'work' as const,
      count: 3 as const,
      seed: 'session-a',
      seenIds: [],
    };
    const first = drawEnergyCards(input);
    const repeated = drawEnergyCards(input);

    expect(first.map((card) => card.id)).toEqual(repeated.map((card) => card.id));
    expect(new Set(first.map((card) => card.id)).size).toBe(3);
  });

  it('avoids seen ids until the theme pool is exhausted, then cycles safely', () => {
    const first = drawEnergyCards({
      mode: 'three',
      theme: 'work',
      count: 3,
      seed: 'session-a',
      seenIds: [],
    });
    const second = drawEnergyCards({
      mode: 'single',
      theme: 'work',
      count: 1,
      seed: 'session-b',
      seenIds: first.map((card) => card.id),
    });
    expect(first.map((card) => card.id)).not.toContain(second[0]?.id);

    const cycled = drawEnergyCards({
      mode: 'single',
      theme: 'work',
      count: 1,
      seed: 'session-c',
      seenIds: HOLADAY_ENERGY_CARDS.filter((card) => card.primaryTheme === 'work').map(
        (card) => card.id,
      ),
    });
    expect(cycled).toHaveLength(1);
    expect(cycled[0]?.primaryTheme).toBe('work');
  });
});
