import { MessagesAdapterError } from './messages-adapter.js';

/**
 * LLM-RETRY-1: a single failed model call (Deploy-25 core-07: planning and
 * execution calls to the mainland Qwen endpoint errored before any browser
 * step) must not fail the whole task. Transient failures get at most two
 * more attempts, 1s then 3s apart; credentials, balance and request errors
 * are reported as they are. A retry only re-sends the model request — no
 * browser action runs between attempts, so a step is never executed twice.
 */
export const MODEL_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

/** Provider codes that no retry can fix (DashScope / OpenAI-compatible). */
const PERMANENT_PROVIDER_CODE =
  /arrearage|invalid[_-]?api[_-]?key|access[_-]?denied|unauthori[sz]ed|insufficient[_-]?quota|billing|invalid[_-]?parameter|data[_-]?inspection/i;

const RETRYABLE_NETWORK_CODE =
  /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/;

const retryableStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/** Whether another attempt of the same request can reasonably succeed. */
export function isRetryableModelError(error: unknown): boolean {
  if (error instanceof MessagesAdapterError) {
    if (PERMANENT_PROVIDER_CODE.test(error.diagnostics.providerCode ?? '')) return false;
    switch (error.code) {
      case 'REQUEST_TIMEOUT':
      case 'INVALID_RESPONSE':
        return true;
      case 'PROVIDER_ERROR':
        // No status: the request never got an HTTP answer (reset, refused, TLS).
        return error.status === null || retryableStatus(error.status);
      default:
        // REQUEST_ABORTED (the caller stopped), INVALID_REQUEST, ADAPTER_DISABLED.
        return false;
    }
  }
  if (typeof error !== 'object' || error === null) return false;
  const { status, code, name } = error as { status?: unknown; code?: unknown; name?: unknown };
  if (name === 'AbortError' || name === 'APIUserAbortError') return false;
  if (typeof status === 'number') return retryableStatus(status);
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;
  return typeof code === 'string' && RETRYABLE_NETWORK_CODE.test(code);
}

/**
 * Run `call` (attempt numbers start at 1), retrying transient model errors
 * after each delay in `delaysMs`. An abort stops the wait and rethrows.
 */
export interface ModelRetryOptions {
  signal?: AbortSignal;
  delaysMs?: readonly number[];
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withModelRetry<T>(
  call: (attempt: number) => Promise<T>,
  options: ModelRetryOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? MODEL_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? abortableSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call(attempt);
    } catch (error) {
      const delay = delays[attempt - 1];
      if (delay === undefined || options.signal?.aborted || !isRetryableModelError(error))
        throw error;
      options.onRetry?.(attempt, error);
      await sleep(delay, options.signal);
      if (options.signal?.aborted) throw error;
    }
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** The mainland endpoint's content inspection refused what was sent. */
export function isContentInspectionRefusal(error: unknown): boolean {
  return (
    error instanceof MessagesAdapterError &&
    /data[_-]?inspection/i.test(error.diagnostics.providerCode ?? '')
  );
}

/**
 * What the task reports when a model call failed for good: a transient error
 * after its retries, or the permanent cause as it is (credentials, balance,
 * request) — never a page or login problem.
 */
export function modelFailureReason(error: unknown): string {
  if (isRetryableModelError(error)) return '模型服务暂时不可用，有限重试后仍失败，请稍后重试。';
  if (error instanceof MessagesAdapterError) {
    const providerCode = error.diagnostics.providerCode ?? '';
    if (/arrearage|insufficient[_-]?quota|billing/i.test(providerCode))
      return '模型服务账户余额不足（欠费），请联系管理员。';
    // The mainland endpoint's content inspection refused what the page said.
    if (/data[_-]?inspection/i.test(providerCode))
      return '模型服务拒绝处理：页面内容未通过内容安全检查，可换一个页面或来源后重试。';
    if (error.code === 'PROVIDER_ERROR') return error.message;
    if (error.code === 'INVALID_REQUEST' || error.code === 'ADAPTER_DISABLED')
      return '模型服务配置或请求不受支持，请联系管理员检查。';
  }
  return '模型服务请求失败，请稍后重试；管理员可查看调用诊断。';
}
