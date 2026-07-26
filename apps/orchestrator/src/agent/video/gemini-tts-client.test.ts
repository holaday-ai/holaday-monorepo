import { describe, expect, it, vi } from 'vitest';
import { GeminiTtsError, synthesizeGeminiSpeech } from './gemini-tts-client.js';

describe('synthesizeGeminiSpeech', () => {
  it('requests Mandarin speech and wraps returned PCM in a WAV container', async () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: {
          responseModalities: string[];
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: string };
            };
          };
        };
      };
      expect(body.contents[0]?.parts[0]?.text).toContain('请用自然、清晰的普通话');
      expect(body.contents[0]?.parts[0]?.text).toContain('今天阳光很好。');
      expect(body).not.toHaveProperty('model');
      expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
      expect(
        body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
      ).toBe('Kore');

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/L16;codec=pcm;rate=24000',
                      data: pcm.toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const out = await synthesizeGeminiSpeech({
      apiKey: 'gemini-key',
      text: '今天阳光很好。',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/v1beta/models/gemini-2.5-flash-preview-tts:generateContent',
    );
    expect(out.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(out.audioBuffer.readUInt32LE(24)).toBe(24_000);
    expect(out.audioBuffer.subarray(44)).toEqual(pcm);
    expect(out.mimeType).toBe('audio/wav');
  });

  it('retries a transient network failure before returning speech', async () => {
    const pcm = Buffer.from([5, 6, 7, 8]);
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket reset'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'audio/L16;codec=pcm;rate=24000',
                        data: pcm.toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const out = await synthesizeGeminiSpeech({
      apiKey: 'gemini-key',
      text: '网络恢复后继续。',
      maxRetries: 1,
      retryBaseMs: 0,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.audioBuffer.subarray(44)).toEqual(pcm);
  });

  it('marks permission failures non-retryable and keeps provider detail internal', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'permission denied' } }), { status: 403 }),
    );

    await expect(
      synthesizeGeminiSpeech({
        apiKey: 'gemini-key',
        text: '测试',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: 'GeminiTtsError',
      kind: 'permission_denied',
      status: 403,
      retryable: false,
    } satisfies Partial<GeminiTtsError>);
  });
});
