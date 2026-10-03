import OpenAI from 'openai';
import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralInputContentBlock,
  type NeutralMessagesRequest,
  type NeutralMessagesRequestOptions,
  type NeutralMessagesResponse,
  type NeutralOutputContentBlock,
} from '../messages-adapter.js';

/** The subset of the OpenAI SDK this adapter depends on (injectable for tests). */
export interface OpenAIChatClient {
  chat: {
    completions: {
      create(
        request: Record<string, unknown>,
        options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
      ): Promise<unknown>;
    };
  };
}

export type OpenAIChatClientFactory = (options: {
  apiKey: string;
  baseURL?: string;
}) => OpenAIChatClient;

/**
 * Catalog-gated GPT brain: maps the provider-neutral Messages/Tools contract
 * onto Chat Completions so every lane that speaks `MessagesAdapter` can run on it.
 */
export function createOpenAIMessagesAdapter(input: {
  apiKey: string;
  model: string;
  baseURL?: string;
  clientFactory?: OpenAIChatClientFactory;
}): MessagesAdapter {
  if (!input.apiKey.trim() || !input.model.trim()) {
    throw new MessagesAdapterError('INVALID_REQUEST', 'Message provider configuration is invalid');
  }
  const client = (input.clientFactory ?? defaultOpenAIChatClientFactory)({
    apiKey: input.apiKey,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
  });
  const metadata = Object.freeze({ provider: 'openai' as const, model: input.model });

  return {
    metadata,
    async create(request, options) {
      let raw: unknown;
      try {
        raw = await client.chat.completions.create(
          toChatCompletionRequest(request, input.model),
          toRequestOptions(options),
        );
      } catch (error) {
        throw normalizeOpenAIError(error, options);
      }
      return normalizeChatCompletion(raw, metadata);
    },
  };
}

export function toChatCompletionRequest(
  request: NeutralMessagesRequest,
  model: string,
): Record<string, unknown> {
  if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens <= 0) {
    throw new MessagesAdapterError('INVALID_REQUEST', 'Message request is invalid');
  }
  if (request.messages.length === 0) {
    throw new MessagesAdapterError('INVALID_REQUEST', 'Message request is invalid');
  }
  const messages: Array<Record<string, unknown>> = [];
  if (request.system !== undefined) {
    const system =
      typeof request.system === 'string'
        ? request.system
        : request.system.map((block) => block.text).join('\n\n');
    if (system) messages.push({ role: 'system', content: system });
  }
  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      messages.push(toAssistantMessage(message.content));
      continue;
    }
    // Tool results must directly follow the assistant tool_calls they answer.
    const parts: Array<Record<string, unknown>> = [];
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        messages.push({
          role: 'tool',
          tool_call_id: block.toolUseId,
          content: block.isError ? `[error] ${block.content}` : block.content,
        });
      } else if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.source.mediaType};base64,${block.source.data}` },
        });
      }
    }
    if (parts.length > 0) messages.push({ role: 'user', content: parts });
  }

  return {
    model,
    messages,
    max_completion_tokens: request.maxTokens,
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
    ...(request.toolChoice ? { tool_choice: mapToolChoice(request.toolChoice) } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.stopSequences && request.stopSequences.length > 0
      ? { stop: request.stopSequences.slice(0, 4) }
      : {}),
  };
}

function toAssistantMessage(content: ReadonlyArray<NeutralInputContentBlock>) {
  const text = content
    .filter(
      (block): block is Extract<NeutralInputContentBlock, { type: 'text' }> =>
        block.type === 'text',
    )
    .map((block) => block.text)
    .join('');
  const toolCalls = content
    .filter(
      (block): block is Extract<NeutralInputContentBlock, { type: 'tool_use' }> =>
        block.type === 'tool_use',
    )
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
    }));
  return {
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function mapToolChoice(choice: NonNullable<NeutralMessagesRequest['toolChoice']>): unknown {
  switch (choice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return { type: 'function', function: { name: choice.name } };
  }
}

function toRequestOptions(options: NeutralMessagesRequestOptions | undefined) {
  if (!options) return undefined;
  return {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  };
}

export function normalizeChatCompletion(
  raw: unknown,
  metadata: { provider: 'openai'; model: string },
): NeutralMessagesResponse {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.choices)) {
    throw new MessagesAdapterError('INVALID_RESPONSE', 'Message provider response is invalid');
  }
  const choice = raw.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new MessagesAdapterError('INVALID_RESPONSE', 'Message provider response is invalid');
  }
  const content: NeutralOutputContentBlock[] = [];
  if (typeof choice.message.content === 'string' && choice.message.content) {
    content.push({ type: 'text', text: choice.message.content });
  }
  if (Array.isArray(choice.message.tool_calls)) {
    for (const call of choice.message.tool_calls) {
      if (!isRecord(call) || typeof call.id !== 'string' || !isRecord(call.function)) continue;
      const name = call.function.name;
      if (typeof name !== 'string' || !name) continue;
      content.push({
        type: 'tool_use',
        id: call.id,
        name,
        input: parseArguments(call.function.arguments),
      });
    }
  }
  if (content.length === 0) {
    throw new MessagesAdapterError('INVALID_RESPONSE', 'Message provider response is invalid');
  }
  const usage = isRecord(raw.usage) ? raw.usage : {};
  const inputTokens = readCount(usage.prompt_tokens);
  const outputTokens = readCount(usage.completion_tokens);
  const cached = isRecord(usage.prompt_tokens_details)
    ? readCount(usage.prompt_tokens_details.cached_tokens)
    : null;
  return {
    id: raw.id,
    metadata,
    content,
    stopReason: mapFinishReason(choice.finish_reason, content),
    usage: {
      inputTokens,
      outputTokens,
      cacheReadInputTokens: cached,
      cacheCreationInputTokens: null,
      complete: inputTokens !== null && outputTokens !== null,
    },
  };
}

function mapFinishReason(
  reason: unknown,
  content: readonly NeutralOutputContentBlock[],
): NeutralMessagesResponse['stopReason'] {
  if (content.some((block) => block.type === 'tool_use')) return 'tool_use';
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  return 'unknown';
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function normalizeOpenAIError(
  error: unknown,
  options: { signal?: AbortSignal } | undefined,
): MessagesAdapterError {
  const name = error instanceof Error ? error.name : undefined;
  if (options?.signal?.aborted || name === 'AbortError' || name === 'APIUserAbortError') {
    return new MessagesAdapterError('REQUEST_ABORTED', 'Message provider request was aborted');
  }
  const status = isRecord(error) ? error.status : undefined;
  if (name === 'APIConnectionTimeoutError' || status === 408 || status === 504) {
    return new MessagesAdapterError('REQUEST_TIMEOUT', 'Message provider request timed out');
  }
  return new MessagesAdapterError('PROVIDER_ERROR', 'Message provider request failed');
}

function defaultOpenAIChatClientFactory(options: {
  apiKey: string;
  baseURL?: string;
}): OpenAIChatClient {
  return new OpenAI(options) as unknown as OpenAIChatClient;
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
