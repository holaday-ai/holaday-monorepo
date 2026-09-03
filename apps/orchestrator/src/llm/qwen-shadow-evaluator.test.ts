import { describe, expect, it, vi } from 'vitest';
import { runQwenSyntheticShadowEvaluation } from './qwen-shadow-evaluator.js';

const ENVIRONMENT = {
  DASHSCOPE_API_KEY: 'legacy-intl',
  DASHSCOPE_WORKSPACE_ID: 'legacy-workspace',
  DASHSCOPE_INTL_API_KEY: 'intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_WORKSPACE_ID: 'intl-workspace',
  DASHSCOPE_CN_API_KEY: 'cn-key',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_WORKSPACE_ID: 'cn-workspace',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_SHADOW_EVAL_ENABLED: false,
};

const SYNTHETIC_CASE = {
  caseId: 'synthetic-planning-001',
  dataClass: 'synthetic',
  region: 'intl',
  purpose: 'reasoning',
  messages: [{ role: 'user', content: 'Create a synthetic three-step plan.' }],
  maxTokens: 400,
} as const;

function successfulClient() {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Synthetic evaluation output.' }],
        usage: { input_tokens: 12, output_tokens: 8 },
      }),
    },
  };
}

describe('Qwen synthetic shadow evaluator', () => {
  it('is disabled by default and never constructs a client', async () => {
    const clientFactory = vi.fn();

    await expect(
      runQwenSyntheticShadowEvaluation({
        environment: ENVIRONMENT,
        evaluation: SYNTHETIC_CASE,
        clientFactory,
      }),
    ).resolves.toEqual({ status: 'disabled' });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('rejects non-synthetic data before resolving credentials or constructing a client', async () => {
    const clientFactory = vi.fn();

    await expect(
      runQwenSyntheticShadowEvaluation({
        environment: { ...ENVIRONMENT, QWEN_SHADOW_EVAL_ENABLED: true },
        evaluation: { ...SYNTHETIC_CASE, dataClass: 'user_task' },
        clientFactory,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'synthetic_only' });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('uses the explicit same-region route and returns only safe route metadata', async () => {
    const client = successfulClient();
    const clientFactory = vi.fn(() => client);

    const result = await runQwenSyntheticShadowEvaluation({
      environment: { ...ENVIRONMENT, QWEN_SHADOW_EVAL_ENABLED: true },
      evaluation: SYNTHETIC_CASE,
      clientFactory,
    });

    expect(clientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'intl',
        apiKey: 'intl-key',
        model: 'qwen3.8-max',
      }),
    );
    expect(client.messages.create).toHaveBeenCalledWith({
      model: 'qwen3.8-max',
      max_tokens: 400,
      messages: SYNTHETIC_CASE.messages,
    });
    expect(result).toEqual({
      status: 'completed',
      caseId: 'synthetic-planning-001',
      route: {
        provider: 'alibaba-model-studio',
        region: 'intl',
        deploymentScope: 'international',
        model: 'qwen3.8-max',
        endpointKind: 'public',
      },
      responseText: 'Synthetic evaluation output.',
      usage: { inputTokens: 12, outputTokens: 8 },
    });
    expect(JSON.stringify(result)).not.toContain('intl-key');
    expect(JSON.stringify(result)).not.toContain('dashscope-intl.aliyuncs.com');
    expect(JSON.stringify(result)).not.toContain('intl-workspace');
  });

  it('isolates provider failures from the caller', async () => {
    const clientFactory = vi.fn(() => ({
      messages: {
        create: vi.fn().mockRejectedValue(new Error('provider included sensitive text')),
      },
    }));

    await expect(
      runQwenSyntheticShadowEvaluation({
        environment: { ...ENVIRONMENT, QWEN_SHADOW_EVAL_ENABLED: true },
        evaluation: SYNTHETIC_CASE,
        clientFactory,
      }),
    ).resolves.toEqual({
      status: 'failed',
      caseId: 'synthetic-planning-001',
      reason: 'provider_error',
    });
  });

  it('fails closed when the requested regional credentials are unavailable', async () => {
    const clientFactory = vi.fn();

    await expect(
      runQwenSyntheticShadowEvaluation({
        environment: {
          ...ENVIRONMENT,
          QWEN_SHADOW_EVAL_ENABLED: true,
          DASHSCOPE_CN_API_KEY: '',
        },
        evaluation: { ...SYNTHETIC_CASE, region: 'cn' },
        clientFactory,
      }),
    ).resolves.toEqual({
      status: 'failed',
      caseId: 'synthetic-planning-001',
      reason: 'route_unavailable',
    });
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
