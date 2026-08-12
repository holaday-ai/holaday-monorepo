import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAGAZINE_ART } from './energy-magazine-visuals';

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
});
