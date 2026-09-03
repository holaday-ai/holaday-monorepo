import type { ModelDataRegion } from './model-data-region.js';

export type { ModelDataRegion } from './model-data-region.js';
export type QwenPurpose = 'reasoning' | 'standard' | 'fast' | 'coding' | 'verify';
export type QwenEndpointKind = 'public' | 'workspace_dedicated';
export type QwenDeploymentScope = 'china_mainland' | 'international';

export type QwenRouteErrorCode =
  | 'REGION_REQUIRED'
  | 'MISSING_REGION_CREDENTIALS'
  | 'INVALID_REGION_ENDPOINT'
  | 'UNKNOWN_PURPOSE';

export class QwenRouteError extends Error {
  constructor(
    public readonly code: QwenRouteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QwenRouteError';
  }
}

export interface QwenRuntimeEnvironment {
  DASHSCOPE_API_KEY: string;
  DASHSCOPE_WORKSPACE_ID: string;
  DASHSCOPE_INTL_API_KEY: string;
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: string;
  DASHSCOPE_INTL_WORKSPACE_ID: string;
  DASHSCOPE_CN_API_KEY: string;
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: string;
  DASHSCOPE_CN_WORKSPACE_ID: string;
  QWEN_REASONING_MODEL: string;
  QWEN_STANDARD_MODEL: string;
  QWEN_FAST_MODEL: string;
  QWEN_CODING_MODEL: string;
  QWEN_VERIFIER_MODEL: string;
}

export interface QwenRoute {
  provider: 'alibaba-model-studio';
  region: ModelDataRegion;
  deploymentScope: QwenDeploymentScope;
  model: string;
  apiKey: string;
  baseURL: string;
  workspaceId?: string;
  endpointKind: QwenEndpointKind;
}

export type SafeQwenRouteMetadata = Omit<QwenRoute, 'apiKey' | 'baseURL' | 'workspaceId'>;

const ENDPOINTS = {
  intl: {
    publicHost: 'dashscope-intl.aliyuncs.com',
    workspaceSuffix: '.ap-southeast-1.maas.aliyuncs.com',
  },
  cn: {
    publicHost: 'dashscope.aliyuncs.com',
    workspaceSuffix: '.cn-beijing.maas.aliyuncs.com',
  },
} as const;

export function normalizeQwenAnthropicBaseUrl(
  region: ModelDataRegion,
  value: string,
): { baseURL: string; endpointKind: QwenEndpointKind } {
  const endpoint = ENDPOINTS[region];
  if (!endpoint) {
    throw new QwenRouteError('REGION_REQUIRED', 'A supported model data region is required');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new QwenRouteError(
      'INVALID_REGION_ENDPOINT',
      `The ${region} Qwen endpoint must be an absolute HTTPS URL`,
    );
  }

  const normalizedPath = url.pathname.replace(/\/$/, '');
  const hasWorkspacePrefix =
    url.hostname.endsWith(endpoint.workspaceSuffix) &&
    url.hostname.length > endpoint.workspaceSuffix.length;
  const endpointKind: QwenEndpointKind | null =
    url.hostname === endpoint.publicHost
      ? 'public'
      : hasWorkspacePrefix
        ? 'workspace_dedicated'
        : null;

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    normalizedPath !== '/apps/anthropic' ||
    endpointKind === null
  ) {
    throw new QwenRouteError(
      'INVALID_REGION_ENDPOINT',
      `The configured Qwen endpoint does not belong to the ${region} Anthropic-compatible region`,
    );
  }

  return {
    baseURL: `${url.origin}${normalizedPath}`,
    endpointKind,
  };
}

export function resolveQwenRoute(
  environment: QwenRuntimeEnvironment,
  region: ModelDataRegion,
  purpose: QwenPurpose,
): QwenRoute {
  if (region !== 'cn' && region !== 'intl') {
    throw new QwenRouteError('REGION_REQUIRED', 'A supported model data region is required');
  }

  const regional = resolveRegionalCredentials(environment, region);
  if (!regional.apiKey) {
    throw new QwenRouteError(
      'MISSING_REGION_CREDENTIALS',
      `Qwen credentials are not configured for the ${region} data region`,
    );
  }

  const { baseURL, endpointKind } = normalizeQwenAnthropicBaseUrl(region, regional.baseURL);

  return {
    provider: 'alibaba-model-studio',
    region,
    deploymentScope: region === 'cn' ? 'china_mainland' : 'international',
    model: resolveModel(environment, purpose),
    apiKey: regional.apiKey,
    baseURL,
    ...(regional.workspaceId ? { workspaceId: regional.workspaceId } : {}),
    endpointKind,
  };
}

export function toSafeQwenRouteMetadata(route: QwenRoute): SafeQwenRouteMetadata {
  return {
    provider: route.provider,
    region: route.region,
    deploymentScope: route.deploymentScope,
    model: route.model,
    endpointKind: route.endpointKind,
  };
}

function resolveRegionalCredentials(
  environment: QwenRuntimeEnvironment,
  region: ModelDataRegion,
): { apiKey: string; baseURL: string; workspaceId: string } {
  if (region === 'cn') {
    return {
      apiKey: environment.DASHSCOPE_CN_API_KEY.trim(),
      baseURL: environment.DASHSCOPE_CN_ANTHROPIC_BASE_URL,
      workspaceId: environment.DASHSCOPE_CN_WORKSPACE_ID.trim(),
    };
  }

  return {
    apiKey: (environment.DASHSCOPE_INTL_API_KEY || environment.DASHSCOPE_API_KEY).trim(),
    baseURL: environment.DASHSCOPE_INTL_ANTHROPIC_BASE_URL,
    workspaceId: (
      environment.DASHSCOPE_INTL_WORKSPACE_ID || environment.DASHSCOPE_WORKSPACE_ID
    ).trim(),
  };
}

function resolveModel(environment: QwenRuntimeEnvironment, purpose: QwenPurpose): string {
  switch (purpose) {
    case 'reasoning':
      return environment.QWEN_REASONING_MODEL;
    case 'standard':
      return environment.QWEN_STANDARD_MODEL;
    case 'fast':
      return environment.QWEN_FAST_MODEL;
    case 'coding':
      return environment.QWEN_CODING_MODEL;
    case 'verify':
      return environment.QWEN_VERIFIER_MODEL;
    default:
      throw new QwenRouteError('UNKNOWN_PURPOSE', 'Unsupported Qwen task purpose');
  }
}
