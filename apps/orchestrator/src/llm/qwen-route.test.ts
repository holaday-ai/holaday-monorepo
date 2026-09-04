import { describe, expect, it } from 'vitest';
import {
  type ModelDataRegion,
  type QwenPurpose,
  QwenRouteError,
  type QwenRuntimeEnvironment,
  normalizeQwenAnthropicBaseUrl,
  normalizeQwenBaseUrl,
  resolveQwenRoute,
  toSafeQwenRouteMetadata,
} from './qwen-route.js';

const ENVIRONMENT: QwenRuntimeEnvironment = {
  DASHSCOPE_API_KEY: 'legacy-intl',
  DASHSCOPE_WORKSPACE_ID: 'legacy-workspace',
  DASHSCOPE_INTL_API_KEY: 'intl-explicit',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL:
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: 'intl-workspace',
  DASHSCOPE_CN_API_KEY: 'cn-explicit',
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
};

function expectRouteError(run: () => unknown, code: QwenRouteError['code']): void {
  try {
    run();
    throw new Error('expected route resolution to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(QwenRouteError);
    expect((error as QwenRouteError).code).toBe(code);
  }
}

describe('resolveQwenRoute', () => {
  it('uses the explicit international credential before the legacy international key', () => {
    expect(resolveQwenRoute(ENVIRONMENT, 'intl', 'reasoning')).toMatchObject({
      provider: 'alibaba-model-studio',
      region: 'intl',
      deploymentScope: 'international',
      model: 'qwen3.8-max',
      apiKey: 'intl-explicit',
      baseURL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      workspaceId: 'intl-workspace',
      endpointKind: 'public',
      protocol: 'messages',
    });
  });

  it('keeps the existing DashScope key as an international-only compatibility fallback', () => {
    const route = resolveQwenRoute(
      {
        ...ENVIRONMENT,
        DASHSCOPE_INTL_API_KEY: '',
        DASHSCOPE_INTL_WORKSPACE_ID: '',
      },
      'intl',
      'fast',
    );

    expect(route.apiKey).toBe('legacy-intl');
    expect(route.workspaceId).toBe('legacy-workspace');
  });

  it('fails closed for China when only an international credential exists', () => {
    expectRouteError(
      () =>
        resolveQwenRoute(
          {
            ...ENVIRONMENT,
            DASHSCOPE_CN_API_KEY: '',
            DASHSCOPE_INTL_API_KEY: 'still-intl',
            DASHSCOPE_API_KEY: 'legacy-is-also-intl',
          },
          'cn',
          'standard',
        ),
      'MISSING_REGION_CREDENTIALS',
    );
  });

  it('routes China only through the Beijing endpoint and credential', () => {
    expect(resolveQwenRoute(ENVIRONMENT, 'cn', 'verify_fast', 'messages')).toMatchObject({
      provider: 'alibaba-model-studio',
      region: 'cn',
      deploymentScope: 'china_mainland',
      model: 'qwen3.8-flash',
      apiKey: 'cn-explicit',
      baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      workspaceId: 'cn-workspace',
      endpointKind: 'public',
      protocol: 'messages',
    });
  });

  it('builds a Singapore Responses route without exposing credentials', () => {
    const route = resolveQwenRoute(ENVIRONMENT, 'intl', 'reasoning', 'responses');

    expect(route.baseURL).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    expect(toSafeQwenRouteMetadata(route)).toEqual({
      provider: 'alibaba-model-studio',
      region: 'intl',
      deploymentScope: 'international',
      model: 'qwen3.8-max',
      endpointKind: 'public',
      protocol: 'responses',
    });
  });

  it.each([
    ['reasoning', 'qwen3.8-max'],
    ['standard', 'qwen3.7-plus'],
    ['fast', 'qwen3.8-flash'],
    ['coding', 'qwen3-coder-plus'],
    ['verify_fast', 'qwen3.8-flash'],
    ['verify_strict', 'qwen3.8-max'],
    ['vision', 'qwen3.8-max'],
  ] satisfies Array<[QwenPurpose, string]>)('maps %s to %s', (purpose, expectedModel) => {
    expect(resolveQwenRoute(ENVIRONMENT, 'intl', purpose).model).toBe(expectedModel);
  });

  it('rejects missing regions and unknown purposes at the runtime boundary', () => {
    expectRouteError(
      () => resolveQwenRoute(ENVIRONMENT, '' as ModelDataRegion, 'fast'),
      'REGION_REQUIRED',
    );
    expectRouteError(
      () => resolveQwenRoute(ENVIRONMENT, 'intl', 'other' as QwenPurpose),
      'UNKNOWN_PURPOSE',
    );
  });

  it('returns log-safe metadata without credentials or workspace identifiers', () => {
    const route = resolveQwenRoute(ENVIRONMENT, 'intl', 'standard');
    const serialized = JSON.stringify(toSafeQwenRouteMetadata(route));

    expect(JSON.parse(serialized)).toEqual({
      provider: 'alibaba-model-studio',
      region: 'intl',
      deploymentScope: 'international',
      model: 'qwen3.7-plus',
      endpointKind: 'public',
      protocol: 'messages',
    });
    expect(serialized).not.toContain('intl-explicit');
    expect(serialized).not.toContain('intl-workspace');
  });
});

describe('normalizeQwenBaseUrl', () => {
  it('accepts a Singapore public Responses endpoint', () => {
    expect(
      normalizeQwenBaseUrl(
        'intl',
        'responses',
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
      ),
    ).toEqual({
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      endpointKind: 'public',
    });
  });

  it('accepts a Beijing dedicated Responses endpoint', () => {
    expect(
      normalizeQwenBaseUrl(
        'cn',
        'responses',
        'https://workspace-2.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      ),
    ).toEqual({
      baseURL: 'https://workspace-2.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      endpointKind: 'workspace_dedicated',
    });
  });

  it('rejects a Beijing URL in the international Responses field', () => {
    expectRouteError(
      () =>
        normalizeQwenBaseUrl(
          'intl',
          'responses',
          'https://dashscope.aliyuncs.com/compatible-mode/v1',
        ),
      'INVALID_REGION_ENDPOINT',
    );
  });

  it('rejects a Messages path for the Responses protocol', () => {
    expectRouteError(
      () =>
        normalizeQwenBaseUrl(
          'intl',
          'responses',
          'https://dashscope-intl.aliyuncs.com/apps/anthropic',
        ),
      'INVALID_REGION_ENDPOINT',
    );
  });
});

describe('normalizeQwenAnthropicBaseUrl', () => {
  it.each([
    [
      'intl',
      'https://dashscope-intl.aliyuncs.com/apps/anthropic/',
      'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      'public',
    ],
    [
      'intl',
      'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
      'https://workspace-1.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
      'workspace_dedicated',
    ],
    [
      'cn',
      'https://dashscope.aliyuncs.com/apps/anthropic',
      'https://dashscope.aliyuncs.com/apps/anthropic',
      'public',
    ],
    [
      'cn',
      'https://workspace-2.cn-beijing.maas.aliyuncs.com/apps/anthropic/',
      'https://workspace-2.cn-beijing.maas.aliyuncs.com/apps/anthropic',
      'workspace_dedicated',
    ],
  ] satisfies Array<[ModelDataRegion, string, string, 'public' | 'workspace_dedicated']>)(
    'accepts and normalizes the %s regional endpoint %s',
    (region, value, baseURL, endpointKind) => {
      expect(normalizeQwenAnthropicBaseUrl(region, value)).toEqual({ baseURL, endpointKind });
    },
  );

  it.each([
    ['intl', 'http://dashscope-intl.aliyuncs.com/apps/anthropic'],
    ['intl', 'https://user:pass@dashscope-intl.aliyuncs.com/apps/anthropic'],
    ['intl', 'https://dashscope-intl.aliyuncs.com/apps/anthropic?route=cn'],
    ['intl', 'https://dashscope-intl.aliyuncs.com/apps/anthropic#debug'],
    ['intl', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'],
    ['intl', 'https://dashscope.aliyuncs.com/apps/anthropic'],
    ['intl', 'https://fake-ap-southeast-1.maas.aliyuncs.com/apps/anthropic'],
    ['intl', 'https://workspace.ap-southeast-1.maas.aliyuncs.com.evil.test/apps/anthropic'],
    ['cn', 'https://dashscope-intl.aliyuncs.com/apps/anthropic'],
    ['cn', 'https://workspace.ap-southeast-1.maas.aliyuncs.com/apps/anthropic'],
    ['cn', 'https://cn-beijing.maas.aliyuncs.com/apps/anthropic'],
  ] satisfies Array<[ModelDataRegion, string]>)(
    'rejects invalid %s endpoint %s',
    (region, value) => {
      expectRouteError(
        () => normalizeQwenAnthropicBaseUrl(region, value),
        'INVALID_REGION_ENDPOINT',
      );
    },
  );
});
