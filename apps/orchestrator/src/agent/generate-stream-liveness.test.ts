import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QwenRoute } from '../llm/qwen-route.js';
import { createQwenResponsesAdapter } from '../llm/responses-adapter.js';
import { runGenerateTask } from './generate-runner.js';

const route: QwenRoute = {
  provider: 'alibaba-model-studio',
  region: 'cn',
  deploymentScope: 'china_mainland',
  model: 'qwen3.7-plus',
  apiKey: 'synthetic-key',
  baseURL: 'https://example.test/compatible-mode/v1',
  endpointKind: 'public',
  protocol: 'responses',
};
const answer = '执行清单：整理虚构读书会议题，准备讨论材料，负责人和场地待确认。';
const encode = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
const complete = {
  type: 'response.completed',
  response: {
    id: 'synthetic-response',
    status: 'completed',
    output: [],
    usage: { input_tokens: 10, output_tokens: 20 },
  },
};

function fixture(events: Array<[number, unknown]>, cancelNeverSettles = false) {
  const cancel = vi.fn();
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const [at, event] of events)
            timers.push(setTimeout(() => controller.enqueue(encode(event)), at));
          // Deliberately stays open even after completed, as a keep-alive transport can.
        },
        cancel() {
          for (const timer of timers) clearTimeout(timer);
          cancel();
          if (cancelNeverSettles) return new Promise<void>(() => {});
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  return { adapter: createQwenResponsesAdapter({ route, fetchImpl }), fetchImpl, cancel };
}

afterEach(() => vi.useRealTimers());

describe('real Qwen adapter and generate runner stream liveness', () => {
  it('keeps real non-text progress alive beyond45s without leaking reasoning or retrying', async () => {
    vi.useFakeTimers();
    const f = fixture([
      ...[10_000, 20_000, 30_000, 40_000, 50_000].map(
        (at) =>
          [at, { type: 'response.reasoning_text.delta', delta: 'synthetic private reasoning' }] as [
            number,
            unknown,
          ],
      ),
      [60_000, { type: 'response.output_text.delta', delta: answer }],
      [60_001, complete],
    ]);
    const onStreamDelta = vi.fn();
    let observed: Awaited<ReturnType<typeof runGenerateTask>> | undefined;
    const pending = runGenerateTask({
      taskId: 'synthetic-task',
      userId: 'synthetic-user',
      intent: '为虚构读书会整理内部执行清单，不联网、不生成文件。',
      planExecutionApproved: true,
      responsesAdapter: f.adapter,
      logger: pino({ level: 'silent' }),
      onStreamDelta,
    }).then((result) => {
      observed = result;
      return result;
    });
    await vi.advanceTimersByTimeAsync(61_000);
    const atDeadline = observed;
    const requests = f.fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(350_000);
    await pending;
    expect(atDeadline?.status).toBe('completed');
    expect(requests).toBe(1);
    expect(atDeadline?.summary).toContain(answer);
    expect(onStreamDelta.mock.calls.flat()).toEqual([answer]);
    expect(atDeadline?.summary).not.toContain('synthetic private reasoning');
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });

  it('settles valid completed event without waiting for an HTTP EOF', async () => {
    vi.useFakeTimers();
    const f = fixture([
      [0, { type: 'response.output_text.delta', delta: answer }],
      [1, complete],
    ]);
    let observed: unknown;
    const pending = f.adapter.stream({ input: 'synthetic' }, { timeoutMs: 1000 }).then(
      (r) => {
        observed = r;
      },
      () => {
        observed = 'failed';
      },
    );
    await vi.advanceTimersByTimeAsync(10);
    const beforeTimeout = observed;
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(beforeTimeout).toMatchObject({ status: 'completed', text: answer });
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['empty reasoning', 'unknown event'])(
    'does not let %s extend the idle deadline',
    async (kind) => {
      vi.useFakeTimers();
      const event =
        kind === 'empty reasoning'
          ? { type: 'response.reasoning_text.delta', delta: '' }
          : { type: 'unknown.progress', delta: 'untrusted' };
      const f = fixture(Array.from({ length: 12 }, (_, i) => [(i + 1) * 10_000, event]));
      let result: Awaited<ReturnType<typeof runGenerateTask>> | undefined;
      const pending = runGenerateTask({
        taskId: 'synthetic-task',
        userId: 'synthetic-user',
        intent: '整理内部读书会清单',
        responsesAdapter: f.adapter,
        logger: pino({ level: 'silent' }),
      }).then((r) => {
        result = r;
      });
      await vi.advanceTimersByTimeAsync(105_000);
      const observed = result;
      await vi.advanceTimersByTimeAsync(350_000);
      await pending;
      expect(observed).toMatchObject({
        status: 'failed',
        reason: 'AI 长时间没有响应，请简化任务后重试。',
      });
      expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it('retains the absolute timeout even while valid reasoning progress continues', async () => {
    vi.useFakeTimers();
    const f = fixture(
      Array.from({ length: 30 }, (_, i) => [
        (i + 1) * 10_000,
        { type: 'response.reasoning_text.delta', delta: 'synthetic' },
      ]),
    );
    let result: Awaited<ReturnType<typeof runGenerateTask>> | undefined;
    const pending = runGenerateTask({
      taskId: 'synthetic-task',
      userId: 'synthetic-user',
      intent: '整理内部读书会清单',
      timeoutMs: 120_000,
      responsesAdapter: f.adapter,
      logger: pino({ level: 'silent' }),
    }).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(121_000);
    await pending;
    expect(result?.status).toBe('failed');
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(result?.durationMs).toBeLessThanOrEqual(120_000);
  });

  it('progress callbacks receive no payload and observer errors cannot corrupt a result', async () => {
    vi.useFakeTimers();
    const f = fixture(
      [
        [0, { type: 'response.reasoning_text.delta', delta: 'private reasoning' }],
        [1, { type: 'response.output_text.delta', delta: answer }],
        [2, complete],
      ],
      true,
    );
    const progress = vi.fn(() => {
      throw new Error('private observer error');
    });
    const pending = f.adapter.stream(
      { input: 'synthetic' },
      { timeoutMs: 1000, onProgress: progress },
    );
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(result.text).toBe(answer);
    expect(progress.mock.calls).toEqual([[]]);
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    { type: 'response.reasoning_text.delta', delta: 123 },
    { type: 'response.completed', response: { status: 'completed' } },
  ])('invalid progress or terminal payload is rejected without waiting for EOF', async (event) => {
    vi.useFakeTimers();
    const f = fixture([[0, event]]);
    let error: unknown;
    const pending = f.adapter.stream({ input: 'synthetic' }, { timeoutMs: 1000 }).catch((e) => {
      error = e;
    });
    await vi.advanceTimersByTimeAsync(10);
    const observed = error;
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(observed).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });
});
