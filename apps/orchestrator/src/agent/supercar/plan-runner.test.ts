import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { PlanRuntimeEnvironment } from './plan-runner.js';
import { generatePlanForUser } from './plan-runner.js';

const BASE_ENVIRONMENT: PlanRuntimeEnvironment = {
  ANTHROPIC_API_KEY: 'anthropic-key',
  DASHSCOPE_API_KEY: 'legacy-intl',
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
  QWEN_MESSAGES_ADAPTER_ENABLED: false,
  QWEN_PLAN_CANARY_ENABLED: false,
  QWEN_PLAN_SYNTHETIC_ALLOWLIST: '',
};

function buildAdapter(provider: 'anthropic' | 'qwen', step: string): MessagesAdapter {
  const metadata =
    provider === 'anthropic'
      ? ({ provider: 'anthropic', model: 'claude-sonnet-4-6' } as const)
      : ({
          provider: 'alibaba-model-studio',
          model: 'qwen3.7-plus',
          region: 'intl',
          deploymentScope: 'international',
          endpointKind: 'public',
          protocol: 'messages',
        } as const);
  return {
    metadata,
    async create() {
      return {
        id: `msg_${provider}`,
        metadata,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              steps: [
                { text: step, tool: '搜索 API' },
                { text: '整理并展示结果', tool: '生成内容' },
              ],
              estimatedSeconds: 8,
            }),
          },
        ],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
}

function buildLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

describe('generatePlanForUser', () => {
  it('uses the international Qwen standard adapter only for an exact canary user', async () => {
    const result = await generatePlanForUser(
      {
        environment: {
          ...BASE_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          QWEN_PLAN_CANARY_ENABLED: true,
          QWEN_PLAN_SYNTHETIC_ALLOWLIST: 'usr_other, usr_canary',
        },
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
        taskId: 'tsk_qwen',
      },
      {
        createAnthropicAdapter: () => buildAdapter('anthropic', 'ANTHROPIC_STEP'),
        createQwenAdapter: () => buildAdapter('qwen', 'QWEN_STEP'),
      },
    );

    expect(result.planText).toContain('QWEN_STEP');
    expect(result.planText).not.toContain('ANTHROPIC_STEP');
  });

  it('preserves the Anthropic planner for users outside the disabled canary', async () => {
    const result = await generatePlanForUser(
      {
        environment: BASE_ENVIRONMENT,
        userExternalId: 'usr_existing',
        userModelDataRegion: 'intl',
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
      },
      {
        createAnthropicAdapter: () => buildAdapter('anthropic', 'ANTHROPIC_STEP'),
        createQwenAdapter: () => buildAdapter('qwen', 'QWEN_STEP'),
      },
    );

    expect(result.planText).toContain('ANTHROPIC_STEP');
    expect(result.planText).not.toContain('QWEN_STEP');
  });

  it('fails closed instead of falling back across providers when the Qwen canary cannot start', async () => {
    const result = await generatePlanForUser(
      {
        environment: {
          ...BASE_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          QWEN_PLAN_CANARY_ENABLED: true,
          QWEN_PLAN_SYNTHETIC_ALLOWLIST: 'usr_canary',
        },
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
      },
      {
        createAnthropicAdapter: () => buildAdapter('anthropic', 'FALLBACK_MUST_NOT_RUN'),
        createQwenAdapter: () => {
          throw new Error('Qwen unavailable');
        },
      },
    );

    expect(result).toEqual({ planText: null, planStatus: null });
  });

  it('fails closed when an active canary has no valid persisted region', async () => {
    const result = await generatePlanForUser(
      {
        environment: {
          ...BASE_ENVIRONMENT,
          QWEN_MESSAGES_ADAPTER_ENABLED: true,
          QWEN_PLAN_CANARY_ENABLED: true,
          QWEN_PLAN_SYNTHETIC_ALLOWLIST: 'usr_canary',
        },
        userExternalId: 'usr_canary',
        userModelDataRegion: null,
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
      },
      {
        createAnthropicAdapter: () => buildAdapter('anthropic', 'FALLBACK_MUST_NOT_RUN'),
        createQwenAdapter: () => buildAdapter('qwen', 'QWEN_STEP'),
      },
    );

    expect(result).toEqual({ planText: null, planStatus: null });
  });
});
