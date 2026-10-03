/**
 * fal.ai Nano Banana 2 image client (text-to-image + edit) over the fal queue.
 *
 * Official references (verified 2026-10-03):
 *   https://fal.ai/models/fal-ai/nano-banana-2/api       (text-to-image)
 *   https://fal.ai/models/fal-ai/nano-banana-2/edit/api  (image_urls → edit)
 *   input  { prompt, num_images, aspect_ratio, resolution('0.5K'|'1K'|'2K'|'4K'),
 *            output_format('png'|'jpeg'|'webp'), image_urls?[] }
 *   output { images:[{ url, content_type, file_name }], description }
 * fal accepts Base64 data URIs wherever a file URL is expected.
 *
 * Endpoint ids come from config (FAL_NANO_BANANA_2_MODEL / _EDIT_MODEL).
 */

import { FalQueueError, runFalQueueJob } from '../video/fal-queue-client.js';
import { VideoHttpError, downloadToBuffer } from '../video/video-http.js';
import {
  type ImageGenerateParams,
  type ImageGenerateResult,
  ImageProviderError,
} from './image-provider-types.js';

const MAX_RESULT_BYTES = 40 * 1024 * 1024;
const MAX_INPUT_IMAGES = 14;
const DEFAULT_MAX_WAIT_MS = 180_000;

export interface FalImageParams extends ImageGenerateParams {
  readonly apiKey: string;
  /** Endpoint used when input images are present. */
  readonly editModel: string;
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
  readonly download?: typeof downloadToBuffer;
}

interface FalImageOutput {
  images?: Array<{ url?: string; content_type?: string }>;
  description?: string;
}

const FAL_RESOLUTIONS = new Set(['0.5K', '1K', '2K', '4K']);

export function buildFalImageInput(p: ImageGenerateParams): Record<string, unknown> {
  const inputs = (p.inputImages ?? []).slice(0, MAX_INPUT_IMAGES);
  const resolution = p.resolution && FAL_RESOLUTIONS.has(p.resolution) ? p.resolution : '1K';
  return {
    prompt: p.prompt,
    num_images: 1,
    aspect_ratio: p.aspectRatio ?? (inputs.length > 0 ? 'auto' : '1:1'),
    resolution,
    output_format: 'png',
    ...(inputs.length > 0
      ? { image_urls: inputs.map((image) => `data:${image.mimeType};base64,${image.data}`) }
      : {}),
  };
}

function decodeDataUri(uri: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(uri);
  if (!match?.[1] || !match[2]) return null;
  return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
}

function toProviderError(err: unknown): unknown {
  if (err instanceof FalQueueError) {
    const kind =
      err.kind === 'job_failed' || err.kind === 'no_result'
        ? 'no_image'
        : err.kind;
    return new ImageProviderError(err.message, kind, err.status, err.detail, 'fal');
  }
  return err;
}

export async function generateFalImages(p: FalImageParams): Promise<ImageGenerateResult> {
  if (!p.apiKey || !p.apiKey.trim()) {
    throw new ImageProviderError('FAL_KEY not configured', 'no_api_key', undefined, undefined, 'fal');
  }
  const hasInputs = (p.inputImages?.length ?? 0) > 0;
  const endpointId = hasInputs ? p.editModel : p.model;
  let output: FalImageOutput;
  try {
    ({ output } = await runFalQueueJob<FalImageOutput>({
      apiKey: p.apiKey,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      endpointId,
      input: buildFalImageInput(p),
      maxWaitMs: p.timeoutMs ?? DEFAULT_MAX_WAIT_MS,
      ...(p.pollIntervalMs !== undefined ? { pollIntervalMs: p.pollIntervalMs } : {}),
      ...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {}),
      ...(p.signal ? { signal: p.signal } : {}),
      ...(p.sleepImpl ? { sleepImpl: p.sleepImpl } : {}),
    }));
  } catch (err) {
    throw toProviderError(err);
  }
  const files = (output.images ?? []).filter(
    (image): image is { url: string; content_type?: string } =>
      typeof image.url === 'string' && image.url.length > 0,
  );
  if (files.length === 0) {
    throw new ImageProviderError('fal returned no image', 'no_image', undefined, output.description, 'fal');
  }
  const download = p.download ?? downloadToBuffer;
  const images = [];
  for (const file of files) {
    const inline = decodeDataUri(file.url);
    if (inline) {
      images.push(inline);
      continue;
    }
    try {
      const downloaded = await download(file.url, { maxBytes: MAX_RESULT_BYTES, timeoutMs: 60_000 });
      images.push({
        buffer: downloaded.buffer,
        mimeType: file.content_type ?? downloaded.contentType ?? 'image/png',
      });
    } catch (err) {
      throw new ImageProviderError(
        `fal image download failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof VideoHttpError ? err.kind : 'network',
        undefined,
        undefined,
        'fal',
      );
    }
  }
  return {
    images,
    model: endpointId,
    ...(output.description ? { text: output.description } : {}),
  };
}
