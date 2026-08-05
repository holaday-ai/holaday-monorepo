import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import {
  runImageTask,
  buildImagePrompt,
  type ImageAttachment,
  type SaveImageFn,
} from './image-runner.js';
import { GeminiImageError } from './gemini-image-client.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, debug: noop, error: noop, fatal: noop, trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

function attachmentFor(index: number): ImageAttachment {
  return {
    fileId: `file_${index}`,
    downloadUrl: `/api/files/file_${index}/download`,
    filename: `holaday-image-${index}.png`,
    mimetype: 'image/png',
    sizeBytes: 1234,
    expiresAt: '2026-06-12T00:00:00.000Z',
    kind: 'output',
  };
}

const save: SaveImageFn = vi.fn(async (_img, index) => attachmentFor(index));

function okGenerate(images = [{ buffer: Buffer.from('PNG'), mimeType: 'image/png' }]) {
  return vi.fn().mockResolvedValue({ images, model: 'gemini-3.1-flash-image' });
}

describe('buildImagePrompt — P0 marketing compliance', () => {
  it('passes plain images through unchanged (no constraint)', () => {
    expect(buildImagePrompt('画一只橘猫', 'flash')).toBe('画一只橘猫');
  });
  it('appends the no-fabricated-promo constraint for marketing keywords', () => {
    const p = buildImagePrompt('做一张促销海报', 'flash');
    expect(p).toContain('做一张促销海报');
    expect(p).toContain('严格约束');
    expect(p).toContain('不得自行添加');
  });
  it('appends the constraint for Pro-tier (text/poster) images', () => {
    expect(buildImagePrompt('设计一张杂志封面', 'pro')).toContain('严格约束');
  });
  it('forbids a second offer when only one was given (negative example)', () => {
    const p = buildImagePrompt('做一张写着“全场五折”的促销海报', 'pro');
    expect(p).toContain('只给了一个优惠就只呈现这一个');
    expect(p).toContain('不要补第二个');
  });
});

describe('runImageTask', () => {
  it('sends the marketing compliance constraint to the model for promo posters', async () => {
    const generate = okGenerate();
    await runImageTask({
      intent: '做一张写着“全场五折”的促销海报',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });
    const sentPrompt = generate.mock.calls[0]![0].prompt;
    expect(sentPrompt).toContain('全场五折'); // user text preserved verbatim
    expect(sentPrompt).toContain('不要补第二个'); // hard constraint attached
  });

  it('does NOT add the constraint to a plain non-marketing image', async () => {
    const generate = okGenerate();
    await runImageTask({ intent: '画一只猫', apiKey: 'k', save, logger: fakeLogger(), generate });
    expect(generate.mock.calls[0]![0].prompt).toBe('画一只猫');
  });

  it('generates with NB2 by default and returns an attachment', async () => {
    const generate = okGenerate();
    const out = await runImageTask({
      intent: '画一只橘猫',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });

    expect(out.status).toBe('completed');
    expect(out.tier).toBe('flash');
    expect(out.attachments).toHaveLength(1);
    expect(out.summary).toContain('Nano Banana 2');
    // adapter called with the flash model + the prompt
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.1-flash-image', prompt: '画一只橘猫' }),
    );
  });

  it('generates the requested number of images and forwards the selected aspect ratio', async () => {
    const generate = okGenerate();
    const saveMany = vi.fn(async (_img, index: number) => attachmentFor(index));

    const out = await runImageTask({
      intent: '画一只橘猫',
      imageCount: 3,
      aspectRatio: '16:9',
      apiKey: 'k',
      save: saveMany,
      logger: fakeLogger(),
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: '16:9' }));
    expect(out.attachments).toHaveLength(3);
    expect(out.summary).toContain('已生成 3 张图片');
  });

  it('reports partial success when fewer images are delivered than requested', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        images: [{ buffer: Buffer.from('FIRST'), mimeType: 'image/png' }],
        model: 'gemini-3.1-flash-image',
      })
      .mockRejectedValueOnce(
        new GeminiImageError('request timed out', 'timeout'),
      );
    const saveOne = vi.fn(async (_img, index: number) => attachmentFor(index));

    const out = await runImageTask({
      intent: '生成两张产品图',
      imageCount: 2,
      apiKey: 'k',
      save: saveOne,
      logger: fakeLogger(),
      generate,
    });

    expect(out.status).toBe('partial_success');
    expect(out.attachments).toHaveLength(1);
    expect(out.summary).toContain('已生成 1/2 张图片');
    expect(out.summary).toContain('未完成');
  });

  it('routes poster asks to Pro and labels the summary', async () => {
    const generate = okGenerate();
    const out = await runImageTask({
      intent: '做一张双十一促销海报',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });

    expect(out.tier).toBe('pro');
    expect(out.summary).toContain('Nano Banana Pro');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3-pro-image', apiVersion: 'v1beta' }),
    );
  });

  it('keeps a configured Pro model on v1beta without relying on its model id', async () => {
    const generate = okGenerate();

    await runImageTask({
      intent: '做一张产品海报',
      preferredTier: 'pro',
      proModel: 'custom-pro-model',
      baseUrl: 'https://gw.internal',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-pro-model',
        apiVersion: 'v1beta',
        baseUrl: 'https://gw.internal',
      }),
    );
  });

  it('forwards input images for edit mode and notes it in the summary', async () => {
    const generate = okGenerate();
    const out = await runImageTask({
      intent: '把背景换成海边',
      inputImages: [{ data: 'B64', mimeType: 'image/jpeg' }],
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });

    expect(out.status).toBe('completed');
    expect(out.summary).toContain('编辑');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImages: [{ data: 'B64', mimeType: 'image/jpeg' }],
      }),
    );
  });

  it('rejects locked-subject mode without a subject image before generation', async () => {
    const generate = okGenerate();
    const out = await runImageTask({
      intent: '把主角放到雪山背景里',
      mode: 'lock_subject',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });

    expect(out.status).toBe('failed');
    expect(out.reason).toContain('主角图');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects locked-subject mode when identity verification is unavailable', async () => {
    const generate = okGenerate();
    const out = await runImageTask({
      intent: '把背景换成雪山',
      mode: 'lock_subject',
      inputImages: [{ data: 'SUBJECT', mimeType: 'image/jpeg' }],
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });

    expect(out.status).toBe('failed');
    expect(out.reason).toContain('一致性复核');
    expect(generate).not.toHaveBeenCalled();
  });

  it('enforces first-image identity preservation for locked-subject generation', async () => {
    const generate = okGenerate();
    const out = await runImageTask({
      intent: '把背景换成雪山',
      mode: 'lock_subject',
      inputImages: [
        { data: 'SUBJECT', mimeType: 'image/jpeg' },
        { data: 'STYLE', mimeType: 'image/png' },
      ],
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
      verifySubject: vi.fn().mockResolvedValue({
        status: 'pass',
        confidence: 0.96,
        reason: '身份特征一致',
      }),
    });

    const sentPrompt = generate.mock.calls[0]![0].prompt;
    expect(sentPrompt).toContain('第一张输入图片是必须锁定的主角');
    expect(sentPrompt).toContain('不得将第二张及后续参考图中的主体身份替换到主角上');
    expect(sentPrompt).toContain('只改变用户明确要求的背景、风格、光线、场景、动作、姿态或构图');
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('锁定主角');
    expect(out.subjectConsistency).toMatchObject({ checked: 1, passed: 1, failed: 0 });
  });

  it('regenerates once when the first locked-subject candidate fails verification', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        images: [{ buffer: Buffer.from('WRONG'), mimeType: 'image/png' }],
        model: 'gemini-3.1-flash-image',
      })
      .mockResolvedValueOnce({
        images: [{ buffer: Buffer.from('MATCH'), mimeType: 'image/png' }],
        model: 'gemini-3.1-flash-image',
      });
    const verifySubject = vi
      .fn()
      .mockResolvedValueOnce({ status: 'fail', confidence: 0.95, reason: '脸部不一致' })
      .mockResolvedValueOnce({ status: 'pass', confidence: 0.92, reason: '身份一致' });
    const saveVerified = vi.fn(async (_img, index: number) => attachmentFor(index));

    const out = await runImageTask({
      intent: '换成电影夜景',
      mode: 'lock_subject',
      inputImages: [{ data: 'SUBJECT', mimeType: 'image/jpeg' }],
      apiKey: 'k',
      save: saveVerified,
      logger: fakeLogger(),
      generate,
      verifySubject,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(verifySubject).toHaveBeenCalledTimes(2);
    expect(saveVerified).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('completed');
    expect(out.subjectConsistency).toMatchObject({ checked: 2, passed: 1, failed: 1 });
  });

  it('does not deliver a locked-subject image that still fails after regeneration', async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({
        images: [{ buffer: Buffer.from('WRONG'), mimeType: 'image/png' }],
        model: 'gemini-3.1-flash-image',
      });
    const verifySubject = vi.fn().mockResolvedValue({
      status: 'fail',
      confidence: 0.9,
      reason: '关键身份特征不一致',
    });
    const saveRejected = vi.fn(async (_img, index: number) => attachmentFor(index));

    const out = await runImageTask({
      intent: '换成电影夜景',
      mode: 'lock_subject',
      inputImages: [{ data: 'SUBJECT', mimeType: 'image/jpeg' }],
      apiKey: 'k',
      save: saveRejected,
      logger: fakeLogger(),
      generate,
      verifySubject,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(saveRejected).not.toHaveBeenCalled();
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('主体一致性复核未通过');
  });

  it('routes a 4K poster to Pro without an unverified explicit resolution', async () => {
    const generate = okGenerate();
    const out = await runImageTask({
      intent: '做一张4K高清电影海报',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });
    expect(out.tier).toBe('pro');
    // Keep resolution unset until accepted imageSize values are live-verified for this model.
    const call = generate.mock.calls[0]![0];
    expect(call.model).toBe('gemini-3-pro-image');
    expect(call.resolution).toBeUndefined();
  });

  it('persists every image when the model returns a batch', async () => {
    const generate = okGenerate([
      { buffer: Buffer.from('A'), mimeType: 'image/png' },
      { buffer: Buffer.from('B'), mimeType: 'image/png' },
    ]);
    const out = await runImageTask({
      intent: '生成图片：城市夜景',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });
    expect(out.attachments).toHaveLength(2);
  });

  it('skips unsupported generated mime types instead of exposing them as downloads', async () => {
    const generate = okGenerate([
      { buffer: Buffer.from('<svg></svg>'), mimeType: 'image/svg+xml' },
      { buffer: Buffer.from('PNG'), mimeType: 'image/png; charset=binary' },
    ]);
    const saveMimeTypes: string[] = [];
    const out = await runImageTask({
      intent: '生成图片：城市夜景',
      apiKey: 'k',
      save: vi.fn(async (img, index) => {
        saveMimeTypes.push(img.mimeType);
        return attachmentFor(index);
      }),
      logger: fakeLogger(),
      generate,
    });
    expect(out.status).toBe('partial_success');
    expect(out.attachments).toHaveLength(1);
    expect(out.summary).toContain('已生成 1/2 张图片');
    expect(saveMimeTypes).toEqual(['image/png']);
  });

  it('fails clearly when intent is empty and no input image', async () => {
    const out = await runImageTask({
      intent: '   ',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate: okGenerate(),
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('描述');
  });

  it('maps a content block to a friendly Chinese reason', async () => {
    const generate = vi.fn().mockRejectedValue(
      new GeminiImageError('blocked', 'blocked', undefined, 'PROHIBITED_CONTENT'),
    );
    const out = await runImageTask({
      intent: '画一些违规内容',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('安全策略');
  });

  it('maps a missing api key to an admin-facing reason', async () => {
    const generate = vi.fn().mockRejectedValue(
      new GeminiImageError('GEMINI_API_KEY not configured', 'no_api_key'),
    );
    const out = await runImageTask({
      intent: '画一只猫',
      apiKey: '',
      save,
      logger: fakeLogger(),
      generate,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('管理员');
  });

  it('degrades Pro→NB2 when Pro is overloaded (503)', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new GeminiImageError('overloaded', 'http', 503))
      .mockResolvedValueOnce({
        images: [{ buffer: Buffer.from('NB2'), mimeType: 'image/png' }],
        model: 'gemini-3.1-flash-image',
      });
    const out = await runImageTask({
      intent: '做一张促销海报，写"全场五折"',
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });

    expect(out.status).toBe('completed');
    expect(out.tier).toBe('flash');
    expect(out.summary).toContain('Pro 档繁忙');
    // first attempt used the Pro model, fallback used flash
    expect(generate.mock.calls[0]![0].model).toBe('gemini-3-pro-image');
    expect(generate.mock.calls[0]![0].apiVersion).toBe('v1beta');
    expect(generate.mock.calls[1]![0].model).toBe('gemini-3.1-flash-image');
    expect(generate.mock.calls[1]![0].apiVersion).toBe('v1');
  });

  it('does NOT degrade when NB2 itself fails (no Pro to fall back from)', async () => {
    const generate = vi
      .fn()
      .mockRejectedValue(new GeminiImageError('overloaded', 'http', 503));
    const out = await runImageTask({
      intent: '画一只猫', // NB2 route
      apiKey: 'k',
      save,
      logger: fakeLogger(),
      generate,
    });
    expect(out.status).toBe('failed');
    expect(generate).toHaveBeenCalledTimes(1); // no second attempt
  });

  it('fails when every save fails', async () => {
    const failingSave: SaveImageFn = vi.fn().mockRejectedValue(new Error('disk full'));
    const out = await runImageTask({
      intent: '画一只猫',
      apiKey: 'k',
      save: failingSave,
      logger: fakeLogger(),
      generate: okGenerate(),
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('保存失败');
  });
});
