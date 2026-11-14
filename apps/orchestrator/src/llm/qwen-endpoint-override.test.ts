/**
 * BROWSER-HOME-1 (BOSS 2026-11-14「我们不是还有国际千问嘛」): a cloud-browser task's Qwen calls for
 * a `cn` account go to the DashScope INTERNATIONAL endpoint with the international credentials,
 * same model names; everything else keeps its endpoint; a missing international key fails, never
 * falls back to the domestic endpoint.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter, QwenMessagesEnvironment } from './messages-adapter.js';
import { BUILTIN_MODEL_CATALOG, type BrainEntry } from './model-catalog.js';
import {
  MODEL_TASK_FAILURE_COPY,
  type ProductionModelRuntimeResolution,
  createProductionModelRuntimeWiring,
  withQwenEndpoint,
} from './model-runtime-wiring.js';
import { type QwenPurpose, type QwenRoute, resolveQwenRoute } from './qwen-route.js';
import type { ResponsesAdapter } from './responses-adapter.js';

const ENVIRONMENT = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'all' as const,
  QWEN_CORE_ENABLED_LANES: '',
  QWEN_CORE_ALLOWLIST: '',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  MODEL_DATA_REGION_SELECTION_ENABLED: true,
  // The legacy alias is set: the override must not use it as the international key.
  DASHSCOPE_API_KEY: 'synthetic-legacy-key',
  DASHSCOPE_WORKSPACE_ID: 'legacy-workspace',
  DASHSCOPE_INTL_API_KEY: 'synthetic-intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: 'intl-workspace',
  DASHSCOPE_CN_API_KEY: 'synthetic-cn-key',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_CN_WORKSPACE_ID: 'cn-workspace',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_FAST_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_STRICT_MODEL: 'qwen3.8-max',
  QWEN_VISION_MODEL: 'qwen3.8-max',
  ANTHROPIC_API_KEY: 'synthetic-anthropic-key',
  BROWSER_BRAIN_CLAUDE_ENABLED: true,
};

/** Factories that resolve the real Qwen route (as the production adapters do) and record it. */
function recordingWiring(environment = ENVIRONMENT) {
  const routes: QwenRoute[] = [];
  const createMessages = vi.fn(
    (input: {
      environment: QwenMessagesEnvironment;
      region: 'cn' | 'intl';
      purpose: QwenPurpose;
    }): MessagesAdapter => {
      const route = resolveQwenRoute(input.environment, input.region, input.purpose, 'messages');
      routes.push(route);
      return {
        metadata: {
          provider: 'alibaba-model-studio',
          model: route.model,
          region: route.region,
          deploymentScope: route.deploymentScope,
          endpointKind: route.endpointKind,
          protocol: 'messages',
        },
        create: vi.fn(),
      };
    },
  );
  const createResponses = vi.fn(({ route }: { route: QwenRoute }): ResponsesAdapter => {
    routes.push(route);
    return {
      metadata: {
        provider: 'alibaba-model-studio',
        model: route.model,
        region: route.region,
        deploymentScope: route.deploymentScope,
        endpointKind: route.endpointKind,
        protocol: 'responses',
      },
      stream: vi.fn(),
    } as unknown as ResponsesAdapter;
  });
  const wiring = createProductionModelRuntimeWiring(environment, {
    createMessages,
    createResponses,
  });
  return { wiring, routes };
}

function ready(resolution: ProductionModelRuntimeResolution) {
  if (resolution.kind !== 'ready') throw new Error(`expected ready, got ${resolution.reasonCode}`);
  return resolution;
}

const cn = { scope: 'personal' as const, userRegion: 'cn' };
const intl = { scope: 'personal' as const, userRegion: 'intl' };

describe('BROWSER-HOME-1 Qwen endpoint override', () => {
  it('a cloud-browser task of a cn account calls the international endpoint, same models', () => {
    const { wiring, routes } = recordingWiring();
    const plain = recordingWiring();
    for (const lane of ['browser', 'plan', 'generate', 'verifier'] as const) {
      const runtime = ready(
        withQwenEndpoint(wiring, 'intl').resolveCore({
          actorExternalId: 'usr_cn',
          lane,
          ownership: cn,
        }),
      );
      // The account's data region is reported unchanged; only the endpoint moved.
      expect(runtime).toMatchObject({ region: 'cn', qwenEndpoint: 'intl' });
      runtime.messages('vision');
      runtime.messages('standard');
      runtime.responses('fast');
      const baseline = ready(
        plain.wiring.resolveCore({ actorExternalId: 'usr_cn', lane, ownership: cn }),
      );
      baseline.messages('vision');
      baseline.messages('standard');
      baseline.responses('fast');
    }
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.region).toBe('intl');
      expect(route.deploymentScope).toBe('international');
      expect(route.apiKey).toBe('synthetic-intl-key');
      expect(route.workspaceId).toBe('intl-workspace');
      expect(new URL(route.baseURL).hostname).toBe('dashscope-intl.aliyuncs.com');
    }
    // Same model, purpose by purpose, as the same account's domestic route.
    expect(routes.map((route) => route.model)).toEqual(plain.routes.map((route) => route.model));
    for (const route of plain.routes) {
      expect(route.region).toBe('cn');
      expect(route.apiKey).toBe('synthetic-cn-key');
    }
  });

  it('an ordinary task of the same cn account keeps the domestic endpoint', () => {
    const { wiring, routes } = recordingWiring();
    // Building the override wiring never changes the shared one.
    withQwenEndpoint(wiring, 'intl');
    const runtime = ready(
      wiring.resolveCore({ actorExternalId: 'usr_cn', lane: 'browser', ownership: cn }),
    );
    expect(runtime).toMatchObject({ region: 'cn', qwenEndpoint: 'cn' });
    runtime.messages('vision');
    runtime.responses('fast');
    expect(routes).toHaveLength(2);
    for (const route of routes) {
      expect(route.region).toBe('cn');
      expect(route.apiKey).toBe('synthetic-cn-key');
      expect(route.workspaceId).toBe('cn-workspace');
      expect(new URL(route.baseURL).hostname).toBe('dashscope.aliyuncs.com');
    }
  });

  it('an intl account is unchanged, legacy-key fallback included', () => {
    const environment = { ...ENVIRONMENT, DASHSCOPE_INTL_API_KEY: '' };
    const overridden = recordingWiring(environment);
    const plain = recordingWiring(environment);
    const a = ready(
      withQwenEndpoint(overridden.wiring, 'intl').resolveCore({
        actorExternalId: 'usr_intl',
        lane: 'browser',
        ownership: intl,
      }),
    );
    const b = ready(
      plain.wiring.resolveCore({ actorExternalId: 'usr_intl', lane: 'browser', ownership: intl }),
    );
    expect(a).toMatchObject({ region: 'intl', qwenEndpoint: 'intl' });
    a.messages('vision');
    b.messages('vision');
    expect(overridden.routes).toEqual(plain.routes);
    expect(overridden.routes[0]?.apiKey).toBe('synthetic-legacy-key');
  });

  it('an intl account on a non-Qwen brain (Claude) is unchanged', () => {
    const claude = BUILTIN_MODEL_CATALOG.find((entry) => entry.id === 'claude') as BrainEntry;
    const createExternalMessages = vi.fn(
      (input: { provider: 'anthropic' | 'openai'; model: string }): MessagesAdapter => ({
        metadata: { provider: input.provider, model: input.model },
        create: vi.fn(),
      }),
    );
    const createMessages = vi.fn();
    const wiring = createProductionModelRuntimeWiring(ENVIRONMENT, {
      createMessages,
      createExternalMessages,
    });
    const input = {
      actorExternalId: 'usr_intl',
      lane: 'generate' as const,
      ownership: intl,
      brain: claude,
    };
    const a = ready(withQwenEndpoint(wiring, 'intl').resolveCore(input));
    const b = ready(wiring.resolveCore(input));
    expect(a).toMatchObject({ provider: 'anthropic', region: null, qwenEndpoint: null });
    expect(a.messages('standard').metadata).toEqual(b.messages('standard').metadata);
    expect(createMessages).not.toHaveBeenCalled();
  });

  it('without the international key the task fails clearly — no domestic fallback', () => {
    // CN key and the legacy alias are both set; neither may stand in for the international key.
    const { wiring, routes } = recordingWiring({ ...ENVIRONMENT, DASHSCOPE_INTL_API_KEY: '' });
    for (const lane of ['browser', 'plan', 'generate'] as const) {
      const resolution = withQwenEndpoint(wiring, 'intl').resolveCore({
        actorExternalId: 'usr_cn',
        lane,
        ownership: cn,
      });
      expect(resolution).toEqual({
        kind: 'unavailable',
        reasonCode: 'QWEN_INTL_ENDPOINT_NOT_CONFIGURED',
      });
    }
    expect(routes).toHaveLength(0);
    expect(MODEL_TASK_FAILURE_COPY.QWEN_INTL_ENDPOINT_NOT_CONFIGURED).toMatch(
      /云浏览器.*国际站千问.*尚未配置/,
    );
    // The same account's ordinary task is not affected by the missing international key.
    expect(
      wiring.resolveCore({ actorExternalId: 'usr_cn', lane: 'browser', ownership: cn }),
    ).toMatchObject({ kind: 'ready', qwenEndpoint: 'cn' });
  });
});
