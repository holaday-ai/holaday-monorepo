/**
 * 视频报价 + 确认解析（纯函数，便于单测）。
 *
 * 安全核心（堵两个烧钱 bug）:
 *  - 确认走【结构化按钮优先】(action) = 零文本猜测;
 *  - 自由文本兜底必须【先过否定护栏】(不/别/取消…→一律 cancel),再用【锚定】确认词
 *    (句首匹配,不许子串命中「要/好」);
 *  - 拿不准 → 'unclear' = 重出报价卡,绝不默认进生成。
 * Veo 烧钱严格在「确认」之后 —— 本模块只决定 choice，不发任何生成调用。
 */
import type { VideoSource } from './video-lane-simple.js';
import type { PetI2vModel } from './video-pet-i2v.js';
import type { WanAnimateMixMode } from './wan-animate-mix-client.js';

export type VideoChoice = 'video' | 'image' | 'cancel' | 'unclear';

// 否定护栏:任一命中 → 一律取消,优先于确认词(把「不要做」先抓成 cancel)。
const NEG = /不|别|勿|不要|不用|算了|取消|再想|先不|等等|暂时|拒绝|放弃|先别/;
// 锚定确认词:必须句首,避免「不要做」里的「做」被当确认;且不含单独的「要/好」。
const CONFIRM = /^(?:确认|确定|开始制作|开始吧?|开始|做吧|开做|可以开始|生成吧?|就这样|好的?[，,]?(?:开始|确认|制作|做))/;
const IMAGE = /图片版|静态图|省钱版|用图片|要图片/;

/**
 * Resolve the user's reply to a video price-quote into a typed choice.
 * Structured `action` (button click) wins; free text falls back through the
 * negation guard first, then anchored confirm words.
 */
export function parseVideoConfirm(o: { action?: string; text?: string }): VideoChoice {
  // 1) 结构化按钮 = 零猜测
  if (o.action === 'confirm_video') return 'video';
  if (o.action === 'confirm_image') return 'image';
  if (o.action === 'cancel') return 'cancel';
  // 2) 自由文本兜底
  const t = (o.text ?? '').trim();
  if (!t) return 'unclear';
  if (NEG.test(t)) return 'cancel'; // 否定护栏【优先】
  if (IMAGE.test(t)) return 'image';
  if (CONFIRM.test(t)) return 'video'; // 锚定确认
  return 'unclear';
}

export type VideoGateAction =
  | 'generate_video'
  | 'generate_image'
  | 'cancel'
  | 'reprompt'
  | 'already_consumed';

/**
 * confirmVideo 的决策核心(纯,可测)。`choice` 来自 parseVideoConfirm;`claimed`
 * 是 consumeVideoConfirm 的原子抢占结果。只有返回 'generate_*' 时 gate 才发
 * runSimpleVideoCreation(含 Veo);cancel/reprompt/already_consumed 一律不烧钱。
 * 这把"何时烧 Veo"收敛到一个真代码纯函数,便于单测 zero-call / exactly-once。
 */
export function decideVideoGate(choice: VideoChoice, claimed: boolean): VideoGateAction {
  if (choice === 'cancel') return 'cancel';
  if (choice === 'unclear') return 'reprompt';
  if (!claimed) return 'already_consumed'; // 双击/二次确认 → 抢占失败 → 不重烧
  return choice === 'image' ? 'generate_image' : 'generate_video';
}

export async function preflightIpVideoAssets(
  input: {
    voiceId: string | null;
    baseVideoFileId: string | null;
    authorized: boolean;
  },
  signBaseVideo: (fileId: string) => Promise<string | null>,
): Promise<{ baseVideoUrl: string | null; issue: string | null }> {
  if (!input.voiceId) {
    return { baseVideoUrl: null, issue: '声音素材已失效，请重新上传后再确认制作。' };
  }
  if (!input.baseVideoFileId) {
    return { baseVideoUrl: null, issue: '请先上传出镜底版，再确认制作。' };
  }
  if (!input.authorized) {
    return { baseVideoUrl: null, issue: '请先确认声音和出镜底版的使用授权。' };
  }
  const baseVideoUrl = await signBaseVideo(input.baseVideoFileId);
  if (!baseVideoUrl) {
    return {
      baseVideoUrl: null,
      issue: '出镜底版当前不可用，请稍后重试；若持续出现，请重新上传。',
    };
  }
  return { baseVideoUrl, issue: null };
}

export async function preflightCloneVideoAssets(
  input: {
    subjectFileId: string;
    referenceVideoFileId: string;
  },
  retainAndSign: (fileId: string) => Promise<string | null>,
): Promise<{
  subjectUrl: string | null;
  referenceVideoUrl: string | null;
  issue: string | null;
}> {
  const [subjectUrl, referenceVideoUrl] = await Promise.all([
    retainAndSign(input.subjectFileId),
    retainAndSign(input.referenceVideoFileId),
  ]);
  if (!subjectUrl || !referenceVideoUrl) {
    return {
      subjectUrl: null,
      referenceVideoUrl: null,
      issue: '主角照片或参考视频当前不可用，请重新上传后再确认制作。',
    };
  }
  return { subjectUrl, referenceVideoUrl, issue: null };
}

// 报价:硬编码的只有官方单价表 + 汇率;动态部分 = 本次真实段数 + 选定档/画质/时长。
// TODO(pricing): 价表/汇率为硬编码快照，Google/阿里 可能调价 → 需手动同步
//   https://ai.google.dev/gemini-api/docs/pricing (Veo 每秒价 + nano banana 图片价)。
//   HappyHorse: 阿里 DashScope 控制台(720P ¥0.9/s · 1080P ¥1.6/s)。
//   Wan 2.7: Alibaba Model Studio Singapore list price
//   (720P $0.10/s · 1080P $0.15/s).
type Resolution = '720p' | '1080p';
/** 每秒美元单价 — 按档 × 画质。720p/1080p 影响真实计费,据此诚实定价(不一律按 1080p)。*/
const VEO_USD_PER_SEC: Record<VideoSource, Record<Resolution, number>> = {
  veo_fast: { '720p': 0.1, '1080p': 0.12 },
  veo_lite: { '720p': 0.05, '1080p': 0.08 },
  veo_standard: { '720p': 0.4, '1080p': 0.4 }, // 高质量档单价不随画质降
  happyhorse: { '720p': 0.9 / 7.3, '1080p': 1.6 / 7.3 }, // ¥/s → USD/s
  wanxiang: { '720p': 0.1, '1080p': 0.15 },
};
/** 档位中文标签 — 报价卡如实标注选了哪档,不再硬写「Veo Fast」。 */
const TIER_LABEL: Record<VideoSource, string> = {
  veo_fast: 'Veo Fast',
  veo_lite: 'Veo Lite',
  veo_standard: 'Veo 高质量',
  happyhorse: '快马 HappyHorse',
  wanxiang: 'Wan 2.7',
};
const NB_USD_PER_IMG = 0.067; // nano banana 1K/张
const USD_TO_CNY = 7.3;
const DEFAULT_BILL_SEC = 8; // 每段默认按 8s 生成计费(成片那段按音频时长裁剪,计费仍按生成时长)

export interface VideoQuoteOpts {
  /** 画质,影响每秒单价。默认 '1080p'。 */
  readonly resolution?: Resolution;
  /** 每段生成时长(6/8),影响计费秒数。默认 8。 */
  readonly durationSeconds?: number;
  /** 画幅,只改报价文案的「竖/横/方屏」措辞,不影响价格。默认竖屏。 */
  readonly aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
}

export interface VideoQuote {
  readonly segments: number;
  readonly videoCny: number;
  readonly imageCny: number;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// 宠物 i2v 报价 (Phase 2 第二期). i2v 单价原生人民币(元/秒),不经汇率.
// ---------------------------------------------------------------------------
// BOSS 2026-06-16 核价:
//   happyhorse-1.0-i2v: 720P 0.9 / 1080P 1.6 元/秒 (高置信, per-resolution, 与 t2v 同价).
//   wan2.2-i2v-flash:   仅确认 floor「低至 0.1 元/秒」(约 480P);720/1080 官方价表 JS 渲染
//     未能抓取 → TODO(pricing): 灰度前必须 console 核 wan i2v 720/1080 真实 元/秒,
//     当前两档都用 0.1 为占位**下限**(不烧不计费阶段, 仅供预览,确认报价以实际为准).
const I2V_CNY_PER_SEC: Record<PetI2vModel, Record<Resolution, number>> = {
  wan_i2v: { '720p': 0.1, '1080p': 0.1 }, // ⚠️ 占位下限, 待 console 核
  happyhorse_i2v: { '720p': 0.9, '1080p': 1.6 },
};
const I2V_LABEL: Record<PetI2vModel, string> = {
  wan_i2v: '万相 i2v(省钱)',
  happyhorse_i2v: '快马 i2v(高质量)',
};

export interface PetVideoQuote {
  readonly durationSeconds: number;
  readonly videoCny: number;
  readonly message: string;
}

/** 宠物 i2v 报价 — videoCny = 时长(秒) × 选定档/画质 元/秒(原生 RMB,无汇率). */
export function quotePetI2v(
  durationSeconds: number,
  model: PetI2vModel,
  resolution: Resolution = '1080p',
): PetVideoQuote {
  const perSec = I2V_CNY_PER_SEC[model]?.[resolution] ?? 0;
  const videoCny = Math.max(1, Math.ceil(durationSeconds * perSec));
  const message =
    `将把这张照片生成一条约 ${durationSeconds} 秒的宠物动态视频，预计费用约 ¥${videoCny}` +
    `（${I2V_LABEL[model]} · ${resolution} · 按 ${durationSeconds} 秒计费）。\n` +
    `点「确认制作」开始；不需要可「取消」。`;
  return { durationSeconds, videoCny, message };
}

// Wan 2.2 Animate Mix, Singapore international pricing snapshot (2026-07-15):
// https://www.alibabacloud.com/help/en/model-studio/model-pricing
// Successful output is billed by actual output duration; failed calls are free.
const CLONE_USD_PER_SEC: Record<WanAnimateMixMode, number> = {
  'wan-std': 0.18,
  'wan-pro': 0.26,
};

export interface CloneVideoQuote {
  readonly durationSeconds: number;
  readonly videoCny: number;
  readonly message: string;
}

export interface CloneVideoQuoteOptions {
  readonly hasAudibleAudio: boolean;
  readonly lipSyncModel: IpLipSyncModel;
}

export function quoteCloneVideo(
  durationSeconds: number,
  mode: WanAnimateMixMode,
  options: CloneVideoQuoteOptions,
): CloneVideoQuote {
  const safeDuration = Math.min(30, Math.max(2, durationSeconds));
  const lipSyncUsdPerSecond = options.hasAudibleAudio
    ? FAL_USD_PER_SECOND[options.lipSyncModel]
    : 0;
  const videoCny = Math.max(
    1,
    Math.ceil(
      safeDuration * (CLONE_USD_PER_SEC[mode] + lipSyncUsdPerSecond) * USD_TO_CNY,
    ),
  );
  const label = mode === 'wan-pro' ? 'Pro' : 'Standard';
  const audioNote = options.hasAudibleAudio
    ? `检测到可听声音，报价已包含 ${options.lipSyncModel.endsWith('/v3') ? 'Sync Lipsync 3.0' : 'Sync Lipsync 2.0'} 口型同步。`
    : '未检测到可听声音，不追加口型同步成本。';
  const message =
    `将用 Wan Animate 2.2 ${label} 把主角照片替换进参考视频，按参考视频约 ${safeDuration.toFixed(1)} 秒估算费用约 ¥${videoCny}。\n` +
    `${audioNote}\n` +
    `最终按成功输出的实际输出时长计费；失败不计费。点「确认制作」开始；不需要可「取消」。`;
  return { durationSeconds: safeDuration, videoCny, message };
}

// ---------------------------------------------------------------------------
// IP 人物 真人换口型 报价 (Phase 2 第三期, B 架构单 clip 口播).
// ---------------------------------------------------------------------------
// Sync Lipsync 按输出时长计费，任务创建阶段尚未合成真实音轨，
// 因此按 Qwen 实测约 5 字/秒保守预估。
// TODO(pricing): fal 单价、Qwen $0.115/万字、汇率 7.3 为硬编码快照,需手动同步:
//   https://fal.ai/models/fal-ai/sync-lipsync/v2
//   https://fal.ai/models/fal-ai/sync-lipsync/v3
//   阿里 Model Studio qwen-tts 计费(按字符)。
export type IpLipSyncModel =
  | 'fal-ai/sync-lipsync/v2'
  | 'fal-ai/sync-lipsync/v3';
const FAL_USD_PER_SECOND: Record<IpLipSyncModel, number> = {
  'fal-ai/sync-lipsync/v2': 3 / 60,
  'fal-ai/sync-lipsync/v3': 8 / 60,
};
const QWEN_USD_PER_10K_CHARS = 0.115;
const IP_ESTIMATED_CHARS_PER_SECOND = 5;
// B 架构 ~40s 对应的中文字数粗界(~4 字/秒 → ~160 字),超则提示可能 >40s。
const IP_CHAR_WARN = 180;

export interface IpVideoQuote {
  readonly chars: number;
  readonly videoCny: number;
  readonly maybeTooLong: boolean;
  readonly message: string;
}

/** IP 口播报价 — videoCny = (预估时长×fal 秒价 + 字符×Qwen) × 汇率. */
export function quoteIpVideo(
  copyText: string,
  model: IpLipSyncModel = 'fal-ai/sync-lipsync/v3',
): IpVideoQuote {
  const chars = copyText.trim().length;
  const estimatedSeconds = Math.max(1, Math.ceil(chars / IP_ESTIMATED_CHARS_PER_SECOND));
  const usd =
    estimatedSeconds * FAL_USD_PER_SECOND[model] +
    (chars / 10_000) * QWEN_USD_PER_10K_CHARS;
  const videoCny = Math.max(1, Math.ceil(usd * USD_TO_CNY));
  const maybeTooLong = chars > IP_CHAR_WARN;
  const modelLabel = model.endsWith('/v3')
    ? 'Sync Lipsync 3.0'
    : 'Sync Lipsync 2.0';
  const message =
    `将使用已授权的声音 + 出镜底版，通过 ${modelLabel} 生成 IP人物视频，` +
    `按约 ${estimatedSeconds} 秒口播预估费用 ¥${videoCny}（单条 ≤40 秒）。\n` +
    (maybeTooLong
      ? `⚠️ 文案约 ${chars} 字,可能超过 40 秒上限;过长会被拒,请适当截短。\n`
      : '') +
    `点「确认制作」开始；不需要可「取消」。`;
  return { chars, videoCny, maybeTooLong, message };
}

/** Dynamic price quote — videoCny = 真实段数 × 每段秒数 × 选定档/画质单价 × 汇率. */
export function quoteVideo(segments: number, tier: VideoSource, opts: VideoQuoteOpts = {}): VideoQuote {
  const resolution: Resolution = opts.resolution ?? '1080p';
  const billSec = opts.durationSeconds ?? DEFAULT_BILL_SEC;
  const perSec = VEO_USD_PER_SEC[tier]?.[resolution] ?? 0;
  const videoCny = Math.ceil(segments * billSec * perSec * USD_TO_CNY);
  const imageCny = Math.ceil(segments * NB_USD_PER_IMG * USD_TO_CNY);
  const shape =
    opts.aspectRatio === '16:9' || opts.aspectRatio === '4:3'
      ? '横屏'
      : opts.aspectRatio === '1:1'
        ? '方形'
        : '竖屏';
  const message =
    `将用 ${segments} 段动态画面合成一条${shape}视频，预计费用约 ¥${videoCny}` +
    `（${TIER_LABEL[tier]} · ${resolution} · 每段 ${billSec} 秒计费）。\n` +
    `点「确认制作」开始；或选「图片版」改用静态图（更省，约 ¥${imageCny}）；不需要可「取消」。`;
  return { segments, videoCny, imageCny, message };
}
