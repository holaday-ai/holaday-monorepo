import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation } from '../execution/owned-operation.js';
import { createQwenMessagesTransport } from './qwen-messages-transport.js';
import type { QwenRoute } from './qwen-route.js';
import { createQwenResponsesAdapter } from './responses-adapter.js';

const route: QwenRoute = {
  provider: 'alibaba-model-studio',
  region: 'cn',
  deploymentScope: 'china_mainland',
  model: 'qwen-synthetic',
  apiKey: 'synthetic-only',
  endpointKind: 'public',
  baseURL: 'https://synthetic.invalid',
  protocol: 'messages',
};
type Protocol = 'messages' | 'responses';
const terminal = `data: ${JSON.stringify({
  type: 'response.completed',
  response: {
    id: 'synthetic',
    status: 'completed',
    output: [],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
})}\n\n`;
function response(protocol: Protocol) {
  return new Response(protocol === 'messages' ? '{"ok":true}' : terminal, { status: 200 });
}
function cached(protocol: Protocol, fetchImpl: typeof fetch) {
  const messages = createQwenMessagesTransport({ route, fetchImpl, retryBaseDelayMs: 0 });
  const responses = createQwenResponsesAdapter({
    route: { ...route, protocol: 'responses' },
    fetchImpl,
  });
  return (signal?: AbortSignal, timeout = 0) =>
    protocol === 'messages'
      ? messages.messages.create(
          { model: route.model, max_tokens: 10, messages: [] },
          { signal, timeout, maxRetries: 0 },
        )
      : responses.stream({ input: 'synthetic' }, { signal, timeoutMs: timeout });
}
function opened() {
  const drain = new ExecutionDrain();
  drain.open();
  return drain;
}
async function launch(drain: ExecutionDrain, action: () => Promise<unknown>) {
  let result!: Promise<unknown>;
  const root = startOwnedOperation(
    drain,
    'request',
    async () => {
      result = action();
      void result.catch(() => undefined);
    },
    { errorOutcome: 'unknown', dispatch: 'immediate' },
  );
  await root.result;
  return { result };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['messages', 'responses'] as const)(
  'refuses a late cached %s call while the old logical scope only owns cleanup',
  async (protocol) => {
    const drain = opened();
    let dispose!: () => void;
    let release!: () => void;
    let late!: Promise<unknown>;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = new Promise<void>((resolve) => {
      dispose = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: {"type":"response.output_text.delta","delta":"synthetic"}\n\n${terminal}`,
          ),
        );
      },
      cancel() {
        return cleanup;
      },
    });
    let requests = 0;
    const fetchImpl: typeof fetch = async () =>
      ++requests === 1 ? new Response(body) : response(protocol);
    const adapter = createQwenResponsesAdapter({
      route: { ...route, protocol: 'responses' },
      fetchImpl,
    });
    const call = cached(protocol, fetchImpl);
    const { result } = await launch(drain, () =>
      adapter.stream(
        { input: 'synthetic' },
        {
          onTextDelta() {
            late = held.then(() => call());
            void late.catch(() => undefined);
          },
        },
      ),
    );
    await expect(result).resolves.toMatchObject({ status: 'completed' });
    drain.close();
    release();
    await expect(late).rejects.toThrow();
    expect(requests).toBe(1);
    expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 0, idle: false });
    dispose();
    await vi.waitFor(() => expect(drain.snapshot().idle).toBe(true));
  },
);

it('disposes the acquired messages body when dispatch closes before JSON reading', async () => {
  const drain = opened();
  let dispose!: () => void;
  let cancellations = 0;
  const held = new Promise<void>((resolve) => {
    dispose = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancellations++;
      return held;
    },
  });
  const { result } = await launch(drain, () =>
    cached('messages', async () => {
      drain.block();
      return new Response(body);
    })(),
  );
  await expect(result).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(cancellations).toBe(1);
  expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 1, idle: false });
  dispose();
  await vi.waitFor(() => expect(drain.snapshot().active).toBe(0));
});

it.each(['messages', 'responses'] as const)(
  'normalizes %s request conversion errors before physical dispatch',
  async (protocol) => {
    const drain = opened();
    const fetchImpl = vi.fn(async () => response(protocol));
    const fail = () => {
      throw new Error('SYNTHETIC_PRIVATE_SENTINEL');
    };
    const { result } = await launch(drain, () =>
      protocol === 'messages'
        ? createQwenMessagesTransport({ route, fetchImpl }).messages.create({
            model: route.model,
            max_tokens: 10,
            messages: [],
            system: { toJSON: fail },
          })
        : createQwenResponsesAdapter({
            route: { ...route, protocol: 'responses' },
            fetchImpl,
          }).stream({
            get input(): string {
              return fail();
            },
          }),
    );
    await expect(result).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    const error = await result.catch((value: unknown) => value);
    expect(String(error)).not.toContain('SYNTHETIC_PRIVATE_SENTINEL');
    expect(fetchImpl).not.toHaveBeenCalled();
    drain.close();
    await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ idle: true, unknown: 0 }));
  },
);

it.each(['messages', 'responses'] as const)(
  'keeps %s error-body disposal occupied without delaying the error',
  async (protocol) => {
    const drain = opened();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const body = new ReadableStream({
      cancel() {
        return held;
      },
    });
    const { result } = await launch(drain, () =>
      cached(protocol, async () => new Response(body, { status: 500 }))(),
    );
    await expect(result).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    drain.close();
    expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 1, idle: false });
    finish();
    await vi.waitFor(() =>
      expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false }),
    );
  },
);

it('keeps original responses read and cancel alive after an abort race', async () => {
  const drain = opened();
  const abort = new AbortController();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      return held;
    },
  });
  const { result } = await launch(drain, () =>
    cached('responses', async () => new Response(body))(abort.signal),
  );
  abort.abort();
  await expect(result).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  drain.close();
  expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 1, idle: false });
  finish();
  await vi.waitFor(() =>
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false }),
  );
});

it('waits for a retryable response body and refuses a retry after disposal fails', async () => {
  const drain = opened();
  let fail!: () => void;
  const held = new Promise<void>((_resolve, reject) => {
    fail = () => reject(new Error('synthetic disposal'));
  });
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            return held;
          },
        }),
        { status: 503 },
      ),
  );
  const transport = createQwenMessagesTransport({ route, fetchImpl, retryBaseDelayMs: 0 });
  const { result } = await launch(drain, () =>
    transport.messages.create(
      { model: route.model, max_tokens: 10, messages: [] },
      { maxRetries: 2 },
    ),
  );
  drain.close();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  fail();
  await expect(result).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  await vi.waitFor(() =>
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false }),
  );
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each(['messages', 'responses'] as const)(
  'binds cached %s to each live caller, not the factory or previous caller',
  async (protocol) => {
    const finish: Array<(value: Response) => void> = [];
    const call = cached(
      protocol,
      async () => new Promise<Response>((resolve) => finish.push(resolve)),
    );
    const a = opened();
    const b = opened();
    const first = await launch(a, () => call());
    const second = await launch(b, () => call());
    a.close();
    b.close();
    expect(a.snapshot()).toMatchObject({ roots: 0, active: 1, byKind: { model: 1 }, idle: false });
    expect(b.snapshot()).toMatchObject({ roots: 0, active: 1, byKind: { model: 1 }, idle: false });
    const [finishFirst, finishSecond] = finish;
    if (!finishFirst || !finishSecond) throw new Error('Missing synthetic fetches');
    finishFirst(response(protocol));
    await first.result;
    await vi.waitFor(() => expect(a.snapshot().idle).toBe(true));
    expect(b.snapshot().idle).toBe(false);
    finishSecond(response(protocol));
    await second.result;
    await vi.waitFor(() => expect(b.snapshot().idle).toBe(true));
  },
);

it.each(['messages', 'responses'] as const)(
  'refuses a cached %s call from an ended async scope before fetch',
  async (protocol) => {
    const drain = opened();
    let release!: () => void;
    let result!: Promise<unknown>;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => response(protocol));
    const call = cached(protocol, fetchImpl);
    await startOwnedOperation(
      drain,
      'request',
      async () => {
        result = held.then(() => call());
        void result.catch(() => undefined);
      },
      { errorOutcome: 'known', dispatch: 'immediate' },
    ).result;
    drain.close();
    release();
    await expect(result).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

it.each(['messages', 'responses'] as const)(
  'keeps timed-out %s fetch occupied and unknown until its late response',
  async (protocol) => {
    vi.useFakeTimers();
    const drain = opened();
    let finish!: (value: Response) => void;
    const call = cached(
      protocol,
      async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = await launch(drain, () => call(undefined, 10));
    drain.close();
    await vi.advanceTimersByTimeAsync(11);
    expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 1, idle: false });
    finish(response(protocol));
    await expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
  },
);

it.each([false, true])(
  'delivers a responses terminal while cancellation remains occupied (reject=%s)',
  async (rejects) => {
    const drain = opened();
    let finish!: () => void;
    const cancellation = new Promise<void>((resolve, reject) => {
      finish = rejects ? () => reject(new Error('synthetic cleanup failure')) : resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(terminal));
      },
      cancel() {
        return cancellation;
      },
    });
    const call = cached('responses', async () => new Response(body));
    const { result } = await launch(drain, () => call());
    await expect(result).resolves.toMatchObject({ status: 'completed' });
    drain.close();
    expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 0, idle: false });
    finish();
    await vi.waitFor(() =>
      expect(drain.snapshot()).toMatchObject({
        active: 0,
        unknown: rejects ? 1 : 0,
        idle: !rejects,
      }),
    );
  },
);

it.each([false, true])(
  'keeps the actual messages JSON reader alive after the request ACK (invalid=%s)',
  async (invalid) => {
    const drain = opened();
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          controller.enqueue(new TextEncoder().encode(invalid ? '{' : '{"ok":true}'));
          controller.close();
        };
      },
    });
    const { result } = await launch(drain, () =>
      cached('messages', async () => new Response(body))(),
    );
    drain.close();
    expect(drain.snapshot()).toMatchObject({ active: 1, idle: false });
    finish();
    if (invalid) await expect(result).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    else await expect(result).resolves.toEqual({ ok: true });
    await vi.waitFor(() =>
      expect(drain.snapshot()).toMatchObject({
        active: 0,
        unknown: invalid ? 1 : 0,
        idle: !invalid,
      }),
    );
  },
);

it('retains a physical responses read even when cancellation has already resolved', async () => {
  const drain = opened();
  const abort = new AbortController();
  type ReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;
  let finishRead!: (value: ReadResult) => void;
  const held = new Promise<ReadResult>((resolve) => {
    finishRead = resolve;
  });
  const body = new ReadableStream<Uint8Array>();
  const supplied = new Response(body);
  const reader = body.getReader();
  // Transport boundary: emulate a reader implementation whose read settles
  // independently of cancel. Keep the actual Response/adapter/operation real.
  const read = vi.spyOn(reader, 'read').mockImplementation(() => held);
  vi.spyOn(body, 'getReader').mockReturnValue(reader);
  const { result } = await launch(drain, () =>
    cached('responses', async () => supplied)(abort.signal),
  );
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  abort.abort();
  await expect(result).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  drain.close();
  expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 1, idle: false });
  finishRead({ done: true, value: undefined });
  await vi.waitFor(() =>
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false }),
  );
});

it('does not accept a messages JSON body that finishes after its deadline', async () => {
  vi.useFakeTimers();
  const drain = opened();
  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      finish = () => {
        controller.enqueue(new TextEncoder().encode('{"ok":true}'));
        controller.close();
      };
    },
  });
  const { result } = await launch(drain, () =>
    cached('messages', async () => new Response(body))(undefined, 10),
  );
  drain.close();
  await vi.advanceTimersByTimeAsync(11);
  expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 1, idle: false });
  finish();
  await expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(0);
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it.each(['messages', 'responses'] as const)(
  'does not dirty an already cancelled %s request',
  async (protocol) => {
    const drain = opened();
    const abort = new AbortController();
    abort.abort();
    const fetchImpl = vi.fn(async () => response(protocol));
    const { result } = await launch(drain, () => cached(protocol, fetchImpl)(abort.signal));
    await expect(result).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    drain.close();
    await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ idle: true, unknown: 0 }));
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);
