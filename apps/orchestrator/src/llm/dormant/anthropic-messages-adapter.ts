import Anthropic from '@anthropic-ai/sdk';
import {
  type AnthropicCompatibleClient,
  type AnthropicCompatibleClientFactory,
  type MessagesAdapter,
  MessagesAdapterError,
  createAnthropicCompatibleMessagesAdapter,
} from '../messages-adapter.js';

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

function defaultAnthropicCompatibleClientFactory(options: {
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}): AnthropicCompatibleClient {
  return new Anthropic(options) as unknown as AnthropicCompatibleClient;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
