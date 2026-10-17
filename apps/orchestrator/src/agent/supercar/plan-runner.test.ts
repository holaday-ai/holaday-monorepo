import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { PlanRuntimeEnvironment } from './plan-runner.js';
import { generatePlanForUser } from './plan-runner.js';

const BASE_ENVIRONMENT: PlanRuntimeEnvironment = {
  NODE_ENV: 'test',
  MODEL_RUNTIME_POLICY: 'qwen_only',
  QWEN_CORE_ROLLOUT_MODE: 'synthetic',
  QWEN_CORE_ENABLED_LANES: 'plan',
  QWEN_CORE_ALLOWLIST: 'usr_canary',
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
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
};

function buildAdapter(step: string): MessagesAdapter {
  const metadata = {
    provider: 'alibaba-model-studio' as const,
    model: 'qwen3.7-plus',
    region: 'intl' as const,
    deploymentScope: 'international' as const,
    endpointKind: 'public' as const,
    protocol: 'messages' as const,
  };
  return {
    metadata,
    async create() {
      return {
        id: 'msg_qwen',
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
  it('uses the explicit browser planning role and records its actual usage', async () => {
    const calls: import('../llm-call-recorder.js').LlmCallRecord[] = [];
    const createQwenAdapter = vi.fn((input) => ({
      ...buildAdapter('SEARCH'),
      metadata: {
        ...buildAdapter('SEARCH').metadata,
        model: input.environment.QWEN_STANDARD_MODEL,
      },
    }));
    await generatePlanForUser(
      {
        environment: {
          ...BASE_ENVIRONMENT,
          BROWSER_BRAIN_PLANNING: 'alibaba-model-studio:qwen3.8-flash',
        },
        browserPlanning: true,
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
        intent: '打开浏览器查找内容',
        logger: buildLogger(),
        taskId: 'tsk_plan',
        recorder: {
          record: async (call) => {
            calls.push(call);
          },
        },
      },
      { createQwenAdapter },
    );
    expect(createQwenAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: expect.objectContaining({ QWEN_STANDARD_MODEL: 'qwen3.8-flash' }),
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      purpose: 'browser.planning',
      taskExternalId: 'tsk_plan',
      model: 'qwen3.8-flash',
      inputTokens: 10,
      outputTokens: 20,
      status: 'ok',
    });
  });
  it('defaults browser planning to flash without changing the generic standard model', async () => {
    const createQwenAdapter = vi.fn(() => buildAdapter('SEARCH'));
    await generatePlanForUser(
      {
        environment: BASE_ENVIRONMENT,
        browserPlanning: true,
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
        intent: '浏览器读取网页',
        logger: buildLogger(),
      },
      { createQwenAdapter },
    );
    expect(createQwenAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: expect.objectContaining({ QWEN_STANDARD_MODEL: 'qwen3.8-flash' }),
      }),
    );
    expect(BASE_ENVIRONMENT.QWEN_STANDARD_MODEL).toBe('qwen3.7-plus');
  });
  it('uses the Qwen standard adapter for an eligible user and region', async () => {
    const createQwenAdapter = vi.fn(() => buildAdapter('QWEN_STEP'));
    const result = await generatePlanForUser(
      {
        environment: BASE_ENVIRONMENT,
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
        taskId: 'tsk_qwen',
      },
      { createQwenAdapter },
    );

    expect(result.planText).toContain('QWEN_STEP');
    expect(createQwenAdapter).toHaveBeenCalledWith({
      environment: BASE_ENVIRONMENT,
      region: 'intl',
      purpose: 'standard',
    });
  });

  it('returns no plan instead of falling back when rollout excludes the actor', async () => {
    const createQwenAdapter = vi.fn(() => buildAdapter('MUST_NOT_RUN'));
    const result = await generatePlanForUser(
      {
        environment: BASE_ENVIRONMENT,
        userExternalId: 'usr_excluded',
        userModelDataRegion: 'intl',
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
      },
      { createQwenAdapter },
    );

    expect(result).toEqual({ planText: null, planStatus: null });
    expect(createQwenAdapter).not.toHaveBeenCalled();
  });

  it('fails closed instead of crossing providers when Qwen construction fails', async () => {
    const result = await generatePlanForUser(
      {
        environment: BASE_ENVIRONMENT,
        userExternalId: 'usr_canary',
        userModelDataRegion: 'intl',
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
      },
      {
        createQwenAdapter: () => {
          throw new Error('Qwen unavailable');
        },
      },
    );

    expect(result).toEqual({ planText: null, planStatus: null });
  });

  it('fails closed when the user has no persisted model-data region', async () => {
    const createQwenAdapter = vi.fn(() => buildAdapter('MUST_NOT_RUN'));
    const result = await generatePlanForUser(
      {
        environment: BASE_ENVIRONMENT,
        userExternalId: 'usr_canary',
        userModelDataRegion: null,
        intent: '对比两个平台的价格并整理报告',
        logger: buildLogger(),
      },
      { createQwenAdapter },
    );

    expect(result).toEqual({ planText: null, planStatus: null });
    expect(createQwenAdapter).not.toHaveBeenCalled();
  });
});
