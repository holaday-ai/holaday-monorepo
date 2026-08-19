import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const assetUrl = (name: string): URL => new URL(`../../public/assets/stocks/${name}`, import.meta.url);

describe('stock first-view performance budget', () => {
  it.each([
    ['stock-story-hero-v1-mobile.webp', 120_000],
    ['stock-story-hero-v1-desktop.webp', 220_000],
  ])('ships %s inside its byte budget', (name, budget) => {
    const url = assetUrl(name);
    expect(existsSync(fileURLToPath(url))).toBe(true);
    if (!existsSync(fileURLToPath(url))) return;
    expect(statSync(fileURLToPath(url)).size).toBeLessThanOrEqual(budget);
  });
});
