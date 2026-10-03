import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from './messages-adapter.js';
import { BUILTIN_MODEL_CATALOG, type BrainEntry, runWithBrain } from './model-catalog.js';
import {
  MODEL_TASK_FAILURE_COPY,
  createProductionModelRuntimeWiring,
} from './model-runtime-wiring.js';
import type { ResponsesAdapter } from './responses-adapter.js';

const ENVIRONMENT = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'synthetic' as const,
  QWEN_CORE_ENABLED_LANES: 'generate,scrape,verifier',
  QWEN_CORE_ALLOWLIST: 'usr_allowed',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_WORKSPACE_ID: '',
  DASHSCOPE_INTL_API_KEY: 'synthetic-intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: 'synthetic-cn-key',
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

describe('createProductionModelRuntimeWiring', () => {
  it('is driven by the model catalog and exposes no raw provider clients', () => {
    const wiring = createProductionModelRuntimeWiring(ENVIRONMENT);
    expect(wiring.policy).toBe('model_catalog');
    expect(Object.keys(wiring)).not.toContain('legacyModelClientFactory');
    expect(Object.keys(wiring)).not.toContain('anthropic');
    expect(Object.keys(wiring)).not.toContain('openai');
    expect(Object.keys(wiring)).not.toContain('google');
  });

  it('maps core runtime failures to stable persisted reason codes', () => {
    const wiring = createProductionModelRuntimeWiring(ENVIRONMENT);
    expect(
      wiring.resolveCore({
        actorExternalId: 'usr_allowed',
        lane: 'generate',
        ownership: { scope: 'personal', userRegion: null },
      }),
    ).toEqual({ kind: 'unavailable', reasonCode: 'MODEL_DATA_REGION_UNASSIGNED' });
    expect(
      wiring.resolveCore({
        actorExternalId: 'usr_outside',
        lane: 'generate',
        ownership: { scope: 'personal', userRegion: 'intl' },
      }),
    ).toEqual({ kind: 'unavailable', reasonCode: 'MODEL_ROLLOUT_NOT_ALLOWED' });
  });

  it('keeps browser and media lanes explicitly unavailable', () => {
    const wiring = createProductionModelRuntimeWiring(ENVIRONMENT);
    for (const lane of ['image', 'video_generation', 'voice', 'memory'] as const) {
      expect(wiring.resolveUnmigrated(lane)).toEqual({
        kind: 'unavailable',
        reasonCode: 'MODEL_MIGRATION_IN_PROGRESS',
      });
    }
  });

  it('owns the exact user-facing copy for every stable reason code', () => {
    expect(MODEL_TASK_FAILURE_COPY).toEqual({
      MODEL_DATA_REGION_UNASSIGNED: '请先选择模型数据区域，再开始任务。',
      REGION_SERVICE_NOT_CONFIGURED: '该区域的模型服务尚未配置，请稍后再试。',
      MODEL_MIGRATION_IN_PROGRESS: '这项能力正在迁移到千问，暂时不可用。',
      MODEL_ROLLOUT_NOT_ALLOWED: '这项能力正在小范围验证，暂未对当前账号开放。',
      MODEL_PROVIDER_NOT_CONFIGURED: '所选模型的服务尚未配置，请切换到千问后重试。',
    });
  });

  describe('provider dispatch', () => {
    const brain = (id: string): BrainEntry => {
      const entry = BUILTIN_MODEL_CATALOG.find((candidate) => candidate.id === id);
      if (!entry) throw new Error(`missing ${id}`);
      return entry;
    };
    const fakeMessages = (provider: 'anthropic' | 'openai', model: string): MessagesAdapter => ({
      metadata: { provider, model },
      create: vi.fn(),
    });
    const fakeResponses = (provider: 'anthropic' | 'openai', model: string): ResponsesAdapter => ({
      metadata: { provider, model, protocol: 'responses' },
      stream: vi.fn(),
    });
    const ALL_LANES_ENV = {
      ...ENVIRONMENT,
      QWEN_CORE_ROLLOUT_MODE: 'all' as const,
      QWEN_CORE_ENABLED_LANES: '',
      ANTHROPIC_API_KEY: 'synthetic-anthropic-key',
      OPENAI_API_KEY: 'synthetic-openai-key',
    };
    const ownership = { scope: 'personal' as const, userRegion: 'intl' };

    it('routes the default Qwen brain through the existing Qwen runtime with catalog lane models', () => {
      const createMessages = vi.fn(({ purpose }: { purpose: string }) => ({
        metadata: {
          provider: 'alibaba-model-studio' as const,
          model: purpose,
          region: 'intl' as const,
          deploymentScope: 'international' as const,
          endpointKind: 'public' as const,
          protocol: 'messages' as const,
        },
        create: vi.fn(),
      }));
      const wiring = createProductionModelRuntimeWiring(ALL_LANES_ENV, { createMessages });
      const runtime = wiring.resolveCore({ actorExternalId: 'usr_any', lane: 'plan', ownership });
      expect(runtime).toMatchObject({
        kind: 'ready',
        brainId: 'qwen',
        provider: 'alibaba-model-studio',
        region: 'intl',
      });
      if (runtime.kind !== 'ready') throw new Error('expected ready');
      runtime.messages('standard');
      const call = createMessages.mock.calls[0]?.[0] as unknown as {
        environment: { QWEN_STANDARD_MODEL: string };
      };
      // Catalog: plan lane runs qwen3.8-flash even though the env standard model is qwen3.7-plus.
      expect(call.environment.QWEN_STANDARD_MODEL).toBe('qwen3.8-flash');
    });

    it.each([
      ['claude', 'anthropic', 'claude-sonnet-4-6'],
      ['gpt', 'openai', 'gpt-4o'],
    ] as const)(
      'routes the %s brain to the %s adapters without a Qwen region',
      (id, provider, model) => {
        const createExternalMessages = vi.fn(
          (input: { provider: 'anthropic' | 'openai'; model: string }) =>
            fakeMessages(input.provider, input.model),
        );
        const createExternalResponses = vi.fn(
          (input: { provider: 'anthropic' | 'openai'; model: string }) =>
            fakeResponses(input.provider, input.model),
        );
        const createMessages = vi.fn();
        const wiring = createProductionModelRuntimeWiring(ALL_LANES_ENV, {
          createMessages,
          createExternalMessages,
          createExternalResponses,
        });
        const runtime = wiring.resolveCore({
          actorExternalId: 'usr_any',
          lane: 'generate',
          ownership: { scope: 'personal', userRegion: null },
          brain: brain(id),
        });
        expect(runtime).toMatchObject({ kind: 'ready', brainId: id, provider, region: null });
        if (runtime.kind !== 'ready') throw new Error('expected ready');
        expect(runtime.responses('standard').metadata).toEqual({
          provider,
          model,
          protocol: 'responses',
        });
        expect(runtime.messages('verify_strict').metadata).toEqual({ provider, model });
        expect(createMessages).not.toHaveBeenCalled();
      },
    );

    it('uses the brain bound to the running task when none is passed', () => {
      const createExternalMessages = vi.fn(
        (input: { provider: 'anthropic' | 'openai'; model: string }) =>
          fakeMessages(input.provider, input.model),
      );
      const wiring = createProductionModelRuntimeWiring(ALL_LANES_ENV, { createExternalMessages });
      const runtime = runWithBrain(
        { brain: brain('claude'), requestedBrainId: 'claude', fallbackReason: null },
        () => wiring.resolveCore({ actorExternalId: 'usr_any', lane: 'browser', ownership }),
      );
      if (runtime.kind !== 'ready') throw new Error('expected ready');
      expect(runtime.messages('vision').metadata).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      });
    });

    it('reports an unconfigured external provider instead of calling it', () => {
      const wiring = createProductionModelRuntimeWiring({ ...ALL_LANES_ENV, OPENAI_API_KEY: '' });
      expect(
        wiring.resolveCore({
          actorExternalId: 'usr_any',
          lane: 'generate',
          ownership,
          brain: brain('gpt'),
        }),
      ).toEqual({ kind: 'unavailable', reasonCode: 'MODEL_PROVIDER_NOT_CONFIGURED' });
    });
  });
});
