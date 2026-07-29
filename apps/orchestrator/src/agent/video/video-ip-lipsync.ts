/**
 * IP 人物 真人换口型 — B 架构「单 clip 口播」lane (Phase 2 第三期 阶段3).
 *
 * 与 A 架构(video-lane.ts runVideoCreation,多段、每句一次 lip-sync)
 * 不同:B 把【全文案】一次合成 1 条克隆音 → 对底版做【1 次】fal 换口型
 * (底版短于音频时循环补够)→ 1 次 compose(画幅 pad + 字幕 + 水印)→ store。
 * 上限 ≤40s,超长抛 'too_long'(报价/前端已提示)。
 *
 * 复用既有件:synthesizeSpeech(克隆音)/ runLipSync(模型对应的循环参数)/
 * buildTimeline+buildAss(把全文案按字数比例切成逐句字幕)/ buildComposeCommand
 * (单 clip,clip 自带克隆音轨)。fire-and-poll 在 confirmVideo 后台协程。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { lipSyncMaxWaitMs, runLipSync } from './fal-lipsync-client.js';
import { ffprobeDurationMs, inspectMediaIntegrity, runFfmpeg } from './ffmpeg-exec.js';
import { synthesizeSpeech } from './qwen-voice-clone-client.js';
import { buildAss, buildTimeline } from './timeline.js';
import type { VideoSegment } from './types.js';
import {
  type VideoAvSyncAudit,
  type VideoAvSyncReview,
  videoAvSyncAudit,
  videoAvSyncLogContext,
} from './video-av-sync-verifier.js';
import { buildComposeCommand } from './video-compose.js';
import { downloadToBuffer, downloadToFile } from './video-http.js';
import { type AspectRatio, resolveAspect } from './video-lane-simple.js';
import type { PipelineLogger } from './video-pipeline.js';
import { generatePosterFile } from './video-poster.js';
import type { VerifyFinalVideoQualityInput, VideoQualityResult } from './video-quality-verifier.js';

/** B 架构产品边界:总音频 ≤40s;超则要进阶档/截短。 */
export const IP_MAX_AUDIO_MS = 40_000;

function ipLipSyncExtra(model: string): Record<string, unknown> {
  return /^fal-ai\/sync-lipsync\/v(?:2|3)$/.test(model)
    ? { sync_mode: 'loop' }
    : { loop_mode: 'loop' };
}

export type IpVideoErrorKind =
  | 'config'
  | 'too_long'
  | 'compose'
  | 'quality'
  | 'quality_unavailable';
export class IpVideoError extends Error {
  constructor(
    message: string,
    readonly kind: IpVideoErrorKind,
    readonly failedChecks: readonly string[] = [],
    readonly qualityReason?: string,
  ) {
    super(message);
    this.name = 'IpVideoError';
  }
}

export interface IpVideoConfig {
  readonly dashscopeApiKey: string;
  readonly dashscopeBaseUrl: string;
  readonly dashscopeWorkspaceId?: string;
  readonly qwenTtsVcModel: string;
  readonly falApiKey: string;
  readonly falBaseUrl: string;
  readonly falLipsyncModel: string;
  readonly subtitleFontName?: string;
  readonly watermarkFontFile?: string;
  readonly ffmpegBin?: string;
  readonly ffprobeBin?: string;
}

export interface IpVideoContext {
  /** users.qwen_voice_id — the user's cloned voice. */
  readonly voiceId: string;
  /** PUBLIC presigned GET url to the user's base on-camera video (confirmVideo resolves it). */
  readonly baseVideoUrl: string;
}

export interface IpVideoOptions {
  readonly aspectRatio?: AspectRatio;
}

export interface IpVideoServices {
  /** Persist a buffer (kind=output) bound to the task/user; returns the file id. */
  storeOutput(input: { filename: string; mimetype: string; buffer: Buffer }): Promise<{
    fileId: string;
  }>;
  /** Persist a generated MP4 without loading it into the Orchestrator heap. */
  storeOutputFile(input: {
    filename: string;
    mimetype: string;
    sourcePath: string;
  }): Promise<{
    fileId: string;
  }>;
  /** Persist cloned audio as a hidden, short-TTL provider handoff. */
  storeTemporaryAudio(input: { filename: string; mimetype: string; buffer: Buffer }): Promise<{
    fileId: string;
  }>;
  /** Mint a public GET url for a just-stored file id (for fal to fetch the cloned audio). */
  presignByFileId(fileId: string): Promise<string | null>;
  /** Remove the temporary cloned-audio object after the provider has consumed it. */
  deleteOutput(fileId: string): Promise<boolean>;
  workdir: string;
  logger: PipelineLogger;
  verifyFinalVideo(input: VerifyFinalVideoQualityInput): Promise<VideoQualityResult>;
  verifyAudioVisualSync(input: {
    videoPath: string;
    durationMs: number;
  }): Promise<VideoAvSyncReview>;
  overrides?: Partial<IpFns>;
}

export interface IpFns {
  synthesizeSpeech: typeof synthesizeSpeech;
  runLipSync: typeof runLipSync;
  downloadToBuffer: typeof downloadToBuffer;
  downloadToFile: typeof downloadToFile;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  inspectMediaIntegrity: typeof inspectMediaIntegrity;
  runFfmpeg: typeof runFfmpeg;
  writeFile: (p: string, b: Buffer) => Promise<void>;
  readFile: (p: string) => Promise<Buffer>;
}

function realFns(): IpFns {
  return {
    synthesizeSpeech,
    runLipSync,
    downloadToBuffer,
    downloadToFile,
    ffprobeDurationMs,
    inspectMediaIntegrity,
    runFfmpeg,
    writeFile: (p, b) => fs.writeFile(p, b),
    readFile: (p) => fs.readFile(p),
  };
}

/**
 * Split the full copy into per-sentence subtitle cues, each given a duration
 * PROPORTIONAL to its character count so the cues span the whole audio. No
 * per-sentence TTS timing exists (B uses one synthesis), so proportional is
 * the honest approximation. Returns parallel segments/durations for buildTimeline.
 */
export function splitIpCues(
  copyText: string,
  totalMs: number,
): { segments: VideoSegment[]; durations: number[] } {
  const parts = copyText
    .split(/(?<=[。！？!?\n；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const sentences = parts.length > 0 ? parts : [copyText.trim() || ' '];
  const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
  const segments: VideoSegment[] = sentences.map((text) => ({ text, type: 'voiceover' as const }));
  // proportional, each >=1ms, last absorbs rounding so the sum == totalMs
  // (when totalMs >= 句数). 给后面每句预留 1ms,保证最后一句也 >=1 且不超总长;
  // 退化情形 totalMs < 句数 时无法满足(N 个 >=1 之和 >= N > totalMs),优雅降级为各 1ms。
  const durations: number[] = [];
  let remaining = totalMs;
  for (let i = 0; i < sentences.length; i += 1) {
    if (i === sentences.length - 1) {
      durations.push(Math.max(1, remaining));
    } else {
      const sentencesLeftAfter = sentences.length - 1 - i;
      const ideal = Math.round(((sentences[i]?.length ?? 0) / totalChars) * totalMs);
      const maxForThis = Math.max(1, remaining - sentencesLeftAfter); // 留给后面每句至少 1ms
      const d = Math.min(Math.max(1, ideal), maxForThis);
      durations.push(d);
      remaining -= d;
    }
  }
  return { segments, durations };
}

export interface IpVideoResult {
  readonly fileId: string;
  readonly downloadUrl: string;
  readonly totalDurationMs: number;
  readonly audiovisualSyncVerified: boolean;
  readonly audiovisualSyncReview?: VideoAvSyncAudit;
}

/**
 * Run the B-architecture single-clip口播 lane. Background-coroutine friendly
 * (confirmVideo fires it detached; the fal poll is the slow part, ~2min).
 */
export async function runIpVideoCreation(
  input: { copyText: string },
  cfg: IpVideoConfig,
  ctx: IpVideoContext,
  opts: IpVideoOptions,
  svc: IpVideoServices,
): Promise<IpVideoResult> {
  if (!cfg.dashscopeApiKey || !cfg.falApiKey)
    throw new IpVideoError('IP lane keys not configured', 'config');
  if (!ctx.voiceId || !ctx.baseVideoUrl)
    throw new IpVideoError('请先完成 onboarding（克隆声音 + 出镜底版）', 'config');
  const text = input.copyText.trim();
  if (!text) throw new IpVideoError('文案为空', 'config');
  if (typeof svc.verifyFinalVideo !== 'function') {
    throw new IpVideoError('video quality verifier not configured', 'config');
  }
  if (typeof svc.verifyAudioVisualSync !== 'function') {
    throw new IpVideoError('audio-visual sync verifier not configured', 'config');
  }

  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const ws = cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {};
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};
  const ffprobeOpts = cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {};
  const aspect = resolveAspect(opts.aspectRatio ?? '9:16');
  // Preserve the authorized base video locally before TTS and provider polling.
  const baseVideoPath = path.join(svc.workdir, 'ip-base-reference.mp4');
  await fns.downloadToFile(ctx.baseVideoUrl, baseVideoPath, {
    maxBytes: 200 * 1024 * 1024,
  });
  const baseVideoDurationMs = await fns.ffprobeDurationMs(baseVideoPath, ffprobeOpts);
  if (baseVideoDurationMs < 2_000 || baseVideoDurationMs > 60_000) {
    throw new IpVideoError('本人出镜底版需为 2 到 60 秒的视频。', 'config');
  }
  const baseIntegrity = await fns.inspectMediaIntegrity(baseVideoPath, {
    ...ffOpts,
    ...ffprobeOpts,
  });
  if (!baseIntegrity.hasVideo || baseIntegrity.frozenRatio >= 0.98) {
    throw new IpVideoError(
      '本人出镜底版缺少可识别的人物运动。',
      'quality',
      ['source_motion_missing'],
      '出镜底版几乎全程静止，无法生成可信口型。',
    );
  }

  // ① 全文案 → 克隆音(用户 voice_id)。
  const synth = await fns.synthesizeSpeech({
    apiKey: cfg.dashscopeApiKey,
    baseUrl: cfg.dashscopeBaseUrl,
    ...ws,
    model: cfg.qwenTtsVcModel,
    voiceId: ctx.voiceId,
    text,
  });
  const audioDl = await fns.downloadToBuffer(synth.audioUrl);
  const audioLocal = path.join(svc.workdir, 'ip-voice.wav');
  await fns.writeFile(audioLocal, audioDl.buffer);
  const audioMs = await fns.ffprobeDurationMs(audioLocal, ffprobeOpts);
  if (audioMs > IP_MAX_AUDIO_MS) {
    throw new IpVideoError(
      `文案过长（约 ${Math.round(audioMs / 1000)} 秒，超过 40 秒），请截短文案或改用进阶档`,
      'too_long',
    );
  }
  // 克隆音存 R2 + presign,给 fal 当 audio_url。
  const audioStored = await svc.storeTemporaryAudio({
    filename: 'ip-voice.wav',
    mimetype: 'audio/wav',
    buffer: audioDl.buffer,
  });

  // ② 1 次 fal 换口型。底版短于口播时，使用对应模型的循环参数补足。
  const lip = await (async () => {
    try {
      const audioUrl = await svc.presignByFileId(audioStored.fileId);
      if (!audioUrl) {
        throw new IpVideoError('克隆音 presign 失败（需 STORAGE_PROVIDER=r2）', 'config');
      }
      return await fns.runLipSync({
        apiKey: cfg.falApiKey,
        baseUrl: cfg.falBaseUrl,
        model: cfg.falLipsyncModel,
        videoUrl: ctx.baseVideoUrl,
        audioUrl,
        extra: ipLipSyncExtra(cfg.falLipsyncModel),
        // Provider queue time grows with output length. Keep the existing
        // conservative ceiling so in-spec clips do not surface false timeouts.
        maxWaitMs: lipSyncMaxWaitMs(audioMs),
      });
    } finally {
      try {
        const deleted = await svc.deleteOutput(audioStored.fileId);
        if (!deleted) {
          svc.logger.warn(
            { fileId: audioStored.fileId },
            'video: temporary IP voice row was already absent',
          );
        }
      } catch (err) {
        svc.logger.warn(
          { err, fileId: audioStored.fileId },
          'video: failed to remove temporary IP voice file',
        );
      }
    }
  })();
  const lipLocal = path.join(svc.workdir, 'ip-lipsync.mp4');
  await fns.downloadToFile(lip.videoUrl, lipLocal, {
    maxBytes: 500 * 1024 * 1024,
  });

  // ③ 字幕(全文案按字数比例切逐句)+ compose(画幅 pad + 字幕 + 水印)。clip 自带克隆音轨。
  const cues = splitIpCues(text, audioMs);
  const timeline = buildTimeline(cues.segments, cues.durations);
  const assPath = path.join(svc.workdir, 'ip-subtitles.ass');
  await fns.writeFile(
    assPath,
    Buffer.from(
      buildAss(timeline, {
        ...(cfg.subtitleFontName ? { fontName: cfg.subtitleFontName } : {}),
        width: aspect.width,
        height: aspect.height,
      }),
      'utf-8',
    ),
  );
  const outPath = path.join(svc.workdir, 'ip-final.mp4');
  const cmd = buildComposeCommand(
    {
      segmentClipPaths: [lipLocal],
      outputPath: outPath,
      assPath,
      width: aspect.width,
      height: aspect.height,
      ...(cfg.watermarkFontFile ? { watermark: { fontFile: cfg.watermarkFontFile } } : {}),
    },
    ffOpts,
  );
  await fns.runFfmpeg(cmd, ffOpts);
  const finalDurationMs = await fns.ffprobeDurationMs(outPath, ffprobeOpts);
  const finalIntegrity = await fns.inspectMediaIntegrity(outPath, {
    ...ffOpts,
    ...ffprobeOpts,
  });
  const mediaFailures: string[] = [];
  if (!finalIntegrity.hasVideo) mediaFailures.push('output_video_missing');
  if (!finalIntegrity.hasAudio) {
    mediaFailures.push('output_audio_missing');
  } else if (finalIntegrity.audioMaxVolumeDb === null || finalIntegrity.audioMaxVolumeDb <= -50) {
    mediaFailures.push('output_audio_inaudible');
  }
  if (finalIntegrity.frozenRatio >= 0.95) mediaFailures.push('output_motion_missing');
  if (mediaFailures.length > 0) {
    throw new IpVideoError(
      'IP video failed deterministic media verification',
      'quality',
      mediaFailures,
      '成片缺少可确认的画面运动、口播声音或有效视频轨。',
    );
  }

  const verification = await svc.verifyFinalVideo({
    videoPath: outPath,
    workdir: svc.workdir,
    durationMs: finalDurationMs,
    minimumDurationMs: audioMs,
    userText: text,
    qualityContext:
      '抽样帧必须保持底版人物的身份、脸部结构、身体、服装和背景稳定，不得出现面部漂移、异常手部、额外肢体或身体融化。静态抽样只能发现可见嘴部异常，不能验证音频与口型同步。',
    referenceVideos: [
      {
        videoPath: baseVideoPath,
        durationMs: baseVideoDurationMs,
        label: '用户本人出镜底版',
      },
    ],
    expectedSubtitleText: cues.segments.map((segment) => segment.text),
    requiredBrandTexts: ['HOLA DAY · AI'],
    brandPolicy: '底版视频原有文字或品牌可以保留，但必须清晰稳定；字幕必须与文案逐字一致。',
    ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
  });
  if (verification.status !== 'pass') {
    svc.logger.warn(
      {
        status: verification.status,
        failedChecks: verification.failedChecks,
        reason: verification.reason,
      },
      'video: IP quality gate rejected generated artifact',
    );
    throw new IpVideoError(
      'IP video failed automated quality verification',
      verification.status === 'unknown' ? 'quality_unavailable' : 'quality',
      verification.failedChecks,
      verification.reason,
    );
  }
  const syncReview = await svc.verifyAudioVisualSync({
    videoPath: outPath,
    durationMs: finalDurationMs,
  });
  if (syncReview.status === 'fail') {
    svc.logger.warn(
      videoAvSyncLogContext(syncReview),
      'video: IP audio-visual sync review rejected generated artifact',
    );
    throw new IpVideoError(
      'IP video failed audio-visual sync verification',
      'quality',
      ['audiovisual_sync_mismatch'],
      '独立音画同步复核发现持续不同步。',
    );
  }
  const audiovisualSyncVerified = syncReview.status === 'pass';
  const audiovisualSyncReview = videoAvSyncAudit(syncReview);
  if (syncReview.status === 'unknown') {
    svc.logger.warn(
      videoAvSyncLogContext(syncReview),
      'video: IP audio-visual sync review was inconclusive',
    );
  }

  const stored = await svc.storeOutputFile({
    filename: 'video.mp4',
    mimetype: 'video/mp4',
    sourcePath: outPath,
  });
  // 首帧 poster（非致命）。storeOutput=storeOutputIp(真存)，poster 分支盖 posterUrl。
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
    { fileId: stored.fileId, audioMs, finalDurationMs },
    'video: IP single-clip lip-sync complete',
  );
  return {
    fileId: stored.fileId,
    downloadUrl: `/api/files/${stored.fileId}/download`,
    totalDurationMs: finalDurationMs,
    audiovisualSyncVerified,
    ...(audiovisualSyncReview ? { audiovisualSyncReview } : {}),
  };
}
