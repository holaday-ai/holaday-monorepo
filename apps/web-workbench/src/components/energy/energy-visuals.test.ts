import { describe, expect, it } from 'vitest';
import { dimensionVisualFor, exploreVisualFor } from './energy-visuals';

describe('energy visual metadata', () => {
  it('uses the active zodiac artwork for zodiac knowledge', () => {
    expect(exploreVisualFor('zodiac-knowledge', 'taurus')).toEqual({
      tone: 'sky',
      icon: 'book',
      imageSrc: '/energy/taurus-badge.jpg',
    });
  });

  it('maps playable categories to approved energy art', () => {
    expect(exploreVisualFor('game-recommendation', 'aries').imageSrc).toBe(
      '/energy/mini-game.jpg',
    );
    expect(exploreVisualFor('card-recommendation', 'aries').imageSrc).toBe(
      '/energy/tarot-cards.jpg',
    );
    expect(exploreVisualFor('test-recommendation', 'aries').imageSrc).toBe(
      '/energy/quick-test.jpg',
    );
  });

  it('gives provider dimensions stable visual metadata', () => {
    expect(dimensionVisualFor('profession')).toEqual({ tone: 'peach', icon: 'briefcase' });
    expect(dimensionVisualFor('unknown')).toEqual({ tone: 'lavender', icon: 'sparkles' });
  });
});
