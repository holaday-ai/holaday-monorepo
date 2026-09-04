import {
  type CoreModelRuntimeEnvironment,
  type CoreModelRuntimeInput,
  type CoreModelRuntimeUnavailableReason,
  resolveCoreModelRuntime,
} from '../llm/core-model-runtime.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';

type QwenMessagesAdapter = Omit<MessagesAdapter, 'metadata'> & {
  readonly metadata: Extract<MessagesAdapter['metadata'], { provider: 'alibaba-model-studio' }>;
};

export type SuggestionsProviderEnvironment = CoreModelRuntimeEnvironment;

export type SuggestionsProviderRoute =
  | {
      provider: 'qwen';
      region: 'cn' | 'intl';
      messagesAdapter: QwenMessagesAdapter;
    }
  | {
      provider: 'unavailable';
      reason: CoreModelRuntimeUnavailableReason;
    };

export function resolveSuggestionsProviderRoute(input: {
  environment: SuggestionsProviderEnvironment;
  userExternalId: string;
  userModelDataRegion: unknown;
  createMessages?: CoreModelRuntimeInput['createMessages'];
}): SuggestionsProviderRoute {
  const runtime = resolveCoreModelRuntime({
    environment: input.environment,
    actorExternalId: input.userExternalId,
    lane: 'suggestions',
    ownership: {
      scope: 'personal',
      userRegion: input.userModelDataRegion,
    },
    createMessages: input.createMessages,
  });

  if (runtime.kind === 'unavailable') {
    return { provider: 'unavailable', reason: runtime.reason };
  }

  const messagesAdapter = runtime.messages('fast');
  if (messagesAdapter.metadata.provider !== 'alibaba-model-studio') {
    throw new Error('Qwen suggestions runtime returned a non-Qwen adapter');
  }
  return {
    provider: 'qwen',
    region: runtime.region,
    messagesAdapter: messagesAdapter as QwenMessagesAdapter,
  };
}
