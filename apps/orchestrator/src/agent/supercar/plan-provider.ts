import {
  type CoreModelRuntimeEnvironment,
  type CoreModelRuntimeInput,
  type CoreModelRuntimeUnavailableReason,
  resolveCoreModelRuntime,
} from '../../llm/core-model-runtime.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';

type QwenMessagesAdapter = Omit<MessagesAdapter, 'metadata'> & {
  readonly metadata: Extract<MessagesAdapter['metadata'], { provider: 'alibaba-model-studio' }>;
};

export type PlanProviderEnvironment = CoreModelRuntimeEnvironment;

export type PlanProviderRoute =
  | {
      provider: 'qwen';
      region: 'cn' | 'intl';
      messagesAdapter: QwenMessagesAdapter;
    }
  | {
      provider: 'unavailable';
      reason: CoreModelRuntimeUnavailableReason;
    };

export function resolvePlanProviderRoute(input: {
  environment: PlanProviderEnvironment;
  userExternalId: string;
  userModelDataRegion: unknown;
  createMessages?: CoreModelRuntimeInput['createMessages'];
}): PlanProviderRoute {
  const runtime = resolveCoreModelRuntime({
    environment: input.environment,
    actorExternalId: input.userExternalId,
    lane: 'plan',
    ownership: {
      scope: 'personal',
      userRegion: input.userModelDataRegion,
    },
    createMessages: input.createMessages,
  });

  if (runtime.kind === 'unavailable') {
    return { provider: 'unavailable', reason: runtime.reason };
  }

  const messagesAdapter = runtime.messages('standard');
  if (messagesAdapter.metadata.provider !== 'alibaba-model-studio') {
    throw new Error('Qwen plan runtime returned a non-Qwen adapter');
  }
  return {
    provider: 'qwen',
    region: runtime.region,
    messagesAdapter: messagesAdapter as QwenMessagesAdapter,
  };
}
