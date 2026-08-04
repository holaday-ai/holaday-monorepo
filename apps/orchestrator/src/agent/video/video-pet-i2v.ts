/**
 * 宠物视频 image-to-video (i2v) lane — Phase 2 第二期.
 *
 * 单主体「单张图 → 短视频」: 用户传一张宠物照片 + 一句动作描述 → DashScope
 * video-synthesis(input.img_url)出一条短视频 → 合成层 pad 到画幅 + 水印 →
 * 落 R2. 与「普通视频」多段文生那套完全不同:
 *   - 无 optimize / 无脚本拆段 / 无 TTS 旁白 / 无字幕(单段、静默);
 *   - 复用既有 generateBrollVideo(已支持 imageUrl→img_url 的 i2v),
 *     buildPetVideoCommand(静默单 clip 合成), storeOutput.
 *
 * 模型 (BOSS 2026-06-16 核价):
 *   - 'wan_i2v' (DEFAULT) = wan2.2-i2v-flash, 更省 + 已证同 dashscope-intl 端点/key.
 *   - 'happyhorse_i2v' = happyhorse-1.0-i2v, 高质量可选 (720P 0.9/1080P 1.6 元/s);
 *     ⚠️ intl 区可达性未核(examples 用 CN host)→ 灰度前 console 核 region.
 *
 * fire-and-poll: generateBrollVideo 内部 create→poll(异步), 由 confirmVideo 的
 * 后台 coroutine 调用 → 对请求层即「submit 后台跑」,不同步阻塞。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ffprobeDurationMs, runFfmpeg } from './ffmpeg-exec.js';
import { buildPetVideoCommand } from './video-compose.js';
import { downloadToBuffer, downloadToFile } from './video-http.js';
import {
  type AspectRatio,
  type SimpleVideoConfig,
  SimpleVideoError,
  resolveAspect,
} from './video-lane-simple.js';
import type { PipelineLogger } from './video-pipeline.js';
import { generatePosterFile } from './video-poster.js';
import type { VerifyFinalVideoQualityInput, VideoQualityResult } from './video-quality-verifier.js';
import { prepareVideoQualityReferenceImage } from './video-quality-verifier.js';
import { generateBrollVideo } from './wanxiang-client.js';

const DEFAULT_WAN_I2V_MODEL = 'wan2.2-i2v-flash';
const DEFAULT_HAPPYHORSE_I2V_MODEL = 'happyhorse-1.0-i2v';

// 宠物 i2v 画面引导(轻):单主体、动作自然、不编乱码假字。宠物无人手解剖问题,suffix 比 t2v 短。
const PET_I2V_SUFFIX =
  '，保持输入宠物的品种、毛色、脸部特征、身体比例和主体外观一致；四肢数量与关节结构正确，动作流畅真实，不得出现融合或额外肢体，避免编造乱码文字。';

export type PetI2vModel = 'wan_i2v' | 'happyhorse_i2v';

export interface PetVideoInput {
  /** Public (presigned GET) URL of the uploaded pet photo. */
  readonly imageUrl: string;
  /** User's motion description ("小猫眨眨眼、歪头看镜头"). */
  readonly motionPrompt: string;
}

export interface PetVideoOptions {
  /** i2v 档. Default 'wan_i2v'. */
  readonly model?: PetI2vModel;
  /** 画幅. Default '9:16' 竖屏. */
  readonly aspectRatio?: AspectRatio;
  /** Clip length seconds → DashScope parameters.duration. Omit = model default. */
  readonly durationSeconds?: number;
}

export interface PetVideoServices {
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
  /** Injectable for tests (no real network / ffmpeg). */
  overrides?: Partial<PetI2vFns>;
}

export interface PetI2vFns {
  generateBrollVideo: typeof generateBrollVideo;
  downloadToBuffer: typeof downloadToBuffer;
  downloadToFile: typeof downloadToFile;
  runFfmpeg: typeof runFfmpeg;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  readFile: (p: string) => Promise<Buffer>;
}

function realFns(): PetI2vFns {
  return {
    generateBrollVideo,
    downloadToBuffer,
    downloadToFile,
    runFfmpeg,
    ffprobeDurationMs,
    readFile: (p) => fs.readFile(p),
  };
}

export interface PetVideoResult {
  readonly fileId: string;
  readonly downloadUrl: string;
}

function resolveI2vModel(model: PetI2vModel, cfg: SimpleVideoConfig): string {
  return model === 'happyhorse_i2v'
    ? (cfg.happyhorseI2vModel ?? DEFAULT_HAPPYHORSE_I2V_MODEL)
    : (cfg.wanI2vModel ?? DEFAULT_WAN_I2V_MODEL);
}

/**
 * Run the pet i2v lane: i2v create+poll → download → pad+watermark → store.
 * Background-coroutine friendly (confirmVideo fires it detached).
 */
export async function runPetVideoCreation(
  input: PetVideoInput,
  cfg: SimpleVideoConfig,
  opts: PetVideoOptions,
  svc: PetVideoServices,
): Promise<PetVideoResult> {
  if (!cfg.dashscopeApiKey)
    throw new SimpleVideoError('DASHSCOPE_API_KEY not configured', 'config');
  if (!input.imageUrl) throw new SimpleVideoError('pet i2v requires an image url', 'config');
  if (typeof svc.verifyFinalVideo !== 'function') {
    throw new SimpleVideoError('video quality verifier not configured', 'config');
  }
  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const ws = cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {};
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};
  const aspect = resolveAspect(opts.aspectRatio ?? '9:16');
  const model = resolveI2vModel(opts.model ?? 'wan_i2v', cfg);
  // Keep the uploaded source available for post-generation identity checks.
  const sourceImage = await fns.downloadToBuffer(input.imageUrl, {
    maxBytes: 12 * 1024 * 1024,
  });
  const sourceReference = await prepareVideoQualityReferenceImage({
    buffer: sourceImage.buffer,
    contentType: sourceImage.contentType,
    label: '用户上传的宠物照片',
  });

  // ① i2v create + poll (fire-and-poll; img_url = uploaded pet photo)
  const v = await fns.generateBrollVideo({
    apiKey: cfg.dashscopeApiKey,
    baseUrl: cfg.dashscopeBaseUrl,
    ...ws,
    model,
    prompt: input.motionPrompt + PET_I2V_SUFFIX,
    imageUrl: input.imageUrl,
    size: aspect.hhSize,
    ...(opts.durationSeconds !== undefined ? { durationSeconds: opts.durationSeconds } : {}),
  });
  if (!v.videoUrl) throw new SimpleVideoError('pet i2v task produced no video url', 'compose');

  // ② download the raw i2v clip (result url is 24h-TTL → download immediately)
  const rawPath = path.join(svc.workdir, 'pet-i2v-raw.mp4');
  await fns.downloadToFile(v.videoUrl, rawPath, {
    maxBytes: 500 * 1024 * 1024,
  });

  // ③ compose — pad to 画幅 + 合规水印 + 静默音轨 (单 clip, 无字幕/无旁白)
  const outPath = path.join(svc.workdir, 'pet-final.mp4');
  const cmd = buildPetVideoCommand(
    {
      clipPath: rawPath,
      outputPath: outPath,
      width: aspect.width,
      height: aspect.height,
      ...(cfg.watermarkFontFile ? { watermark: { fontFile: cfg.watermarkFontFile } } : {}),
    },
    ffOpts,
  );
  await fns.runFfmpeg(cmd, ffOpts);

  // ④ hard quality gate — identity/anatomy failures never become deliverables.
  const durationMs = await fns.ffprobeDurationMs(
    outPath,
    cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {},
  );
  const verification = await svc.verifyFinalVideo({
    videoPath: outPath,
    workdir: svc.workdir,
    durationMs,
    ...(opts.durationSeconds !== undefined
      ? { minimumDurationMs: opts.durationSeconds * 1000 }
      : {}),
    userText: input.motionPrompt,
    qualityContext:
      '抽样帧必须保持输入宠物的身份、品种、毛色、脸部特征和身体比例一致；四肢数量与可见关节必须自然，不得出现融合、增生、消失或主体漂移。静态抽样不证明连续运动流畅性已验证。',
    referenceImages: [sourceReference],
    expectedSubtitleText: [],
    requiredBrandTexts: ['HOLA DAY · AI'],
    brandPolicy: '输入照片原有文字或品牌可以保留，但必须清晰稳定，新增内容不得乱码或拼错。',
    ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
  });
  if (verification.status !== 'pass') {
    svc.logger.warn(
      {
        status: verification.status,
        failedChecks: verification.failedChecks,
        reason: verification.reason,
      },
      'video: pet quality gate rejected generated artifact',
    );
    throw new SimpleVideoError(
      'pet video failed automated quality verification',
      verification.status === 'unknown' ? 'quality_unavailable' : 'quality',
    );
  }

  // ⑤ store final
  const stored = await svc.storeOutputFile({
    filename: 'video.mp4',
    mimetype: 'video/mp4',
    sourcePath: outPath,
  });
  // 首帧 poster（非致命）。
  await generatePosterFile({
    videoPath: outPath,
    posterPath: path.join(svc.workdir, 'poster.jpg'),
    deps: {
      runFfmpeg: fns.runFfmpeg,
      readFile: fns.readFile,
      storeOutput: svc.storeOutput,
      logger: svc.logger,
    },
    ffOpts,
  });
  svc.logger.info(
    { fileId: stored.fileId, model, aspect: opts.aspectRatio ?? '9:16' },
    'video: pet i2v complete',
  );
  return { fileId: stored.fileId, downloadUrl: `/api/files/${stored.fileId}/download` };
}
