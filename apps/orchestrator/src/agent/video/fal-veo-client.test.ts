import { describe, expect, it, vi } from 'vitest';
import { buildFalVeoInput, falVeoDuration, generateFalVeoVideo } from './fal-veo-client.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fal Veo 3.1 adapter', () => {
  it('maps requested seconds to the shortest allowed fal duration', () => {
    expect(falVeoDuration(undefined)).toBe('8s');
    expect(falVeoDuration(3)).toBe('4s');
    expect(falVeoDuration(5)).toBe('6s');
    expect(falVeoDuration(8)).toBe('8s');
    expect(falVeoDuration(12)).toBe('8s');
  });

  it('builds the documented input and disables provider audio (lane dubs with Qwen TTS)', () => {
    expect(
      buildFalVeoInput({
        apiKey: 'k',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        resolution: '720p',
        negativePrompt: 'text',
      }),
    ).toEqual({
      prompt: 'p',
      aspect_ratio: '16:9',
      duration: '8s',
      resolution: '720p',
      generate_audio: false,
      negative_prompt: 'text',
    });
  });

  it('uses first-last-frame-to-video when a composition anchor is given', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { request_id: 'r' }))
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { video: { url: 'https://v3.fal.media/v.mp4' } }));
    const out = await generateFalVeoVideo({
      apiKey: 'fk',
      model: 'fal-ai/veo3.1/fast',
      prompt: 'p',
      startImage: { data: 'AAA', mimeType: 'image/png' },
      fetchImpl,
      sleepImpl: async () => undefined,
    });
    expect(out.videoUri).toBe('https://v3.fal.media/v.mp4');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://queue.fal.run/fal-ai/veo3.1/fast/first-last-frame-to-video',
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.first_frame_url).toBe('data:image/png;base64,AAA');
    expect(body.last_frame_url).toBe('data:image/png;base64,AAA');
  });

  it('maps fal failures onto the VeoError vocabulary the lane already handles', async () => {
    const broke = vi
      .fn()
      .mockResolvedValueOnce(new Response('User is locked. Reason: Exhausted balance', { status: 403 }));
    await expect(
      generateFalVeoVideo({ apiKey: 'fk', model: 'fal-ai/veo3.1', prompt: 'p', fetchImpl: broke }),
    ).rejects.toMatchObject({ name: 'VeoError', kind: 'quota_exhausted' });

    const invalid = vi.fn().mockResolvedValueOnce(new Response('{"detail":"bad duration"}', { status: 422 }));
    await expect(
      generateFalVeoVideo({ apiKey: 'fk', model: 'fal-ai/veo3.1', prompt: 'p', fetchImpl: invalid }),
    ).rejects.toMatchObject({ name: 'VeoError', kind: 'invalid_argument' });

    await expect(
      generateFalVeoVideo({ apiKey: '', model: 'fal-ai/veo3.1', prompt: 'p' }),
    ).rejects.toMatchObject({ name: 'VeoError', kind: 'no_api_key' });
  });
});
