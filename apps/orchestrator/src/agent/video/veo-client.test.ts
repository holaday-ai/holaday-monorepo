import { describe, expect, it } from 'vitest';
import { generateVeoVideo, VeoError } from './veo-client.js';

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

const KEY = 'gkey';
const TINY = { pollIntervalMs: 1 };

describe('generateVeoVideo', () => {
  it('submits 9:16 + numeric duration, polls to done, returns the video uri (real shape)', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { name: 'models/veo-3.0-fast-generate-001/operations/abc' } }, // submit
      { body: { done: false } }, // poll 1
      {
        body: {
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v.mp4' } }] } },
        },
      }, // poll 2
    ]);
    const out = await generateVeoVideo({ apiKey: KEY, prompt: 'a beach', fetchImpl, ...TINY });
    expect(out.videoUri).toBe('https://generativelanguage.googleapis.com/v.mp4');
    expect(typeof out.elapsedMs).toBe('number');
    // submit body: 9:16 + durationSeconds as a NUMBER + no numberOfVideos
    const subInit = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(calls[0]?.url).toContain(':predictLongRunning');
    expect(subInit.headers['x-goog-api-key']).toBe(KEY);
    const body = JSON.parse(subInit.body as string);
    expect(body.parameters.aspectRatio).toBe('9:16');
    expect(body.parameters.durationSeconds).toBe(4);
    expect(typeof body.parameters.durationSeconds).toBe('number');
    expect(body.parameters.numberOfVideos).toBeUndefined();
    expect(body.instances[0].prompt).toBe('a beach');
  });

  it('maps 403 → permission_denied (key not allowlisted)', async () => {
    const { fetchImpl } = jsonQueue([{ status: 403, body: { error: { message: 'PERMISSION_DENIED' } } }]);
    await expect(generateVeoVideo({ apiKey: KEY, prompt: 'x', fetchImpl })).rejects.toMatchObject({
      kind: 'permission_denied',
      status: 403,
    });
  });

  it('maps a 400 submit → http', async () => {
    const { fetchImpl } = jsonQueue([{ status: 400, body: { error: { message: 'bad param' } } }]);
    await expect(generateVeoVideo({ apiKey: KEY, prompt: 'x', fetchImpl })).rejects.toMatchObject({
      kind: 'http',
      status: 400,
    });
  });

  it('throws no_api_key when key empty', async () => {
    await expect(generateVeoVideo({ apiKey: '', prompt: 'x' })).rejects.toMatchObject({ kind: 'no_api_key' });
  });

  it('throws op_failed when the operation completes with an error', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { name: 'op/1' } },
      { body: { done: true, error: { code: 13, message: 'internal' } } },
    ]);
    await expect(generateVeoVideo({ apiKey: KEY, prompt: 'x', fetchImpl, ...TINY })).rejects.toMatchObject({
      kind: 'op_failed',
    });
  });

  it('throws timeout if never done within maxWaitMs', async () => {
    const { fetchImpl } = jsonQueue([{ body: { name: 'op/1' } }, { body: { done: false } }]);
    await expect(
      generateVeoVideo({ apiKey: KEY, prompt: 'x', fetchImpl, pollIntervalMs: 1, maxWaitMs: 5 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('VeoError', () => {
  it('is an Error with a discriminated kind', () => {
    expect(new VeoError('x', 'no_result').kind).toBe('no_result');
  });
});
