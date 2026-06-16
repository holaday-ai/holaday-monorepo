/**
 * 原方案 (simplified) video lane — "对话式 AI 辅助图文配音视频".
 *
 * Pipeline: 用户文案 → AI 优化 → Qwen Cherry 预设音色 TTS → AI 画面 → 字幕 →
 *           FFmpeg 竖屏合成. NO lip-sync, NO clone, NO onboarding, NO base video —
 *           needs ZERO user material, so it's independently acceptable.
 *
 * Visual sources (BOSS 2026-06-15):
 *   - video (DEFAULT) = Veo 3.1 Fast, 8s · 1080p · 9:16 (~¥7/条, 解剖稳).
 *     'veo_lite' 省钱档 / 'veo_standard' 高质量可选 / 'wanxiang' 便宜兜底.
 *   - image = nano banana (gemini-3.1-flash-image), STATIC (无 Ken Burns), 低成本可选.
 *
 * Audio: Veo on the Gemini Developer API ALWAYS renders an audio track — it
 *   can't be disabled (`generateAudio:false` → 400) and there's no audio-off
 *   price tier. We DISCARD that track and dub with Qwen Cherry, so the Veo
 *   audio is paid-for but unused. Don't try to turn it off.
 *
 * Anatomy: every visual prompt carries explicit anatomy constraints (single
 *   subject / arms traceable to shoulders / five fingers / no extra limbs /
 *   avoid hand-object-hand stacked framing) — AI t2v/t2i otherwise grows extra
 *   arms (observed on BOTH Veo Lite and nano banana). Veo & nano banana have no
 *   separate negative-prompt field, so the constraint lives in the prompt text;
 *   wanxiang t2v additionally takes NO_TEXT_NEGATIVE.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateImages } from '../image/gemini-image-client.js';
import { ffprobeDurationMs, renderImageClip, renderVideoClip, runFfmpeg } from './ffmpeg-exec.js';
import { synthesizeSpeech } from './qwen-voice-clone-client.js';
import { generateVeoVideo } from './veo-client.js';
import { buildAss } from './timeline.js';
import { buildComposeCommand } from './video-compose.js';
import { downloadToBuffer } from './video-http.js';
import { runVideoPipeline, type PipelineLogger, type VideoPipelineDeps } from './video-pipeline.js';
import { optimizeUserScript, type LlmComplete, type VideoStyle } from './video-script.js';
import type { VideoScript } from './types.js';
import { generateBrollVideo } from './wanxiang-client.js';

// 收窄(范围2,BOSS 松绑):不再全禁"任何文字"(那是过度一刀切,也拖累画面-文案关联)。
// 只阻止 AI 把【含文字的物体】画成主体/特写(瓶身标签/招牌/屏幕…AI 会编乱码假字);
// 想要的文字(字幕/信息点字卡)由合成层 ASS 字体叠加,不经 AI、永不乱码。环境远景文字不强禁。
// 解剖约束保留:画「手-物-手竖直叠帧」会长出多余手臂(Veo Lite / nano banana 都吐过)。
const CLEAN_SCENE_SUFFIX =
  '，画面整洁，纯场景/人物/氛围；' +
  '单人出镜，双臂可追溯到肩膀，五指完整、手部解剖正确，' +
  '不出现多余肢体、断肢或悬空小臂，避开手-物-手竖直叠帧这类高解剖风险构图；' +
  '不要把产品包装、瓶身标签、招牌、屏幕、书本等含文字物体作为画面主体或特写（AI 会在上面编造乱码假字）';
const NO_TEXT_NEGATIVE = [
  // 中文 — 只压 AI 会编乱码的产品文字载体 + 乱码本身(不再全禁通用文字)
  '瓶身文字, 包装文字, 标签文字, 招牌文字, 屏幕文字, 书本文字, 错乱的字, 乱码假字',
  // 中文 — 解剖
  '多余手臂, 多手, 多臂, 第三只手, 畸形手, 多指, 断肢, 悬空手臂, 解剖错误',
  // English
  'garbled text, fake text, gibberish text, packaging label text, signage text, deformed text,' +
    ' extra arm, extra hand, third arm, deformed hands, extra fingers, floating limb, anatomical error',
].join(', ');

export type VisualMode = 'image' | 'video';
/**
 * Video visual source tiers (BOSS 2026-06-15: 万相手部畸形 → Veo;Lite 解剖不稳
 * → 默认 Fast):
 *   'veo_fast'     — Veo 3.1 Fast, DEFAULT (8s/1080p ≈ ¥7/条, 解剖稳).
 *   'veo_lite'     — Veo 3.1 Lite, 省钱档 (≈ ¥4.6/条, 解剖偶失,一字可改).
 *   'veo_standard' — Veo 3.1 Standard, 高质量可选 (≈ ¥23/条).
 *   'wanxiang'     — wan2.1-t2v-turbo, 便宜兜底 (Veo 降级时).
 */
export type VideoSource = 'veo_fast' | 'veo_lite' | 'veo_standard' | 'happyhorse' | 'wanxiang';

const VEO_MODEL_DEFAULT: Record<'veo_fast' | 'veo_lite' | 'veo_standard', string> = {
  veo_fast: 'veo-3.1-fast-generate-preview',
  veo_lite: 'veo-3.1-lite-generate-preview',
  veo_standard: 'veo-3.1-generate-preview',
};
const DEFAULT_HAPPYHORSE_MODEL = 'happyhorse-1.0-t2v';
const isVeoSource = (s: VideoSource): boolean =>
  s === 'veo_fast' || s === 'veo_lite' || s === 'veo_standard';

/** 三档画幅 (Phase 2 第一期). Veo 仅支持 9:16/16:9 → 1:1 用 9:16 出, compose pad 到方形. */
export type AspectRatio = '9:16' | '16:9' | '1:1';
export function resolveAspect(ar: AspectRatio): {
  width: number;
  height: number;
  veoAspect: '9:16' | '16:9';
  hhSize: string;
} {
  switch (ar) {
    case '16:9':
      return { width: 1920, height: 1080, veoAspect: '16:9', hhSize: '1920*1080' };
    case '1:1':
      return { width: 1080, height: 1080, veoAspect: '9:16', hhSize: '1080*1080' };
    default: // 9:16 竖屏
      return { width: 1080, height: 1920, veoAspect: '9:16', hhSize: '1080*1920' };
  }
}

function resolveVeoModel(source: VideoSource, cfg: SimpleVideoConfig): string {
  switch (source) {
    case 'veo_lite':
      return cfg.veoLiteModel ?? VEO_MODEL_DEFAULT.veo_lite;
    case 'veo_standard':
      return cfg.veoStandardModel ?? VEO_MODEL_DEFAULT.veo_standard;
    default: // veo_fast
      return cfg.veoFastModel ?? VEO_MODEL_DEFAULT.veo_fast;
  }
}

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
  /** Shared Google key (same one as #5 nano banana) — Veo video AND nano banana image. */
  readonly geminiApiKey?: string;
  readonly geminiBaseUrl?: string;
  readonly qwenTtsModel: string; // qwen3-tts-flash
  readonly presetVoice: string; // 'Cherry'
  /** Image source = nano banana. Default 'gemini-3.1-flash-image'. */
  readonly geminiImageModel?: string;
  readonly wanxiangT2vModel: string; // wan2.1-t2v-turbo (兜底)
  /** t2v 竖屏 size `W*H`. Default '720*1280' (fills 1080×1920, no letterbox). */
  readonly wanxiangVideoSize?: string;
  /** HappyHorse t2v model (阿里 DashScope, 同 key 同端点). Default 'happyhorse-1.0-t2v'. */
  readonly happyhorseModel?: string;
  /** i2v 图生视频 model ids (Phase 2 第二期 宠物视频, 同 DashScope video-synthesis 端点). */
  readonly wanI2vModel?: string; // 默认 wan2.2-i2v-flash
  readonly happyhorseI2vModel?: string; // 默认 happyhorse-1.0-i2v(intl 区可达性灰度前核)
  /** Veo model id per tier — each optional → built-in default. */
  readonly veoFastModel?: string;
  readonly veoLiteModel?: string;
  readonly veoStandardModel?: string;
  /** Subtitle font family (fontconfig). Default in buildAss ('WenQuanYi Zen Hei', on Vultr). */
  readonly subtitleFontName?: string;
  /** Watermark drawtext fontfile (CJK-capable) for safe glyph rendering. */
  readonly watermarkFontFile?: string;
  readonly ffmpegBin?: string;
  readonly ffprobeBin?: string;
}

export interface SimpleVideoOptions {
  /** Task-level (整条统一). Default 'video' (动态视频); 'image' = nano banana 静态低成本可选. */
  readonly visualMode?: VisualMode;
  /** When visualMode='video'. Default 'veo_fast'. */
  readonly videoSource?: VideoSource;
  /** Veo clip length seconds. Default 8 (Veo 3.1 native length). */
  readonly veoDurationSeconds?: number;
  /** Veo output resolution. Default '1080p'. */
  readonly veoResolution?: '720p' | '1080p';
  /** 画幅 (Phase 2 第一期). Default '9:16' 竖屏. Drives compose/clip W×H + Veo aspectRatio. */
  readonly aspectRatio?: AspectRatio;
}

interface SimpleFns {
  synthesizeSpeech: typeof synthesizeSpeech;
  generateImages: typeof generateImages; // nano banana (image source)
  generateBrollVideo: typeof generateBrollVideo; // wanxiang t2v (fallback)
  generateVeoVideo: typeof generateVeoVideo;
  downloadToBuffer: typeof downloadToBuffer;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  renderImageClip: typeof renderImageClip; // STATIC (no Ken Burns)
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
    generateImages,
    generateBrollVideo,
    generateVeoVideo,
    downloadToBuffer,
    ffprobeDurationMs,
    renderImageClip,
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
  const videoSource = opts.videoSource ?? 'veo_fast';
  const aspect = resolveAspect(opts.aspectRatio ?? '9:16');
  const aspectLabel = opts.aspectRatio === '16:9' ? '横屏 16:9' : opts.aspectRatio === '1:1' ? '方形 1:1' : '竖屏 9:16';

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
        // 图源 = nano banana (gemini image). 无独立 negative/aspectRatio →
        // 无文字+解剖+竖屏约束并进 prompt 文本。返回 buffer 直接用(非 URL)。
        const img = await fns.generateImages({
          apiKey: cfg.geminiApiKey ?? '',
          ...(cfg.geminiBaseUrl ? { baseUrl: cfg.geminiBaseUrl } : {}),
          model: cfg.geminiImageModel ?? 'gemini-3.1-flash-image',
          prompt: `${visual}${CLEAN_SCENE_SUFFIX}，${aspectLabel} 构图`,
        });
        const first = img.images[0];
        if (!first) throw new SimpleVideoError(`nano banana seg ${index} produced no image`, 'compose');
        await svc.storeOutput({ filename: `seg${index}-img.png`, mimetype: first.mimeType, buffer: first.buffer });
        const localPath = path.join(svc.workdir, `seg${index}-img.png`);
        await fns.writeFile(localPath, first.buffer);
        return { visualRef: localPath };
      }
      // video visual
      let url: string;
      let headers: Record<string, string> | undefined;
      if (isVeoSource(videoSource)) {
        // Veo (default veo_fast). NOTE: the Gemini Developer API ALWAYS renders
        // an audio track — it can't be disabled (generateAudio:false → 400) and
        // there's no audio-off price tier. We discard it and dub with Qwen Cherry.
        const v = await fns.generateVeoVideo({
          apiKey: cfg.geminiApiKey ?? '',
          ...(cfg.geminiBaseUrl ? { baseUrl: cfg.geminiBaseUrl } : {}),
          model: resolveVeoModel(videoSource, cfg),
          prompt: visual + CLEAN_SCENE_SUFFIX,
          aspectRatio: aspect.veoAspect, // 1:1 时用 9:16 出, compose pad 到方形
          durationSeconds: opts.veoDurationSeconds ?? 8,
          resolution: opts.veoResolution ?? '1080p',
        });
        url = v.videoUri;
        headers = { 'x-goog-api-key': cfg.geminiApiKey ?? '' }; // Veo uri needs the key
      } else {
        // wanxiang / happyhorse t2v — 同 DashScope video-synthesis 端点, 改 model + size.
        const isHH = videoSource === 'happyhorse';
        const v = await fns.generateBrollVideo({
          apiKey: cfg.dashscopeApiKey,
          baseUrl: cfg.dashscopeBaseUrl,
          ...ws,
          model: isHH ? (cfg.happyhorseModel ?? DEFAULT_HAPPYHORSE_MODEL) : cfg.wanxiangT2vModel,
          prompt: visual + CLEAN_SCENE_SUFFIX,
          negativePrompt: NO_TEXT_NEGATIVE,
          // HappyHorse 1080P 按画幅; wanxiang 兜底保持 720 竖屏(第一期不做多尺寸).
          size: isHH ? aspect.hhSize : (cfg.wanxiangVideoSize ?? '720*1280'),
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
        // 静态图(无 Ken Burns 运镜)— BOSS 2026-06-15.
        await fns.renderImageClip({ imagePath: visualRef, audioPath: audioRef, outPath, durationMs, width: aspect.width, height: aspect.height }, ffOpts);
      } else {
        await fns.renderVideoClip({ videoPath: visualRef, audioPath: audioRef, outPath, durationMs, width: aspect.width, height: aspect.height }, ffOpts);
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
  /**
   * Pre-optimized script (from the Phase-1 price-quote step). When provided,
   * optimize is SKIPPED so the generated segment count exactly matches the
   * quoted/charged segment count. Omit for the standalone (no-quote) path.
   */
  readonly script?: VideoScript;
  /** Picture style (Phase 2). Passed to optimizeUserScript; ignored when `script` is supplied. */
  readonly style?: VideoStyle;
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
  const videoSource = opts.videoSource ?? 'veo_fast';
  const aspect = resolveAspect(opts.aspectRatio ?? '9:16');
  // Veo (any tier) AND nano banana image both run on the shared Google key.
  const needsGemini = visualMode === 'image' || (visualMode === 'video' && isVeoSource(videoSource));
  if (needsGemini && !cfg.geminiApiKey) {
    throw new SimpleVideoError('Veo/nano banana selected but GEMINI_API_KEY not configured', 'config');
  }
  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};

  // ① optimize the user's draft (faithful, no fabrication) — UNLESS a
  // pre-optimized script is supplied (Phase-1 quote), in which case reuse it
  // verbatim so generated segments == quoted segments.
  const script =
    input.script ??
    (await fns.optimizeUserScript(
      {
        userText: input.userText,
        ...(input.maxSegments !== undefined ? { maxSegments: input.maxSegments } : {}),
        ...(input.style ? { style: input.style } : {}),
      },
      { llm: svc.llm },
    ));
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
    Buffer.from(
      buildAss(result.timeline, {
        ...(cfg.subtitleFontName ? { fontName: cfg.subtitleFontName } : {}),
        width: aspect.width, // PlayRes 跟随画幅, 字幕边距按真实像素
        height: aspect.height,
      }),
      'utf-8',
    ),
  );
  // ⑥ compose — ASS subtitles + English watermark (+ optional CJK fontfile), W×H 按画幅
  const outPath = path.join(svc.workdir, 'final.mp4');
  const cmd = buildComposeCommand(
    {
      segmentClipPaths: result.segments.map((s) => s.clipRef),
      outputPath: outPath,
      assPath,
      width: aspect.width,
      height: aspect.height,
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
