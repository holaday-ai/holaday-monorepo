import { describe, expect, it } from 'vitest';
import {
  MODEL_TASK_FAILURE_COPY,
  createProductionModelRuntimeWiring,
} from './model-runtime-wiring.js';

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
  it('exposes only Qwen core runtime and unavailable-lane descriptors', () => {
    const wiring = createProductionModelRuntimeWiring(ENVIRONMENT);
    expect(wiring.policy).toBe('qwen_only');
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
    for (const lane of ['browser', 'image', 'video_generation', 'voice', 'memory'] as const) {
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
    });
  });
});
