/**
 * Provider-neutral image generation contract shared by the DashScope (Qwen
 * Image / Wan 2.7 Image) and fal (Nano Banana 2) clients.
 *
 * The request/response shapes intentionally mirror the legacy Gemini client
 * (`gemini-image-client.ts`) so the existing orchestrators (`image-runner.ts`,
 * `video-lane-simple.ts`) can switch model clients without changing their
 * architecture. This module has no runtime dependency on any provider.
 */

/** A base64-encoded image handed IN for editing (图生图 / 锁定主角). */
export interface ImageInput {
  /** Raw base64 (no data: prefix). */
  readonly data: string;
  /** e.g. 'image/png', 'image/jpeg', 'image/webp'. */
  readonly mimeType: string;
}

export type ImageAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

/** Same field names as the legacy Gemini `GenerateImagesParams`. */
export interface ImageGenerateParams {
  /** Ignored by the provider dispatcher (each provider owns its key). */
  readonly apiKey?: string;
  readonly prompt: string;
  /** Provider model id (e.g. 'qwen-image-2.0-pro', 'fal-ai/nano-banana-2'). */
  readonly model: string;
  /** Legacy Gemini API surface hint; ignored by non-Gemini providers. */
  readonly apiVersion?: string;
  readonly baseUrl?: string;
  readonly inputImages?: readonly ImageInput[];
  readonly resolution?: string;
  readonly aspectRatio?: ImageAspectRatio;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly signal?: AbortSignal;
}

export interface GeneratedImageOutput {
  readonly buffer: Buffer;
  readonly mimeType: string;
}

export interface ImageGenerateResult {
  readonly images: GeneratedImageOutput[];
  readonly text?: string;
  /** The provider model id actually called. */
  readonly model: string;
}

export type ImageGenerateFn = (params: ImageGenerateParams) => Promise<ImageGenerateResult>;

/** Product-level model keys (UI ↔ API ↔ router). */
export const IMAGE_MODEL_KEYS = ['qwen_image', 'wan_image', 'nano_banana_2'] as const;
export type ImageModelKey = (typeof IMAGE_MODEL_KEYS)[number];

export type ImageProviderId = 'dashscope' | 'fal';

/**
 * Same `kind` vocabulary as the legacy `GeminiImageError`, so one mapping
 * (`mapImageError`) produces the user copy for every provider.
 */
export type ImageProviderErrorKind =
  | 'no_api_key'
  | 'blocked'
  | 'no_image'
  | 'http'
  | 'network'
  | 'timeout'
  | 'bad_response'
  | 'exhausted_balance';

export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ImageProviderErrorKind,
    readonly status?: number,
    readonly detail?: string,
    readonly provider?: ImageProviderId,
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}

export interface ImageErrorInfo {
  readonly kind: string;
  readonly status?: number;
  readonly detail?: string;
}

/**
 * Structural read of a typed image error. Works for `ImageProviderError` and
 * the dormant `GeminiImageError` without importing the legacy client.
 */
export function imageErrorInfo(err: unknown): ImageErrorInfo | null {
  if (!(err instanceof Error)) return null;
  if (err.name !== 'ImageProviderError' && err.name !== 'GeminiImageError') return null;
  const record = err as Error & { kind?: unknown; status?: unknown; detail?: unknown };
  if (typeof record.kind !== 'string') return null;
  return {
    kind: record.kind,
    ...(typeof record.status === 'number' ? { status: record.status } : {}),
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
  };
}

/** Overload / transient failures that justify trying another model. */
export function isTransientImageError(err: unknown): boolean {
  const info = imageErrorInfo(err);
  if (!info) return false;
  if (info.kind === 'timeout' || info.kind === 'network') return true;
  return (
    info.kind === 'http' &&
    (info.status === 429 || info.status === 503 || (info.status ?? 0) >= 500)
  );
}

/** Configuration failures (missing key / exhausted balance) — another provider may still work. */
export function isProviderUnavailableError(err: unknown): boolean {
  const info = imageErrorInfo(err);
  return info?.kind === 'no_api_key' || info?.kind === 'exhausted_balance';
}
