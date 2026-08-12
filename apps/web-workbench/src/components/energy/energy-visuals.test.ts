import { describe, expect, it } from 'vitest';
import { dimensionVisualFor } from './energy-visuals';

describe('energy visual metadata', () => {
  it('gives provider dimensions stable visual metadata', () => {
    expect(dimensionVisualFor('profession')).toEqual({ tone: 'peach', icon: 'briefcase' });
    expect(dimensionVisualFor('unknown')).toEqual({ tone: 'lavender', icon: 'sparkles' });
  });
});
