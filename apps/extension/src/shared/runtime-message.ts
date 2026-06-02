const DEFAULT_RUNTIME_MESSAGE_TIMEOUT_MS = 5_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

interface RuntimeMessageOptions {
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
}

type AttemptResult<T> =
  | { kind: 'ok'; response: T | null }
  | { kind: 'retryable' };

export async function sendRuntimeMessageWithRetry<T>(
  message: unknown,
  options: RuntimeMessageOptions = {},
): Promise<T | null> {
  const attempts = normalizeRuntimeMessageOption(options.attempts, DEFAULT_ATTEMPTS, 1);
  const timeoutMs = normalizeRuntimeMessageOption(
    options.timeoutMs,
    DEFAULT_RUNTIME_MESSAGE_TIMEOUT_MS,
    1,
  );
  const retryDelayMs = normalizeRuntimeMessageOption(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    0,
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await sendRuntimeMessageOnce<T>(message, timeoutMs);
    if (result.kind === 'ok') return result.response;
    if (attempt < attempts) await sleep(retryDelayMs);
  }
  return null;
}

function sendRuntimeMessageOnce<T>(message: unknown, timeoutMs: number): Promise<AttemptResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: AttemptResult<T>): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => finish({ kind: 'retryable' }), timeoutMs);
    try {
      chrome.runtime.sendMessage(message, (response?: T) => {
        if (chrome.runtime.lastError) {
          finish({ kind: 'retryable' });
          return;
        }
        if (isRetryableRuntimeFailure(response)) {
          finish({ kind: 'retryable' });
          return;
        }
        finish({ kind: 'ok', response: response ?? null });
      });
    } catch {
      finish({ kind: 'retryable' });
    }
  });
}

function isRetryableRuntimeFailure(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const raw = response as { ok?: unknown; reason?: unknown };
  return raw.ok === false && raw.reason === 'internal_error';
}

function normalizeRuntimeMessageOption(raw: unknown, fallback: number, min: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.floor(raw));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
