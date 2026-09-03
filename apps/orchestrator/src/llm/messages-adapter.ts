import Anthropic from '@anthropic-ai/sdk';
import type { ModelDataRegion } from './model-data-region.js';
import {
  type QwenPurpose,
  type QwenRuntimeEnvironment,
  resolveQwenRoute,
  toSafeQwenRouteMetadata,
} from './qwen-route.js';

export type MessagesAdapterErrorCode =
  | 'ADAPTER_DISABLED'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'PROVIDER_ERROR';

export class MessagesAdapterError extends Error {
  constructor(
    public readonly code: MessagesAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MessagesAdapterError';
  }
}

export type MessagesProviderMetadata =
  | { provider: 'anthropic'; model: string }
  | {
      provider: 'alibaba-model-studio';
      model: string;
      region: ModelDataRegion;
      deploymentScope: 'china_mainland' | 'international';
      endpointKind: 'public' | 'workspace_dedicated';
    };

export interface NeutralTextBlock {
  type: 'text';
  text: string;
}

export interface NeutralImageBlock {
  type: 'image';
  source: {
    kind: 'base64';
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface NeutralToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface NeutralToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type NeutralInputContentBlock =
  | NeutralTextBlock
  | NeutralImageBlock
  | NeutralToolUseBlock
  | NeutralToolResultBlock;

export type NeutralOutputContentBlock = NeutralTextBlock | NeutralToolUseBlock;

export interface NeutralSystemBlock extends NeutralTextBlock {
  cacheControl?: 'ephemeral';
}

export interface NeutralMessage {
  role: 'user' | 'assistant';
  content: string | ReadonlyArray<NeutralInputContentBlock>;
}

export interface NeutralToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type NeutralToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

export interface NeutralMessagesRequest {
  maxTokens: number;
  /** Explicitly disable provider reasoning for short, deterministic output lanes. */
  thinking?: { type: 'disabled' };
  system?: string | ReadonlyArray<NeutralSystemBlock>;
  messages: ReadonlyArray<NeutralMessage>;
  tools?: ReadonlyArray<NeutralToolDefinition>;
  toolChoice?: NeutralToolChoice;
  temperature?: number;
  stopSequences?: ReadonlyArray<string>;
}

export interface NeutralMessagesRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface NeutralMessagesResponse {
  id: string;
  metadata: MessagesProviderMetadata;
  content: NeutralOutputContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown';
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadInputTokens: number | null;
    cacheCreationInputTokens: number | null;
    complete: boolean;
  };
}

export interface MessagesAdapter {
  readonly metadata: MessagesProviderMetadata;
  create(
    request: NeutralMessagesRequest,
    options?: NeutralMessagesRequestOptions,
  ): Promise<NeutralMessagesResponse>;
}

interface AnthropicCompatibleRequest {
  model: string;
  max_tokens: number;
  thinking?: { type: 'disabled' };
  system?: unknown;
  messages: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  temperature?: number;
  stop_sequences?: string[];
}

interface AnthropicCompatibleRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

export interface AnthropicCompatibleClient {
  messages: {
    create(
      request: AnthropicCompatibleRequest,
      options?: AnthropicCompatibleRequestOptions,
    ): Promise<unknown>;
  };
}

export interface AnthropicCompatibleClientOptions {
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

export type AnthropicCompatibleClientFactory = (
  options: AnthropicCompatibleClientOptions,
) => AnthropicCompatibleClient;

export function createAnthropicCompatibleMessagesAdapter(input: {
  client: AnthropicCompatibleClient;
  metadata: MessagesProviderMetadata;
}): MessagesAdapter {
  const metadata = Object.freeze({ ...input.metadata }) as MessagesProviderMetadata;

  return {
    metadata,
    async create(request, options) {
      const providerRequest = toAnthropicCompatibleRequest(request, metadata.model);
      let rawResponse: unknown;
      try {
        rawResponse = await input.client.messages.create(
          providerRequest,
          toAnthropicCompatibleOptions(options),
        );
      } catch (error) {
        throw normalizeProviderError(error, options);
      }
      return normalizeAnthropicCompatibleResponse(rawResponse, metadata);
    },
  };
}

export function createAnthropicMessagesAdapter(input: {
  apiKey: string;
  model: string;
  clientFactory?: AnthropicCompatibleClientFactory;
}): MessagesAdapter {
  if (!isNonEmptyString(input.apiKey) || !isNonEmptyString(input.model)) {
    throw new MessagesAdapterError('INVALID_REQUEST', 'Message provider configuration is invalid');
  }
  const clientFactory = input.clientFactory ?? defaultAnthropicCompatibleClientFactory;
  return createAnthropicCompatibleMessagesAdapter({
    client: clientFactory({ apiKey: input.apiKey }),
    metadata: { provider: 'anthropic', model: input.model },
  });
}

export interface QwenMessagesEnvironment extends QwenRuntimeEnvironment {
  QWEN_MESSAGES_ADAPTER_ENABLED: boolean;
}

export function createQwenMessagesAdapter(input: {
  environment: QwenMessagesEnvironment;
  region: ModelDataRegion;
  purpose: QwenPurpose;
  clientFactory?: AnthropicCompatibleClientFactory;
}): MessagesAdapter {
  if (!input.environment.QWEN_MESSAGES_ADAPTER_ENABLED) {
    throw new MessagesAdapterError('ADAPTER_DISABLED', 'Qwen messages adapter is disabled');
  }

  const route = resolveQwenRoute(input.environment, input.region, input.purpose);
  const clientFactory = input.clientFactory ?? defaultAnthropicCompatibleClientFactory;
  const client = clientFactory({
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    ...(route.workspaceId
      ? { defaultHeaders: { 'X-DashScope-WorkSpace': route.workspaceId } }
      : {}),
  });

  return createAnthropicCompatibleMessagesAdapter({
    client,
    metadata: toSafeQwenRouteMetadata(route),
  });
}

function defaultAnthropicCompatibleClientFactory(
  options: AnthropicCompatibleClientOptions,
): AnthropicCompatibleClient {
  return new Anthropic(options) as unknown as AnthropicCompatibleClient;
}

function toAnthropicCompatibleRequest(
  request: NeutralMessagesRequest,
  model: string,
): AnthropicCompatibleRequest {
  validateRequest(request);
  return {
    model,
    max_tokens: request.maxTokens,
    ...(request.thinking !== undefined ? { thinking: { type: request.thinking.type } } : {}),
    ...(request.system !== undefined ? { system: mapSystem(request.system) } : {}),
    messages: request.messages.map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map(mapInputContentBlock),
    })),
    ...(request.tools !== undefined
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          })),
        }
      : {}),
    ...(request.toolChoice !== undefined ? { tool_choice: mapToolChoice(request.toolChoice) } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.stopSequences !== undefined ? { stop_sequences: [...request.stopSequences] } : {}),
  };
}

function toAnthropicCompatibleOptions(
  options: NeutralMessagesRequestOptions | undefined,
): AnthropicCompatibleRequestOptions | undefined {
  if (!options) return undefined;
  return {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  };
}

function mapSystem(system: string | ReadonlyArray<NeutralSystemBlock>): unknown {
  if (typeof system === 'string') return system;
  return system.map((block) => ({
    type: 'text',
    text: block.text,
    ...(block.cacheControl === 'ephemeral' ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
}

function mapInputContentBlock(block: NeutralInputContentBlock): unknown {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: block.source.mediaType,
          data: block.source.data,
        },
      };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError !== undefined ? { is_error: block.isError } : {}),
      };
  }
}

function mapToolChoice(choice: NeutralToolChoice): unknown {
  return choice.type === 'tool' ? { type: 'tool', name: choice.name } : { type: choice.type };
}

function validateRequest(request: NeutralMessagesRequest): void {
  if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens <= 0) {
    throw new MessagesAdapterError('INVALID_REQUEST', 'Message request is invalid');
  }
  if (request.messages.length === 0) {
    throw new MessagesAdapterError('INVALID_REQUEST', 'Message request is invalid');
  }
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 1)
  ) {
    throw new MessagesAdapterError('INVALID_REQUEST', 'Message request is invalid');
  }
  if (request.toolChoice?.type === 'tool') {
    const forcedToolName = request.toolChoice.name;
    const matchingTools = request.tools?.filter((tool) => tool.name === forcedToolName);
    if (matchingTools?.length !== 1) {
      throw new MessagesAdapterError('INVALID_REQUEST', 'Message request is invalid');
    }
  }
}

function normalizeAnthropicCompatibleResponse(
  rawResponse: unknown,
  metadata: MessagesProviderMetadata,
): NeutralMessagesResponse {
  if (
    !isRecord(rawResponse) ||
    !isNonEmptyString(rawResponse.id) ||
    !Array.isArray(rawResponse.content)
  ) {
    throw new MessagesAdapterError('INVALID_RESPONSE', 'Message provider response is invalid');
  }

  const content: NeutralOutputContentBlock[] = [];
  for (const rawBlock of rawResponse.content) {
    if (!isRecord(rawBlock)) continue;
    if (rawBlock.type === 'text') {
      if (typeof rawBlock.text !== 'string') {
        throw new MessagesAdapterError('INVALID_RESPONSE', 'Message provider response is invalid');
      }
      content.push({ type: 'text', text: rawBlock.text });
      continue;
    }
    if (rawBlock.type === 'tool_use') {
      if (
        !isNonEmptyString(rawBlock.id) ||
        !isNonEmptyString(rawBlock.name) ||
        !('input' in rawBlock)
      ) {
        throw new MessagesAdapterError('INVALID_RESPONSE', 'Message provider response is invalid');
      }
      content.push({
        type: 'tool_use',
        id: rawBlock.id,
        name: rawBlock.name,
        input: rawBlock.input,
      });
    }
  }
  if (content.length === 0) {
    throw new MessagesAdapterError('INVALID_RESPONSE', 'Message provider response is invalid');
  }

  const inputTokens = readTokenCount(rawResponse.usage, 'input_tokens');
  const outputTokens = readTokenCount(rawResponse.usage, 'output_tokens');
  return {
    id: rawResponse.id,
    metadata,
    content,
    stopReason: normalizeStopReason(rawResponse.stop_reason, content),
    usage: {
      inputTokens,
      outputTokens,
      cacheReadInputTokens: readTokenCount(rawResponse.usage, 'cache_read_input_tokens'),
      cacheCreationInputTokens: readTokenCount(rawResponse.usage, 'cache_creation_input_tokens'),
      complete: inputTokens !== null && outputTokens !== null,
    },
  };
}

function normalizeStopReason(
  stopReason: unknown,
  content: ReadonlyArray<NeutralOutputContentBlock>,
): NeutralMessagesResponse['stopReason'] {
  if (stopReason === 'end_turn' && content.some((block) => block.type === 'tool_use')) {
    return 'tool_use';
  }
  if (
    stopReason === 'end_turn' ||
    stopReason === 'tool_use' ||
    stopReason === 'max_tokens' ||
    stopReason === 'stop_sequence'
  ) {
    return stopReason;
  }
  return 'unknown';
}

function normalizeProviderError(
  error: unknown,
  options: NeutralMessagesRequestOptions | undefined,
): MessagesAdapterError {
  const name = error instanceof Error ? error.name : isRecord(error) ? error.name : undefined;
  if (options?.signal?.aborted || name === 'AbortError' || name === 'APIUserAbortError') {
    return new MessagesAdapterError('REQUEST_ABORTED', 'Message provider request was aborted');
  }

  const status = isRecord(error) ? error.status : undefined;
  const code = isRecord(error) ? error.code : undefined;
  if (
    name === 'APIConnectionTimeoutError' ||
    code === 'ETIMEDOUT' ||
    status === 408 ||
    status === 504
  ) {
    return new MessagesAdapterError('REQUEST_TIMEOUT', 'Message provider request timed out');
  }

  return new MessagesAdapterError('PROVIDER_ERROR', 'Message provider request failed');
}

function readTokenCount(container: unknown, key: string): number | null {
  if (!isRecord(container)) return null;
  const value = container[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
