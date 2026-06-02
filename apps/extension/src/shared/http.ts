const DEFAULT_HTTP_DEADLINE_MS = 30_000;
const MIN_HTTP_DEADLINE_MS = 1;
const MAX_HTTP_DEADLINE_MS = 120_000;

export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  message: string,
): Promise<Response> {
  const safeTimeoutMs = normalizeHttpDeadlineMs(timeoutMs);
  const controller = new AbortController();
  let rejectWithTimeout: () => void = () => undefined;
  const timeout = new Promise<Response>((_resolve, reject) => {
    rejectWithTimeout = () => reject(new Error(message));
  });
  const timer = setTimeout(() => {
    controller.abort(new Error(message));
    rejectWithTimeout();
  }, safeTimeoutMs);
  timer && (timer as { unref?: () => void }).unref?.();

  const request = fetch(input, {
    ...init,
    signal: init?.signal ?? controller.signal,
  });

  try {
    return await Promise.race([request, timeout]);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(message);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function responseJsonWithDeadline<T>(
  response: Response,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return bodyWithDeadline(response.json() as Promise<T>, timeoutMs, message);
}

export async function responseTextWithDeadline(
  response: Response,
  timeoutMs: number,
  message: string,
): Promise<string> {
  return bodyWithDeadline(response.text(), timeoutMs, message);
}

async function bodyWithDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const safeTimeoutMs = normalizeHttpDeadlineMs(timeoutMs);
  let rejectWithTimeout: () => void = () => undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    rejectWithTimeout = () => reject(new Error(message));
  });
  const timer = setTimeout(rejectWithTimeout, safeTimeoutMs);
  timer && (timer as { unref?: () => void }).unref?.();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHttpDeadlineMs(timeoutMs: number): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_HTTP_DEADLINE_MS;
  }
  return Math.min(
    MAX_HTTP_DEADLINE_MS,
    Math.max(MIN_HTTP_DEADLINE_MS, Math.floor(timeoutMs)),
  );
}
