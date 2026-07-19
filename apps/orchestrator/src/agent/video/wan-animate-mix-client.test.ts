import { describe, expect, it } from 'vitest';
import { generateWanAnimateMix, WanAnimateMixError } from './wan-animate-mix-client.js';

function jsonQueue(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('generateWanAnimateMix', () => {
  it('submits the character image and reference video to wan2.2-animate-mix, then polls the nested result URL', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { output: { task_id: 'mix-1', task_status: 'PENDING' } } },
      {
        body: {
          output: {
            task_id: 'mix-1',
            task_status: 'SUCCEEDED',
            results: { video_url: 'https://dashscope-result-sgp/output.mp4' },
          },
          usage: { video_duration: 7.4, video_ratio: 'standard' },
        },
      },
    ]);

    const result = await generateWanAnimateMix({
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope-intl.aliyuncs.com',
      workspaceId: 'ws-test',
      imageUrl: 'https://r2.example/subject.jpg',
      referenceVideoUrl: 'https://r2.example/reference.mp4',
      mode: 'wan-std',
      fetchImpl,
      pollIntervalMs: 1,
      maxWaitMs: 50,
    });

    expect(result).toEqual({
      taskId: 'mix-1',
      videoUrl: 'https://dashscope-result-sgp/output.mp4',
      durationSeconds: 7.4,
      mode: 'wan-std',
    });
    expect(calls[0]?.url).toBe(
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis',
    );
    const create = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(create.method).toBe('POST');
    expect(create.headers.authorization).toBe('Bearer sk-test');
    expect(create.headers['x-dashscope-async']).toBe('enable');
    expect(create.headers['x-dashscope-workspace']).toBe('ws-test');
    expect(JSON.parse(create.body as string)).toEqual({
      model: 'wan2.2-animate-mix',
      input: {
        image_url: 'https://r2.example/subject.jpg',
        video_url: 'https://r2.example/reference.mp4',
        watermark: true,
      },
      parameters: { mode: 'wan-std' },
    });
    expect(calls[1]?.url).toBe('https://dashscope-intl.aliyuncs.com/api/v1/tasks/mix-1');
  });

  it('rejects missing input before making a paid request', async () => {
    await expect(
      generateWanAnimateMix({
        apiKey: 'sk-test',
        imageUrl: '',
        referenceVideoUrl: 'https://r2.example/reference.mp4',
        mode: 'wan-pro',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('surfaces provider moderation failures without retrying the generation task', async () => {
    const { fetchImpl, calls } = jsonQueue([
      { body: { output: { task_id: 'mix-2', task_status: 'PENDING' } } },
      {
        body: {
          output: {
            task_id: 'mix-2',
            task_status: 'FAILED',
            code: 'DataInspectionFailed',
            message: 'input rejected',
          },
        },
      },
    ]);

    await expect(
      generateWanAnimateMix({
        apiKey: 'sk-test',
        imageUrl: 'https://r2.example/subject.jpg',
        referenceVideoUrl: 'https://r2.example/reference.mp4',
        mode: 'wan-pro',
        fetchImpl,
        pollIntervalMs: 1,
        maxWaitMs: 50,
      }),
    ).rejects.toMatchObject({ kind: 'task_failed', code: 'DataInspectionFailed' });
    expect(calls).toHaveLength(2);
  });
});

describe('WanAnimateMixError', () => {
  it('is an Error with a stable discriminated kind', () => {
    const error = new WanAnimateMixError('bad input', 'invalid_input');
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('invalid_input');
  });
});
