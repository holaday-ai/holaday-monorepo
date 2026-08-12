import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENERGY_EXPLORE_CONTENT, type EnergyContentItem } from './explore-content';
import { allocateMagazineVisuals, MAGAZINE_ART } from './energy-magazine-visuals';

function content(id: string): EnergyContentItem {
  const item = ENERGY_EXPLORE_CONTENT.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing fixture ${id}`);
  return item;
}

describe('magazine artwork catalog', () => {
  it('declares sixteen unique bundled WebP assets within their byte budgets', () => {
    expect(MAGAZINE_ART).toHaveLength(16);
    expect(new Set(MAGAZINE_ART.map((asset) => asset.imageSrc)).size).toBe(16);

    for (const asset of MAGAZINE_ART) {
      expect(asset.imageSrc).toMatch(/^\/energy\/magazine\/[a-z-]+\.webp$/);
      const file = new URL(`../../../public${asset.imageSrc}`, import.meta.url);
      expect(statSync(file).size).toBeLessThanOrEqual(asset.maxBytes);
    }
  });

  it('allocates one hero, two portraits and three landscapes without repeated art', () => {
    const items = [
      content('zodiac-fire-recharge'),
      content('zodiac-earth-rhythm'),
      content('relax-breath-window'),
      content('fortune-small-luck'),
      content('relationship-reply-speed'),
      content('game-recommend-catch'),
    ];
    const first = allocateMagazineVisuals(items, 'leo');
    const second = allocateMagazineVisuals(items, 'leo');

    expect(first.map((entry) => entry.slot)).toEqual([
      'hero',
      'portrait',
      'portrait',
      'landscape',
      'landscape',
      'landscape',
    ]);
    expect(new Set(first.map((entry) => entry.visual.imageSrc)).size).toBe(6);
    expect(second).toEqual(first);
    expect(first[0]?.visual.imageSrc).not.toBe('/energy/leo-badge.jpg');
    expect(first[0]?.zodiacBadgeSrc).toBe('/energy/leo-badge.jpg');
    expect(first[1]?.zodiacBadgeSrc).toBe('/energy/leo-badge.jpg');
  });
});
