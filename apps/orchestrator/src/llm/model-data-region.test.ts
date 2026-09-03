import { describe, expect, it } from 'vitest';
import { resolveModelDataRegionOwnership } from './model-data-region.js';

describe('model data region ownership', () => {
  it.each(['cn', 'intl'] as const)('uses the explicit organization region %s', (region) => {
    expect(
      resolveModelDataRegionOwnership({ scope: 'organization', organizationRegion: region }),
    ).toEqual({ region, source: 'organization' });
  });

  it('does not fall back to an account region for an unassigned organization', () => {
    expect(() =>
      resolveModelDataRegionOwnership({ scope: 'organization', organizationRegion: null }),
    ).toThrowError(expect.objectContaining({ code: 'ORGANIZATION_MODEL_DATA_REGION_UNASSIGNED' }));
  });

  it.each(['cn', 'intl'] as const)(
    'uses the explicit account region %s for personal work',
    (region) => {
      expect(resolveModelDataRegionOwnership({ scope: 'personal', userRegion: region })).toEqual({
        region,
        source: 'user',
      });
    },
  );

  it('refuses a personal route whose account region is unassigned', () => {
    expect(() =>
      resolveModelDataRegionOwnership({ scope: 'personal', userRegion: null }),
    ).toThrowError(expect.objectContaining({ code: 'USER_MODEL_DATA_REGION_UNASSIGNED' }));
  });

  it.each([
    { scope: 'personal', userRegion: 'us' },
    { scope: 'personal', userRegion: '' },
    { scope: 'organization', organizationRegion: 'ap-southeast-1' },
    { scope: 'organization', organizationRegion: 1 },
  ] as const)('fails closed for an invalid persisted value', (input) => {
    expect(() => resolveModelDataRegionOwnership(input)).toThrowError(
      expect.objectContaining({ code: 'INVALID_MODEL_DATA_REGION' }),
    );
  });
});
