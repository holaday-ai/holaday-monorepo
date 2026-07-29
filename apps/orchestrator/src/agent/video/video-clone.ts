import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { lipSyncMaxWaitMs, runLipSync } from './fal-lipsync-client.js';
import {
  type VideoMetadata,
  ffprobeDurationMs,
  ffprobeVideoMetadata,
  inspectMediaIntegrity,
  runFfmpeg,
} from './ffmpeg-exec.js';
import {
  type VideoAvSyncAudit,
  type VideoAvSyncReview,
  videoAvSyncAudit,
  videoAvSyncLogContext,
} from './video-av-sync-verifier.js';
import type { VerifyCloneVideoCompatibilityInput } from './video-clone-compatibility.js';
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
  storeTemporaryVideoFile(input: {
    filename: string;
    mimetype: string;
    sourcePath: string;
  }): Promise<{
    fileId: string;
  }>;
  storeTemporaryAudio(input: { filename: string; mimetype: string; buffer: Buffer }): Promise<{
    fileId: string;
  }>;
  presignByFileId(fileId: string): Promise<string | null>;
  deleteOutput(fileId: string): Promise<boolean>;
  workdir: string;
  logger: PipelineLogger;
  verifyCloneInputs(input: VerifyCloneVideoCompatibilityInput): Promise<VideoQualityResult>;
  verifyFinalVideo(input: VerifyFinalVideoQualityInput): Promise<VideoQualityResult>;
  verifyAudioVisualSync(input: {
    videoPath: string;
    durationMs: number;
  }): Promise<VideoAvSyncReview>;
  overrides?: Partial<CloneVideoFns>;
}

export interface CloneVideoFns {
  generateWanAnimateMix: typeof generateWanAnimateMix;
  runLipSync: typeof runLipSync;
  downloadToBuffer: typeof downloadToBuffer;
  downloadToFile: typeof downloadToFile;
  runFfmpeg: typeof runFfmpeg;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  ffprobeVideoMetadata: typeof ffprobeVideoMetadata;
  inspectMediaIntegrity: typeof inspectMediaIntegrity;
  readImageMetadata: (buffer: Buffer) => Promise<{ width: number; height: number }>;
  readFile: (filePath: string) => Promise<Buffer>;
}

export interface CloneVideoResult {
  readonly fileId: string;
  readonly downloadUrl: string;
  readonly durationSeconds?: number;
  readonly audibleAudioVerified: boolean;
  readonly lipSyncProcessingCompleted: boolean;
  readonly audiovisualSyncVerified: boolean;
  readonly audiovisualSyncReview?: VideoAvSyncAudit;
}

function realFns(): CloneVideoFns {
  return {
    generateWanAnimateMix,
    runLipSync,
    downloadToBuffer,
    downloadToFile,
    runFfmpeg,
    ffprobeDurationMs,
    ffprobeVideoMetadata,
    inspectMediaIntegrity,
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

function cloneLipSyncExtra(model: string): Record<string, unknown> {
  return /^fal-ai\/sync-lipsync\/v(?:2|3)$/.test(model)
    ? { sync_mode: 'cut_off' }
    : { loop_mode: 'loop' };
}

/**
 * Replace the main subject in a reference video with the uploaded character.
 * Wan replaces the main subject. When the reference contains audible speech,
 * its original audio is extracted and a dedicated lip-sync pass redraws the
 * cloned subject's mouth before the final artifact is verified and stored.
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
  if (typeof services.verifyCloneInputs !== 'function') {
    throw new SimpleVideoError('clone compatibility verifier not configured', 'config');
  }
  if (typeof services.verifyAudioVisualSync !== 'function') {
    throw new SimpleVideoError('audio-visual sync verifier not configured', 'config');
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
  const referenceIntegrity = await fns.inspectMediaIntegrity(referenceVideoPath, {
    ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
    ...(cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {}),
  });
  if (!referenceIntegrity.hasVideo || referenceIntegrity.frozenRatio >= 0.98) {
    throw new SimpleVideoError(
      'clone video source lacks meaningful motion',
      'clone_incompatible',
      false,
      ['source_motion_missing'],
      '参考视频几乎全程静止，不能作为动作复刻来源。',
    );
  }
  const subjectReference = await prepareVideoQualityReferenceImage({
    buffer: subjectSource.buffer,
    contentType: subjectSource.contentType,
    label: '上传的主角照片',
  });
  const ffprobeOpts = cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {};
  const referenceDurationMs = referenceMetadata.durationMs;
  const compatibility = await services.verifyCloneInputs({
    subjectImage: subjectReference,
    referenceVideoPath,
    referenceVideoDurationMs: referenceDurationMs,
    workdir: services.workdir,
    ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
  });
  if (compatibility.status !== 'pass') {
    services.logger.warn(
      {
        status: compatibility.status,
        failedChecks: compatibility.failedChecks,
        reason: compatibility.reason,
      },
      'video: clone compatibility preflight rejected source assets',
    );
    throw new SimpleVideoError(
      compatibility.status === 'unknown'
        ? 'clone video compatibility verification unavailable'
        : 'clone video source assets are incompatible',
      compatibility.status === 'unknown' ? 'clone_compatibility_unavailable' : 'clone_incompatible',
      compatibility.status === 'unknown',
    );
  }
  const sourceHasAudibleAudio =
    referenceIntegrity.hasAudio &&
    referenceIntegrity.audioMaxVolumeDb !== null &&
    referenceIntegrity.audioMaxVolumeDb > -50;
  if (sourceHasAudibleAudio && (!cfg.falApiKey || !cfg.falBaseUrl || !cfg.falLipsyncModel)) {
    throw new SimpleVideoError('clone lip-sync provider not configured', 'config');
  }
  const generated = await fns.generateWanAnimateMix({
    apiKey: cfg.dashscopeApiKey,
    baseUrl: cfg.dashscopeBaseUrl,
    ...(cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {}),
    imageUrl: input.imageUrl,
    referenceVideoUrl: input.referenceVideoUrl,
    mode: opts.mode,
  });
  let finalVideoUrl = generated.videoUrl;
  let lipSyncRequestId: string | undefined;
  if (sourceHasAudibleAudio) {
    const falApiKey = cfg.falApiKey;
    const falBaseUrl = cfg.falBaseUrl;
    const falLipsyncModel = cfg.falCloneLipsyncModel ?? cfg.falLipsyncModel;
    if (!falApiKey || !falBaseUrl || !falLipsyncModel) {
      throw new SimpleVideoError('clone lip-sync provider not configured', 'config');
    }
    const temporaryFileIds: string[] = [];
    try {
      const providerVideoPath = path.join(services.workdir, 'clone-provider-output.mp4');
      await fns.downloadToFile(generated.videoUrl, providerVideoPath, {
        maxBytes: 500 * 1024 * 1024,
      });
      const videoStored = await services.storeTemporaryVideoFile({
        filename: 'clone-provider-output.mp4',
        mimetype: 'video/mp4',
        sourcePath: providerVideoPath,
      });
      temporaryFileIds.push(videoStored.fileId);
      const providerVideoUrl = await services.presignByFileId(videoStored.fileId);
      if (!providerVideoUrl) {
        throw new SimpleVideoError('clone provider video presign failed', 'config');
      }

      const referenceAudioPath = path.join(services.workdir, 'clone-reference-audio.wav');
      await fns.runFfmpeg(
        {
          bin: cfg.ffmpegBin ?? 'ffmpeg',
          args: [
            '-y',
            '-i',
            referenceVideoPath,
            '-map',
            '0:a:0',
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'pcm_s16le',
            referenceAudioPath,
          ],
        },
        cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {},
      );
      const audioStored = await services.storeTemporaryAudio({
        filename: 'clone-reference-audio.wav',
        mimetype: 'audio/wav',
        buffer: await fns.readFile(referenceAudioPath),
      });
      temporaryFileIds.push(audioStored.fileId);
      const audioUrl = await services.presignByFileId(audioStored.fileId);
      if (!audioUrl) {
        throw new SimpleVideoError('clone audio presign failed', 'config');
      }
      const lipSync = await fns.runLipSync({
        apiKey: falApiKey,
        baseUrl: falBaseUrl,
        model: falLipsyncModel,
        videoUrl: providerVideoUrl,
        audioUrl,
        extra: cloneLipSyncExtra(falLipsyncModel),
        maxWaitMs: lipSyncMaxWaitMs(referenceDurationMs),
      });
      finalVideoUrl = lipSync.videoUrl;
      lipSyncRequestId = lipSync.requestId;
    } finally {
      for (const fileId of temporaryFileIds.reverse()) {
        try {
          const deleted = await services.deleteOutput(fileId);
          if (!deleted) {
            services.logger.warn(
              { fileId },
              'video: temporary clone handoff row was already absent',
            );
          }
        } catch (err) {
          services.logger.warn(
            { err, fileId },
            'video: failed to remove temporary clone handoff file',
          );
        }
      }
    }
  }
  const outputPath = path.join(services.workdir, 'clone-final.mp4');
  await fns.downloadToFile(finalVideoUrl, outputPath, {
    maxBytes: 500 * 1024 * 1024,
  });
  const durationMs = await fns.ffprobeDurationMs(outputPath, ffprobeOpts);
  const outputIntegrity = await fns.inspectMediaIntegrity(outputPath, {
    ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
    ...(cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {}),
  });
  const mediaFailures: string[] = [];
  if (!outputIntegrity.hasVideo) mediaFailures.push('output_video_missing');
  if (outputIntegrity.frozenRatio >= 0.95) mediaFailures.push('output_motion_missing');
  if (sourceHasAudibleAudio && !outputIntegrity.hasAudio) {
    mediaFailures.push('output_audio_missing');
  } else if (
    sourceHasAudibleAudio &&
    (outputIntegrity.audioMaxVolumeDb === null || outputIntegrity.audioMaxVolumeDb <= -50)
  ) {
    mediaFailures.push('output_audio_inaudible');
  }
  if (mediaFailures.length > 0) {
    throw new SimpleVideoError(
      'clone video failed deterministic media verification',
      'quality',
      false,
      mediaFailures,
      '成片没有保留可确认的动作或参考视频中的可听声音。',
    );
  }
  const verification = await services.verifyFinalVideo({
    videoPath: outputPath,
    workdir: services.workdir,
    durationMs,
    minimumDurationMs: referenceDurationMs,
    userText: input.description?.trim() || '复刻参考视频动作，并保持上传主角的身份和外观一致。',
    qualityContext:
      '抽样帧必须保持上传主角的身份、脸部和身体外形一致，并核对可见的粗粒度姿态与场景是否明显偏离参考；不得出现融合手、多余肢体或主体漂移。有声参考视频已在人物替换后执行专门口型同步，但静态抽样不证明音画同步、连续动作、节奏或镜头运动已验证。',
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
      verification.status === 'unknown',
      verification.failedChecks,
      verification.reason,
    );
  }
  let audiovisualSyncVerified = false;
  let audiovisualSyncReview: VideoAvSyncAudit | undefined;
  if (sourceHasAudibleAudio) {
    const syncReview = await services.verifyAudioVisualSync({
      videoPath: outputPath,
      durationMs,
    });
    if (syncReview.status === 'fail') {
      services.logger.warn(
        videoAvSyncLogContext(syncReview),
        'video: clone audio-visual sync review rejected generated artifact',
      );
      throw new SimpleVideoError(
        'clone video failed audio-visual sync verification',
        'quality',
        false,
        ['audiovisual_sync_mismatch'],
        '独立音画同步复核发现持续不同步。',
      );
    }
    audiovisualSyncVerified = syncReview.status === 'pass';
    audiovisualSyncReview = videoAvSyncAudit(syncReview);
    if (syncReview.status === 'unknown') {
      services.logger.warn(
        videoAvSyncLogContext(syncReview),
        'video: clone audio-visual sync review was inconclusive',
      );
    }
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
    {
      fileId: stored.fileId,
      providerTaskId: generated.taskId,
      ...(lipSyncRequestId ? { lipSyncRequestId } : {}),
      mode: opts.mode,
    },
    'video: clone complete',
  );
  return {
    fileId: stored.fileId,
    downloadUrl: `/api/files/${stored.fileId}/download`,
    durationSeconds: durationMs / 1000,
    audibleAudioVerified: sourceHasAudibleAudio,
    lipSyncProcessingCompleted: sourceHasAudibleAudio && lipSyncRequestId !== undefined,
    audiovisualSyncVerified,
    ...(audiovisualSyncReview ? { audiovisualSyncReview } : {}),
  };
}
