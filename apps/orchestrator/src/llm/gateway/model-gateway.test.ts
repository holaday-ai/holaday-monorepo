import { describe, expect, it, vi } from 'vitest';
import type { LlmCallRecord } from '../../agent/llm-call-recorder.js';
import { withMediaCallContext } from '../../agent/media-call-recorder.js';
import { withBrowserBrain } from '../browser-brain.js';
import * as coreRuntime from '../core-model-runtime.js';
import type { CoreModelObservation } from '../core-model-runtime.js';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  QwenMessagesEnvironment,
} from '../messages-adapter.js';
import { BUILTIN_MODEL_CATALOG } from '../model-catalog.js';
import {
  type ProductionModelRuntimeWiring,
  createProductionModelRuntimeWiring,
} from '../model-runtime-wiring.js';
import { resolveQwenRoute } from '../qwen-route.js';
import type { ResponsesAdapter } from '../responses-adapter.js';
import { modelGateway } from './model-gateway.js';
import {
  MODEL_ROLES,
  MODEL_ROLE_VARIANTS,
  type ModelRoleRef,
  baseModelRole,
  legacyModelBinding,
} from './model-roles.js';
import { DEFAULT_ROLE_MODELS } from './role-models.js';
import { MODEL_GATEWAY_OFF } from './settings.js';

const ENV = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'synthetic' as const,
  QWEN_CORE_ENABLED_LANES: '',
  QWEN_CORE_ALLOWLIST: 'usr_allowed',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  MODEL_DATA_REGION_SELECTION_ENABLED: true,
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
  QWEN_REASONING_MODEL: 'qwen-env-reasoning',
  QWEN_STANDARD_MODEL: 'qwen-env-standard',
  QWEN_FAST_MODEL: 'qwen-env-fast',
  QWEN_CODING_MODEL: 'qwen-env-coding',
  QWEN_VERIFIER_MODEL: 'qwen-env-verifier',
  QWEN_VERIFY_FAST_MODEL: 'qwen-env-verify-fast',
  QWEN_VERIFY_STRICT_MODEL: 'qwen-env-verify-strict',
  QWEN_VISION_MODEL: 'qwen-env-vision',
};

const ALL_REFS: ModelRoleRef[] = [
  ...MODEL_ROLES,
  ...(Object.keys(MODEL_ROLE_VARIANTS) as ModelRoleRef[]),
];
const CONTEXT = {
  actorExternalId: 'usr_allowed',
  ownership: { scope: 'personal' as const, userRegion: 'cn' },
};

/** A fake Qwen messages factory that reports the model its route resolved; no network. */
function qwenFactories(content: 'text' | 'tool' = 'text') {
  const requests: NeutralMessagesRequest[] = [];
  const createMessages = vi.fn(
    (input: {
      environment: QwenMessagesEnvironment;
      region: 'cn' | 'intl';
      purpose: Parameters<typeof resolveQwenRoute>[2];
    }): MessagesAdapter => {
      const route = resolveQwenRoute(input.environment, input.region, input.purpose, 'messages');
      const metadata = {
        provider: 'alibaba-model-studio' as const,
        model: route.model,
        region: input.region,
        deploymentScope: route.deploymentScope,
        endpointKind: route.endpointKind,
        protocol: 'messages' as const,
      };
      return {
        metadata,
        async create(request) {
          requests.push(request);
          return {
            id: 'msg_fake',
            metadata,
            content:
              content === 'tool'
                ? [{ type: 'tool_use', id: 't1', name: 'emit', input: {} }]
                : [{ type: 'text', text: 'ok' }],
            stopReason: 'end_turn',
            usage: {
              inputTokens: 124,
              outputTokens: 5,
              cacheReadInputTokens: 256,
              cacheCreationInputTokens: 0,
              complete: true,
            },
          };
        },
      };
    },
  );
  const createResponses = vi.fn(
    (input: { route: ReturnType<typeof resolveQwenRoute> }): ResponsesAdapter => ({
      metadata: {
        provider: 'alibaba-model-studio',
        model: input.route.model,
        region: input.route.region,
        deploymentScope: input.route.deploymentScope,
        endpointKind: input.route.endpointKind,
        protocol: 'responses',
      },
      async stream() {
        throw new Error('not used');
      },
    }),
  );
  return { createMessages, createResponses, requests };
}

function recordingWiring() {
  const messagesByPurpose = new Map<string, MessagesAdapter>();
  const responsesByPurpose = new Map<string, ResponsesAdapter>();
  const ready = {
    kind: 'ready' as const,
    brainId: 'qwen',
    provider: 'alibaba-model-studio' as const,
    region: 'cn' as const,
    messages: vi.fn((purpose: string) => {
      const adapter = { metadata: { provider: 'openai', model: purpose } } as MessagesAdapter;
      messagesByPurpose.set(purpose, adapter);
      return adapter;
    }),
    responses: vi.fn((purpose: string) => {
      const adapter = { metadata: { provider: 'openai', model: purpose } } as ResponsesAdapter;
      responsesByPurpose.set(purpose, adapter);
      return adapter;
    }),
  };
  const wiring: ProductionModelRuntimeWiring = {
    policy: 'model_catalog',
    resolveCore: vi.fn(() => ready),
    resolveUnmigrated: () => ({ kind: 'unavailable', reasonCode: 'MODEL_MIGRATION_IN_PROGRESS' }),
  };
  return { wiring, ready, messagesByPurpose, responsesByPurpose };
}

describe('model gateway, LLM_GATEWAY_V2 off', () => {
  it('resolves exactly the legacy lane and hands back the legacy adapter for every role', () => {
    for (const settings of [undefined, MODEL_GATEWAY_OFF]) {
      for (const ref of ALL_REFS) {
        const fake = recordingWiring();
        const wiring = settings ? { ...fake.wiring, gateway: settings } : fake.wiring;
        const gateway = modelGateway({ wiring });
        expect(gateway.enabled).toBe(false);
        const { lane, purpose } = legacyModelBinding(ref);

        const runtime = gateway.resolve(ref, CONTEXT);
        // The call the site made before: resolveCore({ actorExternalId, lane, ownership }).
        expect(fake.wiring.resolveCore).toHaveBeenCalledTimes(1);
        const [args] = vi.mocked(fake.wiring.resolveCore).mock.calls[0] ?? [];
        expect(args).toStrictEqual({
          actorExternalId: 'usr_allowed',
          lane,
          ownership: CONTEXT.ownership,
        });
        if (runtime.kind !== 'ready') throw new Error('expected ready');
        expect(runtime.region).toBe('cn');
        expect(runtime.brainId).toBe('qwen');

        // Same adapter object the legacy runtime.messages(purpose) returned — unwrapped.
        const messages = runtime.messages();
        expect(fake.ready.messages).toHaveBeenLastCalledWith(purpose);
        expect(messages).toBe(fake.messagesByPurpose.get(purpose));
        const responses = runtime.responses();
        expect(fake.ready.responses).toHaveBeenLastCalledWith(purpose);
        expect(responses).toBe(fake.responsesByPurpose.get(purpose));
      }
    }
  });

  it('passes an explicit brain through and returns an unavailable resolution untouched', () => {
    const unavailable = {
      kind: 'unavailable' as const,
      reasonCode: 'MODEL_ROLLOUT_NOT_ALLOWED' as const,
    };
    const wiring: ProductionModelRuntimeWiring = {
      policy: 'model_catalog',
      resolveCore: vi.fn(() => unavailable),
      resolveUnmigrated: () => ({ kind: 'unavailable', reasonCode: 'MODEL_MIGRATION_IN_PROGRESS' }),
    };
    const brain = BUILTIN_MODEL_CATALOG[0];
    if (!brain) throw new Error('catalog');
    const gateway = modelGateway({ wiring });
    expect(gateway.resolve('verifier', { ...CONTEXT, brain })).toBe(unavailable);
    expect(wiring.resolveCore).toHaveBeenCalledWith({
      actorExternalId: 'usr_allowed',
      lane: 'verifier',
      ownership: CONTEXT.ownership,
      brain,
    });
    expect(gateway.messages('judge', CONTEXT)).toBe(unavailable);
  });

  it('serves another role of the same lane from one resolution, as the call sites did', () => {
    const fake = recordingWiring();
    const runtime = modelGateway({ wiring: fake.wiring }).resolve('brain', CONTEXT);
    if (runtime.kind !== 'ready') throw new Error('expected ready');
    expect(runtime.messages()).toBe(fake.messagesByPurpose.get('vision'));
    expect(runtime.responses('search')).toBe(fake.responsesByPurpose.get('fast'));
    expect(fake.wiring.resolveCore).toHaveBeenCalledTimes(1);
    expect(() => runtime.messages('generate')).toThrow(/not served by the browser lane/);
  });

  it('builds the same adapters as the legacy wiring call, recorded as supercar.turn', async () => {
    for (const ref of ALL_REFS) {
      const { lane, purpose } = legacyModelBinding(ref);
      const viaGateway = qwenFactories();
      const viaLegacy = qwenFactories();
      const gatewayWiring = createProductionModelRuntimeWiring(ENV, viaGateway);
      const legacyWiring = createProductionModelRuntimeWiring(ENV, viaLegacy);
      const runtime = modelGateway({ wiring: gatewayWiring }).resolve(ref, CONTEXT);
      const legacy = legacyWiring.resolveCore({
        actorExternalId: 'usr_allowed',
        lane,
        ownership: CONTEXT.ownership,
      });
      if (runtime.kind !== 'ready' || legacy.kind !== 'ready') throw new Error('expected ready');
      expect(runtime.messages().metadata).toEqual(legacy.messages(purpose).metadata);
      expect(viaGateway.createMessages.mock.calls).toEqual(viaLegacy.createMessages.mock.calls);
      expect(runtime.responses().metadata).toEqual(legacy.responses(purpose).metadata);
      expect(viaGateway.createResponses.mock.calls).toEqual(viaLegacy.createResponses.mock.calls);
    }

    const records: LlmCallRecord[] = [];
    const factories = qwenFactories('tool');
    const wiring = createProductionModelRuntimeWiring(ENV, factories);
    const adapter = modelGateway({ wiring }).messages('judge', CONTEXT);
    if (adapter.kind !== 'ready') throw new Error('expected ready');
    const result = await withMediaCallContext(
      {
        recorder: { record: async (call) => void records.push(call) },
        userExternalId: 'u',
        taskExternalId: 't',
      },
      () => adapter.adapter.create({ maxTokens: 8, messages: [{ role: 'user', content: 'x' }] }),
    );
    expect(records.map((record) => record.purpose)).toEqual(['supercar.turn']);
    expect(factories.requests[0]?.thinking).toBeUndefined(); // nothing added with the flag off
    expect(result.stopReason).toBe('end_turn'); // fake bypasses the adapter: not normalised
  });

  it('takes the direct core path the bypassing call sites used, with the same arguments', () => {
    const spy = vi.spyOn(coreRuntime, 'resolveCoreModelRuntime');
    try {
      const createMessages = qwenFactories().createMessages;
      for (const ref of ['plan', 'suggestions', 'video_edit_planner'] as const) {
        spy.mockClear();
        const gateway = modelGateway({ core: { environment: ENV, createMessages } });
        expect(gateway.enabled).toBe(false);
        const runtime = gateway.resolve(ref, CONTEXT);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]?.[0]).toStrictEqual({
          environment: ENV,
          actorExternalId: 'usr_allowed',
          lane: legacyModelBinding(ref).lane,
          ownership: CONTEXT.ownership,
          createMessages,
        });
        if (runtime.kind !== 'ready') throw new Error('expected ready');
        const legacy = coreRuntime.resolveCoreModelRuntime({
          environment: ENV,
          actorExternalId: 'usr_allowed',
          lane: legacyModelBinding(ref).lane,
          ownership: CONTEXT.ownership,
          createMessages,
        });
        if (legacy.kind !== 'ready') throw new Error('expected ready');
        expect(runtime.messages().metadata).toEqual(
          legacy.messages(legacyModelBinding(ref).purpose).metadata,
        );
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe('model gateway, LLM_GATEWAY_V2 on', () => {
  const ON = { ...ENV, LLM_GATEWAY_V2: true };

  it('picks the role model for the task region for every role', () => {
    for (const region of ['cn', 'intl'] as const) {
      for (const ref of ALL_REFS) {
        const factories = qwenFactories();
        const wiring = createProductionModelRuntimeWiring(ON, factories);
        const gateway = modelGateway({ wiring });
        expect(gateway.enabled).toBe(true);
        const context = {
          ...CONTEXT,
          ownership: { scope: 'personal' as const, userRegion: region },
        };
        const runtime = gateway.resolve(ref, context);
        if (runtime.kind !== 'ready') throw new Error('expected ready');
        const model = DEFAULT_ROLE_MODELS[region][baseModelRole(ref)];
        expect(runtime.messages().metadata).toMatchObject({ model, region });
        expect(runtime.responses().metadata).toMatchObject({ model, region });
      }
    }
  });

  it('applies the env override per region and ignores an invalid one', () => {
    const factories = qwenFactories();
    const wiring = createProductionModelRuntimeWiring(
      { ...ON, LLM_GATEWAY_ROLE_MODELS: JSON.stringify({ intl: { judge: 'qwen3.6-flash' } }) },
      factories,
    );
    const gateway = modelGateway({ wiring });
    const intl = gateway.messages('judge', {
      ...CONTEXT,
      ownership: { scope: 'personal', userRegion: 'intl' },
    });
    const cn = gateway.messages('judge', CONTEXT);
    if (intl.kind !== 'ready' || cn.kind !== 'ready') throw new Error('expected ready');
    expect(intl.adapter.metadata.model).toBe('qwen3.6-flash');
    expect(cn.adapter.metadata.model).toBe(DEFAULT_ROLE_MODELS.cn.judge);

    const invalid = createProductionModelRuntimeWiring(
      { ...ON, LLM_GATEWAY_ROLE_MODELS: JSON.stringify({ cn: { judge: 'gpt-4o', nobody: 'x' } }) },
      qwenFactories(),
    );
    const fallback = modelGateway({ wiring: invalid }).messages('judge', CONTEXT);
    if (fallback.kind !== 'ready') throw new Error('expected ready');
    expect(fallback.adapter.metadata.model).toBe(DEFAULT_ROLE_MODELS.cn.judge);
  });

  it('records role:<role> with the lane kept, totals observation input, and normalises', async () => {
    const records: LlmCallRecord[] = [];
    const observations: CoreModelObservation[] = [];
    const factories = qwenFactories('tool');
    const wiring = createProductionModelRuntimeWiring(ON, {
      ...factories,
      observe: (observation) => void observations.push(observation),
    });
    const adapter = modelGateway({ wiring }).messages('judge', CONTEXT);
    if (adapter.kind !== 'ready') throw new Error('expected ready');
    const result = await withMediaCallContext(
      {
        recorder: { record: async (call) => void records.push(call) },
        userExternalId: 'u',
        taskExternalId: 't',
      },
      () => adapter.adapter.create({ maxTokens: 8, messages: [{ role: 'user', content: 'x' }] }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      purpose: 'role:judge',
      model: DEFAULT_ROLE_MODELS.cn.judge,
      inputTokens: 124, // ledger keeps the Anthropic split…
      cacheReadInputTokens: 256, // …and prices the cache read on its own
      requestMeta: { lane: 'plan', protocol: 'messages' },
    });
    expect(observations[0]).toMatchObject({ lane: 'plan', purpose: 'fast', inputTokens: 380 });
    expect(factories.requests[0]?.thinking).toEqual({ type: 'enabled' });
    expect(result.stopReason).toBe('tool_use');
  });

  it('keeps an explicit browser-brain model and non-Qwen catalog brains', () => {
    const factories = qwenFactories();
    const wiring = createProductionModelRuntimeWiring(ON, factories);
    const runtime = withBrowserBrain(
      { planning: { provider: 'alibaba-model-studio', model: 'qwen3.6-plus' } },
      () => modelGateway({ wiring }).resolve('brain', CONTEXT),
    );
    if (runtime.kind !== 'ready') throw new Error('expected ready');
    const adapter = runtime.messages();
    expect(adapter.metadata.model).toBe(DEFAULT_ROLE_MODELS.cn.brain);
    expect(adapter.browserBrain?.planning.metadata.model).toBe('qwen3.6-plus');
    expect(adapter.browserBrain?.verification.metadata.model).toBe(DEFAULT_ROLE_MODELS.cn.brain);

    const claude = BUILTIN_MODEL_CATALOG.find((brain) => brain.provider === 'anthropic');
    if (!claude) throw new Error('catalog');
    const createExternalMessages = vi.fn(
      (input: { model: string }): MessagesAdapter => ({
        metadata: { provider: 'anthropic', model: input.model },
        create: vi.fn(),
      }),
    );
    const external = createProductionModelRuntimeWiring(
      { ...ON, ANTHROPIC_API_KEY: 'synthetic-anthropic-key' },
      { createExternalMessages },
    );
    const judge = modelGateway({ wiring: external }).messages('judge', {
      ...CONTEXT,
      brain: claude,
    });
    if (judge.kind !== 'ready') throw new Error('expected ready');
    expect(judge.adapter.metadata.model).toBe(claude.laneModels.plan);
  });

  it('direct core path: role model unless the caller pinned one', () => {
    const factories = qwenFactories();
    const gateway = modelGateway({
      core: { environment: { ...ON, QWEN_STANDARD_MODEL: 'qwen3.6-plus' }, ...factories },
    });
    expect(gateway.enabled).toBe(true);
    const plan = gateway.resolve('plan', CONTEXT);
    const pinned = gateway.resolve('plan', { ...CONTEXT, modelPinned: true });
    if (plan.kind !== 'ready' || pinned.kind !== 'ready') throw new Error('expected ready');
    expect(plan.messages().metadata.model).toBe(DEFAULT_ROLE_MODELS.cn.plan);
    expect(pinned.messages().metadata.model).toBe('qwen3.6-plus');
  });
});
