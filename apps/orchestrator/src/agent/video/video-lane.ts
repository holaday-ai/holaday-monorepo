/**
 * Video lane wiring (step 3e-2).
 *
 * Assembles the REAL VideoPipelineDeps from the pure adapters + storage +
 * ffmpeg-exec, and exposes runVideoCreation — the end-to-end lane the
 * tasks.ts gate (3e-3) fires in a background coroutine.
 *
 * Constraints wired here:
 *   - broll n=1 (flash defaults to 4 → cost) — passed explicitly.
 *   - Wanxiang / Qwen result URLs are TEMPORARY → downloaded immediately,
 *     persisted to R2 AND written to a local workdir for ffmpeg.
 *   - fal lip-sync inputs MUST be public → base video + narration audio are
 *     presigned R2 GET URLs.
 *   - per-segment retry + fire-and-poll live in the runner (3b); this module
 *     only supplies the per-step IO.
 *   - 合规硬闸: refuse unless the user signed the self-use authorization and
 *     completed onboarding (voice + base video). Output is always watermarked
 *     by the compositor (3c).
 *
 * Every external effect is overridable (svc.overrides) so the wiring is unit-
 * testable without real APIs / ffmpeg / fs.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ffprobeDurationMs, renderImageClip, runFfmpeg } from './ffmpeg-exec.js';
import { runLipSync } from './fal-lipsync-client.js';
import { synthesizeSpeech } from './qwen-voice-clone-client.js';
import { buildComposeCommand } from './video-compose.js';
import { runVideoPipeline, type PipelineLogger, type VideoPipelineDeps } from './video-pipeline.js';
import { generateVideoScript, type LlmComplete } from './video-script.js';
import { downloadToBuffer } from './video-http.js';
import { generateBrollImage } from './wanxiang-client.js';

export type VideoLaneErrorKind = 'onboarding' | 'compliance' | 'compose' | 'config';

export class VideoLaneError extends Error {
  constructor(
    message: string,
    readonly kind: VideoLaneErrorKind,
  ) {
    super(message);
    this.name = 'VideoLaneError';
  }
}

export interface VideoLaneConfig {
  readonly dashscopeApiKey: string;
  readonly dashscopeBaseUrl: string;
  readonly dashscopeWorkspaceId?: string;
  readonly falApiKey: string;
  readonly falBaseUrl: string;
  readonly wanxiangT2iModel: string;
  readonly falLipsyncModel: string;
  readonly qwenTtsVcModel: string;
  readonly ffmpegBin?: string;
  readonly ffprobeBin?: string;
}

export interface VideoLaneContext {
  /** users.qwen_voice_id — the user's cloned voice. */
  readonly voiceId: string;
  /** R2 storage path to the user's base on-camera video. */
  readonly baseVideoStoragePath: string;
  /** 合规：用户已签「本人授权声明 + 仅用本人素材」。false → 拒绝生成。 */
  readonly authorizedSelfUse: boolean;
}

export interface StoredFile {
  readonly fileId: string;
  readonly storagePath: string;
}

interface LaneFns {
  synthesizeSpeech: typeof synthesizeSpeech;
  generateBrollImage: typeof generateBrollImage;
  runLipSync: typeof runLipSync;
  downloadToBuffer: typeof downloadToBuffer;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  renderImageClip: typeof renderImageClip;
  runFfmpeg: typeof runFfmpeg;
  writeFile: (p: string, b: Buffer) => Promise<void>;
  readFile: (p: string) => Promise<Buffer>;
  generateVideoScript: typeof generateVideoScript;
}

export interface VideoLaneServices {
  /** Persist a buffer to R2 (kind='output', 24h TTL) bound to the task/user. */
  storeOutput(input: { filename: string; mimetype: string; buffer: Buffer }): Promise<StoredFile>;
  /** Presign an R2 storagePath → public GET url (for fal inputs). null on local. */
  presignGet(storagePath: string, expiresInSeconds: number): Promise<string | null>;
  /** Per-task temp dir for ffmpeg intermediates. */
  workdir: string;
  logger: PipelineLogger;
  llm: LlmComplete;
  /** Test/override hook for the external effects. */
  overrides?: Partial<LaneFns>;
}

function realFns(): LaneFns {
  return {
    synthesizeSpeech,
    generateBrollImage,
    runLipSync,
    downloadToBuffer,
    ffprobeDurationMs,
    renderImageClip,
    runFfmpeg,
    writeFile: (p, b) => fs.writeFile(p, b),
    readFile: (p) => fs.readFile(p),
    generateVideoScript,
  };
}

/** Build the runner's deps wired to the real adapters + storage + ffmpeg. */
export function createVideoPipelineDeps(
  cfg: VideoLaneConfig,
  ctx: VideoLaneContext,
  svc: VideoLaneServices,
): VideoPipelineDeps {
  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const wsHeader = cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {};
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};
  // segment index → its R2 audio path (for presigning to fal) + local path.
  const audioMap = new Map<number, { storagePath: string; localPath: string }>();
  // Presign the base video once (shared by every 口播 lip-sync).
  let baseVideoUrlPromise: Promise<string> | null = null;
  const baseVideoUrl = (): Promise<string> => {
    baseVideoUrlPromise ??= svc.presignGet(ctx.baseVideoStoragePath, 3600).then((u) => {
      if (!u) {
        throw new VideoLaneError('base video presign returned null (need STORAGE_PROVIDER=r2)', 'config');
      }
      return u;
    });
    return baseVideoUrlPromise;
  };

  return {
    logger: svc.logger,

    async synthesizeSegmentAudio({ index, text }) {
      const synth = await fns.synthesizeSpeech({
        apiKey: cfg.dashscopeApiKey,
        baseUrl: cfg.dashscopeBaseUrl,
        ...wsHeader,
        model: cfg.qwenTtsVcModel,
        voiceId: ctx.voiceId,
        text,
      });
      const dl = await fns.downloadToBuffer(synth.audioUrl);
      const stored = await svc.storeOutput({
        filename: `seg${index}-audio.wav`,
        mimetype: 'audio/wav',
        buffer: dl.buffer,
      });
      const localPath = path.join(svc.workdir, `seg${index}-audio.wav`);
      await fns.writeFile(localPath, dl.buffer);
      const durationMs = await fns.ffprobeDurationMs(
        localPath,
        cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {},
      );
      audioMap.set(index, { storagePath: stored.storagePath, localPath });
      return { audioRef: localPath, durationMs };
    },

    async generateBroll({ index, visual }) {
      const r = await fns.generateBrollImage({
        apiKey: cfg.dashscopeApiKey,
        baseUrl: cfg.dashscopeBaseUrl,
        ...wsHeader,
        model: cfg.wanxiangT2iModel,
        prompt: visual,
        n: 1, // flash defaults to 4 → control cost
      });
      const url = r.imageUrls[0];
      if (!url) throw new VideoLaneError(`broll segment ${index} produced no image`, 'compose');
      const dl = await fns.downloadToBuffer(url); // OSS 24h TTL → download now
      await svc.storeOutput({ filename: `seg${index}-broll.png`, mimetype: 'image/png', buffer: dl.buffer });
      const localPath = path.join(svc.workdir, `seg${index}-broll.png`);
      await fns.writeFile(localPath, dl.buffer);
      return { visualRef: localPath };
    },

    async renderBrollClip({ index, visualRef, audioRef, durationMs }) {
      const outPath = path.join(svc.workdir, `seg${index}-clip.mp4`);
      await fns.renderImageClip(
        { imagePath: visualRef, audioPath: audioRef, outPath, durationMs },
        ffOpts,
      );
      return { clipRef: outPath };
    },

    async lipSyncSegment({ index }) {
      const audio = audioMap.get(index);
      if (!audio) throw new VideoLaneError(`lipSync: no audio for segment ${index}`, 'compose');
      const audioUrl = await svc.presignGet(audio.storagePath, 3600);
      if (!audioUrl) throw new VideoLaneError('lipSync audio presign null (need STORAGE_PROVIDER=r2)', 'config');
      const result = await fns.runLipSync({
        apiKey: cfg.falApiKey,
        baseUrl: cfg.falBaseUrl,
        model: cfg.falLipsyncModel,
        videoUrl: await baseVideoUrl(),
        audioUrl,
      });
      const dl = await fns.downloadToBuffer(result.videoUrl);
      await svc.storeOutput({ filename: `seg${index}-lipsync.mp4`, mimetype: 'video/mp4', buffer: dl.buffer });
      const localPath = path.join(svc.workdir, `seg${index}-clip.mp4`);
      await fns.writeFile(localPath, dl.buffer);
      return { clipRef: localPath };
    },
  };
}

export interface RunVideoCreationInput {
  readonly userPrompt: string;
  readonly retries?: number;
}

export interface VideoCreationResult {
  readonly fileId: string;
  readonly downloadUrl: string;
  readonly totalDurationMs: number;
  readonly segments: number;
}

/**
 * Full lane: ① script → ②-⑤ runner → ⑥ FFmpeg compose → persist. Throws a
 * typed VideoLaneError before any spend if compliance / onboarding / config
 * gates fail. Meant to run in a background coroutine (never awaited on the
 * request thread).
 */
export async function runVideoCreation(
  input: RunVideoCreationInput,
  cfg: VideoLaneConfig,
  ctx: VideoLaneContext,
  svc: VideoLaneServices,
): Promise<VideoCreationResult> {
  if (!ctx.authorizedSelfUse) {
    throw new VideoLaneError('未签署本人授权声明，拒绝生成（合规：仅用本人声音/肖像）', 'compliance');
  }
  if (!ctx.voiceId || !ctx.baseVideoStoragePath) {
    throw new VideoLaneError('请先完成视频 onboarding（克隆声音 + 出镜底版视频）', 'onboarding');
  }
  if (!cfg.dashscopeApiKey || !cfg.falApiKey) {
    throw new VideoLaneError('video lane keys not configured', 'config');
  }

  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};

  // ① script
  const script = await fns.generateVideoScript({ userPrompt: input.userPrompt }, { llm: svc.llm });
  // ②-⑤ runner (segments + timeline + SRT)
  const deps = createVideoPipelineDeps(cfg, ctx, svc);
  const result = await runVideoPipeline(
    { script, ...(input.retries !== undefined ? { retries: input.retries } : {}) },
    deps,
  );
  // ⑤ subtitle file
  const srtPath = path.join(svc.workdir, 'subtitles.srt');
  await fns.writeFile(srtPath, Buffer.from(result.srt, 'utf-8'));
  // ⑥ compose (watermark is always applied by buildComposeCommand)
  const outPath = path.join(svc.workdir, 'final.mp4');
  const cmd = buildComposeCommand(
    { segmentClipPaths: result.segments.map((s) => s.clipRef), outputPath: outPath, srtPath },
    ffOpts,
  );
  await fns.runFfmpeg(cmd, ffOpts);
  // persist final
  const finalBuffer = await fns.readFile(outPath);
  const stored = await svc.storeOutput({ filename: 'video.mp4', mimetype: 'video/mp4', buffer: finalBuffer });
  svc.logger.info(
    { fileId: stored.fileId, segments: result.segments.length, totalDurationMs: result.timeline.totalDurationMs },
    'video: creation complete',
  );
  return {
    fileId: stored.fileId,
    downloadUrl: `/api/files/${stored.fileId}/download`,
    totalDurationMs: result.timeline.totalDurationMs,
    segments: result.segments.length,
  };
}
