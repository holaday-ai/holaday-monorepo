import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralInputContentBlock,
  type NeutralMessage,
} from '../messages-adapter.js';
import {
  type ExternalResponsesMetadata,
  type NeutralResponsesRequest,
  type ResponsesAdapter,
  ResponsesAdapterError,
} from '../responses-adapter.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/**
 * Generation lanes speak the Responses contract. Providers without a Responses
 * API (Claude) answer through their Messages adapter: one non-streamed call,
 * delivered as a single text delta. Built-in web tools are not forwarded, so
 * research on this brain returns no tool-attributed sources.
 */
export function createMessagesBackedResponsesAdapter(input: {
  messages: MessagesAdapter;
  provider: 'anthropic' | 'openai';
}): ResponsesAdapter {
  const metadata: ExternalResponsesMetadata = Object.freeze({
    provider: input.provider,
    model: input.messages.metadata.model,
    protocol: 'responses' as const,
  });

  return {
    metadata,
    async stream(request, options) {
      let response: Awaited<ReturnType<MessagesAdapter['create']>>;
      try {
        response = await input.messages.create(
          {
            maxTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            ...(request.instructions ? { system: request.instructions } : {}),
            messages: toMessages(request.input),
            ...(typeof request.temperature === 'number'
              ? { temperature: Math.min(1, Math.max(0, request.temperature)) }
              : {}),
          },
          {
            ...(options?.signal ? { signal: options.signal } : {}),
            ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            maxRetries: 0,
          },
        );
      } catch (error) {
        throw toResponsesError(error);
      }
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      if (text) {
        try {
          options?.onTextDelta?.(text);
        } catch {
          // Consumer rendering errors must not corrupt the canonical provider result.
        }
      }
      const truncated = response.stopReason === 'max_tokens';
      return {
        id: response.id,
        metadata,
        text,
        sources: [],
        usage: {
          inputTokens: response.usage.inputTokens ?? 0,
          outputTokens: response.usage.outputTokens ?? 0,
        },
        status: truncated ? 'incomplete' : 'completed',
        ...(truncated ? { incompleteReason: 'max_output_tokens' as const } : {}),
      };
    },
  };
}

function toMessages(value: NeutralResponsesRequest['input']): NeutralMessage[] {
  if (typeof value === 'string') return [{ role: 'user', content: value }];
  return value.map((message) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map(
            (block): NeutralInputContentBlock =>
              block.type === 'input_text'
                ? { type: 'text', text: block.text }
                : {
                    type: 'image',
                    source: {
                      kind: 'base64',
                      mediaType: block.source.mediaType,
                      data: block.source.data,
                    },
                  },
          ),
  }));
}

function toResponsesError(error: unknown): ResponsesAdapterError {
  if (error instanceof MessagesAdapterError) {
    switch (error.code) {
      case 'REQUEST_ABORTED':
        return new ResponsesAdapterError('REQUEST_ABORTED');
      case 'REQUEST_TIMEOUT':
        return new ResponsesAdapterError('REQUEST_TIMEOUT');
      case 'INVALID_RESPONSE':
        return new ResponsesAdapterError('INVALID_RESPONSE');
      default:
        return new ResponsesAdapterError('PROVIDER_ERROR');
    }
  }
  return new ResponsesAdapterError('PROVIDER_ERROR');
}
