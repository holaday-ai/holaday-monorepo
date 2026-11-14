import { describe, expect, it, vi } from 'vitest';
import { createModelConcurrencyGate } from './model-concurrency.js';
import type { QwenRoute } from './qwen-route.js';
import { createQwenResponsesAdapter } from './responses-adapter.js';

const ROUTE: QwenRoute = {
  provider: 'alibaba-model-studio',
  region: 'cn',
  deploymentScope: 'china_mainland',
  model: 'qwen3.7-plus',
  apiKey: 'synthetic-key',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  endpointKind: 'public',
  protocol: 'responses',
};

const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const ok = () =>
  new Response(
    sse({ type: 'response.output_text.delta', delta: '好' }) +
      sse({
        type: 'response.completed',
        response: {
          id: 'resp_ok',
          status: 'completed',
          output: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
const failure = (status: number, headers: Record<string, string> = {}) =>
  new Response('busy', { status, headers });

function adapter(fetchImpl: typeof fetch, extra: { maxRetries?: number } = {}) {
  return createQwenResponsesAdapter({
    route: ROUTE,
    fetchImpl,
    retryBaseDelayMs: 0,
    concurrencyGate: createModelConcurrencyGate(),
    ...extra,
  });
}

describe('Qwen Responses retries', () => {
  it('retries a 429 and then succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(failure(429)).mockResolvedValueOnce(ok());
    const result = await adapter(fetchImpl as unknown as typeof fetch).stream({ input: 'x' });
    expect(result.text).toBe('好');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a network error before any response', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok());
    const result = await adapter(fetchImpl as unknown as typeof fetch).stream({ input: 'x' });
    expect(result.status).toBe('completed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after two retries on repeated 503', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => failure(503));
    await expect(
      adapter(fetchImpl as unknown as typeof fetch).stream({ input: 'x' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      status: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable statuses', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => failure(400));
    await expect(
      adapter(fetchImpl as unknown as typeof fetch).stream({ input: 'x' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry once the stream has started', async () => {
    const broken = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(sse({ type: 'response.output_text.delta', delta: '半' })),
          );
          controller.error(new Error('connection reset'));
        },
      }),
      { status: 200 },
    );
    const fetchImpl = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(ok());
    const deltas: string[] = [];
    await expect(
      adapter(fetchImpl as unknown as typeof fetch).stream(
        { input: 'x' },
        { onTextDelta: (d) => deltas.push(d) },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After and stops waiting when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async () => failure(429, { 'retry-after': '5' }));
    const pending = adapter(fetchImpl as unknown as typeof fetch).stream(
      { input: 'x' },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('respects the overall timeout across retries', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => failure(429, { 'retry-after': '5' }));
    await expect(
      adapter(fetchImpl as unknown as typeof fetch).stream({ input: 'x' }, { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('model concurrency gate', () => {
  it('queues beyond the per-model limit and hands slots over in order', async () => {
    const gate = createModelConcurrencyGate(2);
    const a = await gate.acquire('m');
    const b = await gate.acquire('m');
    const other = await gate.acquire('other');
    let thirdAcquired = false;
    const third = gate.acquire('m').then((release) => {
      thirdAcquired = true;
      return release;
    });
    await Promise.resolve();
    expect(thirdAcquired).toBe(false);
    expect(gate.snapshot('m')).toEqual({ active: 2, waiting: 1 });
    a();
    const releaseThird = await third;
    expect(gate.snapshot('m')).toEqual({ active: 2, waiting: 0 });
    b();
    releaseThird();
    other();
    expect(gate.snapshot('m')).toEqual({ active: 0, waiting: 0 });
  });

  it('removes an aborted waiter without consuming a slot', async () => {
    const gate = createModelConcurrencyGate(1);
    const held = await gate.acquire('m');
    const controller = new AbortController();
    const waiting = gate.acquire('m', controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeDefined();
    expect(gate.snapshot('m')).toEqual({ active: 1, waiting: 0 });
    held();
    expect(gate.snapshot('m')).toEqual({ active: 0, waiting: 0 });
  });
});
