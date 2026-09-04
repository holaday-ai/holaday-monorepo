import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import { resolveSuggestionsProviderRoute } from './suggestions-provider.js';

const BASE_ENVIRONMENT = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'synthetic' as const,
  QWEN_CORE_ENABLED_LANES: 'suggestions',
  QWEN_CORE_ALLOWLIST: 'usr_canary',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_WORKSPACE_ID: '',
  DASHSCOPE_INTL_API_KEY: 'intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: 'cn-key',
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

function buildAdapter(region: 'cn' | 'intl'): MessagesAdapter {
  const metadata = {
    provider: 'alibaba-model-studio' as const,
    model: 'qwen3.8-flash',
    region,
    deploymentScope: region === 'cn' ? ('china_mainland' as const) : ('international' as const),
    endpointKind: 'public' as const,
    protocol: 'messages' as const,
  };
  return { metadata, create: vi.fn() };
}

describe('resolveSuggestionsProviderRoute', () => {
  it('never returns Anthropic when the Qwen rollout excludes the actor', () => {
    const environment = { ...BASE_ENVIRONMENT, ANTHROPIC_API_KEY: 'legacy-key-must-be-ignored' };
    expect(
      resolveSuggestionsProviderRoute({
        environment,
        userExternalId: 'usr_excluded',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' });
  });

  it.each(['intl', 'cn'] as const)('uses fast Qwen Messages in the persisted %s region', (region) => {
    const createMessages = vi.fn(() => buildAdapter(region));
    const route = resolveSuggestionsProviderRoute({
      environment: BASE_ENVIRONMENT,
      userExternalId: 'usr_canary',
      userModelDataRegion: region,
      createMessages,
    });

    expect(route).toMatchObject({ provider: 'qwen', region });
    expect(createMessages).toHaveBeenCalledWith({
      environment: BASE_ENVIRONMENT,
      region,
      purpose: 'fast',
    });
  });

  it('fails closed when the lane is disabled', () => {
    expect(
      resolveSuggestionsProviderRoute({
        environment: { ...BASE_ENVIRONMENT, QWEN_CORE_ENABLED_LANES: 'plan' },
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'unavailable', reason: 'LANE_DISABLED' });
  });

  it.each([null, undefined, 'eu'])(
    'fails closed without a valid persisted region: %s',
    (region) => {
      expect(
        resolveSuggestionsProviderRoute({
          environment: BASE_ENVIRONMENT,
          userExternalId: 'usr_canary',
          userModelDataRegion: region,
        }),
      ).toEqual({ provider: 'unavailable', reason: 'MODEL_DATA_REGION_UNASSIGNED' });
    },
  );

  it('never crosses regions when the selected service is not configured', () => {
    expect(
      resolveSuggestionsProviderRoute({
        environment: { ...BASE_ENVIRONMENT, DASHSCOPE_CN_API_KEY: '' },
        userExternalId: 'usr_canary',
        userModelDataRegion: 'cn',
      }),
    ).toEqual({ provider: 'unavailable', reason: 'REGION_SERVICE_NOT_CONFIGURED' });
  });
});
