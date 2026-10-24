import { pino } from 'pino';
import { isAllowedMcpUrl } from './mcp-url-policy.js';
import { type ModelConcurrencyGate, modelConcurrencyGate } from './model-concurrency.js';
import { type ModelOperation, runModelOperation } from './model-operation.js';
import type { QwenRoute, SafeQwenRouteMetadata } from './qwen-route.js';
import { toSafeQwenRouteMetadata } from './qwen-route.js';

export type NeutralBuiltinTool =
  | { type: 'web_search' }
  | { type: 'web_extractor' }
  | { type: 'code_interpreter' }
  | NeutralMcpTool;

/**
 * Bailian (Model Studio) hosted MCP server over SSE. Authorization is added by
 * the Qwen adapter from its own DashScope key at request time — never stored
 * in config, never logged.
 */
export interface NeutralMcpTool {
  type: 'mcp';
  serverLabel: string;
  serverUrl: string;
}

export interface NeutralResponseInputMessage {
  role: 'user' | 'assistant';
  content: string | ReadonlyArray<NeutralResponseInputContent>;
}

export type NeutralResponseInputContent =
  | { type: 'input_text'; text: string }
  | {
      type: 'input_image';
      source: {
        mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
        data: string;
      };
    };

export interface NeutralResponsesRequest {
  instructions?: string;
  input: string | ReadonlyArray<NeutralResponseInputMessage>;
  tools?: ReadonlyArray<NeutralBuiltinTool>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface NeutralResponseSource {
  title: string;
  url: string;
  provenance: 'web_search';
}

/** Non-Qwen brains carry no Alibaba region or endpoint identity. */
export interface ExternalResponsesMetadata {
  provider: 'anthropic' | 'openai';
  model: string;
  protocol: 'responses';
  region?: undefined;
  deploymentScope?: undefined;
  endpointKind?: undefined;
}

export type ResponsesProviderMetadata = SafeQwenRouteMetadata | ExternalResponsesMetadata;

export interface NeutralResponsesResult {
  id: string;
  metadata: ResponsesProviderMetadata;
  text: string;
  sources: NeutralResponseSource[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** Responses input_tokens includes cache hits. */
    cachedInputTokens?: number | null;
  };
  status: 'completed' | 'incomplete';
  incompleteReason?: 'max_output_tokens';
}

export interface ResponsesAdapter {
  readonly metadata: ResponsesProviderMetadata;
  stream(
    request: NeutralResponsesRequest,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onTextDelta?: (delta: string) => void;
      /** Liveness only: never exposes reasoning content to consumers. */
      onProgress?: () => void;
    },
  ): Promise<NeutralResponsesResult>;
}

export type ResponsesAdapterErrorCode =
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR';

const SAFE_ERROR_MESSAGES: Record<ResponsesAdapterErrorCode, string> = {
  REQUEST_ABORTED: 'Responses provider request was aborted',
  REQUEST_TIMEOUT: 'Responses provider request timed out',
  INVALID_RESPONSE: 'Responses provider response is invalid',
  PROVIDER_ERROR: 'Responses provider request failed',
};

const MAX_PENDING_SSE_BYTES = 2 * 1024 * 1024;
const mcpLog = pino({ level: 'warn', base: { service: 'orchestrator', module: 'responses-mcp' } });

/** Second gate after config validation: never send the key to a non-Bailian host. */
function isSafeMcpTool(tool: NeutralBuiltinTool): boolean {
  if (tool.type !== 'mcp' || isAllowedMcpUrl(tool.serverUrl)) return true;
  let host = 'invalid';
  try {
    host = new URL(tool.serverUrl).hostname;
  } catch {
    /* keep 'invalid' */
  }
  mcpLog.warn({ serverLabel: tool.serverLabel, host }, 'mcp tool dropped: host not allowed');
  return false;
}

const ALLOWED_TOOL_TYPES = new Set<NeutralBuiltinTool['type']>([
  'web_search',
  'web_extractor',
  'code_interpreter',
  'mcp',
]);

export class ResponsesAdapterError extends Error {
  constructor(
    public readonly code: ResponsesAdapterErrorCode,
    public readonly status: number | null = null,
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = 'ResponsesAdapterError';
  }
}

export function createQwenResponsesAdapter(input: {
  route: QwenRoute;
  fetchImpl?: typeof fetch;
  /** Retries before any stream event for 429/502/503/504 and network errors. Default 2. */
  maxRetries?: number;
  retryBaseDelayMs?: number;
  concurrencyGate?: ModelConcurrencyGate;
}): ResponsesAdapter {
  if (input.route.protocol !== 'responses') {
    throw new ResponsesAdapterError('PROVIDER_ERROR');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const maxRetries =
    input.maxRetries !== undefined &&
    Number.isSafeInteger(input.maxRetries) &&
    input.maxRetries >= 0
      ? input.maxRetries
      : DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs =
    input.retryBaseDelayMs !== undefined &&
    Number.isFinite(input.retryBaseDelayMs) &&
    input.retryBaseDelayMs >= 0
      ? input.retryBaseDelayMs
      : DEFAULT_RETRY_BASE_DELAY_MS;
  const gate = input.concurrencyGate ?? modelConcurrencyGate;
  const metadata = Object.freeze(toSafeQwenRouteMetadata(input.route));

  return {
    metadata,
    async stream(request, options) {
      return runModelOperation(async (operation) => {
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
          options?.timeoutMs !== undefined && options.timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                operation.markUnknown();
                controller.abort();
              }, options.timeoutMs)
            : undefined;

        let releaseSlot: (() => void) | undefined;
        try {
          if (callerAborted) throw new ResponsesAdapterError('REQUEST_ABORTED');
          let body: string;
          try {
            body = JSON.stringify(
              toProviderRequest(request, input.route.model, input.route.apiKey),
            );
          } catch {
            throw new ResponsesAdapterError('PROVIDER_ERROR');
          }

          let release: () => void;
          try {
            release = await gate.acquire(input.route.model, controller.signal);
          } catch {
            throw abortError({ callerAborted, timedOut });
          }
          releaseSlot = release;

          // Retry only before any stream event has been read, so no partial
          // text is ever replayed to the caller.
          let response!: Response;
          for (let attempt = 0; ; attempt += 1) {
            if (controller.signal.aborted) throw abortError({ callerAborted, timedOut });
            let candidate: Response | null = null;
            try {
              candidate = await operation.run(() =>
                fetchImpl(`${input.route.baseURL}/responses`, {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    accept: 'text/event-stream',
                    authorization: `Bearer ${input.route.apiKey}`,
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
                throw abortError({ callerAborted, timedOut });
              }
              // Network error before any response: retryable below.
            }

            if (candidate && !controller.signal.aborted && candidate.ok) {
              response = candidate;
              break;
            }
            if (candidate) {
              const disposed = candidate;
              operation.cleanup(() => disposed.body?.cancel() ?? Promise.resolve());
            }
            if (controller.signal.aborted) throw abortError({ callerAborted, timedOut });
            const status = candidate?.status ?? null;
            const retryable = status === null || RETRYABLE_STATUS_CODES.has(status);
            if (!retryable || attempt >= maxRetries) {
              throw new ResponsesAdapterError('PROVIDER_ERROR', status);
            }
            await waitForRetry(
              Math.max(retryBaseDelayMs * 2 ** attempt, retryAfterMs(candidate)),
              controller.signal,
              () => abortError({ callerAborted, timedOut }),
            );
          }
          if (!response.body) {
            throw new ResponsesAdapterError('INVALID_RESPONSE', response.status);
          }

          try {
            return await consumeResponsesStream({
              body: response.body,
              operation,
              metadata,
              signal: controller.signal,
              onTextDelta: options?.onTextDelta,
              onProgress: options?.onProgress,
            });
          } catch (error) {
            if (error instanceof ResponsesAdapterError) throw error;
            if (controller.signal.aborted) {
              throw abortError({ callerAborted, timedOut });
            }
            throw new ResponsesAdapterError('INVALID_RESPONSE', response.status);
          }
        } finally {
          releaseSlot?.();
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          options?.signal?.removeEventListener('abort', abortFromCaller);
        }
      });
    },
  };
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_AFTER_MS = 10_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/** Honours a provider Retry-After (seconds or HTTP date), bounded so one header cannot stall a task. */
function retryAfterMs(response: Response | null): number {
  const value = response?.headers.get('retry-after')?.trim();
  if (!value) return 0;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : 0;
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
  toError: () => ResponsesAdapterError,
): Promise<void> {
  if (signal.aborted) throw toError();
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(toError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function toProviderRequest(
  request: NeutralResponsesRequest,
  model: string,
  apiKey = '',
): Record<string, unknown> {
  return {
    model,
    stream: true,
    store: false,
    ...(typeof request.instructions === 'string' ? { instructions: request.instructions } : {}),
    input: mapInput(request.input),
    ...(Array.isArray(request.tools)
      ? {
          tools: request.tools
            .filter((tool) => ALLOWED_TOOL_TYPES.has(tool.type) && isSafeMcpTool(tool))
            .map((tool) =>
              tool.type === 'mcp'
                ? {
                    type: 'mcp',
                    server_protocol: 'sse',
                    server_label: tool.serverLabel,
                    server_url: tool.serverUrl,
                    headers: { Authorization: `Bearer ${apiKey}` },
                  }
                : { type: tool.type },
            ),
        }
      : {}),
    ...(typeof request.temperature === 'number' && Number.isFinite(request.temperature)
      ? { temperature: request.temperature }
      : {}),
    ...(Number.isSafeInteger(request.maxOutputTokens) && (request.maxOutputTokens ?? 0) > 0
      ? { max_output_tokens: request.maxOutputTokens }
      : {}),
  };
}

function mapInput(
  value: NeutralResponsesRequest['input'],
): string | Array<{ role: 'user' | 'assistant'; content: unknown }> {
  if (typeof value === 'string') return value;
  return value.map((message) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((block) =>
            block.type === 'input_text'
              ? { type: 'input_text', text: block.text }
              : {
                  type: 'input_image',
                  image_url: `data:${block.source.mediaType};base64,${block.source.data}`,
                },
          ),
  }));
}

async function consumeResponsesStream(input: {
  operation: ModelOperation;
  body: ReadableStream<Uint8Array>;
  metadata: SafeQwenRouteMetadata;
  signal: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onProgress?: () => void;
}): Promise<NeutralResponsesResult> {
  const reader = input.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let completion: unknown;
  let terminalReceived = false;
  let cancelling = false;
  const cancel = () => {
    if (cancelling) return;
    cancelling = true;
    input.operation.cleanup(() => reader.cancel());
  };

  const consumeEvent = (eventBlock: string) => {
    if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const data = eventBlock
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      throw new ResponsesAdapterError('INVALID_RESPONSE');
    }
    if (!isRecord(event)) return;

    if (event.type === 'response.reasoning_text.delta') {
      if (typeof event.delta !== 'string') throw new ResponsesAdapterError('INVALID_RESPONSE');
      if (event.delta) {
        try {
          input.onProgress?.();
        } catch {
          // Progress observers cannot change the canonical result or expose reasoning.
        }
      }
      return;
    }

    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') {
        throw new ResponsesAdapterError('INVALID_RESPONSE');
      }
      text += event.delta;
      if (event.delta && input.onTextDelta) {
        try {
          input.onTextDelta(event.delta);
        } catch {
          // Consumer rendering errors must not corrupt the canonical provider result.
        }
      }
      return;
    }

    if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      if (terminalReceived) throw new ResponsesAdapterError('INVALID_RESPONSE');
      completion = event.response;
      terminalReceived = true;
      return true;
    }
  };

  try {
    while (true) {
      const chunk = await readChunk(reader, input.signal, input.operation, cancel);
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > MAX_PENDING_SSE_BYTES) {
        throw new ResponsesAdapterError('INVALID_RESPONSE');
      }
      pending = drainSseEvents(pending, consumeEvent);
      if (terminalReceived) break;
    }
    pending += decoder.decode();
    if (!terminalReceived && pending.trim()) consumeEvent(pending);
  } finally {
    // A terminal event ends the response even when HTTP keep-alive has no EOF.
    // Do not await a transport cancel hook that may itself never settle.
    cancel();
    reader.releaseLock();
  }

  if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return normalizeCompletion(completion, text, input.metadata);
}

function drainSseEvents(
  pending: string,
  consume: (eventBlock: string) => boolean | undefined,
): string {
  let remainder = pending;
  while (true) {
    const match = /\r?\n\r?\n/.exec(remainder);
    if (!match || match.index === undefined) return remainder;
    // The first terminal is authoritative, regardless of transport chunking.
    if (consume(remainder.slice(0, match.index))) return '';
    remainder = remainder.slice(match.index + match[0].length);
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  operation: ModelOperation,
  cancel: () => void,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  return await new Promise((resolve, reject) => {
    const abortRead = () => {
      reject(new DOMException('Aborted', 'AbortError'));
      cancel();
    };
    signal.addEventListener('abort', abortRead, { once: true });
    operation
      .run(() => reader.read())
      .then(
        (result) => {
          signal.removeEventListener('abort', abortRead);
          resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abortRead);
          reject(error);
        },
      );
  });
}

function normalizeCompletion(
  rawCompletion: unknown,
  text: string,
  metadata: SafeQwenRouteMetadata,
): NeutralResponsesResult {
  if (
    !isRecord(rawCompletion) ||
    !isNonEmptyString(rawCompletion.id) ||
    (rawCompletion.status !== 'completed' && rawCompletion.status !== 'incomplete') ||
    !Array.isArray(rawCompletion.output) ||
    !isRecord(rawCompletion.usage)
  ) {
    throw new ResponsesAdapterError('INVALID_RESPONSE');
  }

  const inputTokens = readTokenCount(rawCompletion.usage.input_tokens);
  const outputTokens = readTokenCount(rawCompletion.usage.output_tokens);
  if (inputTokens === null || outputTokens === null) {
    throw new ResponsesAdapterError('INVALID_RESPONSE');
  }

  const status = rawCompletion.status;
  const incompleteReason = readIncompleteReason(rawCompletion);
  if (status === 'incomplete' && incompleteReason === null) {
    throw new ResponsesAdapterError('INVALID_RESPONSE');
  }

  return {
    id: rawCompletion.id,
    metadata,
    text,
    sources: extractToolSources(rawCompletion.output),
    usage: {
      inputTokens,
      outputTokens,
      ...(isRecord(rawCompletion.usage.input_tokens_details)
        ? {
            cachedInputTokens: readTokenCount(
              rawCompletion.usage.input_tokens_details.cached_tokens,
            ),
          }
        : {}),
    },
    status,
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

function readIncompleteReason(rawCompletion: Record<string, unknown>): 'max_output_tokens' | null {
  if (rawCompletion.status === 'completed') return null;
  const details = rawCompletion.incomplete_details;
  if (!isRecord(details) || details.reason !== 'max_output_tokens') return null;
  return 'max_output_tokens';
}

function extractToolSources(output: unknown[]): NeutralResponseSource[] {
  const sources: NeutralResponseSource[] = [];
  const seenUrls = new Set<string>();

  for (const item of output) {
    if (!isRecord(item) || item.type !== 'web_search_call' || !isRecord(item.action)) continue;
    if (!Array.isArray(item.action.sources)) continue;

    for (const candidate of item.action.sources) {
      if (!isRecord(candidate) || !isNonEmptyString(candidate.title)) continue;
      const url = normalizeSourceUrl(candidate.url);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      sources.push({ title: candidate.title.trim(), url, provenance: 'web_search' });
    }
  }
  return sources;
}

function normalizeSourceUrl(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function abortError(state: {
  callerAborted: boolean;
  timedOut: boolean;
}): ResponsesAdapterError {
  return new ResponsesAdapterError(
    state.timedOut && !state.callerAborted ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED',
  );
}

function readTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
