import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  ffprobeDurationMs,
  ffprobeVideoMetadata,
  runFfmpeg,
  type VideoMetadata,
} from './ffmpeg-exec.js';
import { downloadToBuffer, downloadToFile } from './video-http.js';
import { type SimpleVideoConfig, SimpleVideoError } from './video-lane-simple.js';
import type { PipelineLogger } from './video-pipeline.js';
import { generatePosterFile } from './video-poster.js';
import type { VerifyFinalVideoQualityInput, VideoQualityResult } from './video-quality-verifier.js';
import { prepareVideoQualityReferenceImage } from './video-quality-verifier.js';
import { type WanAnimateMixMode, generateWanAnimateMix } from './wan-animate-mix-client.js';

export interface CloneVideoInput {
  readonly imageUrl: string;
  readonly referenceVideoUrl: string;
  readonly description?: string;
}

export interface CloneVideoOptions {
  readonly mode: WanAnimateMixMode;
}

export interface CloneVideoServices {
  storeOutput(input: { filename: string; mimetype: string; buffer: Buffer }): Promise<{
    fileId: string;
    storagePath: string;
  }>;
  storeOutputFile(input: {
    filename: string;
    mimetype: string;
    sourcePath: string;
  }): Promise<{
    fileId: string;
    storagePath: string;
  }>;
  workdir: string;
  logger: PipelineLogger;
  verifyFinalVideo(input: VerifyFinalVideoQualityInput): Promise<VideoQualityResult>;
  overrides?: Partial<CloneVideoFns>;
}

export interface CloneVideoFns {
  generateWanAnimateMix: typeof generateWanAnimateMix;
  downloadToBuffer: typeof downloadToBuffer;
  downloadToFile: typeof downloadToFile;
  runFfmpeg: typeof runFfmpeg;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  ffprobeVideoMetadata: typeof ffprobeVideoMetadata;
  readImageMetadata: (buffer: Buffer) => Promise<{ width: number; height: number }>;
  readFile: (filePath: string) => Promise<Buffer>;
}

export interface CloneVideoResult {
  readonly fileId: string;
  readonly downloadUrl: string;
  readonly durationSeconds?: number;
}

function realFns(): CloneVideoFns {
  return {
    generateWanAnimateMix,
    downloadToBuffer,
    downloadToFile,
    runFfmpeg,
    ffprobeDurationMs,
    ffprobeVideoMetadata,
    readImageMetadata: async (buffer) => {
      const metadata = await sharp(buffer, { failOn: 'warning' }).rotate().metadata();
      const width = metadata.autoOrient.width;
      const height = metadata.autoOrient.height;
      if (!width || !height) throw new Error('无法读取主角照片尺寸。');
      return { width, height };
    },
    readFile: (filePath) => fs.readFile(filePath),
  };
}

function dimensionRatio(width: number, height: number): number {
  return width / height;
}

function validateCloneImageDimensions(width: number, height: number): void {
  const ratio = dimensionRatio(width, height);
  if (width < 200 || height < 200 || width > 4096 || height > 4096 || ratio < 1 / 3 || ratio > 3) {
    throw new SimpleVideoError(
      '主角照片需为 200-4096 像素，宽高比需在 1:3 到 3:1 之间。',
      'invalid_options',
    );
  }
}

function validateCloneReferenceMetadata(metadata: VideoMetadata): void {
  const ratio = dimensionRatio(metadata.width, metadata.height);
  if (
    metadata.width < 200 ||
    metadata.height < 200 ||
    metadata.width > 2048 ||
    metadata.height > 2048 ||
    ratio < 1 / 3 ||
    ratio > 3
  ) {
    throw new SimpleVideoError(
      '参考视频需为 200-2048 像素，宽高比需在 1:3 到 3:1 之间。',
      'invalid_options',
    );
  }
  if (metadata.durationMs < 2_000 || metadata.durationMs > 30_000) {
    throw new SimpleVideoError('参考视频时长必须在 2 到 30 秒之间。', 'invalid_options');
  }
}

/**
 * Replace the main subject in a reference video with the uploaded character.
 * The provider output is stored directly so its original timing and audio are
 * preserved; Wan adds the required AI-generated watermark at generation time.
 */
export async function runCloneVideoCreation(
  input: CloneVideoInput,
  cfg: SimpleVideoConfig,
  opts: CloneVideoOptions,
  services: CloneVideoServices,
): Promise<CloneVideoResult> {
  if (!cfg.dashscopeApiKey)
    throw new SimpleVideoError('DASHSCOPE_API_KEY not configured', 'config');
  if (!input.imageUrl || !input.referenceVideoUrl) {
    throw new SimpleVideoError(
      'clone video requires a character image and reference video',
      'config',
    );
  }
  if (typeof services.verifyFinalVideo !== 'function') {
    throw new SimpleVideoError('video quality verifier not configured', 'config');
  }
  const fns = { ...realFns(), ...(services.overrides ?? {}) };
  // Preserve source evidence locally before the paid provider job starts.
  // Signed input URLs are intentionally short-lived.
  const referenceVideoPath = path.join(services.workdir, 'clone-reference.mp4');
  const [subjectSource] = await Promise.all([
    fns.downloadToBuffer(input.imageUrl, { maxBytes: 12 * 1024 * 1024 }),
    fns.downloadToFile(input.referenceVideoUrl, referenceVideoPath, {
      maxBytes: 200 * 1024 * 1024,
    }),
  ]);
  const [subjectMetadata, referenceMetadata] = await Promise.all([
    fns.readImageMetadata(subjectSource.buffer),
    fns.ffprobeVideoMetadata(
      referenceVideoPath,
      cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {},
    ),
  ]);
  validateCloneImageDimensions(subjectMetadata.width, subjectMetadata.height);
  validateCloneReferenceMetadata(referenceMetadata);
  const subjectReference = await prepareVideoQualityReferenceImage({
    buffer: subjectSource.buffer,
    contentType: subjectSource.contentType,
    label: '上传的主角照片',
  });
  const ffprobeOpts = cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {};
  const referenceDurationMs = referenceMetadata.durationMs;
  const generated = await fns.generateWanAnimateMix({
    apiKey: cfg.dashscopeApiKey,
    baseUrl: cfg.dashscopeBaseUrl,
    ...(cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {}),
    imageUrl: input.imageUrl,
    referenceVideoUrl: input.referenceVideoUrl,
    mode: opts.mode,
  });
  const outputPath = path.join(services.workdir, 'clone-final.mp4');
  await fns.downloadToFile(generated.videoUrl, outputPath, {
    maxBytes: 500 * 1024 * 1024,
  });
  const durationMs = await fns.ffprobeDurationMs(outputPath, ffprobeOpts);
  const verification = await services.verifyFinalVideo({
    videoPath: outputPath,
    workdir: services.workdir,
    durationMs,
    minimumDurationMs: referenceDurationMs,
    userText: input.description?.trim() || '复刻参考视频动作，并保持上传主角的身份和外观一致。',
    qualityContext:
      '抽样帧必须保持上传主角的身份、脸部和身体外形一致，并核对可见的粗粒度姿态与场景是否明显偏离参考；不得出现融合手、多余肢体或主体漂移。静态抽样不证明连续动作、节奏或镜头运动已验证。',
    referenceImages: [subjectReference],
    referenceVideos: [
      {
        videoPath: referenceVideoPath,
        durationMs: referenceDurationMs,
        label: '用户上传的参考动作视频',
      },
    ],
    expectedSubtitleText: [],
    requiredBrandTexts: ['Generated by Qwen AI'],
    brandPolicy:
      '参考视频原有文字或品牌可以保留，但必须清晰稳定；供应商 AI 生成标识必须完整准确，不得新增乱码或错误品牌。',
    ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
  });
  if (verification.status !== 'pass') {
    services.logger.warn(
      {
        status: verification.status,
        failedChecks: verification.failedChecks,
        reason: verification.reason,
      },
      'video: clone quality gate rejected generated artifact',
    );
    throw new SimpleVideoError(
      'clone video failed automated quality verification',
      verification.status === 'unknown' ? 'quality_unavailable' : 'quality',
    );
  }
  const stored = await services.storeOutputFile({
    filename: 'video.mp4',
    mimetype: 'video/mp4',
    sourcePath: outputPath,
  });

  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};
  await generatePosterFile({
    videoPath: outputPath,
    posterPath: path.join(services.workdir, 'poster.jpg'),
    deps: {
      runFfmpeg: fns.runFfmpeg,
      readFile: fns.readFile,
      storeOutput: services.storeOutput,
      logger: services.logger,
    },
    ffOpts,
  });
  services.logger.info(
    { fileId: stored.fileId, providerTaskId: generated.taskId, mode: opts.mode },
    'video: clone complete',
  );
  return {
    fileId: stored.fileId,
    downloadUrl: `/api/files/${stored.fileId}/download`,
    durationSeconds: durationMs / 1000,
  };
}
