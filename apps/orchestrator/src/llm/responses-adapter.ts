import type { QwenRoute, SafeQwenRouteMetadata } from './qwen-route.js';
import { toSafeQwenRouteMetadata } from './qwen-route.js';

export type NeutralBuiltinTool =
  | { type: 'web_search' }
  | { type: 'web_extractor' }
  | { type: 'code_interpreter' };

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

export interface NeutralResponsesResult {
  id: string;
  metadata: SafeQwenRouteMetadata;
  text: string;
  sources: NeutralResponseSource[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  status: 'completed' | 'incomplete';
  incompleteReason?: 'max_output_tokens';
}

export interface ResponsesAdapter {
  readonly metadata: SafeQwenRouteMetadata;
  stream(
    request: NeutralResponsesRequest,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onTextDelta?: (delta: string) => void;
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
const ALLOWED_TOOL_TYPES = new Set<NeutralBuiltinTool['type']>([
  'web_search',
  'web_extractor',
  'code_interpreter',
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
}): ResponsesAdapter {
  if (input.route.protocol !== 'responses') {
    throw new ResponsesAdapterError('PROVIDER_ERROR');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const metadata = Object.freeze(toSafeQwenRouteMetadata(input.route));

  return {
    metadata,
    async stream(request, options) {
      const controller = new AbortController();
      let callerAborted = options?.signal?.aborted ?? false;
      let timedOut = false;
      const abortFromCaller = () => {
        callerAborted = true;
        controller.abort();
      };
      options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timeoutId =
        options?.timeoutMs !== undefined && options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, options.timeoutMs)
          : undefined;

      try {
        if (callerAborted) throw new ResponsesAdapterError('REQUEST_ABORTED');

        let response: Response;
        try {
          response = await fetchImpl(`${input.route.baseURL}/responses`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'text/event-stream',
              authorization: `Bearer ${input.route.apiKey}`,
              ...(input.route.workspaceId
                ? { 'x-dashscope-workspace': input.route.workspaceId }
                : {}),
            },
            body: JSON.stringify(toProviderRequest(request, input.route.model)),
            signal: controller.signal,
          });
        } catch {
          if (controller.signal.aborted) {
            throw abortError({ callerAborted, timedOut });
          }
          throw new ResponsesAdapterError('PROVIDER_ERROR');
        }

        if (!response.ok) {
          throw new ResponsesAdapterError('PROVIDER_ERROR', response.status);
        }
        if (!response.body) {
          throw new ResponsesAdapterError('INVALID_RESPONSE', response.status);
        }

        try {
          return await consumeResponsesStream({
            body: response.body,
            metadata,
            signal: controller.signal,
            onTextDelta: options?.onTextDelta,
          });
        } catch (error) {
          if (error instanceof ResponsesAdapterError) throw error;
          if (controller.signal.aborted) {
            throw abortError({ callerAborted, timedOut });
          }
          throw new ResponsesAdapterError('INVALID_RESPONSE', response.status);
        }
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        options?.signal?.removeEventListener('abort', abortFromCaller);
      }
    },
  };
}

function toProviderRequest(
  request: NeutralResponsesRequest,
  model: string,
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
            .filter((tool) => ALLOWED_TOOL_TYPES.has(tool.type))
            .map((tool) => ({ type: tool.type })),
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
  body: ReadableStream<Uint8Array>;
  metadata: SafeQwenRouteMetadata;
  signal: AbortSignal;
  onTextDelta?: (delta: string) => void;
}): Promise<NeutralResponsesResult> {
  const reader = input.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let completion: unknown;

  const consumeEvent = (eventBlock: string) => {
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
      if (completion !== undefined) throw new ResponsesAdapterError('INVALID_RESPONSE');
      completion = event.response;
    }
  };

  try {
    while (true) {
      const chunk = await readChunk(reader, input.signal);
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > MAX_PENDING_SSE_BYTES) {
        throw new ResponsesAdapterError('INVALID_RESPONSE');
      }
      pending = drainSseEvents(pending, consumeEvent);
    }
    pending += decoder.decode();
    if (pending.trim()) consumeEvent(pending);
  } finally {
    reader.releaseLock();
  }

  return normalizeCompletion(completion, text, input.metadata);
}

function drainSseEvents(pending: string, consume: (eventBlock: string) => void): string {
  let remainder = pending;
  while (true) {
    const match = /\r?\n\r?\n/.exec(remainder);
    if (!match || match.index === undefined) return remainder;
    consume(remainder.slice(0, match.index));
    remainder = remainder.slice(match.index + match[0].length);
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  return await new Promise((resolve, reject) => {
    const abortRead = () => {
      reject(new DOMException('Aborted', 'AbortError'));
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', abortRead, { once: true });
    reader.read().then(
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
    usage: { inputTokens, outputTokens },
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
