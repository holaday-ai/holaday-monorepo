/**
 * Production video lane boundary — the module `trpc/routers/tasks.ts`
 * dynamically imports for its five video entry points.
 *
 * Every export keeps the exact signature of the original executor and
 * delegates to it (`video-lane-simple.ts`, `video-clone.ts`,
 * `video-pet-i2v.ts`, `video-ip-lipsync.ts`); only the model clients change:
 *   普通视频  Wan 2.7 t2v (DashScope, WANXIANG_T2V_MODEL) or Veo 3.1 via fal
 *            (FAL_VEO_*_MODEL); narration Qwen TTS; still-image mode and
 *            composition anchors via Qwen Image / Wan 2.7 Image / fal NB2.
 *   宠物视频  Wan 2.7 i2v (DashScope, WANXIANG_I2V_MODEL).
 *   视频克隆  Wan Animate + fal lip-sync (existing implementation).
 *   IP 换口型 Qwen voice clone + fal lip-sync (existing implementation).
 * The Gemini-backed clients (Veo on the Gemini API, Gemini TTS, nano banana
 * on Google, Gemini AV-sync review) stay in the tree but are not reachable
 * from here: this module strips the Gemini key from the lane config.
 */

import { env as appEnv } from '../../config/env.js';
import { imageProviderConfigFromEnv } from '../image/image-providers.js';
import type {
  VerifyAudioVisualSyncInput,
  VideoAvSyncReview,
  VideoAvSyncVerifierDeps,
} from './video-av-sync-verifier.js';
import {
  type CloneVideoInput,
  type CloneVideoOptions,
  type CloneVideoResult,
  type CloneVideoServices,
  runCloneVideoCreation as runCloneVideoCreationImpl,
} from './video-clone.js';
import {
  type IpVideoConfig,
  type IpVideoContext,
  type IpVideoOptions,
  type IpVideoResult,
  type IpVideoServices,
  runIpVideoCreation as runIpVideoCreationImpl,
} from './video-ip-lipsync.js';
import {
  type RunSimpleVideoInput,
  type SimpleVideoConfig,
  type SimpleVideoOptions,
  type SimpleVideoResult,
  type SimpleVideoServices,
  runSimpleVideoCreation as runSimpleVideoCreationImpl,
} from './video-lane-simple.js';
import {
  type PetVideoInput,
  type PetVideoOptions,
  type PetVideoResult,
  type PetVideoServices,
  runPetVideoCreation as runPetVideoCreationImpl,
} from './video-pet-i2v.js';

/** The env subset the runtime reads (injectable for tests). */
export interface VideoRuntimeEnv {
  readonly DASHSCOPE_API_KEY: string;
  readonly DASHSCOPE_BASE_URL: string;
  readonly DASHSCOPE_WORKSPACE_ID?: string;
  readonly FAL_KEY: string;
  readonly FAL_BASE_URL?: string;
  readonly WANXIANG_T2V_MODEL: string;
  readonly WANXIANG_I2V_MODEL: string;
  readonly FAL_VEO_FAST_MODEL: string;
  readonly FAL_VEO_LITE_MODEL: string;
  readonly FAL_VEO_STANDARD_MODEL: string;
  readonly QWEN_IMAGE_MODEL: string;
  readonly WAN_IMAGE_MODEL: string;
  readonly FAL_NANO_BANANA_2_MODEL: string;
  readonly FAL_NANO_BANANA_2_EDIT_MODEL: string;
  readonly IMAGE_DEFAULT_MODEL: 'qwen_image' | 'wan_image' | 'nano_banana_2';
}

/**
 * Rewrite the lane config built by tasks.ts onto the production providers.
 * Pure — exported for tests.
 */
export function withProductionVideoProviders(
  cfg: SimpleVideoConfig,
  env: VideoRuntimeEnv = appEnv,
): SimpleVideoConfig {
  const { geminiApiKey: _dormantKey, geminiBaseUrl: _dormantBase, ...rest } = cfg;
  return {
    ...rest,
    dashscopeApiKey: cfg.dashscopeApiKey || env.DASHSCOPE_API_KEY,
    dashscopeBaseUrl: cfg.dashscopeBaseUrl || env.DASHSCOPE_BASE_URL,
    ...(cfg.falApiKey || env.FAL_KEY ? { falApiKey: cfg.falApiKey || env.FAL_KEY } : {}),
    ...(cfg.falBaseUrl || env.FAL_BASE_URL
      ? { falBaseUrl: cfg.falBaseUrl || env.FAL_BASE_URL }
      : {}),
    wanxiangT2vModel: env.WANXIANG_T2V_MODEL || cfg.wanxiangT2vModel,
    wanI2vModel: env.WANXIANG_I2V_MODEL || cfg.wanI2vModel,
    veoProvider: 'fal',
    veoFastModel: env.FAL_VEO_FAST_MODEL,
    veoLiteModel: env.FAL_VEO_LITE_MODEL,
    veoStandardModel: env.FAL_VEO_STANDARD_MODEL,
    imageProviders: imageProviderConfigFromEnv(env),
    // Unknown ids route to the configured default image model.
    geminiImageModel: env.FAL_NANO_BANANA_2_MODEL,
  };
}

export async function runSimpleVideoCreation(
  input: RunSimpleVideoInput,
  config: SimpleVideoConfig,
  options: SimpleVideoOptions,
  services: SimpleVideoServices,
): Promise<SimpleVideoResult> {
  return runSimpleVideoCreationImpl(
    input,
    withProductionVideoProviders(config),
    options,
    services,
  );
}

export async function runCloneVideoCreation(
  input: CloneVideoInput,
  config: SimpleVideoConfig,
  options: CloneVideoOptions,
  services: CloneVideoServices,
): Promise<CloneVideoResult> {
  return runCloneVideoCreationImpl(input, withProductionVideoProviders(config), options, services);
}

export async function runPetVideoCreation(
  input: PetVideoInput,
  config: SimpleVideoConfig,
  options: PetVideoOptions,
  services: PetVideoServices,
): Promise<PetVideoResult> {
  return runPetVideoCreationImpl(input, withProductionVideoProviders(config), options, services);
}

export async function runIpVideoCreation(
  input: { copyText: string },
  config: IpVideoConfig,
  context: IpVideoContext,
  options: IpVideoOptions,
  services: IpVideoServices,
): Promise<IpVideoResult> {
  return runIpVideoCreationImpl(input, config, context, options, services);
}

/**
 * Independent audio-visual sync review. The only implementation is the dormant
 * Gemini video reviewer, so production reports `unknown`; every lane treats
 * `unknown` as non-blocking (logged, not recorded as verified). Frame-level
 * quality gating stays on the Qwen vision verifier.
 */
export async function verifyAudioVisualSync(
  input: VerifyAudioVisualSyncInput,
  _deps?: VideoAvSyncVerifierDeps,
): Promise<VideoAvSyncReview> {
  return {
    status: 'unknown',
    reason: '音画同步独立复核暂未接入千问，本次仅完成画面质检。',
    evidence: [],
    model: input.model ?? 'qwen-av-sync-pending',
  };
}
