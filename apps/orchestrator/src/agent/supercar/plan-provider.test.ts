import { describe, expect, it } from 'vitest';
import { resolvePlanProviderRoute } from './plan-provider.js';

const BASE_ENVIRONMENT = {
  ANTHROPIC_API_KEY: 'anthropic-key',
  QWEN_MESSAGES_ADAPTER_ENABLED: false,
  QWEN_PLAN_CANARY_ENABLED: false,
  QWEN_PLAN_SYNTHETIC_ALLOWLIST: '',
};

describe('resolvePlanProviderRoute', () => {
  it('preserves the Anthropic planner while the plan canary is disabled', () => {
    expect(
      resolvePlanProviderRoute({
        environment: BASE_ENVIRONMENT,
        userExternalId: 'usr_existing',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it.each([
    ['intl', 'international'],
    ['cn', 'china_mainland'],
  ] as const)(
    'routes only an exact synthetic canary user to the persisted %s region',
    (region, deploymentScope) => {
      expect(
        resolvePlanProviderRoute({
          environment: {
            ...BASE_ENVIRONMENT,
            QWEN_MESSAGES_ADAPTER_ENABLED: true,
            QWEN_PLAN_CANARY_ENABLED: true,
            QWEN_PLAN_SYNTHETIC_ALLOWLIST: 'usr_other, usr_canary',
          },
          userExternalId: 'usr_canary',
          userModelDataRegion: region,
        }),
      ).toEqual({ provider: 'qwen', region, deploymentScope, purpose: 'standard' });
    },
  );

  it('treats an empty allowlist as zero Qwen plan users', () => {
    expect(
      resolvePlanProviderRoute({
        environment: {
          ...BASE_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          QWEN_PLAN_CANARY_ENABLED: true,
        },
        userExternalId: 'usr_anyone',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('does not accept a partial allowlist match', () => {
    expect(
      resolvePlanProviderRoute({
        environment: {
          ...BASE_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          QWEN_PLAN_CANARY_ENABLED: true,
          QWEN_PLAN_SYNTHETIC_ALLOWLIST: 'usr_canary_2',
        },
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it.each([null, undefined, 'eu'])(
    'fails closed for an active plan canary without a valid persisted region',
    (region) => {
      expect(
        resolvePlanProviderRoute({
          environment: {
            ...BASE_ENVIRONMENT,
            QWEN_MESSAGES_ADAPTER_ENABLED: true,
            QWEN_PLAN_CANARY_ENABLED: true,
            QWEN_PLAN_SYNTHETIC_ALLOWLIST: 'usr_canary',
          },
          userExternalId: 'usr_canary',
          userModelDataRegion: region,
        }),
      ).toEqual({ provider: 'unavailable', reason: 'MODEL_DATA_REGION_UNAVAILABLE' });
    },
  );

  it('is unavailable when neither an eligible canary nor Anthropic is configured', () => {
    expect(
      resolvePlanProviderRoute({
        environment: { ...BASE_ENVIRONMENT, ANTHROPIC_API_KEY: '' },
        userExternalId: 'usr_existing',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'unavailable', reason: 'ANTHROPIC_UNAVAILABLE' });
  });
});
