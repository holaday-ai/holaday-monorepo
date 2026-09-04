import { describe, expect, it, vi } from 'vitest';
import { QwenTransportError, createQwenMessagesTransport } from './qwen-messages-transport.js';
import type { QwenRoute } from './qwen-route.js';

const INTL_ROUTE: QwenRoute = {
  provider: 'alibaba-model-studio',
  region: 'intl',
  deploymentScope: 'international',
  model: 'qwen3.8-flash',
  apiKey: 'private-intl-key',
  baseURL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  workspaceId: 'workspace-private',
  endpointKind: 'public',
  protocol: 'messages',
};

const REQUEST = {
  model: 'qwen3.8-flash',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'synthetic input' }],
};

function successfulResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_qwen',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('createQwenMessagesTransport', () => {
  it('posts only to the resolved Qwen Messages endpoint with regional headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => successfulResponse());
    const transport = createQwenMessagesTransport({ route: INTL_ROUTE, fetchImpl });

    await transport.messages.create(REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('private-intl-key');
    expect(new Headers(init?.headers).get('x-dashscope-workspace')).toBe('workspace-private');
    expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01');
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST);
  });

  it('never includes provider response bodies or credentials in normalized errors', async () => {
    const transport = createQwenMessagesTransport({
      route: INTL_ROUTE,
      fetchImpl: vi.fn(async () => new Response('private provider body', { status: 500 })),
    });

    let caught: unknown;
    try {
      await transport.messages.create(REQUEST);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(QwenTransportError);
    expect(caught).toMatchObject({ code: 'PROVIDER_ERROR', status: 500 });
    expect(JSON.stringify(caught)).not.toContain('private provider body');
    expect(JSON.stringify(caught)).not.toContain('private-intl-key');
  });

  it('performs zero retries when maxRetries is zero', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const transport = createQwenMessagesTransport({
      route: INTL_ROUTE,
      fetchImpl,
      retryBaseDelayMs: 0,
    });

    await expect(transport.messages.create(REQUEST, { maxRetries: 0 })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      status: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries only retryable HTTP responses within the configured budget', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(successfulResponse());
    const transport = createQwenMessagesTransport({
      route: INTL_ROUTE,
      fetchImpl,
      retryBaseDelayMs: 0,
    });

    await expect(transport.messages.create(REQUEST, { maxRetries: 2 })).resolves.toMatchObject({
      id: 'msg_qwen',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable HTTP responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const transport = createQwenMessagesTransport({
      route: INTL_ROUTE,
      fetchImpl,
      retryBaseDelayMs: 0,
    });

    await expect(transport.messages.create(REQUEST, { maxRetries: 3 })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      status: 500,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses one timeout signal for the whole request budget', async () => {
    const observedSignals: AbortSignal[] = [];
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const signal = init?.signal as AbortSignal;
        observedSignals.push(signal);
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('provider detail', 'AbortError')),
            { once: true },
          );
        });
      },
    );
    const transport = createQwenMessagesTransport({ route: INTL_ROUTE, fetchImpl });

    await expect(transport.messages.create(REQUEST, { timeout: 5 })).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
    });
    expect(new Set(observedSignals).size).toBe(1);
  });

  it('distinguishes caller cancellation from timeout without leaking the abort reason', async () => {
    const controller = new AbortController();
    controller.abort('private cancellation reason');
    const fetchImpl = vi.fn(async () => successfulResponse());
    const transport = createQwenMessagesTransport({ route: INTL_ROUTE, fetchImpl });

    await expect(
      transport.messages.create(REQUEST, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps malformed success JSON to a safe invalid-response error', async () => {
    const transport = createQwenMessagesTransport({
      route: INTL_ROUTE,
      fetchImpl: vi.fn(async () => new Response('{', { status: 200 })),
    });

    await expect(transport.messages.create(REQUEST)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
    });
  });
});
