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
      DASHSCOPE_INTL_WORKSPACE_ID: '',
      DASHSCOPE_CN_API_KEY: '',
      DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      DASHSCOPE_CN_WORKSPACE_ID: '',
      QWEN_REASONING_MODEL: 'qwen3.8-max',
      QWEN_STANDARD_MODEL: 'qwen3.7-plus',
      QWEN_FAST_MODEL: 'qwen3.8-flash',
      QWEN_CODING_MODEL: 'qwen3-coder-plus',
      QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
      QWEN_SHADOW_EVAL_ENABLED: false,
    });
  });

  it('normalizes accepted dedicated workspace endpoints', () => {
    const parsed = envSchema.parse({
      ...BASE_ENV,
      DASHSCOPE_INTL_ANTHROPIC_BASE_URL:
        'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/',
      DASHSCOPE_CN_ANTHROPIC_BASE_URL:
        'https://workspace-2.cn-beijing.maas.aliyuncs.com/apps/anthropic/',
    });

    expect(parsed.DASHSCOPE_INTL_ANTHROPIC_BASE_URL).toBe(
      'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
    );
    expect(parsed.DASHSCOPE_CN_ANTHROPIC_BASE_URL).toBe(
      'https://workspace-2.cn-beijing.maas.aliyuncs.com/apps/anthropic',
    );
  });

  it.each([
    ['DASHSCOPE_INTL_ANTHROPIC_BASE_URL', 'https://dashscope.aliyuncs.com/apps/anthropic'],
    ['DASHSCOPE_CN_ANTHROPIC_BASE_URL', 'https://dashscope-intl.aliyuncs.com/apps/anthropic'],
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
