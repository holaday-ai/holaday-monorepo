import { describe, expect, it, vi } from 'vitest';
import {
  type AnthropicCompatibleClient,
  MessagesAdapterError,
  createAnthropicCompatibleMessagesAdapter,
  createQwenMessagesAdapter,
} from './messages-adapter.js';
import type { QwenRuntimeEnvironment } from './qwen-route.js';

const QWEN_ENVIRONMENT: QwenRuntimeEnvironment & {
  QWEN_MESSAGES_ADAPTER_ENABLED: boolean;
} = {
  DASHSCOPE_API_KEY: 'legacy-intl',
  DASHSCOPE_WORKSPACE_ID: 'legacy-workspace',
  DASHSCOPE_INTL_API_KEY: 'intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_WORKSPACE_ID: 'intl-workspace',
  DASHSCOPE_CN_API_KEY: 'cn-key',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_WORKSPACE_ID: 'cn-workspace',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_MESSAGES_ADAPTER_ENABLED: false,
};

function buildClient(response: unknown): AnthropicCompatibleClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  };
}

describe('createAnthropicCompatibleMessagesAdapter', () => {
  it('maps provider-neutral messages, tools, cache hints, and request options', async () => {
    const client = buildClient({
      id: 'msg_1',
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 31,
        output_tokens: 4,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: 2,
      },
    });
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client,
      metadata: { provider: 'anthropic', model: 'claude-opus-4-7' },
    });
    const controller = new AbortController();

    const response = await adapter.create(
      {
        maxTokens: 512,
        system: [{ type: 'text', text: 'You are a planner.', cacheControl: 'ephemeral' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this screenshot.' },
              {
                type: 'image',
                source: { kind: 'base64', mediaType: 'image/png', data: 'cG5n' },
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool_1', name: 'inspect', input: { target: 'page' } },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                toolUseId: 'tool_1',
                content: 'synthetic result',
                isError: false,
              },
            ],
          },
        ],
        tools: [
          {
            name: 'inspect',
            description: 'Inspect a synthetic page.',
            inputSchema: {
              type: 'object',
              properties: { target: { type: 'string' } },
              required: ['target'],
            },
          },
        ],
        toolChoice: { type: 'tool', name: 'inspect' },
      },
      { signal: controller.signal, timeoutMs: 4_000, maxRetries: 0 },
    );

    expect(client.messages.create).toHaveBeenCalledWith(
      {
        model: 'claude-opus-4-7',
        max_tokens: 512,
        system: [
          {
            type: 'text',
            text: 'You are a planner.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this screenshot.' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'cG5n' },
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool_1', name: 'inspect', input: { target: 'page' } },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool_1',
                content: 'synthetic result',
                is_error: false,
              },
            ],
          },
        ],
        tools: [
          {
            name: 'inspect',
            description: 'Inspect a synthetic page.',
            input_schema: {
              type: 'object',
              properties: { target: { type: 'string' } },
              required: ['target'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'inspect' },
      },
      { signal: controller.signal, timeout: 4_000, maxRetries: 0 },
    );
    expect(response).toEqual({
      id: 'msg_1',
      metadata: { provider: 'anthropic', model: 'claude-opus-4-7' },
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 31,
        outputTokens: 4,
        cacheReadInputTokens: 8,
        cacheCreationInputTokens: 2,
        complete: true,
      },
    });
  });

  it('normalizes end_turn with a tool block to tool_use for Qwen compatibility', async () => {
    const client = buildClient({
      id: 'msg_qwen',
      model: 'qwen3.8-max',
      content: [
        { type: 'text', text: 'I will use a tool.' },
        { type: 'tool_use', id: 'tool_qwen', name: 'emit_plan', input: { steps: [] } },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 7 },
    });
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client,
      metadata: {
        provider: 'alibaba-model-studio',
        model: 'qwen3.8-max',
        region: 'intl',
        deploymentScope: 'international',
        endpointKind: 'public',
      },
    });

    await expect(
      adapter.create({ maxTokens: 100, messages: [{ role: 'user', content: 'plan' }] }),
    ).resolves.toMatchObject({
      stopReason: 'tool_use',
      content: [
        { type: 'text', text: 'I will use a tool.' },
        { type: 'tool_use', id: 'tool_qwen', name: 'emit_plan', input: { steps: [] } },
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 7,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    });
  });

  it.each(['max_tokens', 'stop_sequence'] as const)(
    'preserves an explicit %s stop reason when the response also contains a tool block',
    async (stopReason) => {
      const adapter = createAnthropicCompatibleMessagesAdapter({
        client: buildClient({
          id: `msg_${stopReason}`,
          model: 'qwen3.8-max',
          content: [
            { type: 'text', text: 'I started a tool call.' },
            { type: 'tool_use', id: 'tool_partial', name: 'emit_plan', input: { steps: [] } },
          ],
          stop_reason: stopReason,
          usage: { input_tokens: 10, output_tokens: 7 },
        }),
        metadata: {
          provider: 'alibaba-model-studio',
          model: 'qwen3.8-max',
          region: 'intl',
          deploymentScope: 'international',
          endpointKind: 'public',
        },
      });

      await expect(
        adapter.create({ maxTokens: 100, messages: [{ role: 'user', content: 'plan' }] }),
      ).resolves.toMatchObject({ stopReason });
    },
  );

  it('maps an explicit neutral tool disable to the compatible none choice', async () => {
    const client = buildClient({
      id: 'msg_2',
      model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: 'plain' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client,
      metadata: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    });

    await adapter.create({
      maxTokens: 32,
      messages: [{ role: 'user', content: 'plain text only' }],
      toolChoice: { type: 'none' },
    });

    const request = vi.mocked(client.messages.create).mock.calls[0]?.[0];
    expect(request).toMatchObject({ tool_choice: { type: 'none' } });
  });

  it('fails closed with sanitized errors for provider failures and malformed payloads', async () => {
    const failingClient: AnthropicCompatibleClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error('secret provider response body')) },
    };
    const failingAdapter = createAnthropicCompatibleMessagesAdapter({
      client: failingClient,
      metadata: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    });
    await expect(
      failingAdapter.create({ maxTokens: 32, messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'PROVIDER_ERROR',
        message: 'Message provider request failed',
      }),
    );

    const malformedAdapter = createAnthropicCompatibleMessagesAdapter({
      client: buildClient({ content: [{ type: 'tool_use', id: '', name: 'x' }] }),
      metadata: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    });
    await expect(
      malformedAdapter.create({ maxTokens: 32, messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toBeInstanceOf(MessagesAdapterError);
    await expect(
      malformedAdapter.create({ maxTokens: 32, messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Message provider response is invalid',
    });
  });

  it.each([
    ['AbortError', 'REQUEST_ABORTED', 'Message provider request was aborted'],
    ['APIUserAbortError', 'REQUEST_ABORTED', 'Message provider request was aborted'],
    ['APIConnectionTimeoutError', 'REQUEST_TIMEOUT', 'Message provider request timed out'],
  ] as const)('normalizes %s without leaking provider error text', async (name, code, message) => {
    const providerError = new Error('sensitive provider failure details');
    providerError.name = name;
    const client: AnthropicCompatibleClient = {
      messages: { create: vi.fn().mockRejectedValue(providerError) },
    };
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client,
      metadata: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    });

    await expect(
      adapter.create({ maxTokens: 32, messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toMatchObject({ code, message });
  });

  it('rejects a forced tool that is absent from the tool catalogue before provider I/O', async () => {
    const client = buildClient({});
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client,
      metadata: { provider: 'anthropic', model: 'claude-opus-4-7' },
    });

    await expect(
      adapter.create({
        maxTokens: 32,
        messages: [{ role: 'user', content: 'plan' }],
        tools: [{ name: 'other', description: 'Other tool', inputSchema: { type: 'object' } }],
        toolChoice: { type: 'tool', name: 'emit_plan' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'Message request is invalid' });
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});

describe('createQwenMessagesAdapter', () => {
  it('fails before constructing a client while the migration flag is disabled', () => {
    const clientFactory = vi.fn();

    expect(() =>
      createQwenMessagesAdapter({
        environment: QWEN_ENVIRONMENT,
        region: 'intl',
        purpose: 'reasoning',
        clientFactory,
      }),
    ).toThrowError(expect.objectContaining({ code: 'ADAPTER_DISABLED' }));
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('constructs a region-locked Qwen client and exposes only safe metadata', async () => {
    const client = buildClient({
      id: 'msg_qwen',
      model: 'qwen3.8-max',
      content: [{ type: 'text', text: 'synthetic output' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2 },
    });
    const clientFactory = vi.fn(() => client);

    const adapter = createQwenMessagesAdapter({
      environment: { ...QWEN_ENVIRONMENT, QWEN_MESSAGES_ADAPTER_ENABLED: true },
      region: 'intl',
      purpose: 'reasoning',
      clientFactory,
    });
    const result = await adapter.create({
      maxTokens: 64,
      messages: [{ role: 'user', content: 'synthetic input' }],
    });

    expect(clientFactory).toHaveBeenCalledWith({
      apiKey: 'intl-key',
      baseURL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      defaultHeaders: { 'X-DashScope-WorkSpace': 'intl-workspace' },
    });
    expect(result.metadata).toEqual({
      provider: 'alibaba-model-studio',
      region: 'intl',
      deploymentScope: 'international',
      model: 'qwen3.8-max',
      endpointKind: 'public',
    });
    expect(JSON.stringify(result)).not.toContain('intl-key');
    expect(JSON.stringify(result)).not.toContain('dashscope-intl.aliyuncs.com');
    expect(JSON.stringify(result)).not.toContain('intl-workspace');
  });

  it('fails closed without constructing a client when regional credentials are missing', () => {
    const clientFactory = vi.fn();

    expect(() =>
      createQwenMessagesAdapter({
        environment: {
          ...QWEN_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          DASHSCOPE_CN_API_KEY: '',
        },
        region: 'cn',
        purpose: 'standard',
        clientFactory,
      }),
    ).toThrowError(expect.objectContaining({ code: 'MISSING_REGION_CREDENTIALS' }));
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
