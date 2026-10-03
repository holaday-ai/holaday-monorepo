import OpenAI from 'openai';
import {
  type ExternalResponsesMetadata,
  type NeutralResponseSource,
  type NeutralResponsesRequest,
  type NeutralResponsesResult,
  type ResponsesAdapter,
  ResponsesAdapterError,
} from '../responses-adapter.js';

export interface OpenAIResponsesClient {
  responses: {
    create(
      request: Record<string, unknown>,
      options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
    ): Promise<unknown>;
  };
}

export type OpenAIResponsesClientFactory = (options: {
  apiKey: string;
  baseURL?: string;
}) => OpenAIResponsesClient;

/** Catalog-gated GPT brain for streaming generation/research lanes. */
export function createOpenAIResponsesAdapter(input: {
  apiKey: string;
  model: string;
  baseURL?: string;
  clientFactory?: OpenAIResponsesClientFactory;
}): ResponsesAdapter {
  if (!input.apiKey.trim() || !input.model.trim()) {
    throw new ResponsesAdapterError('PROVIDER_ERROR');
  }
  const client = (input.clientFactory ?? defaultClientFactory)({
    apiKey: input.apiKey,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
  });
  const metadata: ExternalResponsesMetadata = Object.freeze({
    provider: 'openai' as const,
    model: input.model,
    protocol: 'responses' as const,
  });

  return {
    metadata,
    async stream(request, options) {
      if (options?.signal?.aborted) throw new ResponsesAdapterError('REQUEST_ABORTED');
      let events: unknown;
      try {
        events = await client.responses.create(toOpenAIResponsesRequest(request, input.model), {
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
          maxRetries: 0,
        });
      } catch (error) {
        throw normalizeError(error, options?.signal);
      }
      if (!isAsyncIterable(events)) throw new ResponsesAdapterError('INVALID_RESPONSE');

      let text = '';
      let final: unknown;
      try {
        for await (const event of events) {
          if (!isRecord(event)) continue;
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            text += event.delta;
            if (event.delta) safeCall(() => options?.onTextDelta?.(event.delta as string));
          } else if (
            typeof event.type === 'string' &&
            (event.type.startsWith('response.reasoning') ||
              event.type.startsWith('response.web_search'))
          ) {
            safeCall(() => options?.onProgress?.());
          } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
            final = event.response;
          } else if (event.type === 'response.failed' || event.type === 'error') {
            throw new ResponsesAdapterError('PROVIDER_ERROR');
          }
        }
      } catch (error) {
        if (error instanceof ResponsesAdapterError) throw error;
        throw normalizeError(error, options?.signal);
      }
      return normalizeOpenAIResponse(final, text, metadata);
    },
  };
}

export function toOpenAIResponsesRequest(
  request: NeutralResponsesRequest,
  model: string,
): Record<string, unknown> {
  const tools = (request.tools ?? []).flatMap((tool) =>
    tool.type === 'web_search' ? [{ type: 'web_search_preview' }] : [],
  );
  return {
    model,
    stream: true,
    store: false,
    ...(request.instructions ? { instructions: request.instructions } : {}),
    input:
      typeof request.input === 'string'
        ? request.input
        : request.input.map((message) => ({
            role: message.role,
            content:
              typeof message.content === 'string'
                ? message.content
                : message.content.map((block) =>
                    block.type === 'input_text'
                      ? {
                          type: message.role === 'assistant' ? 'output_text' : 'input_text',
                          text: block.text,
                        }
                      : {
                          type: 'input_image',
                          image_url: `data:${block.source.mediaType};base64,${block.source.data}`,
                        },
                  ),
          })),
    ...(tools.length > 0 ? { tools } : {}),
    ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
  };
}

export function normalizeOpenAIResponse(
  raw: unknown,
  streamedText: string,
  metadata: ExternalResponsesMetadata,
): NeutralResponsesResult {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    throw new ResponsesAdapterError('INVALID_RESPONSE');
  }
  const status =
    raw.status === 'incomplete' ? 'incomplete' : raw.status === 'completed' ? 'completed' : null;
  if (!status) throw new ResponsesAdapterError('INVALID_RESPONSE');
  const usage = isRecord(raw.usage) ? raw.usage : {};
  const incompleteReason =
    status === 'incomplete' &&
    isRecord(raw.incomplete_details) &&
    raw.incomplete_details.reason === 'max_output_tokens'
      ? ('max_output_tokens' as const)
      : undefined;
  if (status === 'incomplete' && !incompleteReason) {
    throw new ResponsesAdapterError('INVALID_RESPONSE');
  }
  return {
    id: raw.id,
    metadata,
    text: streamedText || collectOutputText(raw.output),
    sources: collectCitations(raw.output),
    usage: {
      inputTokens: readCount(usage.input_tokens),
      outputTokens: readCount(usage.output_tokens),
    },
    status,
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

function collectOutputText(output: unknown): string {
  if (!Array.isArray(output)) return '';
  return output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .flatMap((part) =>
      isRecord(part) && part.type === 'output_text' && typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('');
}

function collectCitations(output: unknown): NeutralResponseSource[] {
  const sources: NeutralResponseSource[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(output)) return sources;
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part) || !Array.isArray(part.annotations)) continue;
      for (const annotation of part.annotations) {
        if (!isRecord(annotation) || annotation.type !== 'url_citation') continue;
        const url = safeUrl(annotation.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const title =
          typeof annotation.title === 'string' && annotation.title.trim()
            ? annotation.title.trim()
            : url;
        sources.push({ title, url, provenance: 'web_search' });
      }
    }
  }
  return sources;
}

function normalizeError(error: unknown, signal: AbortSignal | undefined): ResponsesAdapterError {
  const name = error instanceof Error ? error.name : undefined;
  if (signal?.aborted || name === 'AbortError' || name === 'APIUserAbortError') {
    return new ResponsesAdapterError('REQUEST_ABORTED');
  }
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : null;
  if (name === 'APIConnectionTimeoutError' || status === 408 || status === 504) {
    return new ResponsesAdapterError('REQUEST_TIMEOUT', status);
  }
  return new ResponsesAdapterError('PROVIDER_ERROR', status);
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // Consumer rendering errors must not corrupt the canonical provider result.
  }
}

function defaultClientFactory(options: {
  apiKey: string;
  baseURL?: string;
}): OpenAIResponsesClient {
  return new OpenAI(options) as unknown as OpenAIResponsesClient;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
