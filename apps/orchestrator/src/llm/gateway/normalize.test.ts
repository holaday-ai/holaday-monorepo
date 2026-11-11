import { describe, expect, it, vi } from 'vitest';
import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralMessagesRequest,
  type NeutralMessagesResponse,
  createAnthropicCompatibleMessagesAdapter,
} from '../messages-adapter.js';
import { safeProviderDiagnostics } from '../provider-error-diagnostics.js';
import { modelErrorKind, normalizeMessagesAdapter, totalInputTokens } from './normalize.js';

const QWEN = {
  provider: 'alibaba-model-studio' as const,
  model: 'qwen3.7-plus',
  region: 'cn' as const,
  deploymentScope: 'china_mainland' as const,
  endpointKind: 'public' as const,
  protocol: 'messages' as const,
};

const TOOL = { name: 'emit', description: 'emit', inputSchema: { type: 'object' } };

function response(overrides: Partial<NeutralMessagesResponse> = {}): NeutralMessagesResponse {
  return {
    id: 'msg_1',
    metadata: QWEN,
    content: [{ type: 'text', text: 'ok' }],
    stopReason: 'end_turn',
    usage: {
      inputTokens: 124,
      outputTokens: 5,
      cacheReadInputTokens: 256,
      cacheCreationInputTokens: 0,
      complete: true,
    },
    ...overrides,
  };
}

function fakeAdapter(result: NeutralMessagesResponse | (() => never), metadata = QWEN) {
  const create = vi.fn(async (_request: NeutralMessagesRequest) =>
    typeof result === 'function' ? result() : result,
  );
  const adapter: MessagesAdapter = { metadata, create };
  return { adapter, create };
}

const BASE: NeutralMessagesRequest = { maxTokens: 64, messages: [{ role: 'user', content: 'hi' }] };

describe('normalizeMessagesAdapter', () => {
  it('(1) treats end_turn with a tool_use block as tool_use', async () => {
    const { adapter } = fakeAdapter(
      response({
        content: [{ type: 'tool_use', id: 't1', name: 'emit', input: { a: 1 } }],
        stopReason: 'end_turn',
      }),
    );
    const result = await normalizeMessagesAdapter(adapter).create({
      ...BASE,
      tools: [TOOL],
      toolChoice: { type: 'tool', name: 'emit' },
    });
    expect(result.stopReason).toBe('tool_use');
    const plain = await normalizeMessagesAdapter(fakeAdapter(response()).adapter).create(BASE);
    expect(plain.stopReason).toBe('end_turn');
  });

  it('(2) states thinking on every Qwen request, keeping the effective default', async () => {
    const { adapter, create } = fakeAdapter(response());
    const normalized = normalizeMessagesAdapter(adapter);
    await normalized.create(BASE);
    await normalized.create({ ...BASE, tools: [TOOL], toolChoice: { type: 'tool', name: 'emit' } });
    await normalized.create({ ...BASE, tools: [TOOL], toolChoice: { type: 'any' } });
    await normalized.create({ ...BASE, thinking: { type: 'disabled' } });
    expect(create.mock.calls.map(([request]) => request.thinking)).toEqual([
      { type: 'enabled' }, // endpoint default today
      { type: 'disabled' }, // the adapter already disables it for a forced tool
      { type: 'disabled' },
      { type: 'disabled' }, // caller's explicit choice is kept
    ]);

    // Non-Qwen providers and unvalidated Qwen families get nothing added.
    for (const metadata of [
      { provider: 'openai' as const, model: 'm' },
      { ...QWEN, model: 'qwen3-coder-plus' },
    ]) {
      const other = fakeAdapter(response(), metadata as typeof QWEN);
      await normalizeMessagesAdapter(other.adapter).create(BASE);
      expect(other.create.mock.calls[0]?.[0].thinking).toBeUndefined();
    }
  });

  it('(2) sends the explicit switch on the wire', async () => {
    const sent: unknown[] = [];
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client: {
        messages: {
          async create(request) {
            sent.push(request);
            return {
              id: 'msg_wire',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        },
      },
      metadata: QWEN,
    });
    await normalizeMessagesAdapter(adapter).create(BASE);
    expect(sent[0]).toMatchObject({ thinking: { type: 'enabled' } });
  });

  it('(3) drops empty thinking blocks that reach the adapter output', async () => {
    const { adapter } = fakeAdapter(
      response({
        content: [
          { type: 'thinking', thinking: '', signature: '' } as never,
          { type: 'text', text: 'answer' },
        ],
      }),
    );
    const result = await normalizeMessagesAdapter(adapter).create(BASE);
    expect(result.content).toEqual([{ type: 'text', text: 'answer' }]);
  });

  it('(4) keeps the Anthropic usage split and totals without double counting', async () => {
    const { adapter } = fakeAdapter(response());
    const result = await normalizeMessagesAdapter(adapter).create(BASE);
    // Ledger fields untouched: input excludes the cache read, priced separately.
    expect(result.usage).toMatchObject({ inputTokens: 124, cacheReadInputTokens: 256 });
    // Same figure as the OpenAI channel's prompt_tokens (380, cached 256) in REBUILD-1 D.
    expect(totalInputTokens(result.usage)).toBe(380);
    expect(totalInputTokens({ ...result.usage, cacheReadInputTokens: null })).toBe(124);
    expect(totalInputTokens({ ...result.usage, inputTokens: null })).toBeNull();
  });

  it('(5) surfaces a DashScope {code,message,request_id} failure as one error shape', async () => {
    const raw = Object.assign(new Error('Access denied, account in arrears'), {
      status: 400,
      code: 'Arrearage',
      request_id: 'req-123',
    });
    const { adapter } = fakeAdapter(() => {
      throw raw;
    });
    const error = await normalizeMessagesAdapter(adapter)
      .create(BASE)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MessagesAdapterError);
    expect((error as MessagesAdapterError).diagnostics).toMatchObject({
      httpStatus: 400,
      providerCode: 'Arrearage',
      requestId: 'req-123',
    });
    expect((error as Error).message).not.toContain('arrears'); // provider prose is not kept
    expect(modelErrorKind(error)).toBe('arrears');
  });

  it('(5) leaves adapter errors, aborts and network errors as they are', async () => {
    const adapterError = new MessagesAdapterError('REQUEST_TIMEOUT', 'timeout');
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const reset = Object.assign(new Error('socket'), { code: 'ECONNRESET' });
    for (const thrown of [adapterError, abort, reset]) {
      const { adapter } = fakeAdapter(() => {
        throw thrown;
      });
      await expect(normalizeMessagesAdapter(adapter).create(BASE)).rejects.toBe(thrown);
    }
  });

  it('(5) names the DashScope codes once', () => {
    const failure = (providerCode: string, status: number) =>
      new MessagesAdapterError(
        'PROVIDER_ERROR',
        'x',
        status,
        safeProviderDiagnostics({ httpStatus: status, providerCode }),
      );
    expect(modelErrorKind(failure('Arrearage', 400))).toBe('arrears');
    expect(modelErrorKind(failure('AccessDenied', 403))).toBe('access_denied');
    expect(modelErrorKind(failure('InvalidParameter', 400))).toBe('invalid_parameter');
    expect(modelErrorKind(failure('DataInspectionFailed', 400))).toBe('content_inspection');
    expect(modelErrorKind(failure('Throttling', 429))).toBe('rate_limited');
    expect(modelErrorKind(failure('InternalError', 500))).toBe('provider_unavailable');
    expect(modelErrorKind(new MessagesAdapterError('REQUEST_ABORTED', 'x'))).toBe('aborted');
    expect(modelErrorKind(new Error('x'))).toBe('other');
  });

  it('keeps and normalises the browser-brain role adapters', async () => {
    const planning = fakeAdapter(
      response({ content: [{ type: 'tool_use', id: 't', name: 'emit', input: {} }] }),
    );
    const verification = fakeAdapter(response());
    const execution = fakeAdapter(response());
    const normalized = normalizeMessagesAdapter({
      ...execution.adapter,
      browserBrain: { planning: planning.adapter, verification: verification.adapter },
    });
    expect(normalized.browserBrain).toBeDefined();
    const planned = await normalized.browserBrain?.planning.create(BASE);
    expect(planned?.stopReason).toBe('tool_use');
    await normalized.browserBrain?.verification.create(BASE);
    expect(verification.create.mock.calls[0]?.[0].thinking).toEqual({ type: 'enabled' });
  });
});
