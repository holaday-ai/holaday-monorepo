/**
 * Which image / video model choices the current deployment can actually serve.
 * Single source for the SPA (auth.me → hide unavailable options) and the
 * backend gates, derived only from credential presence (never values).
 */

import { env as appEnv } from '../../config/env.js';
import type { ImageModelKey } from '../image/image-provider-types.js';
import { availableImageModels, imageProviderConfigFromEnv } from '../image/image-providers.js';
import type { VideoSource } from './video-lane-simple.js';
import type { PetI2vModel } from './video-pet-i2v.js';

export interface AvailableMediaModels {
  /** Image studio model choices (besides the always-present 'auto'). */
  readonly image: ImageModelKey[];
  /** Normal-video visual sources. */
  readonly video: VideoSource[];
  /** Single-photo i2v tiers. */
  readonly petVideo: PetI2vModel[];
}

export interface MediaModelsEnv {
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

export function availableMediaModels(env: MediaModelsEnv): AvailableMediaModels {
  const hasDashscope = Boolean(env.DASHSCOPE_API_KEY.trim());
  const hasFal = Boolean(env.FAL_KEY.trim());
  const video: VideoSource[] = [];
  // Normal video always narrates with DashScope TTS; Veo 3.1 additionally needs fal.
  if (hasDashscope && hasFal) video.push('veo_fast', 'veo_lite', 'veo_standard');
  if (hasDashscope) video.push('wanxiang', 'happyhorse');
  return {
    image: availableImageModels(imageProviderConfigFromEnv(env)),
    video,
    petVideo: hasDashscope ? ['wan_i2v', 'happyhorse_i2v'] : [],
  };
}

export function currentMediaModels(): AvailableMediaModels {
  return availableMediaModels(appEnv);
}
