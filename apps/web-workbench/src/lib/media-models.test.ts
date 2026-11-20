import { afterEach, describe, expect, it, vi } from 'vitest';

const meQuery = vi.fn();
vi.mock('@/lib/trpc', () => ({ trpc: { auth: { me: { query: () => meQuery() } } } }));

const {
  filterAvailableOptions,
  isModelAvailable,
  loadMediaModels,
  normalizeMediaModels,
  resetMediaModelsCache,
} = await import('./media-models');

afterEach(() => {
  resetMediaModelsCache();
  meQuery.mockReset();
});

describe('media model availability', () => {
  it('normalizes auth.me mediaModels and rejects malformed payloads', () => {
    expect(
      normalizeMediaModels({ image: ['qwen_image', 3], video: ['wanxiang'], petVideo: [] }),
    ).toEqual({ image: ['qwen_image'], video: ['wanxiang'], petVideo: [] });
    expect(normalizeMediaModels({ image: [] })).toBeNull();
    expect(normalizeMediaModels(null)).toBeNull();
  });

  it('never hides options while availability is unknown', () => {
    expect(isModelAvailable(null, 'veo_fast')).toBe(true);
    expect(isModelAvailable(['wanxiang'], 'veo_fast')).toBe(false);
    const options = [{ value: 'veo_fast' }, { value: 'wanxiang' }, { value: 'auto' }];
    expect(filterAvailableOptions(options, ['wanxiang'], ['auto'])).toEqual([
      { value: 'wanxiang' },
      { value: 'auto' },
    ]);
    expect(filterAvailableOptions(options, undefined)).toHaveLength(3);
  });

  it('loads once from auth.me and degrades to unknown on failure', async () => {
    meQuery.mockResolvedValue({
      mediaModels: { image: ['wan_image'], video: ['wanxiang'], petVideo: ['wan_i2v'] },
    });
    await expect(loadMediaModels()).resolves.toEqual({
      image: ['wan_image'],
      video: ['wanxiang'],
      petVideo: ['wan_i2v'],
    });
    await loadMediaModels();
    expect(meQuery).toHaveBeenCalledTimes(1);

    resetMediaModelsCache();
    meQuery.mockRejectedValue(new Error('offline'));
    await expect(loadMediaModels()).resolves.toBeNull();
  });
});
