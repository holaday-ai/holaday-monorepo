import { describe, expect, it, vi } from 'vitest';
import type { QwenRoute } from './qwen-route.js';
import { ResponsesAdapterError, createQwenResponsesAdapter } from './responses-adapter.js';

const INTL_RESPONSES_ROUTE: QwenRoute = {
  provider: 'alibaba-model-studio',
  region: 'intl',
  deploymentScope: 'international',
  model: 'qwen3.8-max',
  apiKey: 'private-responses-key',
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  workspaceId: 'private-workspace',
  endpointKind: 'public',
  protocol: 'responses',
};

function sseEvent(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function completedEvent(input?: {
  sources?: unknown[];
  usage?: unknown;
  status?: string;
}): unknown {
  return {
    type: 'response.completed',
    response: {
      id: 'resp_1',
      status: input?.status ?? 'completed',
      output: [
        {
          type: 'web_search_call',
          action: { sources: input?.sources ?? [] },
        },
      ],
      usage: input?.usage ?? { input_tokens: 6, output_tokens: 4 },
    },
  };
}

function streamResponse(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function encodeInSmallChunks(value: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(value);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    const length = (offset % 4) + 1;
    chunks.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return chunks;
}

describe('createQwenResponsesAdapter', () => {
  it('joins fragmented UTF-8 deltas and extracts only structured tool sources', async () => {
    const payload =
      sseEvent({ type: 'response.output_text.delta', delta: '市场' }) +
      sseEvent({ type: 'response.output_text.delta', delta: '摘要 https://invented.test' }) +
      sseEvent(
        completedEvent({
          sources: [
            { title: '交易所公告', url: 'https://example.com/exchange' },
            { title: '重复公告', url: 'https://example.com/exchange' },
            { title: '不安全', url: 'file:///private/source' },
          ],
        }),
      );
    const fetchImpl = vi.fn<typeof fetch>(async () => streamResponse(encodeInSmallChunks(payload)));
    const onTextDelta = vi.fn();
    const adapter = createQwenResponsesAdapter({ route: INTL_RESPONSES_ROUTE, fetchImpl });

    const result = await adapter.stream(
      {
        input: [{ role: 'user', content: '今天的市场新闻' }],
        tools: [{ type: 'web_search' }],
      },
      { onTextDelta },
    );

    expect(result.text).toBe('市场摘要 https://invented.test');
    expect(onTextDelta.mock.calls.flat()).toEqual(['市场', '摘要 https://invented.test']);
    expect(result.sources).toEqual([
      { title: '交易所公告', url: 'https://example.com/exchange', provenance: 'web_search' },
    ]);
    expect(result.sources).not.toContainEqual(
      expect.objectContaining({ url: 'https://invented.test' }),
    );
    expect(result).toMatchObject({
      id: 'resp_1',
      status: 'completed',
      usage: { inputTokens: 6, outputTokens: 4 },
      metadata: { protocol: 'responses', region: 'intl' },
    });
  });

  it('posts only whitelisted request fields to the selected regional endpoint', async () => {
    const body =
      sseEvent({ type: 'response.output_text.delta', delta: 'ok' }) + sseEvent(completedEvent());
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      streamResponse([new TextEncoder().encode(body)]),
    );
    const adapter = createQwenResponsesAdapter({ route: INTL_RESPONSES_ROUTE, fetchImpl });

    await adapter.stream({
      instructions: 'Use evidence.',
      input: [{ role: 'user', content: 'Research this.' }],
      tools: [{ type: 'web_search' }, { type: 'web_extractor' }, { type: 'code_interpreter' }],
      temperature: 0.2,
      maxOutputTokens: 512,
      unsafeProviderField: 'must not pass through',
    } as never);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/responses');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer private-responses-key');
    expect(headers.get('x-dashscope-workspace')).toBe('private-workspace');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'qwen3.8-max',
      stream: true,
      store: false,
      instructions: 'Use evidence.',
      input: [{ role: 'user', content: 'Research this.' }],
      tools: [{ type: 'web_search' }, { type: 'web_extractor' }, { type: 'code_interpreter' }],
      temperature: 0.2,
      max_output_tokens: 512,
    });
  });

  it('accepts multiple events in one chunk and removes duplicate HTTP sources', async () => {
    const body =
      sseEvent({ type: 'response.output_text.delta', delta: 'A' }) +
      sseEvent({ type: 'response.output_text.delta', delta: 'B' }) +
      sseEvent(
        completedEvent({
          sources: [
            { title: 'HTTP source', url: 'http://example.com/a' },
            { title: 'Duplicate', url: 'http://example.com/a' },
          ],
        }),
      );
    const adapter = createQwenResponsesAdapter({
      route: INTL_RESPONSES_ROUTE,
      fetchImpl: vi.fn(async () => streamResponse([new TextEncoder().encode(body)])),
    });

    await expect(adapter.stream({ input: 'test', tools: [] })).resolves.toMatchObject({
      text: 'AB',
      sources: [{ title: 'HTTP source', url: 'http://example.com/a', provenance: 'web_search' }],
    });
  });

  it('swallows consumer callback exceptions without losing the canonical result', async () => {
    const body =
      sseEvent({ type: 'response.output_text.delta', delta: 'still returned' }) +
      sseEvent(completedEvent());
    const adapter = createQwenResponsesAdapter({
      route: INTL_RESPONSES_ROUTE,
      fetchImpl: vi.fn(async () => streamResponse([new TextEncoder().encode(body)])),
    });

    await expect(
      adapter.stream(
        { input: 'test', tools: [] },
        {
          onTextDelta() {
            throw new Error('private consumer detail');
          },
        },
      ),
    ).resolves.toMatchObject({ text: 'still returned' });
  });

  it('distinguishes user cancellation from timeout and reuses one signal', async () => {
    const controller = new AbortController();
    controller.abort('private reason');
    const cancelledFetch = vi.fn(async () => streamResponse([]));
    const cancelledAdapter = createQwenResponsesAdapter({
      route: INTL_RESPONSES_ROUTE,
      fetchImpl: cancelledFetch,
    });
    await expect(
      cancelledAdapter.stream({ input: 'test', tools: [] }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(cancelledFetch).not.toHaveBeenCalled();

    const observedSignals: AbortSignal[] = [];
    const timeoutFetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        observedSignals.push(init?.signal as AbortSignal);
        return new Response(
          new ReadableStream<Uint8Array>({
            start() {},
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      },
    );
    const timeoutAdapter = createQwenResponsesAdapter({
      route: INTL_RESPONSES_ROUTE,
      fetchImpl: timeoutFetch,
    });
    await expect(
      timeoutAdapter.stream({ input: 'test', tools: [] }, { timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(new Set(observedSignals).size).toBe(1);
  });

  it('fails closed on HTTP errors without exposing credentials or response bodies', async () => {
    const adapter = createQwenResponsesAdapter({
      route: INTL_RESPONSES_ROUTE,
      fetchImpl: vi.fn(async () => new Response('private provider body', { status: 500 })),
    });

    let caught: unknown;
    try {
      await adapter.stream({ input: 'test', tools: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ResponsesAdapterError);
    expect(caught).toMatchObject({ code: 'PROVIDER_ERROR', status: 500 });
    expect(JSON.stringify(caught)).not.toContain('private provider body');
    expect(JSON.stringify(caught)).not.toContain('private-responses-key');
  });

  it.each([
    ['missing completion', sseEvent({ type: 'response.output_text.delta', delta: 'partial' })],
    [
      'invalid usage',
      sseEvent({ type: 'response.output_text.delta', delta: 'text' }) +
        sseEvent(completedEvent({ usage: { input_tokens: -1, output_tokens: 2 } })),
    ],
    [
      'non-completed status',
      sseEvent({ type: 'response.output_text.delta', delta: 'text' }) +
        sseEvent(completedEvent({ status: 'failed' })),
    ],
  ])('rejects an invalid stream with %s', async (_label, body) => {
    const adapter = createQwenResponsesAdapter({
      route: INTL_RESPONSES_ROUTE,
      fetchImpl: vi.fn(async () => streamResponse([new TextEncoder().encode(String(body))])),
    });

    await expect(adapter.stream({ input: 'test', tools: [] })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
