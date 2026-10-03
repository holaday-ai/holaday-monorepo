import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { ImageProviderError } from './image-provider-types.js';
import { imageProviderConfigFromEnv } from './image-providers.js';
import { type SaveImageFn, mapImageError } from './image-runner.js';
import { runImageTask } from './qwen-only-image-runner.js';

vi.mock('../../config/env.js', () => ({ env: {} }));

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

const ENV = {
  DASHSCOPE_API_KEY: 'dk',
  DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com',
  FAL_KEY: 'fk',
  QWEN_IMAGE_MODEL: 'qwen-image-2.0-pro',
  WAN_IMAGE_MODEL: 'wan2.7-image',
  FAL_NANO_BANANA_2_MODEL: 'fal-ai/nano-banana-2',
  FAL_NANO_BANANA_2_EDIT_MODEL: 'fal-ai/nano-banana-2/edit',
  IMAGE_DEFAULT_MODEL: 'nano_banana_2' as const,
};

const save: SaveImageFn = vi.fn(async (_img, index) => ({
  fileId: `f${index}`,
  downloadUrl: `/api/files/f${index}/download`,
  filename: `holaday-image-${index}.png`,
  mimetype: 'image/png',
  sizeBytes: 3,
  expiresAt: '2026-10-04T00:00:00.000Z',
  kind: 'output' as const,
}));

function ok(model: string) {
  return { images: [{ buffer: Buffer.from('PNG'), mimeType: 'image/png' }], model };
}

const baseOpts = { apiKey: 'legacy-gemini-key', save, logger: fakeLogger() };

describe('production image runner (Qwen Image / Wan 2.7 Image / fal NB2)', () => {
  it('routes a Chinese poster to Qwen Image and labels the summary', async () => {
    const generate = vi.fn().mockResolvedValue(ok('qwen-image-2.0-pro'));
    const out = await runImageTask(
      { ...baseOpts, intent: '做一张写着"全场五折"的促销海报' },
      { config: imageProviderConfigFromEnv(ENV), generate },
    );
    expect(out.status).toBe('completed');
    expect(out.modelKey).toBe('qwen_image');
    expect(out.summary).toContain('千问 Qwen Image');
    const call = generate.mock.calls[0]?.[0];
    expect(call.model).toBe('qwen-image-2.0-pro');
    expect(call.apiVersion).toBeUndefined();
    // Marketing compliance constraint still applied by the shared orchestrator.
    expect(call.prompt).toContain('不要补第二个');
  });

  it('routes reference-image edits to Wan 2.7 Image', async () => {
    const generate = vi.fn().mockResolvedValue(ok('wan2.7-image'));
    const out = await runImageTask(
      {
        ...baseOpts,
        intent: '把背景换成海边',
        inputImages: [{ data: 'AAA', mimeType: 'image/png' }],
      },
      { config: imageProviderConfigFromEnv(ENV), generate },
    );
    expect(out.modelKey).toBe('wan_image');
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      model: 'wan2.7-image',
      inputImages: [{ data: 'AAA', mimeType: 'image/png' }],
    });
  });

  it('honours the UI model key', async () => {
    const generate = vi.fn().mockResolvedValue(ok('wan2.7-image'));
    await runImageTask(
      { ...baseOpts, intent: '画一只猫', preferredModel: 'wan_image' },
      { config: imageProviderConfigFromEnv(ENV), generate },
    );
    expect(generate.mock.calls[0]?.[0].model).toBe('wan2.7-image');
  });

  it('falls back to the next routed model on overload and says so', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ImageProviderError('busy', 'http', 503, undefined, 'fal'))
      .mockResolvedValueOnce(ok('wan2.7-image'));
    const out = await runImageTask(
      { ...baseOpts, intent: '画一只猫' },
      { config: imageProviderConfigFromEnv(ENV), generate },
    );
    expect(out.status).toBe('completed');
    expect(out.modelKey).toBe('wan_image');
    expect(out.summary).toContain('Nano Banana 2 暂不可用，已自动改用 万相 Wan 2.7 Image');
    expect(generate.mock.calls.map((c) => c[0].model)).toEqual([
      'fal-ai/nano-banana-2',
      'wan2.7-image',
    ]);
  });

  it('falls back when a provider is out of balance, but not on content blocks', async () => {
    const broke = vi
      .fn()
      .mockRejectedValueOnce(new ImageProviderError('locked', 'exhausted_balance', 403))
      .mockResolvedValueOnce(ok('wan2.7-image'));
    const out = await runImageTask(
      { ...baseOpts, intent: '画一只猫' },
      { config: imageProviderConfigFromEnv(ENV), generate: broke },
    );
    expect(out.status).toBe('completed');

    const blocked = vi.fn().mockRejectedValue(new ImageProviderError('no', 'blocked', 400));
    const refused = await runImageTask(
      { ...baseOpts, intent: '画一只猫' },
      { config: imageProviderConfigFromEnv(ENV), generate: blocked },
    );
    expect(refused.status).toBe('failed');
    expect(refused.reason).toContain('安全策略');
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when no image provider is configured', async () => {
    const generate = vi.fn();
    const out = await runImageTask(
      { ...baseOpts, intent: '画一只猫' },
      {
        config: imageProviderConfigFromEnv({ ...ENV, DASHSCOPE_API_KEY: '', FAL_KEY: '' }),
        generate,
      },
    );
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('管理员');
    expect(generate).not.toHaveBeenCalled();
  });

  it('notes an unavailable explicit selection in the summary', async () => {
    const generate = vi.fn().mockResolvedValue(ok('wan2.7-image'));
    const out = await runImageTask(
      { ...baseOpts, intent: '画一只猫', preferredModel: 'nano_banana_2' },
      { config: imageProviderConfigFromEnv({ ...ENV, FAL_KEY: '' }), generate },
    );
    expect(out.summary).toContain('所选模型暂不可用');
  });
});

describe('mapImageError — provider-neutral copy', () => {
  it('maps every provider error kind to user-safe Chinese', () => {
    expect(mapImageError(new ImageProviderError('x', 'no_api_key'))).toContain('管理员');
    expect(mapImageError(new ImageProviderError('x', 'exhausted_balance'))).toContain('余额不足');
    expect(mapImageError(new ImageProviderError('x', 'blocked'))).toContain('安全策略');
    expect(mapImageError(new ImageProviderError('x', 'no_image'))).toContain('未能生成');
    expect(mapImageError(new ImageProviderError('x', 'timeout'))).toContain('超时');
    expect(mapImageError(new ImageProviderError('x', 'http', 502))).toContain('502');
    expect(mapImageError(new ImageProviderError('x', 'network'))).toContain('连接失败');
    expect(mapImageError(new Error('boom'))).toBe('图片生成失败，请稍后重试。');
  });
});
