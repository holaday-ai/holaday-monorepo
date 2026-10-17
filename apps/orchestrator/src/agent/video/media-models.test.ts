import { describe, expect, it, vi } from 'vitest';
import {
  hasMediaFailureRefundHook,
  notifyMediaGenerationFailed,
  setMediaFailureRefundHook,
} from './media-failure-refund.js';

vi.mock('../../config/env.js', () => ({ env: {} }));

const { availableMediaModels } = await import('./media-models.js');

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

describe('availableMediaModels', () => {
  it('exposes every model when DashScope and fal are configured', () => {
    expect(availableMediaModels(ENV)).toEqual({
      image: ['qwen_image', 'wan_image', 'nano_banana_2'],
      video: ['veo_fast', 'veo_lite', 'veo_standard', 'wanxiang', 'happyhorse'],
      petVideo: ['wan_i2v', 'happyhorse_i2v'],
    });
  });

  it('hides fal-backed choices without FAL_KEY', () => {
    expect(availableMediaModels({ ...ENV, FAL_KEY: '' })).toEqual({
      image: ['qwen_image', 'wan_image'],
      video: ['wanxiang', 'happyhorse'],
      petVideo: ['wan_i2v', 'happyhorse_i2v'],
    });
  });

  it('hides DashScope-backed choices (and Veo, which needs Qwen narration) without a DashScope key', () => {
    expect(availableMediaModels({ ...ENV, DASHSCOPE_API_KEY: '' })).toEqual({
      image: ['nano_banana_2'],
      video: [],
      petVideo: [],
    });
  });
});

describe('media failure refund hook (integration point)', () => {
  const failure = {
    taskId: 'task_1',
    userIdInternal: 7,
    lane: 'image' as const,
    reason: '图片生成失败，请稍后重试。',
    nothingDelivered: true,
  };

  it('is a logged no-op until the shared refund helper is registered', async () => {
    setMediaFailureRefundHook(null);
    const warn = vi.fn();
    expect(hasMediaFailureRefundHook()).toBe(false);
    await expect(notifyMediaGenerationFailed(failure, { warn })).resolves.toBe('no_hook');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('forwards full failures to the registered helper and skips partial deliveries', async () => {
    const hook = vi.fn(async () => undefined);
    setMediaFailureRefundHook(hook);
    await expect(notifyMediaGenerationFailed(failure)).resolves.toBe('refund_requested');
    expect(hook).toHaveBeenCalledWith(failure);
    await expect(
      notifyMediaGenerationFailed({ ...failure, nothingDelivered: false }),
    ).resolves.toBe('skipped_partial');
    expect(hook).toHaveBeenCalledTimes(1);
    setMediaFailureRefundHook(null);
  });

  it('never throws when the helper fails', async () => {
    setMediaFailureRefundHook(async () => {
      throw new Error('db down');
    });
    const warn = vi.fn();
    await expect(notifyMediaGenerationFailed(failure, { warn })).resolves.toBe('hook_failed');
    expect(warn).toHaveBeenCalled();
    setMediaFailureRefundHook(null);
  });
});
