/**
 * Image execution lane (sprint #5) — orchestrates a 文生图 / 图生图
 * task end-to-end:
 *
 *   intent → pickImageModel (NB2 vs Pro) → generateImages (Gemini)
 *          → persist each PNG to R2 (injected `save`) → attachments[]
 *
 * Persistence + DB are injected via `save` so this stays a pure,
 * unit-testable orchestrator — the tasks.ts branch wires the real
 * DownloadManager. The returned `attachments` already match the shape
 * the SPA reads from `result.metadata.attachments` (FileDownloadCard).
 */

import type { Logger } from 'pino';
import {
  generateImages,
  GeminiImageError,
  type GeminiImageInput,
} from './gemini-image-client.js';
import { pickImageModel, DEFAULT_FLASH_MODEL, type ImageModelTier } from './model-router.js';

/** Matches the SPA's metadata.attachments entry shape (task-store.ts). */
export interface ImageAttachment {
  fileId: string;
  downloadUrl: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  /** ISO string — the SPA rejects non-string expiresAt. */
  expiresAt: string;
  kind: 'output';
}

export interface RunImageTaskResult {
  status: 'completed' | 'failed';
  /** Short Chinese summary shown above the download cards. */
  summary: string;
  attachments: ImageAttachment[];
  /** Present on failure. */
  reason?: string;
  /** The model id actually used. */
  model?: string;
  tier?: ImageModelTier;
}

/** Persist one generated image → an attachment row. Injected. */
export type SaveImageFn = (
  img: { buffer: Buffer; mimeType: string },
  index: number,
) => Promise<ImageAttachment>;

export interface RunImageTaskOpts {
  intent: string;
  /** Input images → image-editing mode (图生图). */
  inputImages?: readonly GeminiImageInput[];
  apiKey: string;
  baseUrl?: string;
  flashModel?: string;
  proModel?: string;
  /** Per-call wall-clock; forwarded to the adapter. */
  timeoutMs?: number;
  save: SaveImageFn;
  logger: Logger;
  /** Injectable adapter for tests; defaults to the real Gemini client. */
  generate?: typeof generateImages;
}

export async function runImageTask(opts: RunImageTaskOpts): Promise<RunImageTaskResult> {
  const intent = opts.intent.trim();
  const hasInputs = Boolean(opts.inputImages && opts.inputImages.length > 0);
  if (!intent && !hasInputs) {
    return { status: 'failed', summary: '', reason: '请描述你想生成的图片。', attachments: [] };
  }

  const decision = pickImageModel(intent, {
    ...(opts.flashModel ? { flashModel: opts.flashModel } : {}),
    ...(opts.proModel ? { proModel: opts.proModel } : {}),
  });
  const generate = opts.generate ?? generateImages;
  const flashModel = opts.flashModel ?? DEFAULT_FLASH_MODEL;
  // P0 compliance — marketing/poster images must NOT invent promo copy.
  const promptText = buildImagePrompt(intent, decision.tier);

  const runGenerate = (model: string, resolution?: string) =>
    generate({
      apiKey: opts.apiKey,
      prompt: promptText,
      model,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      ...(hasInputs ? { inputImages: opts.inputImages } : {}),
      ...(resolution ? { resolution } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });

  const isOverload = (err: unknown): boolean =>
    err instanceof GeminiImageError &&
    ((err.kind === 'http' && (err.status === 503 || err.status === 429)) ||
      err.kind === 'timeout');

  let result;
  let effectiveTier = decision.tier;
  let degraded = false;
  try {
    result = await runGenerate(decision.model, decision.resolution);
  } catch (err) {
    // Pro overloaded (503/429/timeout after the client's own retries)
    // → degrade to NB2 so the user still gets an image (lower text
    // fidelity) instead of a hard failure.
    if (decision.tier === 'pro' && decision.model !== flashModel && isOverload(err)) {
      opts.logger.warn(
        { kind: err instanceof GeminiImageError ? err.kind : 'unknown', from: decision.model },
        'image: Pro overloaded — degrading to NB2',
      );
      try {
        result = await runGenerate(flashModel); // drop hi-res on the NB2 fallback
        degraded = true;
        effectiveTier = 'flash';
      } catch (err2) {
        opts.logger.warn(
          { err: err2 instanceof Error ? err2.message : String(err2) },
          'image: NB2 fallback also failed',
        );
        return {
          status: 'failed',
          summary: '',
          reason: mapImageError(err2),
          attachments: [],
          model: flashModel,
          tier: 'flash',
        };
      }
    } else {
      opts.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          kind: err instanceof GeminiImageError ? err.kind : 'unknown',
          model: decision.model,
        },
        'image: generate failed',
      );
      return {
        status: 'failed',
        summary: '',
        reason: mapImageError(err),
        attachments: [],
        model: decision.model,
        tier: decision.tier,
      };
    }
  }

  const attachments: ImageAttachment[] = [];
  for (let i = 0; i < result.images.length; i += 1) {
    try {
      attachments.push(await opts.save(result.images[i]!, i));
    } catch (err) {
      opts.logger.warn(
        { err: err instanceof Error ? err.message : String(err), index: i },
        'image: save failed',
      );
    }
  }

  if (attachments.length === 0) {
    return {
      status: 'failed',
      summary: '',
      reason: '图片已生成但保存失败，请重试。',
      attachments: [],
      model: decision.model,
      tier: decision.tier,
    };
  }

  return {
    status: 'completed',
    summary: buildSummary(attachments.length, effectiveTier, hasInputs, degraded),
    attachments,
    model: result.model ?? decision.model,
    tier: effectiveTier,
  };
}

// P0 compliance: 营销/海报类图片绝不能自行添加促销承诺（AI 擅自加优惠
// 条件/买赠/价格 = 商家未做出的商业承诺，会造成实际损失）。营销/带字意图
// 给模型追加硬约束：图中文字严格限用户指定内容，不编造任何促销语。
const MARKETING_RE =
  /海报|招贴|横幅|banner|促销|优惠|折扣|打折|特价|大促|秒杀|限时|满\d+减|买[一二三四五]?送|赠品?|广告|宣传|文案|标语|口号|\bsale\b|\bdiscount\b|\bpromo\b|\boffer\b|\bcoupon\b|%\s*off/i;

const MARKETING_CONSTRAINT =
  '【严格约束·营销合规】图中出现的所有文字必须严格限定为用户上面明确指定的内容，' +
  '逐字使用；绝对不得自行添加、扩写或编造任何促销语、优惠条件、折扣比例、买赠/满减、' +
  '价格、时间承诺或未被要求的标语口号。用户只给了一个优惠就只呈现这一个，不要补第二个；' +
  '用户未指定具体文字时，不要在图中编造任何促销数字或承诺性文案。';

/**
 * Build the final image prompt. For marketing / text-bearing images
 * (Pro tier or promo keywords), append a hard constraint so the model
 * doesn't fabricate commercial commitments (P0 eval finding: user asked
 * for "全场五折", model added "买一送一" — a promise the merchant never
 * made). Plain images (画一只猫) pass through unchanged.
 */
export function buildImagePrompt(intent: string, tier: ImageModelTier): string {
  const isMarketing = tier === 'pro' || MARKETING_RE.test(intent);
  if (!isMarketing) return intent;
  return `${intent}\n\n${MARKETING_CONSTRAINT}`;
}

function buildSummary(
  count: number,
  tier: ImageModelTier,
  isEdit: boolean,
  degraded: boolean,
): string {
  const modelLabel = tier === 'pro' ? 'Nano Banana Pro' : 'Nano Banana 2';
  const action = isEdit ? '已按你的要求编辑图片' : `已生成 ${count} 张图片`;
  const note = degraded ? '（Pro 档繁忙，已自动改用 Nano Banana 2 出图）' : '';
  return `${action}（${modelLabel}）${note}。下载链接见下方，24 小时内有效。`;
}

/** Map a thrown error → a clean, user-facing Chinese reason. */
export function mapImageError(err: unknown): string {
  if (err instanceof GeminiImageError) {
    switch (err.kind) {
      case 'no_api_key':
        return '图片生成尚未配置（缺少 GEMINI_API_KEY），请联系管理员。';
      case 'blocked':
        return '该图片请求被内容安全策略拦截，请调整描述后重试。';
      case 'no_image':
        return '模型未能生成图片，请调整描述后重试。';
      case 'timeout':
        return '图片生成超时，请稍后重试。';
      case 'http':
        return `图片服务返回错误（${err.status ?? '未知'}），请稍后重试。`;
      case 'network':
        return '图片服务连接失败，请稍后重试。';
      default:
        return '图片生成失败，请稍后重试。';
    }
  }
  return '图片生成失败，请稍后重试。';
}
