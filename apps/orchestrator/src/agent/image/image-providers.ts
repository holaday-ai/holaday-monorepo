/**
 * Image provider registry — which product image models exist, which are
 * usable with the configured credentials, and a single `generate` function
 * that dispatches a call to the right provider client by model id.
 *
 * Model ids are configuration (env, see config/env.ts), verified against:
 *   qwen_image    → QWEN_IMAGE_MODEL (default 'qwen-image-2.0-pro')
 *                   https://help.aliyun.com/zh/model-studio/qwen-image-api
 *                   https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
 *   wan_image     → WAN_IMAGE_MODEL (default 'wan2.7-image')
 *                   https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference
 *   nano_banana_2 → FAL_NANO_BANANA_2_MODEL / _EDIT_MODEL
 *                   (defaults 'fal-ai/nano-banana-2' / 'fal-ai/nano-banana-2/edit')
 *                   https://fal.ai/models/fal-ai/nano-banana-2/api
 *                   https://fal.ai/models/fal-ai/nano-banana-2/edit/api
 */

import { generateDashScopeImages } from './dashscope-image-client.js';
import { generateFalImages } from './fal-image-client.js';
import {
  IMAGE_MODEL_KEYS,
  type ImageGenerateFn,
  type ImageGenerateParams,
  type ImageModelKey,
  type ImageProviderId,
  ImageProviderError,
} from './image-provider-types.js';

export interface ImageProviderConfig {
  readonly dashscope: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly workspaceId?: string;
  };
  readonly fal: {
    readonly apiKey: string;
    readonly baseUrl?: string;
  };
  readonly models: {
    readonly qwen_image: string;
    readonly wan_image: string;
    readonly nano_banana_2: string;
    readonly nano_banana_2_edit: string;
  };
  /** General-purpose default (no poster text, no edit). */
  readonly defaultModel: ImageModelKey;
}

/** The subset of env this registry reads (keeps it unit-testable). */
export interface ImageProviderEnv {
  readonly DASHSCOPE_API_KEY: string;
  readonly DASHSCOPE_BASE_URL: string;
  readonly DASHSCOPE_WORKSPACE_ID?: string;
  readonly FAL_KEY: string;
  readonly FAL_BASE_URL?: string;
  readonly QWEN_IMAGE_MODEL: string;
  readonly WAN_IMAGE_MODEL: string;
  readonly FAL_NANO_BANANA_2_MODEL: string;
  readonly FAL_NANO_BANANA_2_EDIT_MODEL: string;
  readonly IMAGE_DEFAULT_MODEL: ImageModelKey;
}

export function imageProviderConfigFromEnv(env: ImageProviderEnv): ImageProviderConfig {
  return {
    dashscope: {
      apiKey: env.DASHSCOPE_API_KEY,
      baseUrl: env.DASHSCOPE_BASE_URL,
      ...(env.DASHSCOPE_WORKSPACE_ID ? { workspaceId: env.DASHSCOPE_WORKSPACE_ID } : {}),
    },
    fal: {
      apiKey: env.FAL_KEY,
      ...(env.FAL_BASE_URL ? { baseUrl: env.FAL_BASE_URL } : {}),
    },
    models: {
      qwen_image: env.QWEN_IMAGE_MODEL,
      wan_image: env.WAN_IMAGE_MODEL,
      nano_banana_2: env.FAL_NANO_BANANA_2_MODEL,
      nano_banana_2_edit: env.FAL_NANO_BANANA_2_EDIT_MODEL,
    },
    defaultModel: env.IMAGE_DEFAULT_MODEL,
  };
}

export interface ImageModelSpec {
  readonly key: ImageModelKey;
  readonly provider: ImageProviderId;
  /** Provider model id for text-to-image. */
  readonly model: string;
  readonly label: string;
}

export const IMAGE_MODEL_LABELS: Readonly<Record<ImageModelKey, string>> = {
  qwen_image: '千问 Qwen Image',
  wan_image: '万相 Wan 2.7 Image',
  nano_banana_2: 'Nano Banana 2',
};

const PROVIDER_OF: Readonly<Record<ImageModelKey, ImageProviderId>> = {
  qwen_image: 'dashscope',
  wan_image: 'dashscope',
  nano_banana_2: 'fal',
};

export function imageModelSpec(key: ImageModelKey, config: ImageProviderConfig): ImageModelSpec {
  return {
    key,
    provider: PROVIDER_OF[key],
    model: config.models[key],
    label: IMAGE_MODEL_LABELS[key],
  };
}

export function isImageProviderConfigured(
  provider: ImageProviderId,
  config: ImageProviderConfig,
): boolean {
  return provider === 'dashscope'
    ? Boolean(config.dashscope.apiKey.trim())
    : Boolean(config.fal.apiKey.trim());
}

/** Product image models usable with the configured credentials (stable order). */
export function availableImageModels(config: ImageProviderConfig): ImageModelKey[] {
  return IMAGE_MODEL_KEYS.filter((key) => isImageProviderConfigured(PROVIDER_OF[key], config));
}

export function isImageModelKey(value: unknown): value is ImageModelKey {
  return typeof value === 'string' && (IMAGE_MODEL_KEYS as readonly string[]).includes(value);
}

/** Resolve which product model a provider model id belongs to. */
export function imageModelKeyForId(
  modelId: string,
  config: ImageProviderConfig,
): ImageModelKey | null {
  if (modelId === config.models.nano_banana_2 || modelId === config.models.nano_banana_2_edit) {
    return 'nano_banana_2';
  }
  if (modelId === config.models.qwen_image) return 'qwen_image';
  if (modelId === config.models.wan_image) return 'wan_image';
  return null;
}

export interface ProviderClients {
  readonly dashscope: typeof generateDashScopeImages;
  readonly fal: typeof generateFalImages;
}

const REAL_CLIENTS: ProviderClients = {
  dashscope: generateDashScopeImages,
  fal: generateFalImages,
};

/**
 * One `generate` for every configured provider. The `model` field of each
 * call selects the provider; an unknown id (e.g. a dormant Gemini id passed by
 * an older call site) is served by the configured default model so legacy
 * callers keep working without reaching Google.
 */
export function createProviderImageGenerate(
  config: ImageProviderConfig,
  clients: ProviderClients = REAL_CLIENTS,
): ImageGenerateFn {
  return async (params: ImageGenerateParams) => {
    const available = availableImageModels(config);
    const key =
      imageModelKeyForId(params.model, config) ??
      (available.includes(config.defaultModel) ? config.defaultModel : available[0]) ??
      null;
    if (!key) {
      throw new ImageProviderError('no image provider configured', 'no_api_key');
    }
    const spec = imageModelSpec(key, config);
    if (!isImageProviderConfigured(spec.provider, config)) {
      throw new ImageProviderError(
        `${spec.provider} image provider not configured`,
        'no_api_key',
        undefined,
        undefined,
        spec.provider,
      );
    }
    const { apiKey: _ignoredKey, baseUrl: _ignoredBase, apiVersion: _ignoredVersion, ...rest } =
      params;
    if (spec.provider === 'dashscope') {
      return clients.dashscope({
        ...rest,
        model: spec.model,
        apiKey: config.dashscope.apiKey,
        baseUrl: config.dashscope.baseUrl,
        ...(config.dashscope.workspaceId ? { workspaceId: config.dashscope.workspaceId } : {}),
      });
    }
    return clients.fal({
      ...rest,
      model: config.models.nano_banana_2,
      editModel: config.models.nano_banana_2_edit,
      apiKey: config.fal.apiKey,
      ...(config.fal.baseUrl ? { baseUrl: config.fal.baseUrl } : {}),
    });
  };
}
