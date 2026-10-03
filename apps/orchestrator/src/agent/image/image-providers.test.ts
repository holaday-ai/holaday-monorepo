import { describe, expect, it, vi } from 'vitest';
import {
  type ImageProviderConfig,
  availableImageModels,
  createProviderImageGenerate,
  imageModelKeyForId,
  imageProviderConfigFromEnv,
} from './image-providers.js';

const ENV = {
  DASHSCOPE_API_KEY: 'dk',
  DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com',
  DASHSCOPE_WORKSPACE_ID: '',
  FAL_KEY: 'fk',
  FAL_BASE_URL: 'https://queue.fal.run',
  QWEN_IMAGE_MODEL: 'qwen-image-2.0-pro',
  WAN_IMAGE_MODEL: 'wan2.7-image',
  FAL_NANO_BANANA_2_MODEL: 'fal-ai/nano-banana-2',
  FAL_NANO_BANANA_2_EDIT_MODEL: 'fal-ai/nano-banana-2/edit',
  IMAGE_DEFAULT_MODEL: 'nano_banana_2' as const,
};

function config(overrides: Partial<typeof ENV> = {}): ImageProviderConfig {
  return imageProviderConfigFromEnv({ ...ENV, ...overrides });
}

const result = { images: [{ buffer: Buffer.from('x'), mimeType: 'image/png' }], model: 'm' };

describe('image provider registry', () => {
  it('lists only models whose provider key is configured', () => {
    expect(availableImageModels(config())).toEqual(['qwen_image', 'wan_image', 'nano_banana_2']);
    expect(availableImageModels(config({ FAL_KEY: '' }))).toEqual(['qwen_image', 'wan_image']);
    expect(availableImageModels(config({ DASHSCOPE_API_KEY: '' }))).toEqual(['nano_banana_2']);
    expect(availableImageModels(config({ DASHSCOPE_API_KEY: '', FAL_KEY: '' }))).toEqual([]);
  });

  it('reads model ids from configuration, never hard-coded', () => {
    const cfg = config({ QWEN_IMAGE_MODEL: 'qwen-image-3.0-pro' });
    expect(imageModelKeyForId('qwen-image-3.0-pro', cfg)).toBe('qwen_image');
    expect(imageModelKeyForId('fal-ai/nano-banana-2/edit', cfg)).toBe('nano_banana_2');
    expect(imageModelKeyForId('gemini-3.1-flash-image', cfg)).toBeNull();
  });

  it('dispatches DashScope models with DashScope credentials', async () => {
    const dashscope = vi.fn().mockResolvedValue(result);
    const fal = vi.fn();
    const generate = createProviderImageGenerate(config({ DASHSCOPE_WORKSPACE_ID: 'ws' }), {
      dashscope,
      fal,
    });
    await generate({ apiKey: 'ignored-gemini-key', model: 'wan2.7-image', prompt: 'p', apiVersion: 'v1' });
    expect(fal).not.toHaveBeenCalled();
    expect(dashscope).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'dk',
        model: 'wan2.7-image',
        workspaceId: 'ws',
        baseUrl: 'https://dashscope-intl.aliyuncs.com',
      }),
    );
    expect(dashscope.mock.calls[0]?.[0]).not.toHaveProperty('apiVersion');
  });

  it('dispatches NB2 to fal with both endpoint ids', async () => {
    const fal = vi.fn().mockResolvedValue(result);
    const generate = createProviderImageGenerate(config(), { dashscope: vi.fn(), fal });
    await generate({ model: 'fal-ai/nano-banana-2', prompt: 'p' });
    expect(fal).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'fk',
        model: 'fal-ai/nano-banana-2',
        editModel: 'fal-ai/nano-banana-2/edit',
      }),
    );
  });

  it('serves an unknown (legacy Gemini) model id with the configured default', async () => {
    const dashscope = vi.fn().mockResolvedValue(result);
    const fal = vi.fn().mockResolvedValue(result);
    await createProviderImageGenerate(config(), { dashscope, fal })({
      model: 'gemini-3.1-flash-image',
      prompt: 'p',
    });
    expect(fal).toHaveBeenCalledTimes(1);
    await createProviderImageGenerate(config({ FAL_KEY: '' }), { dashscope, fal })({
      model: 'gemini-3.1-flash-image',
      prompt: 'p',
    });
    expect(dashscope).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen-image-2.0-pro' }));
  });

  it('fails as not configured when the routed provider has no key', async () => {
    const generate = createProviderImageGenerate(config({ FAL_KEY: '' }), {
      dashscope: vi.fn(),
      fal: vi.fn(),
    });
    await expect(generate({ model: 'fal-ai/nano-banana-2', prompt: 'p' })).rejects.toMatchObject({
      name: 'ImageProviderError',
      kind: 'no_api_key',
    });
    const none = createProviderImageGenerate(config({ FAL_KEY: '', DASHSCOPE_API_KEY: '' }));
    await expect(none({ model: 'x', prompt: 'p' })).rejects.toMatchObject({ kind: 'no_api_key' });
  });
});
