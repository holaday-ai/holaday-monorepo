import { describe, expect, it, vi } from 'vitest';
import { resolveCoreModelRuntime } from './core-model-runtime.js';
import type { MessagesAdapter } from './messages-adapter.js';
import { MessagesAdapterError } from './messages-adapter.js';
import type { ResponsesAdapter } from './responses-adapter.js';
import { ResponsesAdapterError } from './responses-adapter.js';

const ENVIRONMENT = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'synthetic' as const,
  QWEN_CORE_ENABLED_LANES: 'suggestions,plan,generate,scrape,video_edit_planner,verifier',
  QWEN_CORE_ALLOWLIST: 'usr_allowed',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_WORKSPACE_ID: '',
  DASHSCOPE_INTL_API_KEY: 'intl-private-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: 'cn-private-key',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_CN_WORKSPACE_ID: '',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_FAST_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_STRICT_MODEL: 'qwen3.8-max',
  QWEN_VISION_MODEL: 'qwen3.8-max',
};

function buildMessagesAdapter(model = 'qwen3.8-flash'): MessagesAdapter {
  const metadata = {
    provider: 'alibaba-model-studio' as const,
    model,
    region: 'intl' as const,
    deploymentScope: 'international' as const,
    endpointKind: 'public' as const,
    protocol: 'messages' as const,
  };
  return {
    metadata,
    async create() {
      return {
        id: 'msg_1',
        metadata,
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 12,
          outputTokens: 4,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
}

function buildResponsesAdapter(): ResponsesAdapter {
  return {
    metadata: {
      provider: 'alibaba-model-studio',
      model: 'qwen3.8-max',
      region: 'intl',
      deploymentScope: 'international',
      endpointKind: 'public',
      protocol: 'responses',
    },
    async stream() {
      return {
        id: 'resp_1',
        metadata: this.metadata,
        text: 'ok',
        sources: [],
        usage: { inputTokens: 20, outputTokens: 6 },
        status: 'completed',
      };
    },
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    environment: ENVIRONMENT,
    actorExternalId: 'usr_allowed',
    lane: 'generate' as const,
    ownership: { scope: 'personal' as const, userRegion: 'intl' },
    createMessages: vi.fn(() => buildMessagesAdapter()),
    createResponses: vi.fn(() => buildResponsesAdapter()),
    ...overrides,
  };
}

describe('resolveCoreModelRuntime', () => {
  it('does not construct a transport before policy, lane and region all pass', () => {
    const createMessages = vi.fn(() => buildMessagesAdapter());
    const createResponses = vi.fn(() => buildResponsesAdapter());
    const result = resolveCoreModelRuntime(
      baseInput({ actorExternalId: 'usr_outside', createMessages, createResponses }),
    );

    expect(result).toEqual({ kind: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' });
    expect(createMessages).not.toHaveBeenCalled();
    expect(createResponses).not.toHaveBeenCalled();
  });

  it('fails before transport construction when the lane is disabled', () => {
    const createMessages = vi.fn(() => buildMessagesAdapter());
    const createResponses = vi.fn(() => buildResponsesAdapter());
    const result = resolveCoreModelRuntime(
      baseInput({
        environment: { ...ENVIRONMENT, QWEN_CORE_ENABLED_LANES: 'plan' },
        createMessages,
        createResponses,
      }),
    );

    expect(result).toEqual({ kind: 'unavailable', reason: 'LANE_DISABLED' });
    expect(createMessages).not.toHaveBeenCalled();
    expect(createResponses).not.toHaveBeenCalled();
  });

  it('maps an unassigned personal or organization region without constructing transports', () => {
    for (const ownership of [
      { scope: 'personal' as const, userRegion: null },
      { scope: 'organization' as const, organizationRegion: null },
    ]) {
      const createMessages = vi.fn(() => buildMessagesAdapter());
      const createResponses = vi.fn(() => buildResponsesAdapter());
      expect(
        resolveCoreModelRuntime(baseInput({ ownership, createMessages, createResponses })),
      ).toEqual({ kind: 'unavailable', reason: 'MODEL_DATA_REGION_UNASSIGNED' });
      expect(createMessages).not.toHaveBeenCalled();
      expect(createResponses).not.toHaveBeenCalled();
    }
  });

  it('never tries the other region when the selected region lacks credentials', () => {
    const createMessages = vi.fn(() => buildMessagesAdapter());
    const createResponses = vi.fn(() => buildResponsesAdapter());
    const result = resolveCoreModelRuntime(
      baseInput({
        environment: { ...ENVIRONMENT, DASHSCOPE_CN_API_KEY: '' },
        ownership: { scope: 'personal', userRegion: 'cn' },
        createMessages,
        createResponses,
      }),
    );

    expect(result).toEqual({ kind: 'unavailable', reason: 'REGION_SERVICE_NOT_CONFIGURED' });
    expect(createMessages).not.toHaveBeenCalled();
    expect(createResponses).not.toHaveBeenCalled();
  });

  it('does not hide invalid endpoint configuration as regional unavailability', () => {
    expect(() =>
      resolveCoreModelRuntime(
        baseInput({
          environment: {
            ...ENVIRONMENT,
            DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
          },
          ownership: { scope: 'personal', userRegion: 'cn' },
        }),
      ),
    ).toThrow('does not belong to the cn region');
  });

  it('rejects legacy_fixture in production before evaluating rollout', () => {
    expect(() =>
      resolveCoreModelRuntime(
        baseInput({
          environment: {
            ...ENVIRONMENT,
            NODE_ENV: 'production',
            MODEL_RUNTIME_POLICY: 'legacy_fixture',
          },
        }),
      ),
    ).toThrow('MODEL_RUNTIME_POLICY must be qwen_only in production');
  });

  it('constructs only the requested adapter and records one bounded success observation', async () => {
    const createMessages = vi.fn(() => buildMessagesAdapter());
    const createResponses = vi.fn(() => buildResponsesAdapter());
    const observe = vi.fn();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(108);
    const result = resolveCoreModelRuntime(
      baseInput({ createMessages, createResponses, observe, now }),
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('expected ready runtime');

    expect(createMessages).not.toHaveBeenCalled();
    const adapter = result.messages('fast');
    expect(createMessages).toHaveBeenCalledWith({
      environment: ENVIRONMENT,
      region: 'intl',
      purpose: 'fast',
    });
    expect(createResponses).not.toHaveBeenCalled();
    await adapter.create({ maxTokens: 32, messages: [{ role: 'user', content: 'private' }] });

    expect(observe).toHaveBeenCalledTimes(1);
    const observation = observe.mock.calls[0]?.[0];
    expect(observation).toEqual({
      provider: 'alibaba-model-studio',
      region: 'intl',
      deploymentScope: 'international',
      purpose: 'fast',
      model: 'qwen3.8-flash',
      outcome: 'success',
      inputTokens: 12,
      outputTokens: 4,
      latencyMs: 8,
    });
    expect(Object.keys(observation ?? {}).sort()).toEqual(
      [
        'provider',
        'region',
        'deploymentScope',
        'purpose',
        'model',
        'outcome',
        'inputTokens',
        'outputTokens',
        'latencyMs',
      ].sort(),
    );
  });

  it('records sanitized failures and never lets observation failures alter the provider result', async () => {
    const failingMessages: MessagesAdapter = {
      ...buildMessagesAdapter('qwen3.8-max'),
      async create() {
        throw new MessagesAdapterError('REQUEST_TIMEOUT', 'private provider detail');
      },
    };
    const observe = vi.fn(() => {
      throw new Error('observer unavailable');
    });
    const result = resolveCoreModelRuntime(
      baseInput({
        createMessages: vi.fn(() => failingMessages),
        observe,
        now: vi.fn().mockReturnValueOnce(20).mockReturnValueOnce(25),
      }),
    );
    if (result.kind !== 'ready') throw new Error('expected ready runtime');

    await expect(
      result
        .messages('reasoning')
        .create({ maxTokens: 32, messages: [{ role: 'user', content: 'private' }] }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(observe).toHaveBeenCalledWith({
      provider: 'alibaba-model-studio',
      region: 'intl',
      deploymentScope: 'international',
      purpose: 'reasoning',
      model: 'qwen3.8-max',
      outcome: 'error',
      inputTokens: null,
      outputTokens: null,
      latencyMs: 5,
    });
  });

  it('wraps Responses calls with the same bounded observation contract', async () => {
    const observe = vi.fn();
    const result = resolveCoreModelRuntime(
      baseInput({ observe, now: vi.fn().mockReturnValueOnce(3).mockReturnValueOnce(13) }),
    );
    if (result.kind !== 'ready') throw new Error('expected ready runtime');

    await result.responses('reasoning').stream({ input: 'private', tools: [] });

    expect(observe).toHaveBeenCalledWith({
      provider: 'alibaba-model-studio',
      region: 'intl',
      deploymentScope: 'international',
      purpose: 'reasoning',
      model: 'qwen3.8-max',
      outcome: 'success',
      inputTokens: 20,
      outputTokens: 6,
      latencyMs: 10,
    });
  });

  it('records Responses failures without including provider error content', async () => {
    const failingResponses: ResponsesAdapter = {
      ...buildResponsesAdapter(),
      async stream() {
        throw new ResponsesAdapterError('PROVIDER_ERROR', 503);
      },
    };
    const observe = vi.fn();
    const result = resolveCoreModelRuntime(
      baseInput({
        createResponses: vi.fn(() => failingResponses),
        observe,
        now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(12),
      }),
    );
    if (result.kind !== 'ready') throw new Error('expected ready runtime');

    await expect(result.responses('standard').stream({ input: 'private' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'standard',
        outcome: 'error',
        inputTokens: null,
        outputTokens: null,
      }),
    );
    expect(JSON.stringify(observe.mock.calls)).not.toContain('private');
  });
});
