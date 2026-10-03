import type { AnthropicCompatibleClient } from './messages-adapter.js';
import { type ModelConcurrencyGate, modelConcurrencyGate } from './model-concurrency.js';
import { runModelOperation } from './model-operation.js';
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

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export class QwenTransportError extends Error {
  constructor(
    public readonly code: QwenTransportErrorCode,
    public readonly status: number | null = null,
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

          const timeoutId =
            options?.timeout !== undefined && options.timeout > 0
              ? setTimeout(() => {
                  timedOut = true;
                  operation.markUnknown();
                  controller.abort();
                }, options.timeout)
              : undefined;

          let releaseSlot: (() => void) | undefined;
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
                throw new QwenTransportError('PROVIDER_ERROR');
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

              // Dispose the previous HTTP body before starting a retry. The final
              // error remains independent of disposal so callers are not delayed.
              let disposed!: Promise<unknown>;
              operation.cleanup(() => {
                disposed = Promise.resolve().then(() => response.body?.cancel());
                return disposed;
              });

              if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt >= maxRetries) {
                throw new QwenTransportError('PROVIDER_ERROR', response.status);
              }
              try {
                await disposed;
              } catch {
                throw new QwenTransportError('PROVIDER_ERROR', response.status);
              }

              await waitForRetry(retryBaseDelayMs * 2 ** attempt, controller.signal, () => ({
                callerAborted,
                timedOut,
              }));
            }
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
  return value === undefined ? 2 : Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeRetryBaseDelay(value: number | undefined): number {
  return value === undefined ? 250 : Number.isFinite(value) && value >= 0 ? value : 0;
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
