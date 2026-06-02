const DEFAULT_DEADLINE_MS = 30_000;
const MIN_DEADLINE_MS = 0;
const MAX_DEADLINE_MS = 120_000;

export function withDeadline<T>(
  work: PromiseLike<T> | T,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const safeTimeoutMs = normalizeDeadlineMs(timeoutMs);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), safeTimeoutMs);
    timer && (timer as { unref?: () => void }).unref?.();
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function normalizeDeadlineMs(timeoutMs: number): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_DEADLINE_MS;
  }
  return Math.min(
    MAX_DEADLINE_MS,
    Math.max(MIN_DEADLINE_MS, Math.floor(timeoutMs)),
  );
}
