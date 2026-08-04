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
import { VideoHttpError, fetchWithTimeout, safeText, sleep } from './video-http.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'veo-3.0-fast-generate-001';
const DEFAULT_SUBMIT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 6_000;
const DEFAULT_MAX_WAIT_MS = 360_000; // Veo can take up to ~6min at peak.
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_BASE_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

export type VeoErrorKind =
  | 'no_api_key'
  | 'invalid_argument'
  | 'permission_denied'
  | 'quota_exhausted'
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
    readonly retryable = true,
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
  /** Optional first-frame composition constraint (Veo 3.1 image-to-video). */
  readonly startImage?: {
    readonly data: string;
    readonly mimeType: 'image/png' | 'image/jpeg';
  };
  /** Optional final-frame composition constraint (Veo 3.1 interpolation). */
  readonly lastFrameImage?: {
    readonly data: string;
    readonly mimeType: 'image/png' | 'image/jpeg';
  };
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
  /** Transient 408/429/5xx retries per submit or poll request. Default 4. */
  readonly maxRetries?: number;
  /** Exponential retry base delay. Default 2000ms. */
  readonly retryBaseMs?: number;
  /** Injectable retry wait for deterministic tests. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
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

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isHardQuotaExhaustion(status: number, detail: string): boolean {
  return (
    status === 429 &&
    /(?:exceeded\s+your\s+current\s+quota|check\s+your\s+plan\s+and\s+billing|current\s+quota\s+(?:has\s+been\s+)?exceeded)/i.test(
      detail,
    )
  );
}

function durationMs(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const match = value.trim().match(/^([\d.]+)s$/i);
    if (match?.[1]) return Number(match[1]) * 1_000;
  }
  if (typeof value === 'object' && value !== null) {
    const duration = value as { seconds?: unknown; nanos?: unknown };
    const seconds = Number(duration.seconds ?? 0);
    const nanos = Number(duration.nanos ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos) && (seconds > 0 || nanos > 0)) {
      return seconds * 1_000 + nanos / 1_000_000;
    }
  }
  return undefined;
}

function responseRetryHintMs(res: Response, detail: string): number {
  const hints: number[] = [];
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) hints.push(seconds * 1_000);
    else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) hints.push(Math.max(0, retryAt - Date.now()));
    }
  }

  try {
    const json = JSON.parse(detail) as {
      error?: {
        message?: unknown;
        details?: Array<Record<string, unknown>>;
      };
    };
    for (const item of json.error?.details ?? []) {
      const parsed = durationMs(item.retryDelay ?? item.retry_delay);
      if (parsed !== undefined) hints.push(parsed);
    }
    if (typeof json.error?.message === 'string') {
      const match = json.error.message.match(/retry\s+in\s+([\d.]+)\s*s/i);
      if (match?.[1]) hints.push(Number(match[1]) * 1_000);
    }
  } catch {
    const match = detail.match(/retry\s+in\s+([\d.]+)\s*s/i);
    if (match?.[1]) hints.push(Number(match[1]) * 1_000);
  }

  return Math.max(0, ...hints.filter(Number.isFinite));
}

function retryDelayMs(res: Response, detail: string, attempt: number, retryBaseMs: number): number {
  const exponential = retryBaseMs * 2 ** attempt;
  const baseDelay = Math.max(exponential, responseRetryHintMs(res, detail));
  const jitter = Math.floor(baseDelay * 0.25 * Math.random());
  return Math.min(MAX_RETRY_DELAY_MS, baseDelay + jitter);
}

async function fetchVeoWithBackoff(
  p: GenerateVeoParams,
  fetchImpl: typeof fetch,
  stage: 'submit' | 'poll',
  url: string,
  init: RequestInit,
): Promise<Response> {
  const maxRetries = Math.max(0, p.maxRetries ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(0, p.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
  const wait = p.sleepImpl ?? sleep;

  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, init, {
        timeoutMs: DEFAULT_SUBMIT_TIMEOUT_MS,
        ...(p.signal ? { signal: p.signal } : {}),
        fetchImpl,
      });
    } catch (err) {
      if (err instanceof VideoHttpError) throw new VeoError(err.message, err.kind);
      throw err;
    }
    if (res.ok) return res;

    const responseBody = await safeText(res);
    const detail = responseBody.slice(0, 800);
    if (stage === 'submit' && res.status === 403) {
      throw new VeoError(
        'Veo access denied — key not allowlisted',
        'permission_denied',
        403,
        detail.slice(0, 300),
        false,
      );
    }
    if (isHardQuotaExhaustion(res.status, responseBody)) {
      throw new VeoError(
        'Veo account quota exhausted',
        'quota_exhausted',
        res.status,
        detail,
        false,
      );
    }
    if (isTransientStatus(res.status) && attempt < maxRetries) {
      await wait(retryDelayMs(res, responseBody, attempt, retryBaseMs));
      continue;
    }
    throw new VeoError(`Veo ${stage} returned ${res.status}`, 'http', res.status, detail, false);
  }
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
    throw new VeoError('Veo 1080p requires an 8-second duration', 'invalid_argument', 400);
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
  const instance: Record<string, unknown> = { prompt: p.prompt };
  if (p.startImage) {
    instance.image = {
      bytesBase64Encoded: p.startImage.data,
      mimeType: p.startImage.mimeType,
    };
  }
  if (p.lastFrameImage) {
    instance.lastFrame = {
      bytesBase64Encoded: p.lastFrameImage.data,
      mimeType: p.lastFrameImage.mimeType,
    };
  }
  const subRes = await fetchVeoWithBackoff(
    p,
    fetchImpl,
    'submit',
    `${base(p)}/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': p.apiKey },
      body: JSON.stringify({ instances: [instance], parameters }),
    },
  );
  let sub: SubmitResponse;
  try {
    sub = (await subRes.json()) as SubmitResponse;
  } catch (err) {
    throw new VeoError(`Veo submit response not JSON: ${(err as Error).message}`, 'bad_response');
  }
  if (!sub.name) {
    throw new VeoError(
      'Veo submit returned no operation name',
      'bad_response',
      undefined,
      sub.error?.message,
    );
  }

  // --- poll ---
  const pollIntervalMs = p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = p.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  for (;;) {
    const opRes = await fetchVeoWithBackoff(p, fetchImpl, 'poll', `${base(p)}/v1beta/${sub.name}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': p.apiKey },
    });
    let op: OperationResponse;
    try {
      op = (await opRes.json()) as OperationResponse;
    } catch (err) {
      throw new VeoError(`Veo poll response not JSON: ${(err as Error).message}`, 'bad_response');
    }
    if (op.done) {
      if (op.error) {
        throw new VeoError(
          `Veo generation failed: ${op.error.message ?? op.error.code}`,
          'op_failed',
          undefined,
          JSON.stringify(op.error).slice(0, 300),
        );
      }
      const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        throw new VeoError(
          'Veo done but no video uri',
          'no_result',
          undefined,
          JSON.stringify(op).slice(0, 300),
        );
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
