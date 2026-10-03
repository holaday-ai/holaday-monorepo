/**
 * DashScope (Alibaba Cloud Model Studio) image client — Qwen Image and
 * Wan 2.7 Image over the synchronous multimodal-generation endpoint.
 *
 * Official references (verified 2026-10-03):
 *   Qwen Image generate: https://help.aliyun.com/zh/model-studio/qwen-image-api
 *   Qwen Image edit:     https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
 *   Wan 2.7 Image:       https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference
 *
 *   POST {base}/api/v1/services/aigc/multimodal-generation/generation
 *     headers  Authorization: Bearer <key>, Content-Type: application/json
 *              (optional) X-DashScope-WorkSpace
 *     body     { model, input:{ messages:[{ role:'user', content:[{text},{image}] }] },
 *                parameters:{ size:'W*H', n, watermark, prompt_extend } }
 *     resp     { output:{ choices:[{ message:{ content:[{ image:'https://…' }] } }] },
 *                usage:{ image_count } }
 *   Input images accept a public URL or `data:{mime};base64,{data}`.
 *   Qwen edit takes ≤3 input images; Wan 2.7 takes ≤9. Result URLs expire in 24h,
 *   so this client downloads them immediately.
 *
 * Pure adapter: no orchestrator / DB / storage coupling. Model ids come from
 * config (QWEN_IMAGE_MODEL / WAN_IMAGE_MODEL); nothing here hard-codes which
 * model the product uses.
 */

import { VideoHttpError, downloadToBuffer, fetchWithTimeout, safeText, sleep } from '../video/video-http.js';
import {
  type ImageAspectRatio,
  type ImageGenerateParams,
  type ImageGenerateResult,
  ImageProviderError,
  type ImageInput,
} from './image-provider-types.js';

const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com';
const GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_TIMEOUT_MS = 150_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 1_000;
const MAX_RESULT_BYTES = 40 * 1024 * 1024;

export type DashScopeImageFamily = 'qwen' | 'wan';

export interface DashScopeImageParams extends ImageGenerateParams {
  /** DashScope key (same region as baseUrl). Empty → no_api_key. */
  readonly apiKey: string;
  readonly workspaceId?: string;
  readonly retryBaseMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  readonly download?: typeof downloadToBuffer;
}

interface DashScopeContentItem {
  image?: string;
  text?: string;
}
interface DashScopeImageResponse {
  output?: {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: DashScopeContentItem[] };
    }>;
  };
  code?: string;
  message?: string;
  request_id?: string;
}

/** Wan 2.7 Image family vs Qwen Image family (decides limits + payload details). */
export function dashScopeImageFamily(model: string): DashScopeImageFamily {
  return model.toLowerCase().startsWith('wan') ? 'wan' : 'qwen';
}

/**
 * Output `W*H` per aspect ratio. Every entry stays inside the documented
 * total-pixel windows: qwen-image-2.0/3.0 [512², 2048²], wan2.7-image [768², 2048²].
 */
const FLEXIBLE_SIZES: Record<ImageAspectRatio, string> = {
  '1:1': '1536*1536',
  '16:9': '2048*1152',
  '9:16': '1152*2048',
  '4:3': '1792*1344',
  '3:4': '1344*1792',
};

/** qwen-image-max / -plus / legacy qwen-image accept only these documented sizes. */
const QWEN_FIXED_SIZES: Record<ImageAspectRatio, string> = {
  '1:1': '1328*1328',
  '16:9': '1664*928',
  '9:16': '928*1664',
  '4:3': '1472*1104',
  '3:4': '1104*1472',
};

export function dashScopeImageSize(
  model: string,
  aspectRatio: ImageAspectRatio | undefined,
  hasInputs: boolean,
): string | undefined {
  const family = dashScopeImageFamily(model);
  // Wan 2.7 editing keeps the input image's aspect ratio; size is not a ratio control there.
  if (family === 'wan' && hasInputs) return undefined;
  // Plain qwen-image-edit does not allow a custom size.
  if (/^qwen-image-edit$/i.test(model)) return undefined;
  const ratio = aspectRatio ?? '1:1';
  const flexible = family === 'wan' || /^qwen-image-[23]\./i.test(model);
  return flexible ? FLEXIBLE_SIZES[ratio] : QWEN_FIXED_SIZES[ratio];
}

function maxInputImages(model: string): number {
  return dashScopeImageFamily(model) === 'wan' ? 9 : 3;
}

function toDataUri(image: ImageInput): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export function buildDashScopeImageBody(p: ImageGenerateParams): Record<string, unknown> {
  const family = dashScopeImageFamily(p.model);
  const inputs = (p.inputImages ?? []).slice(0, maxInputImages(p.model));
  const images = inputs.map((image) => ({ image: toDataUri(image) }));
  const text = { text: p.prompt };
  // Official examples: Qwen edit lists images before the instruction; Wan lists text first.
  const content = family === 'wan' ? [text, ...images] : [...images, text];
  const size = dashScopeImageSize(p.model, p.aspectRatio, inputs.length > 0);
  const parameters: Record<string, unknown> = { n: 1, watermark: false };
  if (size) parameters.size = size;
  // Prompt rewriting may invent on-image copy; posters must render exactly what the user wrote.
  if (family === 'qwen') parameters.prompt_extend = false;
  return {
    model: p.model,
    input: { messages: [{ role: 'user', content }] },
    parameters,
  };
}

/** Statuses where DashScope rejected the call before generating (safe to resend). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function isModerationFailure(code: string | undefined, message: string | undefined): boolean {
  return /data_?inspection|inappropriate|sensitive|moderation|安全/i.test(
    `${code ?? ''} ${message ?? ''}`,
  );
}

function mimeFrom(contentType: string | undefined, url: string): string {
  const declared = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (declared?.startsWith('image/')) return declared;
  const path = url.split('?', 1)[0]?.toLowerCase() ?? '';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

export async function generateDashScopeImages(
  p: DashScopeImageParams,
): Promise<ImageGenerateResult> {
  if (!p.apiKey || !p.apiKey.trim()) {
    throw new ImageProviderError('DASHSCOPE_API_KEY not configured', 'no_api_key', undefined, undefined, 'dashscope');
  }
  const url = `${(p.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}${GENERATION_PATH}`;
  const fetchImpl = p.fetchImpl ?? fetch;
  const maxRetries = p.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseMs = p.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const body = JSON.stringify(buildDashScopeImageBody(p));

  let res!: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${p.apiKey}`,
            ...(p.workspaceId ? { 'x-dashscope-workspace': p.workspaceId } : {}),
          },
          body,
        },
        {
          timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ...(p.signal ? { signal: p.signal } : {}),
          fetchImpl,
        },
      );
    } catch (err) {
      // No blind retry on transport failure: a billable synchronous POST may
      // already have been processed server-side.
      if (err instanceof VideoHttpError) {
        throw new ImageProviderError(err.message, err.kind, undefined, undefined, 'dashscope');
      }
      throw err;
    }
    if (res.ok) break;
    const errText = await safeText(res);
    if (isRetryableStatus(res.status) && attempt < maxRetries) {
      await sleep(retryBaseMs * 2 ** attempt);
      continue;
    }
    let code: string | undefined;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(errText) as { code?: string; message?: string };
      code = parsed.code;
      message = parsed.message;
    } catch {
      // non-JSON body; keep raw detail
    }
    if (res.status === 400 && isModerationFailure(code, message)) {
      throw new ImageProviderError('DashScope image request blocked', 'blocked', 400, code, 'dashscope');
    }
    throw new ImageProviderError(
      `DashScope image returned ${res.status}`,
      'http',
      res.status,
      [code, message].filter(Boolean).join(': ').slice(0, 400) || errText.slice(0, 400),
      'dashscope',
    );
  }

  let json: DashScopeImageResponse;
  try {
    json = (await res.json()) as DashScopeImageResponse;
  } catch (err) {
    throw new ImageProviderError(
      `DashScope image response not JSON: ${(err as Error).message}`,
      'bad_response',
      undefined,
      undefined,
      'dashscope',
    );
  }
  if (json.code && !json.output) {
    if (isModerationFailure(json.code, json.message)) {
      throw new ImageProviderError('DashScope image request blocked', 'blocked', undefined, json.code, 'dashscope');
    }
    throw new ImageProviderError('DashScope image task failed', 'bad_response', undefined, json.code, 'dashscope');
  }
  const urls = (json.output?.choices ?? [])
    .flatMap((choice) => choice.message?.content ?? [])
    .map((item) => item.image)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const text = (json.output?.choices ?? [])
    .flatMap((choice) => choice.message?.content ?? [])
    .map((item) => item.text)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
  if (urls.length === 0) {
    throw new ImageProviderError('DashScope returned no image', 'no_image', undefined, text || undefined, 'dashscope');
  }
  const download = p.download ?? downloadToBuffer;
  const images = [];
  for (const imageUrl of urls) {
    try {
      const downloaded = await download(imageUrl, { maxBytes: MAX_RESULT_BYTES, timeoutMs: 60_000 });
      images.push({ buffer: downloaded.buffer, mimeType: mimeFrom(downloaded.contentType, imageUrl) });
    } catch (err) {
      throw new ImageProviderError(
        `DashScope image download failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof VideoHttpError ? err.kind : 'network',
        undefined,
        undefined,
        'dashscope',
      );
    }
  }
  return { images, model: p.model, ...(text ? { text } : {}) };
}
