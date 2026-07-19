/**
 * Image-model router — pick Nano Banana 2 (flash) vs Nano Banana Pro
 * per the user's intent.
 *
 * Routing rule (BOSS sprint plan #5):
 *   default                       → NB2  (gemini-3.1-flash-image), fast/<2s
 *   poster / embedded text / hi-fi → Pro (gemini-3-pro-image), best text
 *                                          rendering + complex scenes
 *
 * Pure function — model ids are injected (env-overridable) so a model
 * rename never touches this logic. The default ids match the plan.
 */

export type ImageModelTier = 'flash' | 'pro';

export interface ImageModelDecision {
  /** Full model id to call. */
  readonly model: string;
  readonly tier: ImageModelTier;
  /** Human-readable Chinese reason (for logs / the task summary). */
  readonly reason: string;
  /** Output resolution when the user explicitly asked for hi-res. */
  readonly resolution?: string;
}

export interface ImageModelOptions {
  /** Default 'gemini-3.1-flash-image'. */
  readonly flashModel?: string;
  /** Default 'gemini-3-pro-image'. */
  readonly proModel?: string;
  /** Structured UI selection. When present, this wins over prompt heuristics. */
  readonly preferredTier?: ImageModelTier;
}

export const DEFAULT_FLASH_MODEL = 'gemini-3.1-flash-image';
export const DEFAULT_PRO_MODEL = 'gemini-3-pro-image';

const FORCE_FLASH_HINTS: readonly RegExp[] = [
  /\b(?:nano\s*banana\s*2|nb\s*2|gemini-3\.1-flash-image)\b/i,
  /图片模型要求[：:]\s*使用\s*Nano\s*Banana\s*2/i,
];

const FORCE_PRO_HINTS: readonly RegExp[] = [
  /\b(?:nano\s*banana\s*pro|nb\s*pro|gemini-3-pro-image)\b/i,
  /图片模型要求[：:]\s*使用\s*Nano\s*Banana\s*Pro/i,
];

/**
 * Signals that the request needs Pro's strengths: rendering legible
 * text inside the image (posters, covers, 详情页, logos with words),
 * or an explicit demand for high fidelity / resolution.
 */
const PRO_HINTS: readonly RegExp[] = [
  // Chinese — text-in-image / print artefacts
  /海报|招贴|banner|横幅|封面|杂志|详情页|主图|展板|易拉宝|名片|传单|宣传单|菜单/,
  /带字|文字|文案|标题|字体|排版|logo|标志|商标|字样|写[着上有].{0,8}字|[几两三四五六七八九十\d]\s*个?字|要有.{0,8}字/,
  // A quoted phrase in an image prompt is almost always text to render
  // INTO the image (写"开业大吉" / 标题是「夏日特惠」) → needs Pro.
  /["'“”‘’「」『』][^"'“”‘’「」『』]{1,40}["'“”‘’「」『』]/,
  // Chinese — explicit quality / resolution
  /高清|超清|高精度|高质量|精细|4k|4K|2k|2K|印刷|高分辨率/,
  // English — text-in-image / print
  /\b(poster|flyer|banner|cover|magazine|signage|infographic|logo|typograph|lettering|menu)\b/i,
  /\b(with\s+text|embedded\s+text|readable\s+text|render\s+text)\b/i,
  // English — explicit quality / resolution
  /\b(high[-\s]?(res|resolution|fidelity|quality)|hi[-\s]?res|4k|2k|print[-\s]?ready|ultra[-\s]?hd)\b/i,
];

export function pickImageModel(
  intent: string,
  opts?: ImageModelOptions,
): ImageModelDecision {
  const flashModel = opts?.flashModel ?? DEFAULT_FLASH_MODEL;
  const proModel = opts?.proModel ?? DEFAULT_PRO_MODEL;
  const text = intent ?? '';

  if (opts?.preferredTier === 'flash') {
    return {
      model: flashModel,
      tier: 'flash',
      reason: '用户选择 Nano Banana 2',
    };
  }
  if (opts?.preferredTier === 'pro') {
    return {
      model: proModel,
      tier: 'pro',
      reason: '用户选择 Nano Banana Pro',
    };
  }

  const matchedFlash = FORCE_FLASH_HINTS.find((re) => re.test(text));
  if (matchedFlash) {
    return {
      model: flashModel,
      tier: 'flash',
      reason: '用户选择 Nano Banana 2',
    };
  }

  const matchedForcedPro = FORCE_PRO_HINTS.find((re) => re.test(text));
  if (matchedForcedPro) {
    return {
      model: proModel,
      tier: 'pro',
      reason: '用户选择 Nano Banana Pro',
    };
  }

  const matchedPro = PRO_HINTS.find((re) => re.test(text));
  if (matchedPro) {
    // v1: `imageConfig.resolution:"4096x4096"` was rejected by the API
    // (400), so we do NOT request an explicit resolution. A 4K / 高清
    // ask still routes to Pro for text/print quality; explicit 4K is a
    // follow-up once the correct imageConfig format is verified against
    // a live Pro model.
    return {
      model: proModel,
      tier: 'pro',
      reason: '检测到海报/带字/高精度需求 → Nano Banana Pro',
    };
  }

  return {
    model: flashModel,
    tier: 'flash',
    reason: '默认 → Nano Banana 2（快速出图）',
  };
}
