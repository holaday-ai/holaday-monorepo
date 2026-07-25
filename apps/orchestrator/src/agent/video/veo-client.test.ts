import { describe, expect, it } from 'vitest';
import { VeoError, generateVeoVideo } from './veo-client.js';

function jsonQueue(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    if (!r) throw new Error('jsonQueue requires at least one response');
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
          response: {
            generateVideoResponse: {
              generatedSamples: [
                { video: { uri: 'https://generativelanguage.googleapis.com/v.mp4' } },
              ],
            },
          },
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

  it('forwards the negative prompt to the Gemini video request', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { name: 'op/negative' } },
      {
        body: {
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                { video: { uri: 'https://generativelanguage.googleapis.com/v.mp4' } },
              ],
            },
          },
        },
      },
    ]);

    await generateVeoVideo({
      apiKey: KEY,
      prompt: 'a blue cup on a table',
      negativePrompt: 'person, hands, arms, body parts',
      fetchImpl,
      ...TINY,
    });

    const submit = JSON.parse(calls[0]?.init.body as string);
    expect(submit.parameters.negativePrompt).toBe('person, hands, arms, body parts');
  });

  it('maps 403 → permission_denied (key not allowlisted)', async () => {
    const { fetchImpl } = jsonQueue([
      { status: 403, body: { error: { message: 'PERMISSION_DENIED' } } },
    ]);
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

  it('backs off and retries a transient 429 using the provider retry delay', async () => {
    const { fetchImpl, calls } = jsonQueue([
      {
        status: 429,
        body: {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '3s',
              },
            ],
          },
        },
      },
      { body: { name: 'op/retried' } },
      {
        body: {
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                { video: { uri: 'https://generativelanguage.googleapis.com/retried.mp4' } },
              ],
            },
          },
        },
      },
    ]);
    const retryDelays: number[] = [];

    const out = await generateVeoVideo({
      apiKey: KEY,
      prompt: 'x',
      fetchImpl,
      pollIntervalMs: 1,
      maxRetries: 2,
      retryBaseMs: 100,
      sleepImpl: async (ms) => {
        retryDelays.push(ms);
      },
    });

    expect(out.videoUri).toContain('retried.mp4');
    expect(calls).toHaveLength(3);
    expect(retryDelays).toHaveLength(1);
    expect(retryDelays[0]).toBeGreaterThanOrEqual(3_000);
    expect(retryDelays[0]).toBeLessThanOrEqual(3_750);
  });

  it('bounds persistent 429 retries and prevents the pipeline from immediately retrying again', async () => {
    const { fetchImpl, calls } = jsonQueue([
      {
        status: 429,
        body: {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message: 'Please retry in 2s.',
          },
        },
      },
    ]);

    await expect(
      generateVeoVideo({
        apiKey: KEY,
        prompt: 'x',
        fetchImpl,
        maxRetries: 2,
        retryBaseMs: 1,
        sleepImpl: async () => {},
      }),
    ).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      retryable: false,
    });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a hard account quota exhaustion response', async () => {
    const { fetchImpl, calls } = jsonQueue([
      {
        status: 429,
        body: {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message:
              'You exceeded your current quota, please check your plan and billing details.',
          },
        },
      },
    ]);
    const retryDelays: number[] = [];

    await expect(
      generateVeoVideo({
        apiKey: KEY,
        prompt: 'x',
        fetchImpl,
        maxRetries: 4,
        sleepImpl: async (ms) => {
          retryDelays.push(ms);
        },
      }),
    ).rejects.toMatchObject({
      kind: 'quota_exhausted',
      status: 429,
      retryable: false,
    });
    expect(calls).toHaveLength(1);
    expect(retryDelays).toEqual([]);
  });

  it('retries transient polling errors without submitting a second paid operation', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { name: 'op/poll-retry' } },
      {
        status: 503,
        body: {
          error: {
            status: 'UNAVAILABLE',
            message: 'Please retry in 1s.',
          },
        },
      },
      {
        body: {
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                { video: { uri: 'https://generativelanguage.googleapis.com/poll-retried.mp4' } },
              ],
            },
          },
        },
      },
    ]);
    const retryDelays: number[] = [];

    const out = await generateVeoVideo({
      apiKey: KEY,
      prompt: 'x',
      fetchImpl,
      pollIntervalMs: 1,
      maxRetries: 2,
      retryBaseMs: 100,
      sleepImpl: async (ms) => {
        retryDelays.push(ms);
      },
    });

    expect(out.videoUri).toContain('poll-retried.mp4');
    expect(calls.filter((call) => call.init.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.init.method === 'GET')).toHaveLength(2);
    expect(retryDelays[0]).toBeGreaterThanOrEqual(1_000);
  });

  it('rejects 1080p + 6 seconds before making a paid provider request', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error('provider request must not start');
    }) as unknown as typeof fetch;

    await expect(
      generateVeoVideo({
        apiKey: KEY,
        prompt: 'x',
        resolution: '1080p',
        durationSeconds: 6,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      kind: 'invalid_argument',
    });
    expect(calls).toBe(0);
  });

  it('throws no_api_key when key empty', async () => {
    await expect(generateVeoVideo({ apiKey: '', prompt: 'x' })).rejects.toMatchObject({
      kind: 'no_api_key',
    });
  });

  it('throws op_failed when the operation completes with an error', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { name: 'op/1' } },
      { body: { done: true, error: { code: 13, message: 'internal' } } },
    ]);
    await expect(
      generateVeoVideo({ apiKey: KEY, prompt: 'x', fetchImpl, ...TINY }),
    ).rejects.toMatchObject({
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
