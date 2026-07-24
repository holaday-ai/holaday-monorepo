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

import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxBytes?: number;
    /** Extra request headers (e.g. x-goog-api-key for a Veo result URI). */
    headers?: Record<string, string>;
  } = {},
): Promise<{ buffer: Buffer; contentType?: string; sizeBytes: number }> {
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  const res = await fetchWithTimeout(
    url,
    { method: 'GET', ...(opts.headers ? { headers: opts.headers } : {}) },
    { timeoutMs: opts.timeoutMs ?? 120_000, fetchImpl: opts.fetchImpl },
  );
  if (!res.ok) {
    throw new VideoHttpError(`download failed: HTTP ${res.status}`, 'network');
  }
  if (!res.body) {
    throw new VideoHttpError('download failed: response body is empty', 'network');
  }
  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await res.body.cancel().catch(() => {});
    throw new VideoHttpError(
      `declared ${declaredLength} bytes exceeds maxBytes ${maxBytes}`,
      'network',
    );
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const bodyTimeout = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new VideoHttpError(
            `download body timed out after ${opts.timeoutMs ?? 120_000}ms`,
            'timeout',
          ),
        ),
      opts.timeoutMs ?? 120_000,
    );
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), bodyTimeout]);
      if (done) break;
      const chunk = Buffer.from(value);
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        throw new VideoHttpError(
          `downloaded ${sizeBytes} bytes exceeds maxBytes ${maxBytes}`,
          'network',
        );
      }
      chunks.push(chunk);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (err instanceof VideoHttpError) throw err;
    throw new VideoHttpError(`download failed: ${(err as Error).message}`, 'network', err);
  } finally {
    if (timeout) clearTimeout(timeout);
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks, sizeBytes);
  const contentType = res.headers.get('content-type') ?? undefined;
  return { buffer, ...(contentType ? { contentType } : {}), sizeBytes };
}

/**
 * Stream a remote artifact directly to disk. This is the required path for
 * user-supplied videos, which may be hundreds of megabytes and must never be
 * materialized as one Buffer inside the Orchestrator process.
 */
export async function downloadToFile(
  url: string,
  destination: string,
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxBytes?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<{ contentType?: string; sizeBytes: number }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const res = await fetchWithTimeout(
    url,
    { method: 'GET', ...(opts.headers ? { headers: opts.headers } : {}) },
    { timeoutMs, fetchImpl: opts.fetchImpl },
  );
  if (!res.ok) {
    throw new VideoHttpError(`download failed: HTTP ${res.status}`, 'network');
  }
  if (!res.body) {
    throw new VideoHttpError('download failed: response body is empty', 'network');
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  let sizeBytes = 0;
  const byteCounter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      if (opts.maxBytes !== undefined && sizeBytes > opts.maxBytes) {
        callback(
          new VideoHttpError(
            `downloaded ${sizeBytes} bytes exceeds maxBytes ${opts.maxBytes}`,
            'network',
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  const bodyController = new AbortController();
  const timer = setTimeout(() => bodyController.abort(), timeoutMs);
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      byteCounter,
      createWriteStream(destination, { flags: 'wx' }),
      { signal: bodyController.signal },
    );
  } catch (err) {
    await fs.rm(destination, { force: true }).catch(() => {});
    if (bodyController.signal.aborted) {
      throw new VideoHttpError(`download body timed out after ${timeoutMs}ms`, 'timeout', err);
    }
    if (err instanceof VideoHttpError) throw err;
    throw new VideoHttpError(`download failed: ${(err as Error).message}`, 'network', err);
  } finally {
    clearTimeout(timer);
  }
  const contentType = res.headers.get('content-type') ?? undefined;
  return { ...(contentType ? { contentType } : {}), sizeBytes };
}
