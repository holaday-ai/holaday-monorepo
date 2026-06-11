import { describe, it, expect, vi } from 'vitest';
import {
  generateImages,
  GeminiImageError,
  type GenerateImagesParams,
} from './gemini-image-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A minimal successful image response with one PNG candidate. */
function okImageBody(base64: string, mimeType = 'image/png') {
  return {
    candidates: [
      {
        content: { parts: [{ inlineData: { mimeType, data: base64 } }] },
        finishReason: 'STOP',
      },
    ],
  };
}

const BASE: Omit<GenerateImagesParams, 'fetchImpl'> = {
  apiKey: 'test-key',
  prompt: '画一只橘猫',
  model: 'gemini-3.1-flash-image',
};

describe('generateImages', () => {
  it('decodes the base64 image from a well-formed response', async () => {
    const b64 = Buffer.from('PNGBYTES').toString('base64');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okImageBody(b64)));

    const result = await generateImages({ ...BASE, fetchImpl });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.mimeType).toBe('image/png');
    expect(result.images[0]!.buffer.toString('utf8')).toBe('PNGBYTES');
    expect(result.model).toBe('gemini-3.1-flash-image');
    expect(result.finishReason).toBe('STOP');
  });

  it('throws no_api_key when the key is empty', async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateImages({ ...BASE, apiKey: '  ', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'no_api_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('targets the right URL and sends the api-key header + prompt body', async () => {
    const b64 = Buffer.from('x').toString('base64');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okImageBody(b64)));

    await generateImages({ ...BASE, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
    );
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].text).toBe('画一只橘猫');
    // No imageConfig / responseModalities unless asked.
    expect(body.generationConfig).toBeUndefined();
  });

  it('honours a custom baseUrl (proxy/gateway override)', async () => {
    const b64 = Buffer.from('x').toString('base64');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okImageBody(b64)));

    await generateImages({ ...BASE, baseUrl: 'https://gw.internal/', fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(
      'https://gw.internal/v1beta/models/gemini-3.1-flash-image:generateContent',
    );
  });

  it('sends inputImages as inlineData parts (图生图 / edit mode)', async () => {
    const b64 = Buffer.from('out').toString('base64');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okImageBody(b64)));

    await generateImages({
      ...BASE,
      prompt: '把背景换成海边',
      inputImages: [{ data: 'INPUTB64', mimeType: 'image/jpeg' }],
      fetchImpl,
    });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[0].parts).toHaveLength(2);
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: 'INPUTB64',
    });
  });

  it('sets imageConfig.resolution only when resolution is provided', async () => {
    const b64 = Buffer.from('x').toString('base64');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okImageBody(b64)));

    await generateImages({ ...BASE, resolution: '4096x4096', fetchImpl });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.generationConfig.imageConfig).toEqual({ resolution: '4096x4096' });
  });

  it('collects images across multiple candidates (batch)', async () => {
    const a = Buffer.from('A').toString('base64');
    const b = Buffer.from('B').toString('base64');
    const body = {
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: 'image/png', data: a } }] } },
        { content: { parts: [{ inlineData: { mimeType: 'image/png', data: b } }] } },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));

    const result = await generateImages({ ...BASE, fetchImpl });
    expect(result.images.map((i) => i.buffer.toString('utf8'))).toEqual(['A', 'B']);
  });

  it('parses snake_case inline_data defensively', async () => {
    const b64 = Buffer.from('snake').toString('base64');
    const body = {
      candidates: [
        { content: { parts: [{ inline_data: { mime_type: 'image/webp', data: b64 } }] } },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));

    const result = await generateImages({ ...BASE, fetchImpl });
    expect(result.images[0]!.mimeType).toBe('image/webp');
    expect(result.images[0]!.buffer.toString('utf8')).toBe('snake');
  });

  it('throws blocked when the prompt is refused with no image', async () => {
    const body = { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, candidates: [] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));

    await expect(generateImages({ ...BASE, fetchImpl })).rejects.toMatchObject({
      kind: 'blocked',
      detail: 'PROHIBITED_CONTENT',
    });
  });

  it('throws no_image when the model returns only text', async () => {
    const body = {
      candidates: [{ content: { parts: [{ text: '抱歉我无法生成' }] }, finishReason: 'STOP' }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));

    await expect(generateImages({ ...BASE, fetchImpl })).rejects.toMatchObject({
      kind: 'no_image',
    });
  });

  it('throws http with status + body on a non-2xx response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('quota exceeded', { status: 429 }));

    const err = await generateImages({ ...BASE, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiImageError);
    expect(err.kind).toBe('http');
    expect(err.status).toBe(429);
    expect(err.detail).toContain('quota exceeded');
  });

  it('throws network on fetch rejection', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(generateImages({ ...BASE, fetchImpl })).rejects.toMatchObject({
      kind: 'network',
    });
  });
});
