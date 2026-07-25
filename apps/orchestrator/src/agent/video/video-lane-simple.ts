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
 * Anatomy: visual prompts use the original user request to decide whether
 *   people/hands belong in the scene. Object-only scenes explicitly exclude
 *   unrequested body parts; human scenes carry strict anatomy constraints.
 *   Veo and DashScope video providers also receive a matching negative prompt.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { videoParameterIssue } from '@holaday/shared-types';
import { generateImages } from '../image/gemini-image-client.js';
import { ffprobeDurationMs, renderImageClip, renderVideoClip, runFfmpeg } from './ffmpeg-exec.js';
import { synthesizeSpeech } from './qwen-voice-clone-client.js';
import { buildAss } from './timeline.js';
import type { VideoScript } from './types.js';
import { generateVeoVideo } from './veo-client.js';
import { buildComposeCommand } from './video-compose.js';
import { downloadToBuffer, downloadToFile } from './video-http.js';
import { type PipelineLogger, type VideoPipelineDeps, runVideoPipeline } from './video-pipeline.js';
import { generatePosterFile } from './video-poster.js';
import type { VerifyFinalVideoQualityInput, VideoQualityResult } from './video-quality-verifier.js';
import { type LlmComplete, type VideoStyle, optimizeUserScript } from './video-script.js';
import { generateBrollVideo } from './wanxiang-client.js';

// 文字与品牌不做一刀切。用户未要求时不让模型擅自添加；用户明确要求时保留，
// 并要求逐字准确。字幕仍由合成层 ASS 叠加，生成画面里的其它文字由终态质检复核。
// 解剖约束保留:画「手-物-手竖直叠帧」会长出多余手臂(Veo Lite / nano banana 都吐过)。
const COMMON_SCENE_SUFFIX =
  '，画面整洁；' +
  '用户未要求时不要凭空添加文字、品牌或 Logo；' +
  '若需求包含文字、品牌、包装、标牌或屏幕内容，必须逐字准确、清晰可读，不得替换、增删或拼错';
const HUMAN_SCENE_SUFFIX =
  '；若人物出镜，双臂必须可追溯到肩膀，手部解剖正确并符合当前姿势与自然遮挡关系；' +
  '可见手指的边界、指根和关节方向必须自然，抓握时允许被物体合理遮挡，' +
  '不得出现少指、手指粘连、融合手、多余手臂、多余肢体、多指、断肢、悬空小臂或不可能的关节，' +
  '避开手-物-手竖直叠帧这类高解剖风险构图';
const REQUIRED_HAND_SCENE_SUFFIX =
  '；在不违背用户指定构图的前提下，必要手部动作优先采用单手、手腕与前臂连续、' +
  '三分之四侧面或侧面构图，让可见手指轮廓与物体边界自然可辨，避免手指和杯柄或物体边缘完全重叠融合';
const OBJECT_ONLY_SCENE_SUFFIX =
  '；这是纯物体/环境镜头，不得出现人物、手、手臂或身体部位，' +
  '不要新增拿起、触碰或操作主体的动作，只保留用户指定的主体、环境和运动';
const AVOID_UNREQUESTED_HAND_SUFFIX =
  '；未明确要求人物或手部时，优先通过主体运动、镜头运动或环境变化表达，不要主动加入手或手臂';
const BASE_NEGATIVE = [
  // 中文 — 只压错误文字，不禁止用户明确要求的文字载体或品牌。
  '错别字, 错误品牌, 错误 Logo, 错乱的字, 乱码假字, 不可读文字',
  // 中文 — 解剖
  '融合手, 手指粘连, 少指, 多余手臂, 多手, 多臂, 第三只手, 畸形手, 多指, 断肢, 悬空手臂, 解剖错误',
  // English
  'garbled text, fake text, gibberish text, misspelled text, unreadable text, incorrect logo, malformed logo,' +
    ' fused hands, fused fingers, missing fingers, extra arm, extra hand, third arm, deformed hands, extra fingers, floating limb, anatomical error',
].join(', ');
const OBJECT_ONLY_NEGATIVE = `${BASE_NEGATIVE}, person, people, human, face, hand, hands, arm, arms, body parts, holding object, touching object, picking up object`;

type HumanPresencePolicy = 'explicit-human' | 'object-only' | 'conditional';

const HUMAN_INTENT_RE =
  /(?:人物|人像|真人|人类|男人|女人|男性|女性|男士|女士|男孩|女孩|儿童|孩子|老人|模特|演员|主持人|主播|手部|双手|左手|右手|手臂|拿起|端起|握住|触碰|操作|person|people|human|man|woman|boy|girl|child|model|actor|presenter|host|hand|hands|arm|arms|hold|holding|touch|pick(?:ing)? up)/iu;
const HAND_INTENT_RE =
  /(?:手部|双手|左手|右手|手臂|拿起|端起|握住|触碰|操作|hand|hands|arm|arms|hold|holding|touch|grab|pick(?:ing)? up)/iu;
const NO_HUMAN_INTENT_RE =
  /(?:无人物|无人出镜|不要人物|不出现人物|不出现人手|不要人手|不要手|无手部|no people|without people|no hands|without hands)/iu;
const OBJECT_ONLY_INTENT_RE =
  /(?:静物|物体|产品|商品|杯|瓶|桌面|器皿|家具|食物|饮料|风景|景观|建筑|车辆|动物|宠物|固定镜头|无人物|无人|不出现人物|不出现人手|object|product|still life|landscape|building|vehicle|animal|pet|locked camera|no people|without people)/iu;

function humanPresencePolicy(userText: string): HumanPresencePolicy {
  if (NO_HUMAN_INTENT_RE.test(userText)) return 'object-only';
  if (HUMAN_INTENT_RE.test(userText)) return 'explicit-human';
  if (OBJECT_ONLY_INTENT_RE.test(userText)) return 'object-only';
  return 'conditional';
}

function scenePromptPolicy(userText: string): {
  suffix: string;
  negativePrompt: string;
  presencePolicy: HumanPresencePolicy;
  handRequired: boolean;
} {
  const policy = humanPresencePolicy(userText);
  if (policy === 'object-only') {
    return {
      suffix: COMMON_SCENE_SUFFIX + OBJECT_ONLY_SCENE_SUFFIX,
      negativePrompt: OBJECT_ONLY_NEGATIVE,
      presencePolicy: policy,
      handRequired: false,
    };
  }
  if (policy === 'conditional') {
    return {
      suffix: COMMON_SCENE_SUFFIX + AVOID_UNREQUESTED_HAND_SUFFIX + HUMAN_SCENE_SUFFIX,
      negativePrompt: BASE_NEGATIVE,
      presencePolicy: policy,
      handRequired: false,
    };
  }
  return {
    suffix:
      COMMON_SCENE_SUFFIX +
      HUMAN_SCENE_SUFFIX +
      (HAND_INTENT_RE.test(userText) ? REQUIRED_HAND_SCENE_SUFFIX : ''),
    negativePrompt: BASE_NEGATIVE,
    presencePolicy: policy,
    handRequired: HAND_INTENT_RE.test(userText),
  };
}

function motionCompletionInstruction(durationSeconds: number): string {
  const finalHoldSeconds =
    durationSeconds >= 4 ? 1 : Math.min(1, Math.max(0.5, durationSeconds * 0.15));
  const finishBySeconds = Math.max(0.5, durationSeconds - finalHoldSeconds);
  return `；若需求包含连续动作，必须在 ${durationSeconds} 秒内按顺序完整执行所有动作：开头迅速建立初始状态，中段完成核心动作，最晚在第 ${finishBySeconds.toFixed(1)} 秒前完成放回、离开等收尾；结尾应清楚呈现完成状态，最后至少 ${finalHoldSeconds.toFixed(0)} 秒展示动作完成后的稳定终态，不得在动作途中结束或省略收尾；镜头语言、节奏和构图在满足动作顺序与终态的前提下可自由发挥`;
}

function qualityRepairInstruction(
  quality: VideoQualityResult,
  durationSeconds: number,
  scenePolicy: ReturnType<typeof scenePromptPolicy>,
): string {
  const diagnostic = `${quality.failedChecks.join(' ')} ${quality.reason}`;
  const hasAnatomyIssue = /(?:hand|finger|arm|limb|anatom|手|指|臂|肢)/iu.test(diagnostic);
  let anatomyRepair = '';
  if (hasAnatomyIssue && scenePolicy.handRequired) {
    anatomyRepair =
      '；手部修复要求：只保留用户要求的手和手臂，手掌与手臂连续自然，保持符合动作的自然抓握和合理遮挡；' +
      '可见手指的边界、指根和关节方向必须自然，杯柄或物体不得与手指融为一体，不得融合、缺失、增生或扭曲';
  } else if (hasAnatomyIssue && scenePolicy.presencePolicy === 'object-only') {
    anatomyRepair = '；上一版出现了非必要手部，必须移除所有手和手臂，改用主体或镜头运动完成表达';
  } else if (hasAnatomyIssue) {
    anatomyRepair = '；上一版出现了非必要手部，改为不露手构图，不要让手或手臂进入画面';
  }

  return `；质量修复重试：上一版未通过检查（${quality.reason}）。必须修正该问题，同时保持主体、动作、颜色、文字、构图和镜头要求不变${anatomyRepair}；动作修复要求：必须在 ${durationSeconds} 秒内按用户原始顺序完整执行全部动作，最后至少 1 秒展示动作完成后的稳定终态`;
}

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

/** 多画幅. Veo 仅支持 9:16/16:9 → 方形/4:3/3:4 用最接近源比例生成, compose pad 到目标画幅. */
export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
export function resolveAspect(ar: AspectRatio): {
  width: number;
  height: number;
  veoAspect: '9:16' | '16:9';
  hhSize: string;
} {
  switch (ar) {
    case '16:9':
      return { width: 1920, height: 1080, veoAspect: '16:9', hhSize: '1920*1080' };
    case '4:3':
      return { width: 1440, height: 1080, veoAspect: '16:9', hhSize: '1440*1080' };
    case '1:1':
      return { width: 1080, height: 1080, veoAspect: '9:16', hhSize: '1080*1080' };
    case '3:4':
      return { width: 1080, height: 1440, veoAspect: '9:16', hhSize: '1080*1440' };
    default: // 9:16 竖屏
      return { width: 1080, height: 1920, veoAspect: '9:16', hhSize: '1080*1920' };
  }
}

function aspectCopy(ar: AspectRatio | undefined): string {
  switch (ar) {
    case '16:9':
      return '横屏 16:9';
    case '4:3':
      return '横屏 4:3';
    case '1:1':
      return '方形 1:1';
    case '3:4':
      return '竖屏 3:4';
    default:
      return '竖屏 9:16';
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

export type SimpleVideoErrorKind =
  | 'config'
  | 'compose'
  | 'invalid_options'
  | 'quality'
  | 'quality_unavailable';
export class SimpleVideoError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly kind: SimpleVideoErrorKind,
    retryable = kind !== 'quality' && kind !== 'quality_unavailable',
  ) {
    super(message);
    this.name = 'SimpleVideoError';
    this.retryable = retryable;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  downloadToFile: typeof downloadToFile;
  ffprobeDurationMs: typeof ffprobeDurationMs;
  renderImageClip: typeof renderImageClip; // STATIC (no Ken Burns)
  renderVideoClip: typeof renderVideoClip;
  runFfmpeg: typeof runFfmpeg;
  optimizeUserScript: typeof optimizeUserScript;
  writeFile: (p: string, b: Buffer) => Promise<void>;
  readFile: (p: string) => Promise<Buffer>;
  removeFile: (p: string) => Promise<void>;
}

export interface SimpleVideoServices {
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
  llm: LlmComplete;
  verifyFinalVideo: (input: VerifyFinalVideoQualityInput) => Promise<VideoQualityResult>;
  overrides?: Partial<SimpleFns>;
}

interface SimplePipelinePromptContext {
  readonly includeFullUserRequirement?: boolean;
  readonly initialRepairInstruction?: string;
}

function realFns(): SimpleFns {
  return {
    synthesizeSpeech,
    generateImages,
    generateBrollVideo,
    generateVeoVideo,
    downloadToBuffer,
    downloadToFile,
    ffprobeDurationMs,
    renderImageClip,
    renderVideoClip,
    runFfmpeg,
    optimizeUserScript,
    writeFile: (p, b) => fs.writeFile(p, b),
    readFile: (p) => fs.readFile(p),
    removeFile: (p) => fs.rm(p, { force: true }),
  };
}

export function createSimplePipelineDeps(
  cfg: SimpleVideoConfig,
  opts: SimpleVideoOptions,
  svc: SimpleVideoServices,
  userText = '',
  promptContext: SimplePipelinePromptContext = {},
): VideoPipelineDeps {
  const fns = { ...realFns(), ...(svc.overrides ?? {}) };
  const ws = cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {};
  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};
  const visualMode = opts.visualMode ?? 'video';
  const videoSource = opts.videoSource ?? 'veo_fast';
  const minimumSegmentDurationMs = (opts.veoDurationSeconds ?? 8) * 1000;
  const aspect = resolveAspect(opts.aspectRatio ?? '9:16');
  const aspectLabel = aspectCopy(opts.aspectRatio);
  const scenePolicy = scenePromptPolicy(userText);
  const originalUserRequirement =
    promptContext.includeFullUserRequirement && userText.trim()
      ? `；用户原始需求（每个动作阶段都必须完整覆盖）：${userText.trim()}`
      : '';
  const initialRepairInstruction = promptContext.initialRepairInstruction ?? '';

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
      await svc.storeOutput({
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
          prompt: `${visual}${scenePolicy.suffix}，${aspectLabel} 构图`,
        });
        const first = img.images[0];
        if (!first)
          throw new SimpleVideoError(`nano banana seg ${index} produced no image`, 'compose');
        await svc.storeOutput({
          filename: `seg${index}-img.png`,
          mimetype: first.mimeType,
          buffer: first.buffer,
        });
        const localPath = path.join(svc.workdir, `seg${index}-img.png`);
        await fns.writeFile(localPath, first.buffer);
        return { visualRef: localPath };
      }
      const localPath = path.join(svc.workdir, `seg${index}-vid.mp4`);
      const durationSeconds = opts.veoDurationSeconds ?? 8;
      const completionInstruction = motionCompletionInstruction(durationSeconds);
      let repairInstruction = initialRepairInstruction;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const candidatePrompt =
          visual +
          originalUserRequirement +
          repairInstruction +
          scenePolicy.suffix +
          completionInstruction;
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
            prompt: candidatePrompt,
            negativePrompt: scenePolicy.negativePrompt,
            aspectRatio: aspect.veoAspect, // 1:1 时用 9:16 出, compose pad 到方形
            durationSeconds,
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
            prompt: candidatePrompt,
            negativePrompt: scenePolicy.negativePrompt,
            // HappyHorse 1080P 按画幅; wanxiang 兜底保持 720 竖屏(第一期不做多尺寸).
            size: isHH ? aspect.hhSize : (cfg.wanxiangVideoSize ?? '720*1280'),
          });
          if (!v.videoUrl)
            throw new SimpleVideoError(`broll video seg ${index} produced no url`, 'compose');
          url = v.videoUrl;
        }
        let downloaded = false;
        let downloadError: unknown;
        for (let downloadAttempt = 0; downloadAttempt < 2; downloadAttempt += 1) {
          try {
            await fns.removeFile(localPath);
            await fns.downloadToFile(url, localPath, {
              ...(headers ? { headers } : {}),
              maxBytes: 500 * 1024 * 1024,
            });
            downloaded = true;
            break;
          } catch (err) {
            downloadError = err;
            if (downloadAttempt === 0) {
              svc.logger.warn(
                { segmentIndex: index, err: errorMessage(err) },
                'video: generated segment download failed — retrying the same URL',
              );
            }
          }
        }
        if (!downloaded) {
          throw new SimpleVideoError(
            `generated segment download failed after provider completed: ${errorMessage(downloadError)}`,
            'compose',
            false,
          );
        }

        let candidateDurationMs: number;
        try {
          candidateDurationMs = await fns.ffprobeDurationMs(
            localPath,
            cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {},
          );
        } catch (err) {
          throw new SimpleVideoError(
            `generated segment inspection failed after provider completed: ${errorMessage(err)}`,
            'compose',
            false,
          );
        }

        let candidateQuality: VideoQualityResult;
        try {
          candidateQuality = await svc.verifyFinalVideo({
            videoPath: localPath,
            workdir: svc.workdir,
            durationMs: candidateDurationMs,
            minimumDurationMs: minimumSegmentDurationMs,
            userText,
            qualityContext: `这是最终成片中的第 ${index + 1} 个原始动态片段。片段画面要求：${visual}`,
            expectedSubtitleText: [],
            requiredBrandTexts: [],
            brandPolicy:
              '用户明确要求的文字或品牌必须逐字准确；未要求时不得新增乱码、错字或错误品牌。',
            ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
          });
        } catch (err) {
          throw new SimpleVideoError(
            `generated segment quality verification failed after provider completed: ${errorMessage(err)}`,
            'quality_unavailable',
          );
        }
        if (candidateQuality.status === 'pass') return { visualRef: localPath };
        if (candidateQuality.status === 'unknown') {
          svc.logger.warn(
            {
              segmentIndex: index,
              failedChecks: candidateQuality.failedChecks,
              reason: candidateQuality.reason,
            },
            'video: segment quality verification inconclusive',
          );
          throw new SimpleVideoError(
            'generated segment quality verification unavailable',
            'quality_unavailable',
          );
        }
        if (attempt === 1) {
          svc.logger.warn(
            {
              segmentIndex: index,
              failedChecks: candidateQuality.failedChecks,
              reason: candidateQuality.reason,
            },
            'video: replacement segment quality rejected',
          );
          throw new SimpleVideoError(
            'generated segment failed automated quality verification',
            'quality',
          );
        }
        svc.logger.warn(
          {
            segmentIndex: index,
            failedChecks: candidateQuality.failedChecks,
            reason: candidateQuality.reason,
          },
          'video: segment quality rejected — generating one replacement candidate',
        );
        repairInstruction =
          initialRepairInstruction +
          qualityRepairInstruction(candidateQuality, durationSeconds, scenePolicy);
      }
      throw new SimpleVideoError('video segment quality retry exhausted', 'quality');
    },

    async renderBrollClip({ index, visualRef, audioRef, durationMs }) {
      const outPath = path.join(svc.workdir, `seg${index}-clip.mp4`);
      if (visualMode === 'image') {
        // 静态图(无 Ken Burns 运镜)— BOSS 2026-06-15.
        await fns.renderImageClip(
          {
            imagePath: visualRef,
            audioPath: audioRef,
            outPath,
            durationMs,
            width: aspect.width,
            height: aspect.height,
          },
          ffOpts,
        );
      } else {
        await fns.renderVideoClip(
          {
            videoPath: visualRef,
            audioPath: audioRef,
            outPath,
            durationMs,
            width: aspect.width,
            height: aspect.height,
          },
          ffOpts,
        );
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
  if (!cfg.dashscopeApiKey)
    throw new SimpleVideoError('DASHSCOPE_API_KEY not configured', 'config');
  if (typeof svc.verifyFinalVideo !== 'function') {
    throw new SimpleVideoError('video quality verifier not configured', 'config');
  }
  const visualMode = opts.visualMode ?? 'video';
  const videoSource = opts.videoSource ?? 'veo_fast';
  const minimumSegmentDurationMs = (opts.veoDurationSeconds ?? 8) * 1000;
  if (
    visualMode === 'video' &&
    videoParameterIssue({
      model: videoSource,
      resolution: opts.veoResolution ?? '1080p',
      durationSeconds: opts.veoDurationSeconds ?? 8,
    })
  ) {
    throw new SimpleVideoError('Veo 1080p requires an 8-second duration', 'invalid_options');
  }
  const aspect = resolveAspect(opts.aspectRatio ?? '9:16');
  // Veo (any tier) AND nano banana image both run on the shared Google key.
  const needsGemini =
    visualMode === 'image' || (visualMode === 'video' && isVeoSource(videoSource));
  if (needsGemini && !cfg.geminiApiKey) {
    throw new SimpleVideoError(
      'Veo/nano banana selected but GEMINI_API_KEY not configured',
      'config',
    );
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
  const assPath = path.join(svc.workdir, 'subtitles.ass');
  const outPath = path.join(svc.workdir, 'final.mp4');
  const canRegenerateVisuals =
    visualMode === 'video' && script.segments.every((segment) => segment.type === 'broll');
  const scenePolicy = scenePromptPolicy(input.userText);
  let finalRepairInstruction = '';
  let result: Awaited<ReturnType<typeof runVideoPipeline>> | undefined;
  let finalDurationMs = 0;

  for (let finalAttempt = 0; finalAttempt < 2; finalAttempt += 1) {
    // ②-⑤ runner (synth preset voice + visual + clip per segment).
    const deps = createSimplePipelineDeps(cfg, opts, svc, input.userText, {
      includeFullUserRequirement: script.segments.length === 1,
      ...(finalRepairInstruction ? { initialRepairInstruction: finalRepairInstruction } : {}),
    });
    result = await runVideoPipeline(
      {
        script,
        minimumSegmentDurationMs,
        ...(input.retries !== undefined ? { retries: input.retries } : {}),
      },
      deps,
    );

    // ⑤ subtitle file — styled ASS (CJK font + safe margins + auto-wrap, fixes overflow P0-1)
    await fns.writeFile(
      assPath,
      Buffer.from(
        buildAss(result.timeline, {
          ...(cfg.subtitleFontName ? { fontName: cfg.subtitleFontName } : {}),
          width: aspect.width,
          height: aspect.height,
        }),
        'utf-8',
      ),
    );
    // ⑥ compose — ASS subtitles + English watermark (+ optional CJK fontfile), W×H 按画幅
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
    finalDurationMs = await fns.ffprobeDurationMs(
      outPath,
      cfg.ffprobeBin ? { ffprobeBin: cfg.ffprobeBin } : {},
    );
    const verification = await svc.verifyFinalVideo({
      videoPath: outPath,
      workdir: svc.workdir,
      durationMs: finalDurationMs,
      minimumDurationMs: script.segments.length * minimumSegmentDurationMs,
      userText: input.userText,
      qualityContext:
        script.segments.length === 1
          ? '这是单一连续镜头，不应出现切镜、构图突变或场景跳变。'
          : `这是由 ${script.segments.length} 个脚本分段组成的短视频。分段边界允许正常切镜，不得仅因镜头变化判失败；每段内部仍须稳定且符合对应画面要求。`,
      expectedSubtitleText: script.segments.map((segment) => segment.text),
      requiredBrandTexts: ['HOLA DAY · AI'],
      brandPolicy:
        '用户明确要求的其它文字或品牌必须逐字准确；未要求时不得新增乱码、错字或错误品牌。',
      ...(cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {}),
    });
    if (verification.status === 'pass') break;

    svc.logger.warn(
      {
        status: verification.status,
        failedChecks: verification.failedChecks,
        reason: verification.reason,
        finalAttempt,
      },
      'video: final quality gate rejected generated artifact',
    );
    if (verification.status === 'unknown' || !canRegenerateVisuals || finalAttempt === 1) {
      throw new SimpleVideoError(
        'final video failed automated quality verification',
        verification.status === 'unknown' ? 'quality_unavailable' : 'quality',
      );
    }
    finalRepairInstruction = qualityRepairInstruction(
      verification,
      opts.veoDurationSeconds ?? 8,
      scenePolicy,
    );
    svc.logger.warn(
      {
        failedChecks: verification.failedChecks,
        reason: verification.reason,
      },
      'video: final quality rejected — regenerating one replacement video',
    );
  }
  if (!result) throw new SimpleVideoError('video pipeline produced no result', 'compose');
  const stored = await svc.storeOutputFile({
    filename: 'video.mp4',
    mimetype: 'video/mp4',
    sourcePath: outPath,
  });
  // 首帧 poster（非致命：抽帧失败只 log，成片照常完成）。
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
    {
      fileId: stored.fileId,
      segments: result.segments.length,
      visualMode,
      totalDurationMs: finalDurationMs,
    },
    'video: simplified creation complete',
  );
  return {
    fileId: stored.fileId,
    downloadUrl: `/api/files/${stored.fileId}/download`,
    totalDurationMs: finalDurationMs,
    segments: result.segments.length,
    visualMode,
  };
}
