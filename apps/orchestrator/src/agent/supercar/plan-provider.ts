import type {
  CoreModelRuntimeEnvironment,
  CoreModelRuntimeInput,
  CoreModelRuntimeUnavailableReason,
} from '../../llm/core-model-runtime.js';
import { modelGateway } from '../../llm/gateway/model-gateway.js';
import type { ModelGatewayEnvironment } from '../../llm/gateway/settings.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';

type QwenMessagesAdapter = Omit<MessagesAdapter, 'metadata'> & {
  readonly metadata: Extract<MessagesAdapter['metadata'], { provider: 'alibaba-model-studio' }>;
};

export type PlanProviderEnvironment = CoreModelRuntimeEnvironment & ModelGatewayEnvironment;

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
  /** `environment` already names an explicitly selected planning model (browser brain). */
  modelPinned?: boolean;
}): PlanProviderRoute {
  const runtime = modelGateway({
    core: { environment: input.environment, createMessages: input.createMessages },
  }).resolve('plan', {
    actorExternalId: input.userExternalId,
    ownership: {
      scope: 'personal',
      userRegion: input.userModelDataRegion,
    },
    ...(input.modelPinned ? { modelPinned: true } : {}),
  });

  if (runtime.kind === 'unavailable') {
    return { provider: 'unavailable', reason: runtime.reason };
  }

  const messagesAdapter = runtime.messages();
  if (messagesAdapter.metadata.provider !== 'alibaba-model-studio') {
    throw new Error('Qwen plan runtime returned a non-Qwen adapter');
  }
  return {
    provider: 'qwen',
    region: runtime.region,
    messagesAdapter: messagesAdapter as QwenMessagesAdapter,
  };
}
