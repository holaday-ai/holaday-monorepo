import { describe, expect, it, vi } from 'vitest';
import {
  createImageTask,
  createVideoTask,
  generateBrollImage,
  generateBrollVideo,
  getTaskStatus,
  WanxiangError,
} from './wanxiang-client.js';

/** A fetch stub that returns queued JSON responses in order, recording calls. */
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

const KEY = 'sk-test-key';
const TINY = { pollIntervalMs: 1, retryBaseMs: 1 };

describe('createImageTask', () => {
  it('posts an async create + returns task_id (real shape)', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { request_id: 'r1', output: { task_id: '3ef403f7', task_status: 'PENDING' } } },
    ]);
    const out = await createImageTask({ apiKey: KEY, prompt: 'a shiba inu', fetchImpl });
    expect(out).toEqual({ taskId: '3ef403f7', model: 'wan2.2-t2i-flash' });
    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(calls[0]?.url).toContain('/api/v1/services/aigc/text2image/image-synthesis');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(init.headers['x-dashscope-async']).toBe('enable');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'wan2.2-t2i-flash',
      input: { prompt: 'a shiba inu' },
    });
  });

  it('throws no_api_key when key is empty', async () => {
    await expect(createImageTask({ apiKey: '', prompt: 'x' })).rejects.toMatchObject({
      kind: 'no_api_key',
    });
  });

  it('throws http on 401 InvalidApiKey', async () => {
    const { fetchImpl } = jsonQueue([
      { status: 401, body: { code: 'InvalidApiKey', message: 'invalid' } },
    ]);
    await expect(createImageTask({ apiKey: KEY, prompt: 'x', fetchImpl })).rejects.toMatchObject({
      kind: 'http',
      status: 401,
    });
  });

  it('marks a permanent account billing failure non-retryable', async () => {
    const { fetchImpl, calls } = jsonQueue([
      {
        status: 400,
        body: {
          code: 'Arrearage',
          message: 'The account is not in good standing due to an overdue payment.',
        },
      },
    ]);

    await expect(
      createImageTask({ apiKey: KEY, prompt: 'x', fetchImpl }),
    ).rejects.toMatchObject({
      name: 'WanxiangError',
      kind: 'http',
      status: 400,
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('retries transient 429 then succeeds', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { status: 429, body: { code: 'Throttling', message: 'slow down' } },
      { body: { output: { task_id: 't2', task_status: 'PENDING' } } },
    ]);
    const out = await createImageTask({ apiKey: KEY, prompt: 'x', fetchImpl, ...TINY });
    expect(out.taskId).toBe('t2');
    expect(calls.length).toBe(2);
  });

  it('sends X-DashScope-WorkSpace header only when workspaceId is set', async () => {
    const q1 = jsonQueue([{ body: { output: { task_id: 't', task_status: 'PENDING' } } }]);
    await createImageTask({ apiKey: KEY, prompt: 'x', workspaceId: 'ws_123', fetchImpl: q1.fetchImpl });
    expect((q1.calls[0]?.init as RequestInit & { headers: Record<string, string> }).headers['x-dashscope-workspace']).toBe('ws_123');
    const q2 = jsonQueue([{ body: { output: { task_id: 't', task_status: 'PENDING' } } }]);
    await createImageTask({ apiKey: KEY, prompt: 'x', fetchImpl: q2.fetchImpl });
    expect((q2.calls[0]?.init as RequestInit & { headers: Record<string, string> }).headers['x-dashscope-workspace']).toBeUndefined();
  });
});

describe('createVideoTask — i2v 图生 (Phase 2 第二期)', () => {
  it('imageUrl → input.img_url; durationSeconds → parameters.duration; size passthrough', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { output: { task_id: 'v1', task_status: 'PENDING' } } },
    ]);
    const out = await createVideoTask({
      apiKey: KEY,
      model: 'wan2.2-i2v-flash',
      prompt: '小猫眨眨眼',
      imageUrl: 'https://r2/pet.jpg',
      size: '1080*1920',
      durationSeconds: 5,
      fetchImpl,
    });
    expect(out).toEqual({ taskId: 'v1', model: 'wan2.2-i2v-flash' });
    expect(calls[0]?.url).toContain('/api/v1/services/aigc/video-generation/video-synthesis');
    const body = JSON.parse((calls[0]?.init as RequestInit).body as string);
    expect(body).toMatchObject({
      model: 'wan2.2-i2v-flash',
      input: { prompt: '小猫眨眨眼', img_url: 'https://r2/pet.jpg' },
      parameters: { size: '1080*1920', duration: 5 },
    });
  });

  it('t2v defaults to the pinned Wan 2.7 release and omits optional parameters', async () => {
    const { fetchImpl, calls } = jsonQueue([{ body: { output: { task_id: 'v2', task_status: 'PENDING' } } }]);
    await createVideoTask({ apiKey: KEY, prompt: 'a beach', fetchImpl });
    const body = JSON.parse((calls[0]?.init as RequestInit).body as string);
    expect(body.model).toBe('wan2.7-t2v-2026-06-12');
    expect(body.input.img_url).toBeUndefined();
    expect(body.parameters?.duration).toBeUndefined();
  });

  it('uses the Wan 2.7 resolution and ratio protocol instead of the legacy size field', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { output: { task_id: 'v27', task_status: 'PENDING' } } },
    ]);
    await createVideoTask({
      apiKey: KEY,
      model: 'wan2.7-t2v-2026-06-12',
      prompt: 'single-shot product video',
      size: '1280*720',
      resolution: '720P',
      ratio: '16:9',
      durationSeconds: 8,
      fetchImpl,
    });
    const body = JSON.parse((calls[0]?.init as RequestInit).body as string);
    expect(body.parameters).toEqual({
      resolution: '720P',
      ratio: '16:9',
      duration: 8,
    });
    expect(body.parameters.size).toBeUndefined();
  });
});

describe('getTaskStatus', () => {
  it('maps SUCCEEDED → imageUrls + imageCount (real shape)', async () => {
    const { fetchImpl } = jsonQueue([
      {
        body: {
          output: {
            task_id: 't',
            task_status: 'SUCCEEDED',
            results: [{ url: 'https://dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com/a.png' }],
          },
          usage: { image_count: 1 },
        },
      },
    ]);
    const s = await getTaskStatus({ apiKey: KEY, taskId: 't', fetchImpl });
    expect(s.taskStatus).toBe('SUCCEEDED');
    expect(s.imageUrls).toHaveLength(1);
    expect(s.imageCount).toBe(1);
  });

  it('surfaces FAILED status + code/message', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { output: { task_status: 'FAILED', code: 'DataInspectionFailed', message: 'nsfw' } } },
    ]);
    const s = await getTaskStatus({ apiKey: KEY, taskId: 't', fetchImpl });
    expect(s.taskStatus).toBe('FAILED');
    expect(s.code).toBe('DataInspectionFailed');
  });
});

describe('generateBrollImage (create + poll)', () => {
  it('polls PENDING→RUNNING→SUCCEEDED and returns the url', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { output: { task_id: 't', task_status: 'PENDING' } } }, // create
      { body: { output: { task_id: 't', task_status: 'RUNNING' } } }, // poll 1
      {
        body: {
          output: { task_id: 't', task_status: 'SUCCEEDED', results: [{ url: 'https://r2/x.png' }] },
          usage: { image_count: 1 },
        },
      }, // poll 2
    ]);
    const out = await generateBrollImage({ apiKey: KEY, prompt: 'x', fetchImpl, ...TINY });
    expect(out.taskStatus).toBe('SUCCEEDED');
    expect(out.imageUrls[0]).toBe('https://r2/x.png');
  });

  it('throws task_failed when the task FAILs', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { output: { task_id: 't', task_status: 'PENDING' } } },
      { body: { output: { task_status: 'FAILED', message: 'boom' } } },
    ]);
    await expect(generateBrollImage({ apiKey: KEY, prompt: 'x', fetchImpl, ...TINY })).rejects.toMatchObject(
      { kind: 'task_failed' },
    );
  });

  it('throws timeout if it never finishes within maxWaitMs', async () => {
    const { fetchImpl } = jsonQueue([
      { body: { output: { task_id: 't', task_status: 'PENDING' } } },
      { body: { output: { task_id: 't', task_status: 'RUNNING' } } },
    ]);
    await expect(
      generateBrollImage({ apiKey: KEY, prompt: 'x', fetchImpl, pollIntervalMs: 1, maxWaitMs: 5 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('generateBrollVideo', () => {
  it('returns the video_url on SUCCEEDED', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { output: { task_id: 'v', task_status: 'PENDING' } } },
      { body: { output: { task_id: 'v', task_status: 'SUCCEEDED', video_url: 'https://oss/v.mp4' } } },
    ]);
    const out = await generateBrollVideo({ apiKey: KEY, prompt: 'clip', fetchImpl, ...TINY });
    expect(out.videoUrl).toBe('https://oss/v.mp4');
    expect(calls[0]?.url).toContain('/api/v1/services/aigc/video-generation/video-synthesis');
  });

  it('passes negative_prompt into the t2v input when supplied (no-text constraint)', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { output: { task_id: 'v', task_status: 'PENDING' } } },
      { body: { output: { task_id: 'v', task_status: 'SUCCEEDED', video_url: 'https://oss/v.mp4' } } },
    ]);
    await generateBrollVideo({ apiKey: KEY, prompt: 'clip', negativePrompt: '乱码, gibberish', fetchImpl, ...TINY });
    const init = calls[0]?.init as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ input: { negative_prompt: '乱码, gibberish' } });
  });

  it('passes the selected HappyHorse duration instead of using the provider default', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { output: { task_id: 'v', task_status: 'PENDING' } } },
      { body: { output: { task_id: 'v', task_status: 'SUCCEEDED', video_url: 'https://oss/v.mp4' } } },
    ]);
    await generateBrollVideo({
      apiKey: KEY,
      model: 'happyhorse-1.1-t2v',
      prompt: 'clip',
      size: '1920*1080',
      durationSeconds: 6,
      fetchImpl,
      ...TINY,
    });
    const init = calls[0]?.init as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'happyhorse-1.1-t2v',
      parameters: { size: '1920*1080', duration: 6 },
    });
  });
});

describe('WanxiangError', () => {
  it('is an Error with a discriminated kind', () => {
    const e = new WanxiangError('x', 'no_result');
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('no_result');
  });
});
