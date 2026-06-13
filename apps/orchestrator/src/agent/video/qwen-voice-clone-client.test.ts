import { describe, expect, it } from 'vitest';
import {
  enrollVoice,
  QwenVoiceCloneError,
  synthesizeSpeech,
} from './qwen-voice-clone-client.js';

function jsonQueue(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const KEY = 'sk-test';

describe('enrollVoice', () => {
  it('posts the enrollment body + returns the voice id (real shape)', async () => {
    const { fetchImpl, calls } = jsonQueue([
      {
        body: {
          output: {
            target_model: 'qwen3-tts-vc-2026-01-22',
            voice: 'qwen-tts-vc-holaday-voice-20260613215600977-2339',
          },
          usage: { count: 1 },
        },
      },
    ]);
    const out = await enrollVoice({ apiKey: KEY, audioBase64: 'QUJD', fetchImpl });
    expect(out.voiceId).toBe('qwen-tts-vc-holaday-voice-20260613215600977-2339');
    expect(out.targetModel).toBe('qwen3-tts-vc-2026-01-22');
    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(calls[0]?.url).toContain('/api/v1/services/audio/tts/customization');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe('qwen-voice-enrollment');
    expect(sent.input.action).toBe('create');
    expect(sent.input.target_model).toBe('qwen3-tts-vc-2026-01-22');
    expect(sent.input.audio.data).toBe('data:audio/mp4;base64,QUJD');
  });

  it('honours a custom audioMime (mp3/wav)', async () => {
    const { fetchImpl, calls } = jsonQueue([{ body: { output: { voice: 'v1' } } }]);
    await enrollVoice({ apiKey: KEY, audioBase64: 'QUJD', audioMime: 'audio/wav', fetchImpl });
    const sent = JSON.parse((calls[0]?.init as RequestInit).body as string);
    expect(sent.input.audio.data).toBe('data:audio/wav;base64,QUJD');
  });

  it('throws no_api_key when key empty', async () => {
    await expect(enrollVoice({ apiKey: '', audioBase64: 'x' })).rejects.toMatchObject({
      kind: 'no_api_key',
    });
  });

  it('throws http on 401', async () => {
    const { fetchImpl } = jsonQueue([{ status: 401, body: { code: 'InvalidApiKey' } }]);
    await expect(enrollVoice({ apiKey: KEY, audioBase64: 'x', fetchImpl })).rejects.toMatchObject({
      kind: 'http',
      status: 401,
    });
  });

  it('throws no_voice when output has no voice', async () => {
    const { fetchImpl } = jsonQueue([{ body: { output: {} } }]);
    await expect(enrollVoice({ apiKey: KEY, audioBase64: 'x', fetchImpl })).rejects.toMatchObject({
      kind: 'no_voice',
    });
  });
});

describe('synthesizeSpeech', () => {
  it('posts text+voice + returns audioUrl + characters (real shape)', async () => {
    const { fetchImpl, calls } = jsonQueue([
      {
        body: {
          output: {
            audio: {
              data: '',
              expires_at: 1781445405,
              id: 'audio_b3fe882a',
              url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x.wav?Expires=1',
            },
            finish_reason: 'stop',
          },
          usage: { characters: 50 },
        },
      },
    ]);
    const out = await synthesizeSpeech({ apiKey: KEY, voiceId: 'v1', text: '你好', fetchImpl });
    expect(out.audioUrl).toContain('.wav');
    expect(out.characters).toBe(50);
    expect(out.expiresAt).toBe(1781445405);
    expect(out.audioId).toBe('audio_b3fe882a');
    const sent = JSON.parse((calls[0]?.init as RequestInit).body as string);
    expect(calls[0]?.url).toContain('/api/v1/services/aigc/multimodal-generation/generation');
    expect(sent.model).toBe('qwen3-tts-vc-2026-01-22');
    expect(sent.input).toEqual({ text: '你好', voice: 'v1' });
  });

  it('throws no_audio when output has no url', async () => {
    const { fetchImpl } = jsonQueue([{ body: { output: { audio: {} } } }]);
    await expect(
      synthesizeSpeech({ apiKey: KEY, voiceId: 'v1', text: 'x', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'no_audio' });
  });
});

describe('QwenVoiceCloneError', () => {
  it('is an Error with a discriminated kind', () => {
    const e = new QwenVoiceCloneError('x', 'no_voice');
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('no_voice');
  });
});
