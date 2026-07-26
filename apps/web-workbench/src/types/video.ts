/**
 * Phase 2 — 视频独立界面的前端类型 + 客户端价格预览。
 *
 * VideoCreationOptions 与后端 `tasks.create` 的 `videoOptions` 入参一一对应
 * (orchestrator src/trpc/routers/tasks.ts);`estimatePerSegmentCny` /
 * `estimatePetCny` 镜像后端 `video-confirm.ts` 的单价矩阵,只用于"价格预览
 * 实时"。**它只是估算** —— 真实段数/价格以后端 video_quote 卡确认为准。
 */

export type VideoTab = 'normal' | 'pet' | 'ip_person';
export type NormalVideoModel = 'veo_fast' | 'happyhorse' | 'veo_standard' | 'wanxiang';
export type CloneVideoModel = 'wan_animate_std' | 'wan_animate_pro';
export type VideoModel = NormalVideoModel | CloneVideoModel;
export type CloneVideoMode = 'wan-std' | 'wan-pro';
export type PetModel = 'wan_i2v' | 'happyhorse_i2v';
export type VideoStyleOption = 'auto' | 'realistic' | 'atmospheric' | 'science';
export type VideoAspect = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
export type VideoResolution = '720p' | '1080p';
export type VideoDuration = 6 | 8;
export type PetDuration = 3 | 5;

export interface VideoCreationOptions {
  /** 'normal' 普通文生(默) / 'pet' 宠物图生 i2v. */
  tab?: VideoTab;
  model?: NormalVideoModel;
  /** 宠物 i2v 档(tab='pet'). */
  petModel?: PetModel;
  /** 已上传宠物照片的 fileId(tab='pet' 必填). */
  petImageFileId?: string;
  /** 已上传的复刻参考视频。 */
  referenceVideoFileId?: string;
  /** 从本地视频 metadata 读取，仅用于提交前价格估算。 */
  referenceVideoDurationSeconds?: number;
  /** Wan Animate 2.2 的真实服务档位。 */
  cloneMode?: CloneVideoMode;
  style?: VideoStyleOption;
  aspectRatio?: VideoAspect;
  resolution?: VideoResolution;
  /** 普通 6/8;宠物 3/5. */
  durationSeconds?: number;
}

/** 每秒美元单价(档 × 画质)。镜像后端 video-confirm.ts VEO_USD_PER_SEC。 */
const USD_PER_SEC: Record<NormalVideoModel, Record<VideoResolution, number>> = {
  veo_fast: { '720p': 0.1, '1080p': 0.12 },
  veo_standard: { '720p': 0.4, '1080p': 0.4 },
  happyhorse: { '720p': 0.9 / 7.3, '1080p': 1.6 / 7.3 },
  wanxiang: { '720p': 0.1, '1080p': 0.15 },
};
const USD_TO_CNY = 7.3;

export function cloneModeFromVideoModel(model: VideoModel): CloneVideoMode | null {
  if (model === 'wan_animate_std') return 'wan-std';
  if (model === 'wan_animate_pro') return 'wan-pro';
  return null;
}

export function normalVideoModelFromSelection(model: VideoModel): NormalVideoModel {
  if (model === 'wan_animate_std' || model === 'wan_animate_pro') return 'veo_fast';
  return model;
}

const CLONE_USD_PER_SEC: Record<CloneVideoMode, number> = {
  'wan-std': 0.18,
  'wan-pro': 0.26,
};

/** Wan Animate Singapore list price; final provider billing uses actual successful output duration. */
export function estimateCloneCny(opts: { mode: CloneVideoMode; durationSeconds: number }): number {
  const safeDuration = Math.min(30, Math.max(2, opts.durationSeconds));
  return Math.max(1, Math.ceil(safeDuration * CLONE_USD_PER_SEC[opts.mode] * USD_TO_CNY));
}

/** 普通文生:单段预计人民币(向上取整),= 每段秒数 × 档/画质单价 × 汇率。 */
export function estimatePerSegmentCny(
  opts: Required<Pick<VideoCreationOptions, 'model' | 'resolution' | 'durationSeconds'>>,
): number {
  const perSec = USD_PER_SEC[opts.model]?.[opts.resolution] ?? 0;
  return Math.ceil(opts.durationSeconds * perSec * USD_TO_CNY);
}

/**
 * 宠物 i2v 每秒人民币(元/秒,原生 RMB,无汇率)。镜像后端 I2V_CNY_PER_SEC。
 * ⚠️ wan_i2v 720/1080 真实价待 console 核(当前 0.1 占位下限);happyhorse 高置信。
 */
const I2V_CNY_PER_SEC: Record<PetModel, Record<VideoResolution, number>> = {
  wan_i2v: { '720p': 0.1, '1080p': 0.1 },
  happyhorse_i2v: { '720p': 0.9, '1080p': 1.6 },
};

/** 宠物 i2v 预计人民币(向上取整,floor ¥1) = 时长(秒) × 档/画质 元/秒。 */
export function estimatePetCny(
  opts: Required<Pick<VideoCreationOptions, 'petModel' | 'resolution' | 'durationSeconds'>>,
): number {
  const perSec = I2V_CNY_PER_SEC[opts.petModel]?.[opts.resolution] ?? 0;
  return Math.max(1, Math.ceil(opts.durationSeconds * perSec));
}

/**
 * IP 真人换口型(B 架构单 clip)预计价。镜像后端 quoteIpVideo:
 * 1 clip × fal $0.20 + 字符 × Qwen(~$0.13/万字)→ 折人民币 floor ¥1。
 * maybeTooLong: 文案 >180 字可能超 40s 上限。
 */
export function estimateIpVideo(copyText: string): { videoCny: number; chars: number; maybeTooLong: boolean } {
  const chars = copyText.trim().length;
  const usd = 0.2 + (chars / 10_000) * 0.13;
  return { videoCny: Math.max(1, Math.ceil(usd * 7.3)), chars, maybeTooLong: chars > 180 };
}
