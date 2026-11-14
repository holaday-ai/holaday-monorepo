import type {
  CoreModelRuntimeEnvironment,
  CoreModelRuntimeInput,
  CoreModelRuntimeUnavailableReason,
} from '../llm/core-model-runtime.js';
import { modelGateway } from '../llm/gateway/model-gateway.js';
import type { ModelGatewayEnvironment } from '../llm/gateway/settings.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';

type QwenMessagesAdapter = Omit<MessagesAdapter, 'metadata'> & {
  readonly metadata: Extract<MessagesAdapter['metadata'], { provider: 'alibaba-model-studio' }>;
};

export type SuggestionsProviderEnvironment = CoreModelRuntimeEnvironment & ModelGatewayEnvironment;

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
  const runtime = modelGateway({
    core: { environment: input.environment, createMessages: input.createMessages },
  }).resolve('suggestions', {
    actorExternalId: input.userExternalId,
    ownership: {
      scope: 'personal',
      userRegion: input.userModelDataRegion,
    },
  });

  if (runtime.kind === 'unavailable') {
    return { provider: 'unavailable', reason: runtime.reason };
  }

  const messagesAdapter = runtime.messages();
  if (messagesAdapter.metadata.provider !== 'alibaba-model-studio') {
    throw new Error('Qwen suggestions runtime returned a non-Qwen adapter');
  }
  return {
    provider: 'qwen',
    region: runtime.region,
    messagesAdapter: messagesAdapter as QwenMessagesAdapter,
  };
}
