import { describe, expect, it } from 'vitest';
import {
  FalLipSyncError,
  getLipSyncResult,
  getLipSyncStatus,
  lipSyncMaxWaitMs,
  runLipSync,
  submitLipSync,
} from './fal-lipsync-client.js';

describe('lipSyncMaxWaitMs — dynamic poll ceiling (fal timeout fix)', () => {
  it('scales 60s + audioSec × 16s for in-range clips', () => {
    expect(lipSyncMaxWaitMs(16_000)).toBe(316_000); // 16s clip (old 300s was too tight)
    expect(lipSyncMaxWaitMs(37_000)).toBe(652_000); // 37s clip that falsely timed out
    expect(lipSyncMaxWaitMs(40_000)).toBe(700_000); // ≤40s IP cap → ≤700s, under ceiling
  });

  it('floors at 300s for short clips (never below the old default)', () => {
    expect(lipSyncMaxWaitMs(5_000)).toBe(300_000); // 60+80=140s → floor 300s
    expect(lipSyncMaxWaitMs(0)).toBe(300_000);
    expect(lipSyncMaxWaitMs(15_000)).toBe(300_000); // 60+240=300s → exactly floor
  });

  it('caps at the 720s hard ceiling for anything past the cap', () => {
    expect(lipSyncMaxWaitMs(45_000)).toBe(720_000); // 60+720=780 → clamp 720s
    expect(lipSyncMaxWaitMs(10_000_000)).toBe(720_000);
  });

  it('rounds audio seconds up + tolerates junk input', () => {
    expect(lipSyncMaxWaitMs(16_001)).toBe(60_000 + 17 * 16_000); // ceil(16.001s)=17 → 332s
    expect(lipSyncMaxWaitMs(Number.NaN)).toBe(300_000);
    expect(lipSyncMaxWaitMs(-5_000)).toBe(300_000);
  });

  it('is monotonic non-decreasing in audio length', () => {
    let prev = 0;
    for (let s = 0; s <= 60; s += 5) {
      const v = lipSyncMaxWaitMs(s * 1000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

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

const KEY = 'id:secret';
const VID = 'https://r2/base.mp4';
const AUD = 'https://r2/voice.wav';
const TINY = { pollIntervalMs: 1 };

describe('submitLipSync', () => {
  it('posts video_url + audio_url with Key auth, returns request_id (real shape)', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { status: 'IN_QUEUE', request_id: '019ebfdc-1847', queue_position: 0 } },
    ]);
    const out = await submitLipSync({ apiKey: KEY, videoUrl: VID, audioUrl: AUD, fetchImpl });
    expect(out).toEqual({ requestId: '019ebfdc-1847', status: 'IN_QUEUE' });
    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(calls[0]?.url).toBe('https://queue.fal.run/fal-ai/latentsync');
    expect(init.headers.authorization).toBe(`Key ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({ video_url: VID, audio_url: AUD });
  });

  it('maps 403 Exhausted balance → kind exhausted_balance (NOT a bad key)', async () => {
    const { fetchImpl } = jsonQueue([
      {
        status: 403,
        body: { detail: 'User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.' },
      },
    ]);
    await expect(
      submitLipSync({ apiKey: KEY, videoUrl: VID, audioUrl: AUD, fetchImpl }),
    ).rejects.toMatchObject({ kind: 'exhausted_balance', status: 403 });
  });

  it('maps 401 → http', async () => {
    const { fetchImpl } = jsonQueue([{ status: 401, body: { detail: 'unauthorized' } }]);
    await expect(
      submitLipSync({ apiKey: KEY, videoUrl: VID, audioUrl: AUD, fetchImpl }),
    ).rejects.toMatchObject({ kind: 'http', status: 401 });
  });

  it('throws no_api_key when key empty', async () => {
    await expect(submitLipSync({ apiKey: '', videoUrl: VID, audioUrl: AUD })).rejects.toMatchObject({
      kind: 'no_api_key',
    });
  });
});

describe('getLipSyncStatus / getLipSyncResult', () => {
  it('reads status', async () => {
    const { fetchImpl } = jsonQueue([{ body: { status: 'IN_PROGRESS' } }]);
    expect(await getLipSyncStatus({ apiKey: KEY, requestId: 'r', fetchImpl })).toEqual({
      status: 'IN_PROGRESS',
    });
  });

  it('reads the result video url + file_size (real shape)', async () => {
    const { fetchImpl } = jsonQueue([
      {
        body: {
          video: {
            url: 'https://v3b.fal.media/files/b/out.mp4',
            content_type: 'application/octet-stream',
            file_name: 'out.mp4',
            file_size: 1806338,
          },
        },
      },
    ]);
    const r = await getLipSyncResult({ apiKey: KEY, requestId: 'r', fetchImpl });
    expect(r.videoUrl).toBe('https://v3b.fal.media/files/b/out.mp4');
    expect(r.fileSize).toBe(1806338);
  });

  it('throws no_result when video url absent', async () => {
    const { fetchImpl } = jsonQueue([{ body: {} }]);
    await expect(getLipSyncResult({ apiKey: KEY, requestId: 'r', fetchImpl })).rejects.toMatchObject({
      kind: 'no_result',
    });
  });
});

describe('runLipSync (submit + poll to completion)', () => {
  it('follows provider queue URLs for versioned model endpoints', async () => {
    const statusUrl = 'https://queue.fal.run/fal-ai/sync-lipsync/requests/req-v2/status';
    const responseUrl = 'https://queue.fal.run/fal-ai/sync-lipsync/requests/req-v2';
    const { fetchImpl, calls } = jsonQueue([
      {
        body: {
          status: 'IN_QUEUE',
          request_id: 'req-v2',
          status_url: statusUrl,
          response_url: responseUrl,
        },
      },
      { body: { status: 'COMPLETED' } },
      { body: { video: { url: 'https://v3b.fal.media/versioned.mp4' } } },
    ]);

    const out = await runLipSync({
      apiKey: KEY,
      model: 'fal-ai/sync-lipsync/v2',
      videoUrl: VID,
      audioUrl: AUD,
      fetchImpl,
      ...TINY,
    });

    expect(out.videoUrl).toBe('https://v3b.fal.media/versioned.mp4');
    expect(calls.map((call) => call.url)).toEqual([
      'https://queue.fal.run/fal-ai/sync-lipsync/v2',
      statusUrl,
      responseUrl,
    ]);
  });

  it('ignores cross-origin queue URLs returned by the provider', async () => {
    const { fetchImpl, calls } = jsonQueue([
      {
        body: {
          status: 'IN_QUEUE',
          request_id: 'req-safe',
          status_url: 'https://untrusted.example/requests/req-safe/status',
          response_url: 'https://untrusted.example/requests/req-safe',
        },
      },
      { body: { status: 'COMPLETED' } },
      { body: { video: { url: 'https://v3b.fal.media/safe.mp4' } } },
    ]);

    await runLipSync({
      apiKey: KEY,
      videoUrl: VID,
      audioUrl: AUD,
      fetchImpl,
      ...TINY,
    });

    expect(calls.map((call) => call.url)).toEqual([
      'https://queue.fal.run/fal-ai/latentsync',
      'https://queue.fal.run/fal-ai/latentsync/requests/req-safe/status',
      'https://queue.fal.run/fal-ai/latentsync/requests/req-safe',
    ]);
  });

  it('submits, polls IN_PROGRESS→COMPLETED, returns the result', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { status: 'IN_QUEUE', request_id: 'req1' } }, // submit
      { body: { status: 'IN_PROGRESS' } }, // status poll 1
      { body: { status: 'COMPLETED' } }, // status poll 2
      { body: { video: { url: 'https://v3b.fal.media/out.mp4', file_size: 1806338 } } }, // result
    ]);
    const out = await runLipSync({ apiKey: KEY, videoUrl: VID, audioUrl: AUD, fetchImpl, ...TINY });
    expect(out.requestId).toBe('req1');
    expect(out.videoUrl).toBe('https://v3b.fal.media/out.mp4');
    expect(out.fileSize).toBe(1806338);
    expect(typeof out.elapsedMs).toBe('number');
  });

  it('throws timeout if it never completes within maxWaitMs', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { status: 'IN_QUEUE', request_id: 'req2' } },
      { body: { status: 'IN_PROGRESS' } },
    ]);
    await expect(
      runLipSync({ apiKey: KEY, videoUrl: VID, audioUrl: AUD, fetchImpl, pollIntervalMs: 1, maxWaitMs: 5 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('FalLipSyncError', () => {
  it('is an Error with a discriminated kind', () => {
    const e = new FalLipSyncError('x', 'exhausted_balance', 403);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('exhausted_balance');
  });
});
