import { describe, expect, it } from 'vitest';
import { resolveSuggestionsProviderRoute } from './suggestions-provider.js';

const BASE_ENVIRONMENT = {
  ANTHROPIC_API_KEY: 'anthropic-key',
  QWEN_MESSAGES_ADAPTER_ENABLED: false,
  QWEN_SUGGESTIONS_CANARY_ENABLED: false,
  QWEN_SUGGESTIONS_SYNTHETIC_ALLOWLIST: '',
};

describe('resolveSuggestionsProviderRoute', () => {
  it('keeps the existing Anthropic route while the canary is disabled', () => {
    expect(
      resolveSuggestionsProviderRoute({
        environment: BASE_ENVIRONMENT,
        userExternalId: 'usr_existing',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'anthropic' });
  });

  it.each([
    ['intl', 'international'],
    ['cn', 'china_mainland'],
  ] as const)(
    'routes an exact synthetic canary user to its persisted %s region',
    (region, scope) => {
      expect(
        resolveSuggestionsProviderRoute({
          environment: {
            ...BASE_ENVIRONMENT,
            QWEN_MESSAGES_ADAPTER_ENABLED: true,
            QWEN_SUGGESTIONS_CANARY_ENABLED: true,
            QWEN_SUGGESTIONS_SYNTHETIC_ALLOWLIST: 'usr_other, usr_canary',
          },
          userExternalId: 'usr_canary',
          userModelDataRegion: region,
        }),
      ).toEqual({ provider: 'qwen', region, deploymentScope: scope });
    },
  );

  it('treats an empty allowlist as zero users and preserves the existing route', () => {
    expect(
      resolveSuggestionsProviderRoute({
        environment: {
          ...BASE_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          QWEN_SUGGESTIONS_CANARY_ENABLED: true,
        },
        userExternalId: 'usr_anyone',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'anthropic' });
  });

  it('does not route a partial allowlist match to Qwen', () => {
    expect(
      resolveSuggestionsProviderRoute({
        environment: {
          ...BASE_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          QWEN_SUGGESTIONS_CANARY_ENABLED: true,
          QWEN_SUGGESTIONS_SYNTHETIC_ALLOWLIST: 'usr_canary_2',
        },
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'anthropic' });
  });

  it.each([null, undefined, 'eu'])(
    'fails closed for an active canary without a valid region',
    (region) => {
      expect(
        resolveSuggestionsProviderRoute({
          environment: {
            ...BASE_ENVIRONMENT,
            QWEN_MESSAGES_ADAPTER_ENABLED: true,
            QWEN_SUGGESTIONS_CANARY_ENABLED: true,
            QWEN_SUGGESTIONS_SYNTHETIC_ALLOWLIST: 'usr_canary',
          },
          userExternalId: 'usr_canary',
          userModelDataRegion: region,
        }),
      ).toEqual({ provider: 'unavailable', reason: 'MODEL_DATA_REGION_UNAVAILABLE' });
    },
  );

  it('is unavailable when neither an eligible canary nor Anthropic is configured', () => {
    expect(
      resolveSuggestionsProviderRoute({
        environment: { ...BASE_ENVIRONMENT, ANTHROPIC_API_KEY: '' },
        userExternalId: 'usr_existing',
        userModelDataRegion: 'intl',
      }),
    ).toEqual({ provider: 'unavailable', reason: 'ANTHROPIC_UNAVAILABLE' });
  });
});
