import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

const BASE_ENV = {
  DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('Qwen dual-region environment contract', () => {
  it('defines separate empty credentials and pinned regional endpoints without enabling routing', () => {
    const parsed = envSchema.parse(BASE_ENV);

    expect(parsed).toMatchObject({
      DASHSCOPE_INTL_API_KEY: '',
      DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      DASHSCOPE_INTL_RESPONSES_BASE_URL:
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      DASHSCOPE_INTL_WORKSPACE_ID: '',
      DASHSCOPE_CN_API_KEY: '',
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
      MODEL_RUNTIME_POLICY: 'qwen_only',
      QWEN_CORE_ROLLOUT_MODE: 'off',
      QWEN_CORE_ENABLED_LANES: '',
      QWEN_CORE_ALLOWLIST: '',
      QWEN_RESPONSES_ADAPTER_ENABLED: false,
      QWEN_SHADOW_EVAL_ENABLED: false,
      QWEN_MESSAGES_ADAPTER_ENABLED: false,
      QWEN_SUGGESTIONS_CANARY_ENABLED: false,
      QWEN_SUGGESTIONS_SYNTHETIC_ALLOWLIST: '',
      QWEN_PLAN_CANARY_ENABLED: false,
      QWEN_PLAN_SYNTHETIC_ALLOWLIST: '',
    });
  });

  it('normalizes accepted dedicated workspace endpoints', () => {
    const parsed = envSchema.parse({
      ...BASE_ENV,
      DASHSCOPE_INTL_ANTHROPIC_BASE_URL:
        'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/',
      DASHSCOPE_CN_ANTHROPIC_BASE_URL:
        'https://workspace-2.cn-beijing.maas.aliyuncs.com/apps/anthropic/',
      DASHSCOPE_INTL_RESPONSES_BASE_URL:
        'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
      DASHSCOPE_CN_RESPONSES_BASE_URL:
        'https://workspace-2.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
    });

    expect(parsed.DASHSCOPE_INTL_ANTHROPIC_BASE_URL).toBe(
      'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
    );
    expect(parsed.DASHSCOPE_CN_ANTHROPIC_BASE_URL).toBe(
      'https://workspace-2.cn-beijing.maas.aliyuncs.com/apps/anthropic',
    );
    expect(parsed.DASHSCOPE_INTL_RESPONSES_BASE_URL).toBe(
      'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    );
    expect(parsed.DASHSCOPE_CN_RESPONSES_BASE_URL).toBe(
      'https://workspace-2.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    );
  });

  it('enables the adapter only through an explicit true value', () => {
    const parsed = envSchema.parse({ ...BASE_ENV, QWEN_MESSAGES_ADAPTER_ENABLED: 'true' });

    expect(parsed.QWEN_MESSAGES_ADAPTER_ENABLED).toBe(true);
  });

  it('enables the Responses adapter only through an explicit true value', () => {
    const parsed = envSchema.parse({ ...BASE_ENV, QWEN_RESPONSES_ADAPTER_ENABLED: 'true' });

    expect(parsed.QWEN_RESPONSES_ADAPTER_ENABLED).toBe(true);
  });

  it('rejects legacy_fixture as a production runtime policy', () => {
    expect(() =>
      envSchema.parse({
        ...BASE_ENV,
        NODE_ENV: 'production',
        MODEL_RUNTIME_POLICY: 'legacy_fixture',
      }),
    ).toThrow('MODEL_RUNTIME_POLICY must be qwen_only in production');
  });

  it('rejects unknown core lane tokens', () => {
    expect(() =>
      envSchema.parse({ ...BASE_ENV, QWEN_CORE_ENABLED_LANES: 'generate,unknown_lane' }),
    ).toThrow('Unknown QWEN_CORE_ENABLED_LANES value: unknown_lane');
  });

  it('enables the suggestions canary only through an explicit true value', () => {
    const parsed = envSchema.parse({ ...BASE_ENV, QWEN_SUGGESTIONS_CANARY_ENABLED: 'true' });

    expect(parsed.QWEN_SUGGESTIONS_CANARY_ENABLED).toBe(true);
  });

  it('enables the plan canary only through an explicit true value', () => {
    const parsed = envSchema.parse({ ...BASE_ENV, QWEN_PLAN_CANARY_ENABLED: 'true' });

    expect(parsed.QWEN_PLAN_CANARY_ENABLED).toBe(true);
  });

  it.each([
    ['DASHSCOPE_INTL_ANTHROPIC_BASE_URL', 'https://dashscope.aliyuncs.com/apps/anthropic'],
    ['DASHSCOPE_CN_ANTHROPIC_BASE_URL', 'https://dashscope-intl.aliyuncs.com/apps/anthropic'],
    [
      'DASHSCOPE_INTL_RESPONSES_BASE_URL',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ],
    [
      'DASHSCOPE_CN_RESPONSES_BASE_URL',
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    ],
  ])('rejects a wrong-region URL in %s', (field, value) => {
    expect(() => envSchema.parse({ ...BASE_ENV, [field]: value })).toThrow(field);
  });

  it('keeps the existing native DashScope media defaults unchanged', () => {
    const parsed = envSchema.parse(BASE_ENV);

    expect(parsed.DASHSCOPE_API_KEY).toBe('');
    expect(parsed.DASHSCOPE_BASE_URL).toBe('https://dashscope-intl.aliyuncs.com');
    expect(parsed.DASHSCOPE_WORKSPACE_ID).toBe('');
  });
});
