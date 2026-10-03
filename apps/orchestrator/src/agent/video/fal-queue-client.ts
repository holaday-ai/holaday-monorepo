/**
 * Generic fal.ai queue client (submit → poll status → fetch result) shared by
 * the Nano Banana 2 image adapter and the Veo 3.1 video adapter.
 *
 * Queue protocol (https://docs.fal.ai/model-apis/model-endpoints/queue):
 *   SUBMIT  POST {base}/{endpointId}              -> { request_id, status_url, response_url }
 *   STATUS  GET  status_url                       -> { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
 *   RESULT  GET  response_url                     -> endpoint output JSON
 *   auth    Authorization: Key <FAL_KEY>
 * For endpoints with a sub-path (e.g. `fal-ai/veo3.1/fast`) the queue status /
 * result URLs live under the app id (`fal-ai/veo3.1`), so the URLs returned by
 * submit are preferred; the fallback derives `{owner}/{app}` from the id.
 *
 * Pure adapter: no storage coupling, never logs the key.
 */

import { VideoHttpError, fetchWithTimeout, safeText, sleep } from './video-http.js';

const DEFAULT_BASE_URL = 'https://queue.fal.run';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 300_000;

export type FalQueueErrorKind =
  | 'no_api_key'
  | 'http'
  | 'exhausted_balance'
  | 'blocked'
  | 'job_failed'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'no_result';

export class FalQueueError extends Error {
  constructor(
    message: string,
    readonly kind: FalQueueErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'FalQueueError';
  }
}

export interface FalQueueParams {
  /** FAL_KEY (`id:secret`). Empty → no_api_key. */
  readonly apiKey: string;
  /** Defaults to https://queue.fal.run. */
  readonly baseUrl?: string;
  /** Endpoint id, e.g. 'fal-ai/nano-banana-2' or 'fal-ai/veo3.1/fast'. */
  readonly endpointId: string;
  readonly input: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly sleepImpl?: (ms: number) => Promise<void>;
  readonly onStatus?: (status: string, elapsedMs: number) => void;
}

interface FalSubmitResponse {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  detail?: unknown;
}

function base(p: Pick<FalQueueParams, 'baseUrl'>): string {
  return (p.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** `{owner}/{app}` part of an endpoint id — the queue's request namespace. */
export function falAppId(endpointId: string): string {
  return endpointId.split('/').filter(Boolean).slice(0, 2).join('/');
}

function trustedQueueUrl(value: string | undefined, p: FalQueueParams): string | undefined {
  if (!value) return undefined;
  try {
    const candidate = new URL(value);
    if (candidate.protocol !== 'https:' || candidate.origin !== new URL(base(p)).origin) {
      return undefined;
    }
    return candidate.toString();
  } catch {
    return undefined;
  }
}

export function falHttpError(prefix: string, status: number, body: string): FalQueueError {
  if (status === 403 && /exhausted balance|user is locked|top up/i.test(body)) {
    return new FalQueueError('fal account balance exhausted', 'exhausted_balance', 403, body.slice(0, 400));
  }
  if ((status === 400 || status === 422) && /content[_\s-]?policy|nsfw|safety|moderat/i.test(body)) {
    return new FalQueueError(`${prefix} blocked by content policy`, 'blocked', status, body.slice(0, 400));
  }
  if (status === 401) {
    return new FalQueueError(`${prefix} unauthorized`, 'no_api_key', 401, body.slice(0, 200));
  }
  return new FalQueueError(`${prefix} returned ${status}`, 'http', status, body.slice(0, 400));
}

async function falFetch(url: string, init: RequestInit, p: FalQueueParams): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init, {
      timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(p.signal ? { signal: p.signal } : {}),
      fetchImpl: p.fetchImpl ?? fetch,
    });
  } catch (err) {
    if (err instanceof VideoHttpError) throw new FalQueueError(err.message, err.kind);
    throw err;
  }
}

async function readJson<T>(res: Response, label: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new FalQueueError(`${label} response not JSON: ${(err as Error).message}`, 'bad_response');
  }
}

/** Submit, poll to completion and return the endpoint's output JSON. */
export async function runFalQueueJob<T = unknown>(
  p: FalQueueParams,
): Promise<{ output: T; requestId: string; elapsedMs: number }> {
  if (!p.apiKey || !p.apiKey.trim()) {
    throw new FalQueueError('FAL_KEY not configured', 'no_api_key');
  }
  const headers = { authorization: `Key ${p.apiKey}`, 'content-type': 'application/json' };
  const startedAt = Date.now();
  const wait = p.sleepImpl ?? sleep;

  const submitted = await falFetch(
    `${base(p)}/${p.endpointId}`,
    { method: 'POST', headers, body: JSON.stringify(p.input) },
    p,
  );
  if (!submitted.ok) throw falHttpError('fal submit', submitted.status, await safeText(submitted));
  const submit = await readJson<FalSubmitResponse>(submitted, 'fal submit');
  const requestId = submit.request_id;
  if (!requestId) throw new FalQueueError('fal submit returned no request_id', 'bad_response');
  const appBase = `${base(p)}/${falAppId(p.endpointId)}/requests/${encodeURIComponent(requestId)}`;
  const statusUrl = trustedQueueUrl(submit.status_url, p) ?? `${appBase}/status`;
  const responseUrl = trustedQueueUrl(submit.response_url, p) ?? appBase;
  const maxWaitMs = p.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  for (;;) {
    const statusRes = await falFetch(statusUrl, { method: 'GET', headers }, p);
    if (!statusRes.ok) throw falHttpError('fal status', statusRes.status, await safeText(statusRes));
    const status = (await readJson<{ status?: string }>(statusRes, 'fal status')).status ?? 'UNKNOWN';
    p.onStatus?.(status, Date.now() - startedAt);
    if (status === 'COMPLETED') break;
    if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
      throw new FalQueueError(`fal job ended with status ${status}`, 'job_failed', undefined, requestId);
    }
    if (Date.now() - startedAt > maxWaitMs) {
      throw new FalQueueError(`fal job timed out after ${maxWaitMs}ms`, 'timeout', undefined, requestId);
    }
    await wait(p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  const resultRes = await falFetch(responseUrl, { method: 'GET', headers }, p);
  if (!resultRes.ok) throw falHttpError('fal result', resultRes.status, await safeText(resultRes));
  const output = await readJson<T>(resultRes, 'fal result');
  return { output, requestId, elapsedMs: Date.now() - startedAt };
}
