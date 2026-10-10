/**
 * Veo 3.1 via fal.ai — drop-in replacement for the dormant Gemini Developer
 * API client (`veo-client.ts#generateVeoVideo`): same params, same result
 * shape, same `VeoError` vocabulary, so `video-lane-simple.ts` only swaps
 * the model client.
 *
 * Official references (verified 2026-10-03):
 *   https://fal.ai/models/fal-ai/veo3.1/fast/api       (text-to-video)
 *   https://fal.ai/models/fal-ai/veo3.1/lite/api
 *   https://fal.ai/models/fal-ai/veo3.1/api
 *   https://fal.ai/models/fal-ai/veo3.1/fast/first-last-frame-to-video/api
 *   input  { prompt, aspect_ratio('16:9'|'9:16'), duration('4s'|'6s'|'8s'),
 *            resolution('720p'|'1080p'|'4k'), generate_audio, negative_prompt,
 *            first_frame_url?, last_frame_url? }
 *   output { video:{ url } }
 * The lane discards provider audio and dubs with Qwen TTS, so
 * `generate_audio:false` (fal supports turning it off, unlike the Gemini API).
 */

import { FalQueueError, runFalQueueJob } from './fal-queue-client.js';
import { type GenerateVeoParams, VeoError, type VeoResult } from './veo-types.js';

const DEFAULT_MAX_WAIT_MS = 420_000;
const FAL_DURATIONS = [4, 6, 8] as const;

/** fal Veo 3.1 accepts 4/6/8 s; pick the shortest allowed clip that covers the request. */
export function falVeoDuration(seconds: number | undefined): '4s' | '6s' | '8s' {
  const requested = seconds ?? 8;
  const match = FAL_DURATIONS.find((allowed) => allowed >= requested) ?? 8;
  return `${match}s` as '4s' | '6s' | '8s';
}

export function buildFalVeoInput(p: GenerateVeoParams): Record<string, unknown> {
  return {
    prompt: p.prompt,
    aspect_ratio: p.aspectRatio ?? '9:16',
    duration: falVeoDuration(p.durationSeconds),
    resolution: p.resolution ?? '1080p',
    generate_audio: false,
    ...(p.negativePrompt ? { negative_prompt: p.negativePrompt } : {}),
    ...(p.startImage
      ? { first_frame_url: `data:${p.startImage.mimeType};base64,${p.startImage.data}` }
      : {}),
    ...(p.startImage
      ? {
          last_frame_url: `data:${(p.lastFrameImage ?? p.startImage).mimeType};base64,${(p.lastFrameImage ?? p.startImage).data}`,
        }
      : {}),
  };
}

function toVeoError(err: unknown): unknown {
  if (!(err instanceof FalQueueError)) return err;
  switch (err.kind) {
    case 'no_api_key':
      return new VeoError(err.message, 'no_api_key', err.status, err.detail, false);
    case 'exhausted_balance':
      return new VeoError(err.message, 'quota_exhausted', err.status, err.detail, false);
    case 'blocked':
    case 'job_failed':
      return new VeoError(err.message, 'op_failed', err.status, err.detail, false);
    case 'http':
      return err.status === 422
        ? new VeoError(err.message, 'invalid_argument', 422, err.detail, false)
        : new VeoError(err.message, 'http', err.status, err.detail);
    case 'timeout':
    case 'network':
    case 'bad_response':
    case 'no_result':
      return new VeoError(err.message, err.kind, err.status, err.detail);
    default:
      return err;
  }
}

/**
 * Same contract as `generateVeoVideo`. `apiKey` = FAL_KEY, `baseUrl` = fal
 * queue base, `model` = fal endpoint id (e.g. 'fal-ai/veo3.1/fast').
 */
export async function generateFalVeoVideo(p: GenerateVeoParams): Promise<VeoResult> {
  if (!p.apiKey || !p.apiKey.trim()) {
    throw new VeoError('FAL_KEY not configured', 'no_api_key', undefined, undefined, false);
  }
  if (!p.model) {
    throw new VeoError(
      'fal Veo endpoint not configured',
      'invalid_argument',
      undefined,
      undefined,
      false,
    );
  }
  const endpointId = p.startImage ? `${p.model}/first-last-frame-to-video` : p.model;
  try {
    const { output, elapsedMs } = await runFalQueueJob<{ video?: { url?: string } }>({
      apiKey: p.apiKey,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      endpointId,
      input: buildFalVeoInput(p),
      pollIntervalMs: p.pollIntervalMs ?? 6_000,
      maxWaitMs: p.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
      ...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {}),
      ...(p.signal ? { signal: p.signal } : {}),
      ...(p.sleepImpl ? { sleepImpl: p.sleepImpl } : {}),
      ...(p.onPoll ? { onStatus: (_status: string, elapsed: number) => p.onPoll?.(elapsed) } : {}),
    });
    const url = output.video?.url;
    if (!url) throw new VeoError('fal Veo returned no video url', 'no_result');
    return { videoUri: url, elapsedMs };
  } catch (err) {
    throw toVeoError(err);
  }
}
