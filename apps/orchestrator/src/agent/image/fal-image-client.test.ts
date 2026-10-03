import { describe, expect, it, vi } from 'vitest';
import { buildFalImageInput, generateFalImages } from './fal-image-client.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const download = vi.fn(async () => ({
  buffer: Buffer.from('PNG'),
  contentType: 'image/png',
  sizeBytes: 3,
}));

function completedQueue(output: unknown) {
  return vi
    .fn()
    .mockResolvedValueOnce(json(200, { request_id: 'r' }))
    .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
    .mockResolvedValueOnce(json(200, output));
}

describe('fal Nano Banana 2 client', () => {
  it('builds the documented input with data-URI references for edits', () => {
    expect(
      buildFalImageInput({
        model: 'fal-ai/nano-banana-2',
        prompt: 'cat',
        aspectRatio: '16:9',
        inputImages: [{ data: 'AAA', mimeType: 'image/jpeg' }],
      }),
    ).toEqual({
      prompt: 'cat',
      num_images: 1,
      aspect_ratio: '16:9',
      resolution: '1K',
      output_format: 'png',
      image_urls: ['data:image/jpeg;base64,AAA'],
    });
    expect(buildFalImageInput({ model: 'm', prompt: 'p', resolution: '4096x4096' })).toMatchObject(
      { resolution: '1K', aspect_ratio: '1:1' },
    );
  });

  it('uses the text-to-image endpoint without inputs and the edit endpoint with inputs', async () => {
    const t2i = completedQueue({ images: [{ url: 'https://v3.fal.media/a.png' }] });
    await generateFalImages({
      apiKey: 'k',
      model: 'fal-ai/nano-banana-2',
      editModel: 'fal-ai/nano-banana-2/edit',
      prompt: 'p',
      fetchImpl: t2i,
      download,
    });
    expect(t2i.mock.calls[0]?.[0]).toBe('https://queue.fal.run/fal-ai/nano-banana-2');

    const edit = completedQueue({ images: [{ url: 'data:image/png;base64,UE5H' }] });
    const out = await generateFalImages({
      apiKey: 'k',
      model: 'fal-ai/nano-banana-2',
      editModel: 'fal-ai/nano-banana-2/edit',
      prompt: 'p',
      inputImages: [{ data: 'AAA', mimeType: 'image/png' }],
      fetchImpl: edit,
      download,
    });
    expect(edit.mock.calls[0]?.[0]).toBe('https://queue.fal.run/fal-ai/nano-banana-2/edit');
    expect(out.images[0]?.buffer.toString()).toBe('PNG');
    expect(out.model).toBe('fal-ai/nano-banana-2/edit');
  });

  it('maps exhausted balance and content-policy failures to image error kinds', async () => {
    const broke = vi.fn().mockResolvedValueOnce(
      new Response('User is locked. Reason: Exhausted balance', { status: 403 }),
    );
    await expect(
      generateFalImages({ apiKey: 'k', model: 'm', editModel: 'e', prompt: 'p', fetchImpl: broke }),
    ).rejects.toMatchObject({ name: 'ImageProviderError', kind: 'exhausted_balance', provider: 'fal' });

    const blocked = vi
      .fn()
      .mockResolvedValueOnce(json(200, { request_id: 'r' }))
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        new Response('{"detail":[{"type":"content_policy_violation"}]}', { status: 422 }),
      );
    await expect(
      generateFalImages({ apiKey: 'k', model: 'm', editModel: 'e', prompt: 'p', fetchImpl: blocked }),
    ).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('reports no_image for an empty result and no_api_key without a key', async () => {
    const empty = completedQueue({ images: [], description: 'nothing' });
    await expect(
      generateFalImages({ apiKey: 'k', model: 'm', editModel: 'e', prompt: 'p', fetchImpl: empty }),
    ).rejects.toMatchObject({ kind: 'no_image' });
    await expect(
      generateFalImages({ apiKey: '', model: 'm', editModel: 'e', prompt: 'p' }),
    ).rejects.toMatchObject({ kind: 'no_api_key' });
  });
});
