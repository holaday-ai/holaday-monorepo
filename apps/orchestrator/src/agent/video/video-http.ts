/**
 * Shared low-level HTTP helpers for the video sub-capability clients
 * (wanxiang B-roll, fal lip-sync, qwen voice-clone). Mirrors the
 * timeout/abort/retry composition in agent/image/gemini-image-client.ts
 * so every external-gen client behaves the same way.
 *
 * These are PURE — no orchestrator / DB / storage coupling. Each client
 * keeps its own typed API-error class for status/task failures and lets
 * `VideoHttpError` (timeout / network) propagate or maps it.
 */

export type VideoHttpErrorKind = 'timeout' | 'network';

export class VideoHttpError extends Error {
  constructor(
    message: string,
    readonly kind: VideoHttpErrorKind,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VideoHttpError';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Drain a response body to text, swallowing read errors (frees the socket). */
export async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * One fetch attempt with an internal wall-clock timeout composed with an
 * optional caller AbortSignal. Throws `VideoHttpError('timeout')` when the
 * internal timer fires (and the caller didn't abort), `('network')` on any
 * other fetch rejection. A non-2xx response is NOT an error here — the
 * caller inspects `res.status` and maps it to its own typed API error.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !(opts.signal?.aborted ?? false)) {
      throw new VideoHttpError(`request timed out after ${opts.timeoutMs}ms`, 'timeout');
    }
    throw new VideoHttpError(`request failed: ${(err as Error).message}`, 'network', err);
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Download a remote URL into a Buffer. Used to pull a generated artifact
 * off a SHORT-LIVED provider URL (Wanxiang OSS result = 24h TTL; fal
 * v3.fal.media output) immediately so the runner can persist it to R2
 * before the URL expires. The runner — not this helper — owns the R2
 * write (storage coupling stays out of the pure client layer).
 */
export async function downloadToBuffer(
  url: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ buffer: Buffer; contentType?: string; sizeBytes: number }> {
  const res = await fetchWithTimeout(
    url,
    { method: 'GET' },
    { timeoutMs: opts.timeoutMs ?? 120_000, fetchImpl: opts.fetchImpl },
  );
  if (!res.ok) {
    throw new VideoHttpError(`download failed: HTTP ${res.status}`, 'network');
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (opts.maxBytes !== undefined && buffer.length > opts.maxBytes) {
    throw new VideoHttpError(
      `downloaded ${buffer.length} bytes exceeds maxBytes ${opts.maxBytes}`,
      'network',
    );
  }
  const contentType = res.headers.get('content-type') ?? undefined;
  return { buffer, ...(contentType ? { contentType } : {}), sizeBytes: buffer.length };
}
