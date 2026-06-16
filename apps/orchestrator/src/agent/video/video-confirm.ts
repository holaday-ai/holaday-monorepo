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

// 报价:硬编码的只有官方单价表 + 汇率;动态部分 = 本次真实段数 + 选定档/画质/时长。
// TODO(pricing): 价表/汇率为硬编码快照，Google/阿里 可能调价 → 需手动同步
//   https://ai.google.dev/gemini-api/docs/pricing (Veo 每秒价 + nano banana 图片价)。
//   HappyHorse: 阿里 DashScope 控制台(720P ¥0.9/s · 1080P ¥1.6/s)。
type Resolution = '720p' | '1080p';
/** 每秒美元单价 — 按档 × 画质。720p/1080p 影响真实计费,据此诚实定价(不一律按 1080p)。*/
const VEO_USD_PER_SEC: Record<VideoSource, Record<Resolution, number>> = {
  veo_fast: { '720p': 0.1, '1080p': 0.12 },
  veo_lite: { '720p': 0.05, '1080p': 0.08 },
  veo_standard: { '720p': 0.4, '1080p': 0.4 }, // 高质量档单价不随画质降
  happyhorse: { '720p': 0.9 / 7.3, '1080p': 1.6 / 7.3 }, // ¥/s → USD/s
  wanxiang: { '720p': 0, '1080p': 0 }, // 兜底源,不进报价(仅 Veo 降级时用)
};
/** 档位中文标签 — 报价卡如实标注选了哪档,不再硬写「Veo Fast」。 */
const TIER_LABEL: Record<VideoSource, string> = {
  veo_fast: 'Veo Fast',
  veo_lite: 'Veo Lite',
  veo_standard: 'Veo 高质量',
  happyhorse: '快马 HappyHorse',
  wanxiang: '万相',
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
  readonly aspectRatio?: '9:16' | '16:9' | '1:1';
}

export interface VideoQuote {
  readonly segments: number;
  readonly videoCny: number;
  readonly imageCny: number;
  readonly message: string;
}

/** Dynamic price quote — videoCny = 真实段数 × 每段秒数 × 选定档/画质单价 × 汇率. */
export function quoteVideo(segments: number, tier: VideoSource, opts: VideoQuoteOpts = {}): VideoQuote {
  const resolution: Resolution = opts.resolution ?? '1080p';
  const billSec = opts.durationSeconds ?? DEFAULT_BILL_SEC;
  const perSec = VEO_USD_PER_SEC[tier]?.[resolution] ?? 0;
  const videoCny = Math.ceil(segments * billSec * perSec * USD_TO_CNY);
  const imageCny = Math.ceil(segments * NB_USD_PER_IMG * USD_TO_CNY);
  const shape =
    opts.aspectRatio === '16:9' ? '横屏' : opts.aspectRatio === '1:1' ? '方形' : '竖屏';
  const message =
    `将用 ${segments} 段动态画面合成一条${shape}视频，预计费用约 ¥${videoCny}` +
    `（${TIER_LABEL[tier]} · ${resolution} · 每段 ${billSec} 秒计费）。\n` +
    `点「确认制作」开始；或选「图片版」改用静态图（更省，约 ¥${imageCny}）；不需要可「取消」。`;
  return { segments, videoCny, imageCny, message };
}
