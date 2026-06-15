/**
 * 原方案 (simplified) video lane — "对话式 AI 辅助图文配音视频".
 *
 * Pipeline: 用户文案 → AI 优化 → Qwen 预设音色 TTS → AI 画面(图默认/视频可选)
 *           → 字幕 → FFmpeg 竖屏合成. NO lip-sync, NO clone, NO onboarding,
 * NO base video — needs ZERO user material, so it's independently acceptable.
 *
 * Reuses runVideoPipeline: every segment is a narrated visual ('broll'), so
 * the runner just calls generateBroll + renderBrollClip per segment (the
 * lip-sync branch is never hit). This lane supplies the per-step IO:
 *   - synth  = Qwen3-TTS preset voice (qwen3-tts-flash + 'Cherry'), no clone.
 *   - visual = image (wan-t2i n=1 + Ken Burns) by default; OR video (Wanxiang
 *              t2v default / Veo premium, user-opt-in 「更贵/更慢」).
 *   - clip   = Ken Burns (image) / loop-trim-to-audio (video).
 * Compose adds subtitles + watermark (compliance) + BGM, 1080×1920.
 *
 * Cost (BOSS-confirmed framing): image ~¥1-1.5 (default) · Wanxiang video ~¥8
 * (default video source) · Veo veo-3-fast 720p ~¥17 (high-quality tier, opt-in).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ffprobeDurationMs,
  renderImageKenBurns,
  renderVideoClip,
  runFfmpeg,
} from './ffmpeg-exec.js';
import { synthesizeSpeech } from './qwen-voice-clone-client.js';
import { generateVeoVideo } from './veo-client.js';
import { buildAss } from './timeline.js';
import { buildComposeCommand } from './video-compose.js';
import { downloadToBuffer } from './video-http.js';
import { runVideoPipeline, type PipelineLogger, type VideoPipelineDeps } from './video-pipeline.js';
import { optimizeUserScript, type LlmComplete } from './video-script.js';
import { generateBrollImage, generateBrollVideo } from './wanxiang-client.js';

// 画面整洁约束 (P1-2): AI 文生图/视频画产品包装/标签特写时必然编造乱码假字。
// 双管齐下 — 主要靠 optimizeUserScript 把画面引导成「场景/人物/氛围」(非产品标签特写),
// 这里的后缀+负向词是兜底:进一步压低任何残留文字出现的概率。
const CLEAN_SCENE_SUFFIX =
  '，画面整洁，纯场景/人物/氛围，不出现任何产品包装文字、标签、瓶身文字、招牌、屏幕文字、书本文字、字幕或水印，画面中不能有任何文字';
const NO_TEXT_NEGATIVE = [
  // 中文
  '文字, 文本, 字幕, 标题, 标签, 包装文字, 瓶身文字, 招牌, 招牌文字, 屏幕文字, 书本文字, 水印, 错乱的字, 乱码',
  // English
  'text, words, letters, label, labels, packaging text, signage, screen text, captions, subtitles, watermark, gibberish text, fake text, garbled text',
].join(', ');

export type VisualMode = 'image' | 'video';
export type VideoSource = 'wanxiang' | 'veo';

export type SimpleVideoErrorKind = 'config' | 'compose';
export class SimpleVideoError extends Error {
  constructor(
    message: string,
    readonly kind: SimpleVideoErrorKind,
  ) {
    super(message);
    this.name = 'SimpleVideoError';
  }
}

export interface SimpleVideoConfig {
  readonly dashscopeApiKey: string;
  readonly dashscopeBaseUrl: string;
  readonly dashscopeWorkspaceId?: string;
  /** Reused from the #5 image lane env (GEMINI_API_KEY) — only needed for Veo. */
  readonly geminiApiKey?: string;
  readonly geminiBaseUrl?: string;
  readonly qwenTtsModel: string; // qwen3-tts-flash
  readonly presetVoice: string; // 'Cherry'
  readonly wanxiangT2iModel: string; // wan2.2-t2i-flash
  readonly wanxiangT2vModel: string; // wan2.1-t2v-turbo
  /**
   * t2v output resolution `W*H`. Default vertical '720*1280' so the clip
   * fills the 1080×1920 frame (a landscape source would letterbox). 720P
   * tier on wan2.1-t2v-turbo.
   */
  readonly wanxiangVideoSize?: string;
  readonly veoModel: string; // veo-3.0-fast-generate-001
  /** Subtitle font family (fontconfig). Default in buildAss ('WenQuanYi Zen Hei', on Vultr). */
  readonly subtitleFontName?: string;
  /** Watermark drawtext fontfile (CJK-capable) for safe glyph rendering. */
  readonly watermarkFontFile?: string;
  readonly ffmpegBin?: string;
  readonly ffprobeBin?: string;
}

export interface SimpleVideoOptions {
  /**
   * Task-level (整条统一). Default 'video' (BOSS 2026-06-15: 图片版幻灯片感 +
   * AI 乱码拿不出手，默认要动态视频). 'image' is the low-cost opt-in.
   */
  readonly visualMode?: VisualMode;
  /** When visualMode='video'. Default 'wanxiang' (~¥8); 'veo' = high-quality tier (~¥17). */
  readonly videoSource?: VideoSource;
  /** Veo clip length seconds (number). Default 4. */
  readonly veoDurationSeconds?: number;
}

interface SimpleFns {
  synthesizeSpeech: typeof synthesizeSpeech;
  generateBrollImage: typeof generateBrollImage;
  generateBrollVideo: typeof generateBrollVideo;
  generateVeoVideo: typeof generateVeoVideo;
  downloadToBuffer: typeof downloadToBuffer;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  renderImageKenBurns: typeof renderImageKenBurns;
  renderVideoClip: typeof renderVideoClip;
  runFfmpeg: typeof runFfmpeg;
  optimizeUserScript: typeof optimizeUserScript;
  writeFile: (p: string, b: Buffer) => Promise<void>;
  readFile: (p: string) => Promise<Buffer>;
}

export interface SimpleVideoServices {
  storeOutput(input: { filename: string; mimetype: string; buffer: Buffer }): Promise<{
    fileId: string;
    storagePath: string;
  }>;
  workdir: string;
  logger: PipelineLogger;
  llm: LlmComplete;
  overrides?: Partial<SimpleFns>;
}

function realFns(): SimpleFns {
  return {
    synthesizeSpeech,
    generateBrollImage,
    generateBrollVideo,
    generateVeoVideo,
    downloadToBuffer,
    ffprobeDurationMs,
    renderImageKenBurns,
    renderVideoClip,
    runFfmpeg,
    optimizeUserScript,
    writeFile: (p, b) => fs.writeFile(p, b),
    readFile: (p) => fs.readFile(p),
  };
}

export function createSimplePipelineDeps(
  cfg: SimpleVideoConfig,
  opts: SimpleVideoOptions,
  svc: SimpleVideoServices,
): VideoPipelineDeps {
  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const ws = cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {};
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};
  const visualMode = opts.visualMode ?? 'video';
  const videoSource = opts.videoSource ?? 'wanxiang';

  return {
    logger: svc.logger,

    async synthesizeSegmentAudio({ index, text }) {
      // Qwen3-TTS PRESET voice (no clone): pass the preset voice name as `voiceId`.
      const synth = await fns.synthesizeSpeech({
        apiKey: cfg.dashscopeApiKey,
        baseUrl: cfg.dashscopeBaseUrl,
        ...ws,
        model: cfg.qwenTtsModel,
        voiceId: cfg.presetVoice,
        text,
      });
      const dl = await fns.downloadToBuffer(synth.audioUrl);
      await svc.storeOutput({ filename: `seg${index}-audio.wav`, mimetype: 'audio/wav', buffer: dl.buffer });
      const localPath = path.join(svc.workdir, `seg${index}-audio.wav`);
      await fns.writeFile(localPath, dl.buffer);
      const durationMs = await fns.ffprobeDurationMs(
        localPath,
        cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {},
      );
      return { audioRef: localPath, durationMs };
    },

    async generateBroll({ index, visual }) {
      if (visualMode === 'image') {
        const r = await fns.generateBrollImage({
          apiKey: cfg.dashscopeApiKey,
          baseUrl: cfg.dashscopeBaseUrl,
          ...ws,
          model: cfg.wanxiangT2iModel,
          prompt: visual + CLEAN_SCENE_SUFFIX,
          negativePrompt: NO_TEXT_NEGATIVE,
          n: 1,
        });
        const url = r.imageUrls[0];
        if (!url) throw new SimpleVideoError(`broll image seg ${index} produced no url`, 'compose');
        const dl = await fns.downloadToBuffer(url);
        await svc.storeOutput({ filename: `seg${index}-img.png`, mimetype: 'image/png', buffer: dl.buffer });
        const localPath = path.join(svc.workdir, `seg${index}-img.png`);
        await fns.writeFile(localPath, dl.buffer);
        return { visualRef: localPath };
      }
      // video visual
      let url: string;
      let headers: Record<string, string> | undefined;
      if (videoSource === 'veo') {
        const v = await fns.generateVeoVideo({
          apiKey: cfg.geminiApiKey ?? '',
          ...(cfg.geminiBaseUrl ? { baseUrl: cfg.geminiBaseUrl } : {}),
          model: cfg.veoModel,
          prompt: visual + CLEAN_SCENE_SUFFIX,
          aspectRatio: '9:16',
          durationSeconds: opts.veoDurationSeconds ?? 4,
        });
        url = v.videoUri;
        headers = { 'x-goog-api-key': cfg.geminiApiKey ?? '' }; // Veo uri needs the key
      } else {
        const v = await fns.generateBrollVideo({
          apiKey: cfg.dashscopeApiKey,
          baseUrl: cfg.dashscopeBaseUrl,
          ...ws,
          model: cfg.wanxiangT2vModel,
          prompt: visual + CLEAN_SCENE_SUFFIX,
          negativePrompt: NO_TEXT_NEGATIVE,
          size: cfg.wanxiangVideoSize ?? '720*1280', // vertical → fills 竖屏 frame
        });
        if (!v.videoUrl) throw new SimpleVideoError(`broll video seg ${index} produced no url`, 'compose');
        url = v.videoUrl;
      }
      const dl = await fns.downloadToBuffer(url, headers ? { headers } : {});
      await svc.storeOutput({ filename: `seg${index}-vid.mp4`, mimetype: 'video/mp4', buffer: dl.buffer });
      const localPath = path.join(svc.workdir, `seg${index}-vid.mp4`);
      await fns.writeFile(localPath, dl.buffer);
      return { visualRef: localPath };
    },

    async renderBrollClip({ index, visualRef, audioRef, durationMs }) {
      const outPath = path.join(svc.workdir, `seg${index}-clip.mp4`);
      if (visualMode === 'image') {
        await fns.renderImageKenBurns({ imagePath: visualRef, audioPath: audioRef, outPath, durationMs }, ffOpts);
      } else {
        await fns.renderVideoClip({ videoPath: visualRef, audioPath: audioRef, outPath, durationMs }, ffOpts);
      }
      return { clipRef: outPath };
    },

    // The simplified pipeline never produces 'voiceover' segments → never called.
    async lipSyncSegment() {
      throw new SimpleVideoError('simplified pipeline has no lip-sync segments', 'compose');
    },
  };
}

export interface RunSimpleVideoInput {
  /** The user's draft copy. */
  readonly userText: string;
  readonly maxSegments?: number;
  readonly retries?: number;
}

export interface SimpleVideoResult {
  readonly fileId: string;
  readonly downloadUrl: string;
  readonly totalDurationMs: number;
  readonly segments: number;
  readonly visualMode: VisualMode;
}

/**
 * Full simplified lane: ① optimize user script → ②-⑤ runner → ⑥ compose →
 * persist. Needs NO user material. Background-coroutine friendly.
 */
export async function runSimpleVideoCreation(
  input: RunSimpleVideoInput,
  cfg: SimpleVideoConfig,
  opts: SimpleVideoOptions,
  svc: SimpleVideoServices,
): Promise<SimpleVideoResult> {
  if (!cfg.dashscopeApiKey) throw new SimpleVideoError('DASHSCOPE_API_KEY not configured', 'config');
  const visualMode = opts.visualMode ?? 'video';
  if (visualMode === 'video' && (opts.videoSource ?? 'wanxiang') === 'veo' && !cfg.geminiApiKey) {
    throw new SimpleVideoError('Veo selected but GEMINI_API_KEY not configured', 'config');
  }
  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};

  // ① optimize the user's draft (faithful, no fabrication)
  const script = await fns.optimizeUserScript(
    { userText: input.userText, ...(input.maxSegments !== undefined ? { maxSegments: input.maxSegments } : {}) },
    { llm: svc.llm },
  );
  // ②-⑤ runner (synth preset voice + visual + clip per segment)
  const deps = createSimplePipelineDeps(cfg, opts, svc);
  const result = await runVideoPipeline(
    { script, ...(input.retries !== undefined ? { retries: input.retries } : {}) },
    deps,
  );
  // ⑤ subtitle file — styled ASS (CJK font + safe margins + auto-wrap, fixes overflow P0-1)
  const assPath = path.join(svc.workdir, 'subtitles.ass');
  await fns.writeFile(
    assPath,
    Buffer.from(buildAss(result.timeline, cfg.subtitleFontName ? { fontName: cfg.subtitleFontName } : {}), 'utf-8'),
  );
  // ⑥ compose — ASS subtitles + English watermark (+ optional CJK fontfile), 1080×1920
  const outPath = path.join(svc.workdir, 'final.mp4');
  const cmd = buildComposeCommand(
    {
      segmentClipPaths: result.segments.map((s) => s.clipRef),
      outputPath: outPath,
      assPath,
      ...(cfg.watermarkFontFile ? { watermark: { fontFile: cfg.watermarkFontFile } } : {}),
    },
    ffOpts,
  );
  await fns.runFfmpeg(cmd, ffOpts);
  const finalBuffer = await fns.readFile(outPath);
  const stored = await svc.storeOutput({ filename: 'video.mp4', mimetype: 'video/mp4', buffer: finalBuffer });
  svc.logger.info(
    { fileId: stored.fileId, segments: result.segments.length, visualMode, totalDurationMs: result.timeline.totalDurationMs },
    'video: simplified creation complete',
  );
  return {
    fileId: stored.fileId,
    downloadUrl: `/api/files/${stored.fileId}/download`,
    totalDurationMs: result.timeline.totalDurationMs,
    segments: result.segments.length,
    visualMode,
  };
}
