/**
 * Retry policy helpers for the vision loop.
 *
 * Two call sites today:
 *   - Anthropic `messages.create` inside commander.ts — transient
 *     upstream failures (429, 5xx, connection resets behind GFW) get
 *     exponential backoff. Auth / bad-request (4xx that isn't 408/429)
 *     short-circuit immediately; retrying an invalid API key just
 *     wastes latency and budget.
 *   - Driver action dispatch inside runner.ts — single-action retry
 *     once on a non-ok result (e.g. page was mid-reflow and the click
 *     landed on the wrong node). After 2 in-tick attempts we record
 *     whatever result we got and let sequentialDriverFails decide.
 *
 * Exported shape is narrow on purpose — callers pass a classifier so
 * the retry logic doesn't have to know every SDK's error shape.
 */

export interface RetryPolicy {
  /** Max total attempts (including the first). Default 3. */
  maxAttempts?: number;
  /**
   * Classify a caught error. Return `true` to retry, `false` to
   * surface immediately. Default policy retries everything.
   */
  isRetryable?: (err: unknown, attempt: number) => boolean;
  /**
   * Delay in ms before attempt N (0-indexed; N=0 is the first retry).
   * Default exponential: 500ms, 1500ms, 3500ms, 7500ms…
   */
  delayMs?: (attempt: number) => number;
  /**
   * Optional hook for operator logs. Called before each retry with
   * the attempt number (1 = first retry) and the error.
   */
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function retryAsync<T>(fn: () => Promise<T>, policy: RetryPolicy = {}): Promise<T> {
  const maxAttempts = policy.maxAttempts ?? 3;
  const isRetryable = policy.isRetryable ?? (() => true);
  const delayMs = policy.delayMs ?? defaultBackoff;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt + 1 >= maxAttempts) break;
      if (!isRetryable(err, attempt)) break;
      policy.onRetry?.(attempt + 1, err);
      await sleep(delayMs(attempt));
    }
  }
  throw lastErr;
}

function defaultBackoff(attempt: number): number {
  // 500, 1500, 3500, 7500, 15500 … — doubles + half-second base.
  return 500 + 2 ** attempt * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classifier for the Anthropic SDK. Retries:
 *   - 408 Request Timeout
 *   - 409 Conflict (retried once; the SDK retries itself but we keep
 *     the belt)
 *   - 429 Rate Limited
 *   - 5xx Server Error
 *   - Network errors (ECONNRESET / ETIMEDOUT / EAI_AGAIN / fetch failed)
 *
 * Non-retryable (surface immediately):
 *   - 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found
 *   - Request payload too large (Anthropic-specific)
 *
 * Works against both the thrown object shape Anthropic SDK uses
 * (`{status, error: {type, message}}`) and the plain Error fallback
 * we see when `undici` fails to connect.
 */
export function isRetryableAnthropicError(err: unknown): boolean {
  // The SDK throws APIError subclasses with a numeric .status.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number') {
    if (status === 408 || status === 409 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // No status → probably a transport error (undici / global-agent).
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('eai_again') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up')
  );
}
