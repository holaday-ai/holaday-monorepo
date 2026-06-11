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
import { pickImageModel, type ImageModelTier } from './model-router.js';

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

  let result;
  try {
    result = await generate({
      apiKey: opts.apiKey,
      prompt: intent,
      model: decision.model,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      ...(hasInputs ? { inputImages: opts.inputImages } : {}),
      ...(decision.resolution ? { resolution: decision.resolution } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
  } catch (err) {
    const reason = mapImageError(err);
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
      reason,
      attachments: [],
      model: decision.model,
      tier: decision.tier,
    };
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
    summary: buildSummary(attachments.length, decision.tier, hasInputs),
    attachments,
    model: decision.model,
    tier: decision.tier,
  };
}

function buildSummary(count: number, tier: ImageModelTier, isEdit: boolean): string {
  const modelLabel = tier === 'pro' ? 'Nano Banana Pro' : 'Nano Banana 2';
  const action = isEdit ? '已按你的要求编辑图片' : `已生成 ${count} 张图片`;
  return `${action}（${modelLabel}）。下载链接见下方，24 小时内有效。`;
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
