import { env as appEnv } from '../../config/env.js';
import type { ImageGenerateFn } from './image-provider-types.js';
import {
  IMAGE_MODEL_LABELS,
  type ImageProviderConfig,
  availableImageModels,
  createProviderImageGenerate,
  imageProviderConfigFromEnv,
} from './image-providers.js';
import {
  type ImageRoute,
  type ImageRouteChoice,
  type RunImageTaskOpts,
  type RunImageTaskResult,
  runImageTask as runImageTaskCore,
} from './image-runner.js';
import { pickImageModelForTask } from './model-router.js';

export type { ImageAttachment, RunImageTaskOpts, RunImageTaskResult } from './image-runner.js';

/**
 * Production image lane boundary (the module `trpc/routers/tasks.ts` imports).
 *
 * Same signature as the original `image-runner.ts#runImageTask`; it reuses that
 * orchestrator (prompt compliance, option count, locked-subject review, save)
 * and only swaps the model clients:
 *   - DashScope Qwen Image   — posters / on-image Chinese text / 排版
 *   - DashScope Wan 2.7 Image — subject consistency / edits with reference images
 *   - fal Nano Banana 2      — general default (reachable in and outside China)
 * Model ids and the default come from env (QWEN_IMAGE_MODEL, WAN_IMAGE_MODEL,
 * FAL_NANO_BANANA_2_MODEL(_EDIT), IMAGE_DEFAULT_MODEL). Gemini-specific fields
 * on `opts` (apiKey/baseUrl/flashModel/proModel) are ignored here; the dormant
 * Gemini client stays in `gemini-image-client.ts` and is never reached.
 */
export async function runImageTask(
  opts: RunImageTaskOpts,
  deps: { config?: ImageProviderConfig; generate?: ImageGenerateFn } = {},
): Promise<RunImageTaskResult> {
  const config = deps.config ?? imageProviderConfigFromEnv(appEnv);
  const hasInputs = Boolean(opts.inputImages && opts.inputImages.length > 0);
  const route = pickImageModelForTask(opts.intent, {
    available: availableImageModels(config),
    defaultModel: config.defaultModel,
    hasInputs,
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(resolvePreferredModel(opts) ? { preferredModel: resolvePreferredModel(opts) } : {}),
  });
  if (!route) {
    return {
      status: 'failed',
      summary: '',
      reason: '图片生成服务尚未配置（缺少模型服务密钥），请联系管理员。',
      attachments: [],
    };
  }
  const choice = (key: typeof route.primary): ImageRouteChoice => ({
    key,
    model: config.models[key],
    tier: route.tier,
    label: IMAGE_MODEL_LABELS[key],
  });
  const primary = choice(route.primary);
  const imageRoute: ImageRoute = {
    primary,
    fallbacks: route.fallbacks.map(choice),
    reason: route.reason,
    ...(route.preferredUnavailable
      ? { note: `（所选模型暂不可用，已改用 ${primary.label}）` }
      : {}),
  };
  opts.logger.info(
    {
      model: primary.model,
      modelKey: primary.key,
      reason: route.reason,
      fallbacks: route.fallbacks,
    },
    'image: model routed',
  );
  return runImageTaskCore({
    ...opts,
    route: imageRoute,
    generate: deps.generate ?? createProviderImageGenerate(config),
  });
}

/**
 * Structured UI choice. `preferredModel` is the new product key; the legacy
 * `preferredTier: 'flash'` (old UI "Nano Banana 2") maps to NB2, while the
 * legacy Pro choice lets the router pick the text-grade model.
 */
function resolvePreferredModel(opts: RunImageTaskOpts): string | undefined {
  if (opts.preferredModel) return opts.preferredModel;
  if (opts.preferredTier === 'flash') return 'nano_banana_2';
  return undefined;
}
