import { describe, expect, it, vi } from 'vitest';
import { verifyAudioVisualSync } from './video-av-sync-verifier.js';

function geminiResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('verifyAudioVisualSync', () => {
  it('returns a pass only when the independent video review provides temporal evidence', async () => {
    const runFfmpeg = vi.fn(async () => {});
    const readFile = vi.fn(async () => Buffer.from('qa-proxy'));
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{
          parts: Array<{
            inlineData?: { mimeType?: string; data?: string };
            videoMetadata?: { fps?: number };
          }>;
        }>;
        generationConfig: Record<string, unknown>;
      };
      expect(body.contents[0]?.parts[0]).toEqual({
        inlineData: {
          mimeType: 'video/mp4',
          data: Buffer.from('qa-proxy').toString('base64'),
        },
        videoMetadata: { fps: 5 },
      });
      expect(body.generationConfig).not.toHaveProperty('temperature');
      return geminiResponse(
        JSON.stringify({
          status: 'pass',
          reason: '可见口播片段中的嘴部启停与语音节奏一致。',
          evidence: [
            { startSeconds: 0.8, endSeconds: 2.2, observation: '开口与语音同时开始' },
            { startSeconds: 4.1, endSeconds: 5.6, observation: '停顿时嘴部同步停止' },
          ],
        }),
      );
    });

    const result = await verifyAudioVisualSync(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/work',
        durationMs: 8_000,
        apiKey: 'gemini-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-3.6-flash',
      },
      { runFfmpeg, readFile, fetchImpl },
    );

    expect(result).toEqual({
      status: 'pass',
      reason: '可见口播片段中的嘴部启停与语音节奏一致。',
      evidence: [
        { startSeconds: 0.8, endSeconds: 2.2, observation: '开口与语音同时开始' },
        { startSeconds: 4.1, endSeconds: 5.6, observation: '停顿时嘴部同步停止' },
      ],
      model: 'gemini-3.6-flash',
    });
    expect(runFfmpeg).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'ffmpeg',
        args: expect.arrayContaining([
          '-i',
          '/tmp/final.mp4',
          '-c:v',
          'libx264',
          '/tmp/work/av-sync-review.mp4',
        ]),
      }),
      {},
    );
  });

  it('fails closed when the reviewer finds a persistent lead or lag', async () => {
    const result = await verifyAudioVisualSync(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/work',
        durationMs: 8_000,
        apiKey: 'gemini-key',
      },
      {
        runFfmpeg: vi.fn(async () => {}),
        readFile: vi.fn(async () => Buffer.from('qa-proxy')),
        fetchImpl: vi.fn(async () =>
          geminiResponse(
            JSON.stringify({
              status: 'fail',
              reason: '多个口播片段中嘴部运动持续晚于声音。',
              evidence: [{ startSeconds: 1, endSeconds: 2.5, observation: '声音开始后嘴部才运动' }],
            }),
          ),
        ),
      },
    );

    expect(result.status).toBe('fail');
    expect(result.reason).toContain('持续晚于声音');
  });

  it('returns unknown instead of manufacturing confidence from thin evidence', async () => {
    const result = await verifyAudioVisualSync(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/work',
        durationMs: 8_000,
        apiKey: 'gemini-key',
      },
      {
        runFfmpeg: vi.fn(async () => {}),
        readFile: vi.fn(async () => Buffer.from('qa-proxy')),
        fetchImpl: vi.fn(async () =>
          geminiResponse(
            JSON.stringify({
              status: 'pass',
              reason: '看起来同步。',
              evidence: [],
            }),
          ),
        ),
      },
    );

    expect(result).toMatchObject({
      status: 'unknown',
      evidence: [],
    });
  });

  it('rejects duplicated or overlapping pass windows as insufficient evidence', async () => {
    const result = await verifyAudioVisualSync(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/work',
        durationMs: 8_000,
        apiKey: 'gemini-key',
      },
      {
        runFfmpeg: vi.fn(async () => {}),
        readFile: vi.fn(async () => Buffer.from('qa-proxy')),
        fetchImpl: vi.fn(async () =>
          geminiResponse(
            JSON.stringify({
              status: 'pass',
              reason: '两个片段看起来同步。',
              evidence: [
                { startSeconds: 1, endSeconds: 3, observation: '语音和开口同时开始' },
                { startSeconds: 1.5, endSeconds: 2.5, observation: '重复观察同一段口播' },
              ],
            }),
          ),
        ),
      },
    );

    expect(result).toMatchObject({
      status: 'unknown',
      evidence: [],
    });
  });

  it('never retries a non-idempotent paid review request', async () => {
    const fetchImpl = vi.fn(async () => new Response('unavailable', { status: 503 }));

    const result = await verifyAudioVisualSync(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/work',
        durationMs: 8_000,
        apiKey: 'gemini-key',
      },
      {
        runFfmpeg: vi.fn(async () => {}),
        readFile: vi.fn(async () => Buffer.from('qa-proxy')),
        fetchImpl,
      },
    );

    expect(result.status).toBe('unknown');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
