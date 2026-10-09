import type { AnthropicCompatibleClient } from './messages-adapter.js';
import { type ModelConcurrencyGate, modelConcurrencyGate } from './model-concurrency.js';
import { runModelOperation } from './model-operation.js';
import {
  type ProviderErrorDiagnostics,
  responseErrorDiagnostics,
  safeProviderDiagnostics,
} from './provider-error-diagnostics.js';
import type { QwenRoute } from './qwen-route.js';

export type QwenTransportErrorCode =
  | 'INVALID_ROUTE'
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR';

const SAFE_ERROR_MESSAGES: Record<QwenTransportErrorCode, string> = {
  INVALID_ROUTE: 'Qwen transport route is invalid',
  REQUEST_ABORTED: 'Qwen transport request was aborted',
  REQUEST_TIMEOUT: 'Qwen transport request timed out',
  INVALID_RESPONSE: 'Qwen transport response is invalid',
  PROVIDER_ERROR: 'Qwen transport request failed',
};

const isRetryableStatus = (status: number) =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

export class QwenTransportError extends Error {
  constructor(
    public readonly code: QwenTransportErrorCode,
    public readonly status: number | null = null,
    public readonly diagnostics: ProviderErrorDiagnostics = safeProviderDiagnostics({
      httpStatus: status,
    }),
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = 'QwenTransportError';
  }
}

export function createQwenMessagesTransport(input: {
  route: QwenRoute;
  fetchImpl?: typeof fetch;
  retryBaseDelayMs?: number;
  concurrencyGate?: ModelConcurrencyGate;
}): AnthropicCompatibleClient {
  if (input.route.protocol !== 'messages') {
    throw new QwenTransportError('INVALID_ROUTE');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const retryBaseDelayMs = normalizeRetryBaseDelay(input.retryBaseDelayMs);
  const gate = input.concurrencyGate ?? modelConcurrencyGate;

  return {
    messages: {
      async create(request, options) {
        return runModelOperation(async (operation) => {
          const startedAt = Date.now();
          const maxRetries = normalizeMaxRetries(options?.maxRetries);
          const controller = new AbortController();
          let callerAborted = options?.signal?.aborted ?? false;
          let timedOut = false;

          const abortFromCaller = () => {
            callerAborted = true;
            operation.markUnknown();
            controller.abort();
          };
          options?.signal?.addEventListener('abort', abortFromCaller, { once: true });

          // Includes queue wait, all retries, backoff and response-body consumption.
          const timeoutMs =
            Number.isFinite(options?.timeout) && (options?.timeout ?? 0) > 0
              ? Math.min(120_000, options?.timeout ?? 120_000)
              : 120_000;
          const timeoutId = setTimeout(() => {
            timedOut = true;
            operation.markUnknown();
            controller.abort();
          }, timeoutMs);

          let releaseSlot: (() => void) | undefined;
          let retries = 0;
          try {
            if (callerAborted) throw new QwenTransportError('REQUEST_ABORTED');
            try {
              releaseSlot = await gate.acquire(input.route.model, controller.signal);
            } catch {
              throwAbortError({ callerAborted, timedOut });
            }
            let body: string;
            try {
              body = JSON.stringify(request);
            } catch {
              throw new QwenTransportError('PROVIDER_ERROR');
            }

            for (let attempt = 0; ; attempt += 1) {
              retries = attempt;
              if (controller.signal.aborted) throwAbortError({ callerAborted, timedOut });
              let response: Response;
              try {
                response = await operation.run(() =>
                  fetchImpl(`${input.route.baseURL}/v1/messages`, {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      'anthropic-version': '2023-06-01',
                      'x-api-key': input.route.apiKey,
                      ...(input.route.workspaceId
                        ? { 'x-dashscope-workspace': input.route.workspaceId }
                        : {}),
                    },
                    body,
                    signal: controller.signal,
                  }),
                );
              } catch {
                if (controller.signal.aborted) {
                  throw new QwenTransportError(
                    timedOut && !callerAborted ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED',
                  );
                }
                // A network error before any response (reset, refused, TLS
                // failure) is retried like a 502/503 within the same deadline.
                if (attempt >= maxRetries)
                  throw new QwenTransportError(
                    'PROVIDER_ERROR',
                    null,
                    safeProviderDiagnostics({
                      retryCount: attempt,
                      elapsedMs: Date.now() - startedAt,
                      providerType: 'network_error',
                    }),
                  );
                await waitForRetry(retryBaseDelayMs * 2 ** attempt, controller.signal, () => ({
                  callerAborted,
                  timedOut,
                }));
                continue;
              }

              if (controller.signal.aborted) {
                operation.cleanup(() => response.body?.cancel() ?? Promise.resolve());
                throwAbortError({ callerAborted, timedOut });
              }
              if (response.ok) {
                try {
                  const value = await operation.run(() => response.json());
                  if (controller.signal.aborted) throwAbortError({ callerAborted, timedOut });
                  return value;
                } catch {
                  if (!response.body?.locked)
                    operation.cleanup(() => response.body?.cancel() ?? Promise.resolve());
                  if (controller.signal.aborted) throwAbortError({ callerAborted, timedOut });
                  throw new QwenTransportError('INVALID_RESPONSE', response.status);
                }
              }

              const diagnostics = await operation.run(() =>
                responseErrorDiagnostics(
                  response,
                  Date.now() - startedAt,
                  attempt,
                  operation.cleanup,
                  [input.route.apiKey, input.route.workspaceId ?? ''],
                ),
              );
              if (controller.signal.aborted) throwAbortError({ callerAborted, timedOut });
              if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
                throw new QwenTransportError('PROVIDER_ERROR', response.status, diagnostics);
              }

              await waitForRetry(retryBaseDelayMs * 2 ** attempt, controller.signal, () => ({
                callerAborted,
                timedOut,
              }));
            }
          } catch (error) {
            if (error instanceof QwenTransportError)
              throw new QwenTransportError(
                error.code,
                error.status,
                safeProviderDiagnostics({
                  ...error.diagnostics,
                  elapsedMs: Date.now() - startedAt,
                  retryCount: retries,
                }),
              );
            throw error;
          } finally {
            releaseSlot?.();
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            options?.signal?.removeEventListener('abort', abortFromCaller);
          }
        });
      },
    },
  };
}

function normalizeMaxRetries(value: number | undefined): number {
  return value === undefined
    ? 2
    : Number.isSafeInteger(value) && value >= 0
      ? Math.min(2, value)
      : 0;
}

function normalizeRetryBaseDelay(value: number | undefined): number {
  return value === undefined
    ? 250
    : Number.isFinite(value) && value >= 0
      ? Math.min(2000, value)
      : 0;
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
  readAbortState: () => { callerAborted: boolean; timedOut: boolean },
): Promise<void> {
  if (signal.aborted) throwAbortError(readAbortState());
  if (delayMs === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', abortWait);
      resolve();
    }, delayMs);
    const abortWait = () => {
      clearTimeout(timeoutId);
      reject(toAbortError(readAbortState()));
    };
    signal.addEventListener('abort', abortWait, { once: true });
  });
}

function throwAbortError(state: { callerAborted: boolean; timedOut: boolean }): never {
  throw toAbortError(state);
}

function toAbortError(state: {
  callerAborted: boolean;
  timedOut: boolean;
}): QwenTransportError {
  return new QwenTransportError(
    state.timedOut && !state.callerAborted ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED',
  );
}
