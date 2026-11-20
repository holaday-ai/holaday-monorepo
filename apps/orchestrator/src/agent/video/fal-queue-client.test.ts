import { describe, expect, it, vi } from 'vitest';
import { FalQueueError, falAppId, falHttpError, runFalQueueJob } from './fal-queue-client.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fal queue client', () => {
  it('derives the queue app id from a sub-path endpoint', () => {
    expect(falAppId('fal-ai/veo3.1/fast/first-last-frame-to-video')).toBe('fal-ai/veo3.1');
    expect(falAppId('fal-ai/nano-banana-2')).toBe('fal-ai/nano-banana-2');
  });

  it('submits, polls the returned status url and fetches the result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, {
          request_id: 'r1',
          status_url: 'https://queue.fal.run/fal-ai/veo3.1/requests/r1/status',
          response_url: 'https://queue.fal.run/fal-ai/veo3.1/requests/r1',
        }),
      )
      .mockResolvedValueOnce(json(200, { status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { video: { url: 'https://v3.fal.media/x.mp4' } }));
    const out = await runFalQueueJob<{ video: { url: string } }>({
      apiKey: 'id:secret',
      endpointId: 'fal-ai/veo3.1/fast',
      input: { prompt: 'p' },
      fetchImpl,
      sleepImpl: async () => undefined,
    });
    expect(out.output.video.url).toBe('https://v3.fal.media/x.mp4');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://queue.fal.run/fal-ai/veo3.1/fast');
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      authorization: 'Key id:secret',
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://queue.fal.run/fal-ai/veo3.1/requests/r1/status',
    );
  });

  it('ignores untrusted queue urls and falls back to the app namespace', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, { request_id: 'r2', status_url: 'https://evil.example/status' }),
      )
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { images: [] }));
    await runFalQueueJob({
      apiKey: 'k',
      endpointId: 'fal-ai/nano-banana-2/edit',
      input: {},
      fetchImpl,
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://queue.fal.run/fal-ai/nano-banana-2/requests/r2/status',
    );
  });

  it('times out a job that never completes', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { request_id: 'r3' }))
      .mockImplementation(async () => json(200, { status: 'IN_QUEUE' }));
    const job = runFalQueueJob({
      apiKey: 'k',
      endpointId: 'fal-ai/veo3.1',
      input: {},
      fetchImpl,
      maxWaitMs: 1000,
      sleepImpl: async () => {
        now += 600;
      },
    });
    await expect(job).rejects.toMatchObject({ kind: 'timeout' });
    vi.restoreAllMocks();
  });

  it('maps billing, policy and auth failures', () => {
    expect(falHttpError('x', 403, 'User is locked. Reason: Exhausted balance').kind).toBe(
      'exhausted_balance',
    );
    expect(falHttpError('x', 422, '{"detail":[{"type":"content_policy_violation"}]}').kind).toBe(
      'blocked',
    );
    expect(falHttpError('x', 401, 'bad key').kind).toBe('no_api_key');
    expect(falHttpError('x', 500, 'boom')).toBeInstanceOf(FalQueueError);
  });

  it('rejects a missing key before any request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      runFalQueueJob({ apiKey: '', endpointId: 'fal-ai/veo3.1', input: {}, fetchImpl }),
    ).rejects.toMatchObject({ kind: 'no_api_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps polling a paid job through transient poll/result failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { request_id: 'r2' }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(503, { detail: 'busy' }))
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(200, { images: [{ url: 'https://v3.fal.media/x.png' }] }));
    const out = await runFalQueueJob<{ images: Array<{ url: string }> }>({
      apiKey: 'id:secret',
      endpointId: 'fal-ai/nano-banana-2',
      input: { prompt: 'p' },
      fetchImpl,
      sleepImpl: async () => undefined,
    });
    expect(out.output.images[0]?.url).toBe('https://v3.fal.media/x.png');
    // Submit happened exactly once: a retry there could pay twice.
    expect(
      fetchImpl.mock.calls.filter((call) => (call[1] as RequestInit).method === 'POST'),
    ).toHaveLength(1);
  });

  it('gives up after repeated poll failures and never resubmits', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { request_id: 'r3' }))
      .mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      runFalQueueJob({
        apiKey: 'id:secret',
        endpointId: 'fal-ai/nano-banana-2',
        input: { prompt: 'p' },
        fetchImpl,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(FalQueueError);
    expect(
      fetchImpl.mock.calls.filter((call) => (call[1] as RequestInit).method === 'POST'),
    ).toHaveLength(1);
  });
});
