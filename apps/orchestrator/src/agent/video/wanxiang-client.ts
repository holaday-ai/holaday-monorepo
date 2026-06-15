/**
 * Tongyi Wanxiang (通义万相 / Wan) B-roll client — DashScope async
 * image / video generation.
 *
 * Pure adapter over the DashScope INTERNATIONAL (Singapore) REST API.
 * NO orchestrator / DB / storage coupling — the runner persists results
 * to R2. Verified 2026-06-13 from Vultr (Singapore egress, ~48ms to
 * dashscope-intl): a wan2.2-t2i-flash call returned a real PNG on
 * dashscope-result-sgp OSS, usage.image_count=1, end-to-end ~6.4s.
 *
 * API surface (async two-step):
 *   CREATE  POST {base}/api/v1/services/aigc/text2image/image-synthesis
 *           POST {base}/api/v1/services/aigc/video-generation/video-synthesis
 *           headers  Authorization: Bearer <key>
 *                    Content-Type: application/json
 *                    X-DashScope-Async: enable     (mandatory)
 *           body     { model, input:{prompt,...}, parameters:{...} }
 *           resp     { output:{ task_id, task_status:'PENDING' } }
 *   POLL    GET  {base}/api/v1/tasks/{task_id}
 *           resp { output:{ task_status, results:[{url}], video_url },
 *                  usage:{ image_count } }
 *           task_status: PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED|UNKNOWN
 *
 * REGION RULE: the international endpoint + a Singapore-region key go
 * together (a Beijing key fails here). Result URLs are TEMPORARY (24h
 * TTL) — the runner must download immediately (see video-http.downloadToBuffer).
 *
 * Model ids come from the caller (env-overridable in the runner); the
 * defaults match the reachability matrix's pinned ids. A wrong id is a
 * one-env-var fix, never a redeploy.
 */

import { fetchWithTimeout, safeText, sleep, VideoHttpError } from './video-http.js';

const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com';
const DEFAULT_IMAGE_MODEL = 'wan2.2-t2i-flash';
const DEFAULT_VIDEO_MODEL = 'wan2.1-t2v-turbo';
const DEFAULT_TIMEOUT_MS = 30_000;
// Image gen is ~10-30s, video 1-5min — these are POLL ceilings, not the
// per-HTTP timeout above.
const DEFAULT_IMAGE_MAX_WAIT_MS = 120_000;
const DEFAULT_VIDEO_MAX_WAIT_MS = 360_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

export type WanxiangErrorKind =
  | 'no_api_key'
  | 'http'
  | 'task_failed'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'no_result';

/** Typed failure so the runner can map each kind to a clean Chinese message. */
export class WanxiangError extends Error {
  constructor(
    message: string,
    readonly kind: WanxiangErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'WanxiangError';
  }
}

export type WanxiangTaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'UNKNOWN';

export interface WanxiangBaseParams {
  /** DashScope INTERNATIONAL (Singapore-region) API key. Empty → no_api_key. */
  readonly apiKey: string;
  /** Defaults to https://dashscope-intl.aliyuncs.com. No trailing slash needed. */
  readonly baseUrl?: string;
  /** Optional DashScope business-space id → `X-DashScope-WorkSpace` header. */
  readonly workspaceId?: string;
  /** Per-HTTP wall-clock timeout. Default 30s. */
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Caller cancellation, composed with the internal timeout. */
  readonly signal?: AbortSignal;
  /** Retries on transient 429/503. Default 2 → 3 attempts. */
  readonly maxRetries?: number;
  /** Base backoff ms (exponential). Default 1000. */
  readonly retryBaseMs?: number;
}

export interface CreateImageTaskParams extends WanxiangBaseParams {
  readonly prompt: string;
  readonly model?: string;
  readonly negativePrompt?: string;
  /** e.g. '512*512' (smallest valid) .. '1440*1440'. Default omitted (model default). */
  readonly size?: string;
  /** Number of images (1..4). Default 1. */
  readonly n?: number;
}

export interface CreateVideoTaskParams extends WanxiangBaseParams {
  readonly prompt: string;
  readonly model?: string;
  /** Public reference image URL for image-to-video. Omit for text-to-video. */
  readonly imageUrl?: string;
  /** Suppresses unwanted content (e.g. fabricated on-screen text). */
  readonly negativePrompt?: string;
  /** e.g. '1280*720'. Default omitted (model default). */
  readonly size?: string;
}

export interface WanxiangTaskResult {
  readonly taskId: string;
  readonly taskStatus: WanxiangTaskStatus;
  /** Result image URLs (image tasks). TEMPORARY (24h TTL). */
  readonly imageUrls: string[];
  /** Result video URL (video tasks). TEMPORARY (24h TTL). */
  readonly videoUrl?: string;
  /** usage.image_count — the billable unit ($0.025/img on flash). */
  readonly imageCount?: number;
  /** Provider error code/message on FAILED. */
  readonly code?: string;
  readonly message?: string;
}

interface DashScopeCreateResponse {
  output?: { task_id?: string; task_status?: string; code?: string; message?: string };
  code?: string;
  message?: string;
  request_id?: string;
}

interface DashScopeTaskResponse {
  output?: {
    task_id?: string;
    task_status?: string;
    results?: Array<{ url?: string }>;
    video_url?: string;
    code?: string;
    message?: string;
  };
  usage?: { image_count?: number };
  code?: string;
  message?: string;
}

function assertKey(apiKey: string): void {
  if (!apiKey || apiKey.trim() === '') {
    throw new WanxiangError('DASHSCOPE_API_KEY not configured', 'no_api_key');
  }
}

function base(p: WanxiangBaseParams): string {
  return (p.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** POST a create-task body with X-DashScope-Async, retrying transient 429/503. */
async function postCreate(
  url: string,
  body: unknown,
  p: WanxiangBaseParams,
): Promise<string> {
  const fetchImpl = p.fetchImpl ?? fetch;
  const maxRetries = p.maxRetries ?? 2;
  const retryBaseMs = p.retryBaseMs ?? 1000;
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
            'x-dashscope-async': 'enable',
            ...(p.workspaceId ? { 'x-dashscope-workspace': p.workspaceId } : {}),
          },
          body: JSON.stringify(body),
        },
        { timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(p.signal ? { signal: p.signal } : {}), fetchImpl },
      );
    } catch (err) {
      if (err instanceof VideoHttpError) throw new WanxiangError(err.message, err.kind);
      throw err;
    }
    if (res.ok) break;
    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      await safeText(res);
      await sleep(retryBaseMs * 2 ** attempt);
      continue;
    }
    const errBody = await safeText(res);
    throw new WanxiangError(
      `DashScope create returned ${res.status}`,
      'http',
      res.status,
      errBody.slice(0, 800),
    );
  }
  let json: DashScopeCreateResponse;
  try {
    json = (await res.json()) as DashScopeCreateResponse;
  } catch (err) {
    throw new WanxiangError(`DashScope create response not JSON: ${(err as Error).message}`, 'bad_response');
  }
  const taskId = json.output?.task_id;
  if (!taskId) {
    throw new WanxiangError(
      'DashScope create returned no task_id',
      'bad_response',
      undefined,
      json.output?.message ?? json.message,
    );
  }
  return taskId;
}

export async function createImageTask(
  p: CreateImageTaskParams,
): Promise<{ taskId: string; model: string }> {
  assertKey(p.apiKey);
  const model = p.model ?? DEFAULT_IMAGE_MODEL;
  const parameters: Record<string, unknown> = {};
  if (p.size) parameters.size = p.size;
  if (p.n !== undefined) parameters.n = p.n;
  const input: Record<string, unknown> = { prompt: p.prompt };
  if (p.negativePrompt) input.negative_prompt = p.negativePrompt;
  const taskId = await postCreate(
    `${base(p)}/api/v1/services/aigc/text2image/image-synthesis`,
    { model, input, ...(Object.keys(parameters).length ? { parameters } : {}) },
    p,
  );
  return { taskId, model };
}

export async function createVideoTask(
  p: CreateVideoTaskParams,
): Promise<{ taskId: string; model: string }> {
  assertKey(p.apiKey);
  const model = p.model ?? DEFAULT_VIDEO_MODEL;
  const parameters: Record<string, unknown> = {};
  if (p.size) parameters.size = p.size;
  const input: Record<string, unknown> = { prompt: p.prompt };
  if (p.imageUrl) input.img_url = p.imageUrl;
  if (p.negativePrompt) input.negative_prompt = p.negativePrompt;
  const taskId = await postCreate(
    `${base(p)}/api/v1/services/aigc/video-generation/video-synthesis`,
    { model, input, ...(Object.keys(parameters).length ? { parameters } : {}) },
    p,
  );
  return { taskId, model };
}

export async function getTaskStatus(
  p: WanxiangBaseParams & { taskId: string },
): Promise<WanxiangTaskResult> {
  assertKey(p.apiKey);
  const fetchImpl = p.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base(p)}/api/v1/tasks/${encodeURIComponent(p.taskId)}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${p.apiKey}`,
          ...(p.workspaceId ? { 'x-dashscope-workspace': p.workspaceId } : {}),
        },
      },
      { timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(p.signal ? { signal: p.signal } : {}), fetchImpl },
    );
  } catch (err) {
    if (err instanceof VideoHttpError) throw new WanxiangError(err.message, err.kind);
    throw err;
  }
  if (!res.ok) {
    const errBody = await safeText(res);
    throw new WanxiangError(`DashScope task poll returned ${res.status}`, 'http', res.status, errBody.slice(0, 800));
  }
  let json: DashScopeTaskResponse;
  try {
    json = (await res.json()) as DashScopeTaskResponse;
  } catch (err) {
    throw new WanxiangError(`DashScope task response not JSON: ${(err as Error).message}`, 'bad_response');
  }
  const out = json.output ?? {};
  const taskStatus = (out.task_status ?? 'UNKNOWN') as WanxiangTaskStatus;
  const imageUrls = (out.results ?? [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  return {
    taskId: out.task_id ?? p.taskId,
    taskStatus,
    imageUrls,
    ...(out.video_url ? { videoUrl: out.video_url } : {}),
    ...(json.usage?.image_count !== undefined ? { imageCount: json.usage.image_count } : {}),
    ...(out.code ? { code: out.code } : {}),
    ...(out.message ? { message: out.message } : {}),
  };
}

export interface WaitForTaskParams extends WanxiangBaseParams {
  readonly taskId: string;
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  /** Called after each poll with the latest status (for WS progress). */
  readonly onStatus?: (status: WanxiangTaskResult) => void;
}

/**
 * Poll a task until it reaches a terminal state. Resolves on SUCCEEDED,
 * throws WanxiangError('task_failed') on FAILED/CANCELED/UNKNOWN, and
 * ('timeout') if maxWaitMs elapses while still PENDING/RUNNING.
 */
export async function waitForTask(p: WaitForTaskParams): Promise<WanxiangTaskResult> {
  const pollIntervalMs = p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = p.maxWaitMs ?? DEFAULT_IMAGE_MAX_WAIT_MS;
  const startedAt = Date.now();
  for (;;) {
    const status = await getTaskStatus(p);
    p.onStatus?.(status);
    if (status.taskStatus === 'SUCCEEDED') return status;
    if (
      status.taskStatus === 'FAILED' ||
      status.taskStatus === 'CANCELED' ||
      status.taskStatus === 'UNKNOWN'
    ) {
      throw new WanxiangError(
        `Wanxiang task ${status.taskStatus}`,
        'task_failed',
        undefined,
        [status.code, status.message].filter(Boolean).join(': ') || undefined,
      );
    }
    if (Date.now() - startedAt > maxWaitMs) {
      throw new WanxiangError(`Wanxiang task poll timed out after ${maxWaitMs}ms`, 'timeout');
    }
    await sleep(pollIntervalMs);
  }
}

/** Convenience: create an image task and poll to completion. */
export async function generateBrollImage(
  p: CreateImageTaskParams & {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    onStatus?: (status: WanxiangTaskResult) => void;
  },
): Promise<WanxiangTaskResult> {
  const { taskId } = await createImageTask(p);
  const result = await waitForTask({
    apiKey: p.apiKey,
    taskId,
    ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
    ...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {}),
    ...(p.signal ? { signal: p.signal } : {}),
    pollIntervalMs: p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    maxWaitMs: p.maxWaitMs ?? DEFAULT_IMAGE_MAX_WAIT_MS,
    ...(p.onStatus ? { onStatus: p.onStatus } : {}),
  });
  if (result.imageUrls.length === 0) {
    throw new WanxiangError('Wanxiang image task succeeded with no result url', 'no_result');
  }
  return result;
}

/** Convenience: create a video task and poll to completion. */
export async function generateBrollVideo(
  p: CreateVideoTaskParams & {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    onStatus?: (status: WanxiangTaskResult) => void;
  },
): Promise<WanxiangTaskResult> {
  const { taskId } = await createVideoTask(p);
  const result = await waitForTask({
    apiKey: p.apiKey,
    taskId,
    ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
    ...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {}),
    ...(p.signal ? { signal: p.signal } : {}),
    pollIntervalMs: p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    maxWaitMs: p.maxWaitMs ?? DEFAULT_VIDEO_MAX_WAIT_MS,
    ...(p.onStatus ? { onStatus: p.onStatus } : {}),
  });
  if (!result.videoUrl) {
    throw new WanxiangError('Wanxiang video task succeeded with no result url', 'no_result');
  }
  return result;
}
