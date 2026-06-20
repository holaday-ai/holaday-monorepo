/**
 * fal.ai lip-sync client (fal-ai/latentsync) — real-human-video mouth
 * re-draw from a cloned-voice audio track.
 *
 * Pure adapter over fal's QUEUE API. NO orchestrator / DB / storage
 * coupling — the runner persists the result to R2. Verified 2026-06-13
 * from Vultr: submit RTT ~696ms, end-to-end ~112.5s for one clip
 * (diffusion model ~2min/clip), real output mp4 (~1.8MB) on v3.fal.media.
 *
 * KEY ARCHITECTURAL CONSTRAINT: lip-sync is ~2min/clip → the runner must
 * fire-and-poll (never await `runLipSync` in a request handler). This
 * client exposes both the low-level submit/status/result calls (so the
 * runner can drive its own poll loop + WS progress) AND a `runLipSync`
 * convenience that loops to completion.
 *
 * API surface (queue, async):
 *   SUBMIT  POST {base}/{model}                     -> { request_id, status:'IN_QUEUE', ... }
 *   STATUS  GET  {base}/{model}/requests/{id}/status -> { status }
 *   RESULT  GET  {base}/{model}/requests/{id}         -> { video:{ url, content_type, file_size } }
 *   auth header: Authorization: Key <id:secret>
 *   inputs: video_url + audio_url MUST be PUBLIC (R2 presigned / fal storage).
 *
 * A 403 "User is locked. Reason: Exhausted balance" is distinct from a
 * 401 bad key — surfaced as kind 'exhausted_balance' so the runner can
 * tell the user "top up fal billing" vs "key misconfigured".
 */

import { fetchWithTimeout, safeText, sleep, VideoHttpError } from './video-http.js';

const DEFAULT_BASE_URL = 'https://queue.fal.run';
const DEFAULT_MODEL = 'fal-ai/latentsync';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
// Floor / fallback poll ceiling (used when no maxWaitMs is passed). The real
// ceiling for the IP lane is dynamic — see lipSyncMaxWaitMs.
const DEFAULT_MAX_WAIT_MS = 300_000;
// Hard upper bound so a stuck fal job can't hold the fire-and-poll coroutine
// forever. A ≤40s IP clip needs ~700s; 720s leaves margin without going wild.
const MAX_LIPSYNC_WAIT_MS = 720_000;
const LIPSYNC_BASE_MS = 60_000;
const LIPSYNC_MS_PER_AUDIO_SEC = 16_000;

/**
 * Dynamic poll ceiling for latentsync, scaled by output length (= audio
 * length, since loop_mode loops the base to cover the audio).
 *
 * Root cause this fixes: latentsync is diffusion-based ~12-14× realtime, so a
 * fixed 300s ceiling timed out anything past ~20s output (16s clip ≈ 225s OK,
 * 37s clip needs ~460-520s → the client gave up at 300s and surfaced a false
 * "timeout" / "服务繁忙"). Retry is useless here (deterministic slowness, not a
 * flake) — the patient fix is to wait proportionally.
 *
 * `60s + audioSec × 16s`, clamped to [300s floor, 720s ceiling]. The IP lane
 * caps audio at 40s (IP_MAX_AUDIO_MS) before calling fal, so the realistic max
 * is ~700s — under the 720s ceiling, i.e. no in-spec clip is capped short.
 */
export function lipSyncMaxWaitMs(audioMs: number): number {
  const audioSec = Math.max(0, Math.ceil((Number.isFinite(audioMs) ? audioMs : 0) / 1000));
  const wanted = LIPSYNC_BASE_MS + audioSec * LIPSYNC_MS_PER_AUDIO_SEC;
  return Math.min(MAX_LIPSYNC_WAIT_MS, Math.max(DEFAULT_MAX_WAIT_MS, wanted));
}

export type FalLipSyncErrorKind =
  | 'no_api_key'
  | 'http'
  | 'exhausted_balance'
  | 'job_failed'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'no_result';

export class FalLipSyncError extends Error {
  constructor(
    message: string,
    readonly kind: FalLipSyncErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'FalLipSyncError';
  }
}

export type FalStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'UNKNOWN';

export interface FalBaseParams {
  /** fal API key, format `id:secret`. Empty → no_api_key. */
  readonly apiKey: string;
  /** Defaults to https://queue.fal.run. No trailing slash needed. */
  readonly baseUrl?: string;
  /** Model id path segment. Default 'fal-ai/latentsync'. */
  readonly model?: string;
  /** Per-HTTP wall-clock timeout. Default 30s. */
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface SubmitLipSyncParams extends FalBaseParams {
  /** PUBLIC https URL to the real-human base video (mp4/mov/webm/m4v). */
  readonly videoUrl: string;
  /** PUBLIC https URL to the cloned-voice audio (wav/mp3/m4a/aac/ogg). */
  readonly audioUrl: string;
  /** Extra model params (guidance_scale, seed, loop_mode, …). */
  readonly extra?: Record<string, unknown>;
}

export interface LipSyncResult {
  readonly videoUrl: string;
  readonly contentType?: string;
  readonly fileSize?: number;
  readonly fileName?: string;
}

interface FalSubmitResponse {
  request_id?: string;
  status?: string;
  detail?: string;
}
interface FalStatusResponse {
  status?: string;
  detail?: string;
}
interface FalResultResponse {
  video?: { url?: string; content_type?: string; file_size?: number; file_name?: string };
  detail?: string;
}

function assertKey(apiKey: string): void {
  if (!apiKey || apiKey.trim() === '') {
    throw new FalLipSyncError('FAL_KEY not configured', 'no_api_key');
  }
}

function base(p: FalBaseParams): string {
  return (p.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}
function modelPath(p: FalBaseParams): string {
  return p.model ?? DEFAULT_MODEL;
}
function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Key ${apiKey}`, 'content-type': 'application/json' };
}

/** Map a non-2xx fal response to a typed error (403 balance vs other http). */
function httpError(prefix: string, status: number, body: string): FalLipSyncError {
  if (status === 403 && /exhausted balance|user is locked|top up/i.test(body)) {
    return new FalLipSyncError(
      'fal account balance exhausted — top up at fal.ai/dashboard/billing',
      'exhausted_balance',
      403,
      body.slice(0, 400),
    );
  }
  return new FalLipSyncError(`${prefix} returned ${status}`, 'http', status, body.slice(0, 400));
}

async function falFetch(
  url: string,
  init: RequestInit,
  p: FalBaseParams,
): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init, {
      timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(p.signal ? { signal: p.signal } : {}),
      fetchImpl: p.fetchImpl ?? fetch,
    });
  } catch (err) {
    if (err instanceof VideoHttpError) throw new FalLipSyncError(err.message, err.kind);
    throw err;
  }
}

export async function submitLipSync(
  p: SubmitLipSyncParams,
): Promise<{ requestId: string; status: FalStatus }> {
  assertKey(p.apiKey);
  const body = { video_url: p.videoUrl, audio_url: p.audioUrl, ...(p.extra ?? {}) };
  const res = await falFetch(
    `${base(p)}/${modelPath(p)}`,
    { method: 'POST', headers: authHeaders(p.apiKey), body: JSON.stringify(body) },
    p,
  );
  if (!res.ok) throw httpError('fal submit', res.status, await safeText(res));
  let json: FalSubmitResponse;
  try {
    json = (await res.json()) as FalSubmitResponse;
  } catch (err) {
    throw new FalLipSyncError(`fal submit response not JSON: ${(err as Error).message}`, 'bad_response');
  }
  if (!json.request_id) {
    throw new FalLipSyncError('fal submit returned no request_id', 'bad_response', undefined, json.detail);
  }
  return { requestId: json.request_id, status: (json.status as FalStatus) ?? 'IN_QUEUE' };
}

export async function getLipSyncStatus(
  p: FalBaseParams & { requestId: string },
): Promise<{ status: FalStatus }> {
  assertKey(p.apiKey);
  const res = await falFetch(
    `${base(p)}/${modelPath(p)}/requests/${encodeURIComponent(p.requestId)}/status`,
    { method: 'GET', headers: authHeaders(p.apiKey) },
    p,
  );
  if (!res.ok) throw httpError('fal status', res.status, await safeText(res));
  let json: FalStatusResponse;
  try {
    json = (await res.json()) as FalStatusResponse;
  } catch (err) {
    throw new FalLipSyncError(`fal status response not JSON: ${(err as Error).message}`, 'bad_response');
  }
  return { status: (json.status as FalStatus) ?? 'UNKNOWN' };
}

export async function getLipSyncResult(
  p: FalBaseParams & { requestId: string },
): Promise<LipSyncResult> {
  assertKey(p.apiKey);
  const res = await falFetch(
    `${base(p)}/${modelPath(p)}/requests/${encodeURIComponent(p.requestId)}`,
    { method: 'GET', headers: authHeaders(p.apiKey) },
    p,
  );
  if (!res.ok) throw httpError('fal result', res.status, await safeText(res));
  let json: FalResultResponse;
  try {
    json = (await res.json()) as FalResultResponse;
  } catch (err) {
    throw new FalLipSyncError(`fal result response not JSON: ${(err as Error).message}`, 'bad_response');
  }
  const url = json.video?.url;
  if (!url) {
    throw new FalLipSyncError('fal result has no video url', 'no_result', undefined, json.detail);
  }
  return {
    videoUrl: url,
    ...(json.video?.content_type ? { contentType: json.video.content_type } : {}),
    ...(json.video?.file_size !== undefined ? { fileSize: json.video.file_size } : {}),
    ...(json.video?.file_name ? { fileName: json.video.file_name } : {}),
  };
}

export interface RunLipSyncParams extends SubmitLipSyncParams {
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  /** Called after each status poll (for WS progress). */
  readonly onStatus?: (status: FalStatus) => void;
}

/**
 * Submit + poll to completion + return the result url. Resolves in
 * ~2min for a short clip. The RUNNER must call this in a fire-and-forget
 * coroutine (never await in a request handler). Throws 'timeout' if
 * maxWaitMs elapses while still IN_QUEUE/IN_PROGRESS.
 */
export async function runLipSync(
  p: RunLipSyncParams,
): Promise<LipSyncResult & { requestId: string; elapsedMs: number }> {
  const startedAt = Date.now();
  const pollIntervalMs = p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = p.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const { requestId } = await submitLipSync(p);
  for (;;) {
    const { status } = await getLipSyncStatus({
      apiKey: p.apiKey,
      requestId,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      ...(p.model ? { model: p.model } : {}),
      ...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {}),
      ...(p.signal ? { signal: p.signal } : {}),
    });
    p.onStatus?.(status);
    if (status === 'COMPLETED') {
      const result = await getLipSyncResult({
        apiKey: p.apiKey,
        requestId,
        ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
        ...(p.model ? { model: p.model } : {}),
        ...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {}),
        ...(p.signal ? { signal: p.signal } : {}),
      });
      return { ...result, requestId, elapsedMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt > maxWaitMs) {
      throw new FalLipSyncError(`fal lip-sync timed out after ${maxWaitMs}ms`, 'timeout', undefined, requestId);
    }
    await sleep(pollIntervalMs);
  }
}
