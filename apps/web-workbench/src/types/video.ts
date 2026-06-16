/**
 * Phase 2 第一期 — 视频独立界面的前端类型 + 客户端价格预览。
 *
 * 这里的 VideoCreationOptions 与后端 `tasks.create` 的 `videoOptions` 入参
 * 一一对应(orchestrator src/trpc/routers/tasks.ts);`estimatePerSegmentCny`
 * 镜像后端 `video-confirm.ts` 的单价矩阵,只用于"价格预览实时"。**它只是
 * 估算** —— 真实段数由后端 optimize 决定,权威报价走 video_quote 卡确认。
 */

export type VideoModel = 'veo_fast' | 'happyhorse' | 'veo_standard';
export type VideoStyleOption = 'auto' | 'realistic' | 'atmospheric' | 'science';
export type VideoAspect = '9:16' | '16:9' | '1:1';
export type VideoResolution = '720p' | '1080p';
export type VideoDuration = 6 | 8;

export interface VideoCreationOptions {
  model?: VideoModel;
  style?: VideoStyleOption;
  aspectRatio?: VideoAspect;
  resolution?: VideoResolution;
  durationSeconds?: VideoDuration;
}

/** 每秒美元单价(档 × 画质)。镜像后端 video-confirm.ts VEO_USD_PER_SEC。 */
const USD_PER_SEC: Record<VideoModel, Record<VideoResolution, number>> = {
  veo_fast: { '720p': 0.1, '1080p': 0.12 },
  veo_standard: { '720p': 0.4, '1080p': 0.4 },
  happyhorse: { '720p': 0.9 / 7.3, '1080p': 1.6 / 7.3 },
};
const USD_TO_CNY = 7.3;

/** 单段预计人民币(向上取整),= 每段秒数 × 档/画质单价 × 汇率。 */
export function estimatePerSegmentCny(opts: Required<Pick<VideoCreationOptions, 'model' | 'resolution' | 'durationSeconds'>>): number {
  const perSec = USD_PER_SEC[opts.model]?.[opts.resolution] ?? 0;
  return Math.ceil(opts.durationSeconds * perSec * USD_TO_CNY);
}
