/**
 * Google Veo text-to-video client (Gemini API) — the "high-quality" video
 * background tier (user-opt-in; default video source is Wanxiang t2v).
 *
 * Pure adapter over the Gemini predictLongRunning operation. NO storage
 * coupling — returns the result video URI; the lane downloads it (the URI
 * requires the x-goog-api-key header → video-http.downloadToBuffer(headers)).
 *
 * Verified 2026-06-15 from Vultr with the BOSS GEMINI_API_KEY:
 *   veo-3.0-fast-generate-001, aspectRatio 9:16, durationSeconds 4 (NUMBER)
 *   → submit 200, op done in ~32s, 9:16 644KB mp4 on generativelanguage host.
 *   Access present (NOT 403). Pricing: veo-3-fast $0.10/s 720p.
 *   GOTCHAS the docs got wrong: durationSeconds is a NUMBER (string → 400);
 *   `numberOfVideos` is unsupported (→ 400). Keep params minimal.
 *
 * API surface (async long-running operation):
 *   SUBMIT  POST {base}/v1beta/models/{model}:predictLongRunning
 *           header x-goog-api-key
 *           body { instances:[{ prompt }],
 *                  parameters:{ aspectRatio, durationSeconds, resolution? } }
 *           → { name: 'models/.../operations/...' }
 *   POLL    GET {base}/v1beta/{operation_name}
 *           → { done, response.generateVideoResponse.generatedSamples[0].video.uri, error }
 *   The result video URI is served for ~2 days; download with x-goog-api-key.
 */

import { videoParameterIssue } from '@holaday/shared-types';
import { fetchWithTimeout, safeText, sleep, VideoHttpError } from './video-http.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'veo-3.0-fast-generate-001';
const DEFAULT_SUBMIT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 6_000;
const DEFAULT_MAX_WAIT_MS = 360_000; // Veo can take up to ~6min at peak.

export type VeoErrorKind =
  | 'no_api_key'
  | 'invalid_argument'
  | 'permission_denied'
  | 'http'
  | 'op_failed'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'no_result';

export class VeoError extends Error {
  constructor(
    message: string,
    readonly kind: VeoErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'VeoError';
  }
}

export interface GenerateVeoParams {
  /** Gemini API key. Empty → no_api_key. */
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Default veo-3.0-fast-generate-001. */
  readonly model?: string;
  readonly prompt: string;
  /** Elements that should not appear in the generated video. */
  readonly negativePrompt?: string;
  /** Default '9:16' (vertical). */
  readonly aspectRatio?: '9:16' | '16:9';
  /** Default 4. MUST be a number (string → 400). */
  readonly durationSeconds?: number;
  /** Optional — omit for the model default (720p). */
  readonly resolution?: '720p' | '1080p';
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Called on each poll with the elapsed seconds (for WS progress). */
  readonly onPoll?: (elapsedMs: number) => void;
}

export interface VeoResult {
  /** Result video URI (download with the x-goog-api-key header; ~2-day TTL). */
  readonly videoUri: string;
  readonly elapsedMs: number;
}

interface SubmitResponse {
  name?: string;
  error?: { message?: string };
}
interface OperationResponse {
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
  };
}

function base(p: GenerateVeoParams): string {
  return (p.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * Submit a Veo generation, poll to completion, return the result video URI.
 * Resolves in ~30s–6min. The lane must run this in a background coroutine.
 */
export async function generateVeoVideo(p: GenerateVeoParams): Promise<VeoResult> {
  if (!p.apiKey || p.apiKey.trim() === '') {
    throw new VeoError('GEMINI_API_KEY not configured', 'no_api_key');
  }
  const model = p.model ?? DEFAULT_MODEL;
  const durationSeconds = p.durationSeconds ?? 4;
  const resolution = p.resolution ?? '720p';
  if (
    videoParameterIssue({
      model: model.includes('lite')
        ? 'veo_lite'
        : model.includes('fast')
          ? 'veo_fast'
          : 'veo_standard',
      resolution,
      durationSeconds,
    })
  ) {
    throw new VeoError(
      'Veo 1080p requires an 8-second duration',
      'invalid_argument',
      400,
    );
  }
  const fetchImpl = p.fetchImpl ?? fetch;
  const startedAt = Date.now();

  // --- submit ---
  const parameters: Record<string, unknown> = {
    aspectRatio: p.aspectRatio ?? '9:16',
    durationSeconds,
  };
  if (p.resolution) parameters.resolution = p.resolution;
  if (p.negativePrompt) parameters.negativePrompt = p.negativePrompt;
  let subRes: Response;
  try {
    subRes = await fetchWithTimeout(
      `${base(p)}/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': p.apiKey },
        body: JSON.stringify({ instances: [{ prompt: p.prompt }], parameters }),
      },
      { timeoutMs: DEFAULT_SUBMIT_TIMEOUT_MS, ...(p.signal ? { signal: p.signal } : {}), fetchImpl },
    );
  } catch (err) {
    if (err instanceof VideoHttpError) throw new VeoError(err.message, err.kind);
    throw err;
  }
  if (subRes.status === 403) {
    throw new VeoError('Veo access denied — key not allowlisted', 'permission_denied', 403, (await safeText(subRes)).slice(0, 300));
  }
  if (!subRes.ok) {
    throw new VeoError(`Veo submit returned ${subRes.status}`, 'http', subRes.status, (await safeText(subRes)).slice(0, 400));
  }
  let sub: SubmitResponse;
  try {
    sub = (await subRes.json()) as SubmitResponse;
  } catch (err) {
    throw new VeoError(`Veo submit response not JSON: ${(err as Error).message}`, 'bad_response');
  }
  if (!sub.name) {
    throw new VeoError('Veo submit returned no operation name', 'bad_response', undefined, sub.error?.message);
  }

  // --- poll ---
  const pollIntervalMs = p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = p.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  for (;;) {
    let opRes: Response;
    try {
      opRes = await fetchWithTimeout(
        `${base(p)}/v1beta/${sub.name}`,
        { method: 'GET', headers: { 'x-goog-api-key': p.apiKey } },
        { timeoutMs: DEFAULT_SUBMIT_TIMEOUT_MS, ...(p.signal ? { signal: p.signal } : {}), fetchImpl },
      );
    } catch (err) {
      if (err instanceof VideoHttpError) throw new VeoError(err.message, err.kind);
      throw err;
    }
    if (!opRes.ok) {
      throw new VeoError(`Veo poll returned ${opRes.status}`, 'http', opRes.status, (await safeText(opRes)).slice(0, 300));
    }
    let op: OperationResponse;
    try {
      op = (await opRes.json()) as OperationResponse;
    } catch (err) {
      throw new VeoError(`Veo poll response not JSON: ${(err as Error).message}`, 'bad_response');
    }
    if (op.done) {
      if (op.error) {
        throw new VeoError(`Veo generation failed: ${op.error.message ?? op.error.code}`, 'op_failed', undefined, JSON.stringify(op.error).slice(0, 300));
      }
      const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        throw new VeoError('Veo done but no video uri', 'no_result', undefined, JSON.stringify(op).slice(0, 300));
      }
      return { videoUri: uri, elapsedMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt > maxWaitMs) {
      throw new VeoError(`Veo timed out after ${maxWaitMs}ms`, 'timeout');
    }
    p.onPoll?.(Date.now() - startedAt);
    await sleep(pollIntervalMs);
  }
}
