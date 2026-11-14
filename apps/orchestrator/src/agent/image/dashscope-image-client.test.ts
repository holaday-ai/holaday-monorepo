import { describe, expect, it, vi } from 'vitest';
import {
  buildDashScopeImageBody,
  dashScopeImageFamily,
  dashScopeImageSize,
  generateDashScopeImages,
} from './dashscope-image-client.js';
import { ImageProviderError } from './image-provider-types.js';

function response(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const okBody = {
  output: {
    choices: [{ message: { content: [{ image: 'https://oss/result.png?Expires=1' }] } }],
  },
  usage: { image_count: 1 },
};

const download = vi.fn(async () => ({
  buffer: Buffer.from('PNG'),
  contentType: 'image/png',
  sizeBytes: 3,
}));

describe('dashscope image request shape', () => {
  it('detects model families', () => {
    expect(dashScopeImageFamily('wan2.7-image')).toBe('wan');
    expect(dashScopeImageFamily('qwen-image-2.0-pro')).toBe('qwen');
  });

  it('maps aspect ratios to documented sizes per family', () => {
    expect(dashScopeImageSize('qwen-image-2.0-pro', '16:9', false)).toBe('2048*1152');
    expect(dashScopeImageSize('qwen-image-max', '16:9', false)).toBe('1664*928');
    expect(dashScopeImageSize('wan2.7-image', '9:16', false)).toBe('1152*2048');
    // Wan edit keeps the input aspect; plain qwen-image-edit cannot take a size.
    expect(dashScopeImageSize('wan2.7-image', '9:16', true)).toBeUndefined();
    expect(dashScopeImageSize('qwen-image-edit', '1:1', true)).toBeUndefined();
  });

  it('builds a Qwen poster body: images first, no prompt rewriting, no watermark', () => {
    const body = buildDashScopeImageBody({
      model: 'qwen-image-2.0-pro',
      prompt: '海报：开业大吉',
      aspectRatio: '3:4',
      inputImages: [{ data: 'AAA', mimeType: 'image/png' }],
    });
    expect(body).toEqual({
      model: 'qwen-image-2.0-pro',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ image: 'data:image/png;base64,AAA' }, { text: '海报：开业大吉' }],
          },
        ],
      },
      parameters: { n: 1, watermark: false, size: '1344*1792', prompt_extend: false },
    });
  });

  it('builds a Wan 2.7 edit body: text first, up to 9 images', () => {
    const images = Array.from({ length: 12 }, (_, i) => ({
      data: `D${i}`,
      mimeType: 'image/jpeg',
    }));
    const body = buildDashScopeImageBody({
      model: 'wan2.7-image',
      prompt: '换背景',
      inputImages: images,
    });
    const content =
      (body.input as { messages: Array<{ content: unknown[] }> }).messages[0]?.content ?? [];
    expect(content[0]).toEqual({ text: '换背景' });
    expect(content).toHaveLength(10);
    expect(body.parameters).toEqual({ n: 1, watermark: false });
  });
});

describe('generateDashScopeImages', () => {
  it('posts to the sync multimodal endpoint and downloads the result', async () => {
    const fetchImpl = vi.fn(async () => response(200, okBody));
    const out = await generateDashScopeImages({
      apiKey: 'k',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/',
      workspaceId: 'ws',
      model: 'wan2.7-image',
      prompt: '一只猫',
      fetchImpl,
      download,
    });
    expect(out.images).toEqual([{ buffer: Buffer.from('PNG'), mimeType: 'image/png' }]);
    expect(out.model).toBe('wan2.7-image');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect((init.headers as Record<string, string>)['x-dashscope-workspace']).toBe('ws');
    expect((init.headers as Record<string, string>)['x-dashscope-async']).toBeUndefined();
  });

  it('maps a missing key to no_api_key without calling the network', async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateDashScopeImages({ apiKey: ' ', model: 'wan2.7-image', prompt: 'x', fetchImpl }),
    ).rejects.toMatchObject({ name: 'ImageProviderError', kind: 'no_api_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps moderation rejections to blocked', async () => {
    const fetchImpl = vi.fn(async () =>
      response(400, {
        code: 'DataInspectionFailed',
        message: 'Input data may contain inappropriate content.',
      }),
    );
    await expect(
      generateDashScopeImages({ apiKey: 'k', model: 'qwen-image-2.0-pro', prompt: 'x', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'blocked', status: 400 });
  });

  it('retries 429 then surfaces an http error with status', async () => {
    const fetchImpl = vi.fn(async () => response(429, { code: 'Throttling', message: 'rate' }));
    const error = await generateDashScopeImages({
      apiKey: 'k',
      model: 'qwen-image-2.0-pro',
      prompt: 'x',
      fetchImpl,
      maxRetries: 1,
      retryBaseMs: 0,
    }).catch((err: unknown) => err);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(error).toMatchObject({ kind: 'http', status: 429 });
  });

  it('does not resend a billable request after a transport failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    await expect(
      generateDashScopeImages({ apiKey: 'k', model: 'wan2.7-image', prompt: 'x', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports no_image when the provider returns no image url', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, { output: { choices: [{ message: { content: [{ text: 'refused' }] } }] } }),
    );
    await expect(
      generateDashScopeImages({ apiKey: 'k', model: 'wan2.7-image', prompt: 'x', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'no_image' });
  });
});
