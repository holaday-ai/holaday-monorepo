import {
  type MessagesAdapter,
  type QwenMessagesEnvironment,
  createQwenMessagesAdapter,
} from './messages-adapter.js';
import {
  ModelDataRegionError,
  type ModelDataRegionOwnershipInput,
  resolveModelDataRegionOwnership,
} from './model-data-region.js';
import {
  type CoreModelLane,
  type CoreRolloutMode,
  type ModelRuntimePolicy,
  assertProductionModelRuntimePolicy,
  resolveCoreModelLaneAccess,
} from './model-runtime-policy.js';
import { type QwenPurpose, QwenRouteError, resolveQwenRoute } from './qwen-route.js';
import { type ResponsesAdapter, createQwenResponsesAdapter } from './responses-adapter.js';

export interface CoreModelRuntimeEnvironment extends QwenMessagesEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  MODEL_RUNTIME_POLICY: ModelRuntimePolicy;
  QWEN_CORE_ROLLOUT_MODE: CoreRolloutMode;
  QWEN_CORE_ENABLED_LANES: string;
  QWEN_CORE_ALLOWLIST: string;
  QWEN_RESPONSES_ADAPTER_ENABLED: boolean;
}

export interface CoreModelObservation {
  provider: 'alibaba-model-studio';
  region: 'cn' | 'intl';
  deploymentScope: 'china_mainland' | 'international';
  purpose: QwenPurpose;
  model: string;
  outcome: 'success' | 'error';
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export type CoreModelRuntimeUnavailableReason =
  | 'LANE_DISABLED'
  | 'ROLLOUT_NOT_ALLOWED'
  | 'MODEL_DATA_REGION_UNASSIGNED'
  | 'REGION_SERVICE_NOT_CONFIGURED';

export type CoreModelRuntimeResolution =
  | {
      kind: 'ready';
      region: 'cn' | 'intl';
      messages(purpose: QwenPurpose): MessagesAdapter;
      responses(purpose: QwenPurpose): ResponsesAdapter;
    }
  | { kind: 'unavailable'; reason: CoreModelRuntimeUnavailableReason };

type MessagesFactory = (input: {
  environment: QwenMessagesEnvironment;
  region: 'cn' | 'intl';
  purpose: QwenPurpose;
}) => MessagesAdapter;

type ResponsesFactory = (input: {
  route: ReturnType<typeof resolveQwenRoute>;
}) => ResponsesAdapter;

export interface CoreModelRuntimeInput {
  environment: CoreModelRuntimeEnvironment;
  actorExternalId: string;
  lane: CoreModelLane;
  ownership: ModelDataRegionOwnershipInput;
  createMessages?: MessagesFactory;
  createResponses?: ResponsesFactory;
  observe?: (observation: CoreModelObservation) => void;
  now?: () => number;
}

const RESPONSES_LANES: ReadonlySet<CoreModelLane> = new Set(['generate', 'scrape']);

export function resolveCoreModelRuntime(input: CoreModelRuntimeInput): CoreModelRuntimeResolution {
  assertProductionModelRuntimePolicy(
    input.environment.NODE_ENV,
    input.environment.MODEL_RUNTIME_POLICY,
  );

  const access = resolveCoreModelLaneAccess({
    mode: input.environment.QWEN_CORE_ROLLOUT_MODE,
    enabledLanes: input.environment.QWEN_CORE_ENABLED_LANES,
    allowlist: input.environment.QWEN_CORE_ALLOWLIST,
    actorExternalId: input.actorExternalId,
    lane: input.lane,
  });
  if (access.kind === 'unavailable') return access;

  if (
    (RESPONSES_LANES.has(input.lane) && !input.environment.QWEN_RESPONSES_ADAPTER_ENABLED) ||
    (!RESPONSES_LANES.has(input.lane) && !input.environment.QWEN_MESSAGES_ADAPTER_ENABLED)
  ) {
    return { kind: 'unavailable', reason: 'LANE_DISABLED' };
  }

  let region: 'cn' | 'intl';
  try {
    region = resolveModelDataRegionOwnership(input.ownership).region;
  } catch (error) {
    if (error instanceof ModelDataRegionError) {
      return { kind: 'unavailable', reason: 'MODEL_DATA_REGION_UNASSIGNED' };
    }
    throw error;
  }

  try {
    resolveQwenRoute(input.environment, region, 'standard', 'messages');
    resolveQwenRoute(input.environment, region, 'standard', 'responses');
  } catch (error) {
    if (error instanceof QwenRouteError && error.code === 'MISSING_REGION_CREDENTIALS') {
      return { kind: 'unavailable', reason: 'REGION_SERVICE_NOT_CONFIGURED' };
    }
    throw error;
  }

  return createReadyRuntime(input, region);
}

function createReadyRuntime(
  input: CoreModelRuntimeInput,
  region: 'cn' | 'intl',
): Extract<CoreModelRuntimeResolution, { kind: 'ready' }> {
  const createMessages = input.createMessages ?? createQwenMessagesAdapter;
  const createResponses = input.createResponses ?? createQwenResponsesAdapter;
  const observe = input.observe ?? (() => undefined);
  const now = input.now ?? Date.now;

  return {
    kind: 'ready',
    region,
    messages(purpose) {
      const adapter = createMessages({ environment: input.environment, region, purpose });
      assertQwenAdapterMetadata(adapter.metadata, region, 'messages');
      return observeMessagesAdapter(adapter, purpose, observe, now);
    },
    responses(purpose) {
      const route = resolveQwenRoute(input.environment, region, purpose, 'responses');
      const adapter = createResponses({ route });
      assertQwenAdapterMetadata(adapter.metadata, region, 'responses');
      return observeResponsesAdapter(adapter, purpose, observe, now);
    },
  };
}

function observeMessagesAdapter(
  adapter: MessagesAdapter,
  purpose: QwenPurpose,
  observe: (observation: CoreModelObservation) => void,
  now: () => number,
): MessagesAdapter {
  return {
    metadata: adapter.metadata,
    async create(request, options) {
      const startedAt = now();
      try {
        const result = await adapter.create(request, options);
        emitObservation(observe, {
          ...observationIdentity(adapter, purpose),
          outcome: 'success',
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: elapsedMs(startedAt, now()),
        });
        return result;
      } catch (error) {
        emitObservation(observe, {
          ...observationIdentity(adapter, purpose),
          outcome: 'error',
          inputTokens: null,
          outputTokens: null,
          latencyMs: elapsedMs(startedAt, now()),
        });
        throw error;
      }
    },
  };
}

function observeResponsesAdapter(
  adapter: ResponsesAdapter,
  purpose: QwenPurpose,
  observe: (observation: CoreModelObservation) => void,
  now: () => number,
): ResponsesAdapter {
  return {
    metadata: adapter.metadata,
    async stream(request, options) {
      const startedAt = now();
      try {
        const result = await adapter.stream(request, options);
        emitObservation(observe, {
          ...observationIdentity(adapter, purpose),
          outcome: 'success',
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: elapsedMs(startedAt, now()),
        });
        return result;
      } catch (error) {
        emitObservation(observe, {
          ...observationIdentity(adapter, purpose),
          outcome: 'error',
          inputTokens: null,
          outputTokens: null,
          latencyMs: elapsedMs(startedAt, now()),
        });
        throw error;
      }
    },
  };
}

function observationIdentity(
  adapter: MessagesAdapter | ResponsesAdapter,
  purpose: QwenPurpose,
): Pick<CoreModelObservation, 'provider' | 'region' | 'deploymentScope' | 'purpose' | 'model'> {
  const metadata = adapter.metadata;
  if (metadata.provider !== 'alibaba-model-studio') {
    throw new Error('Core Qwen runtime received a non-Qwen adapter');
  }
  return {
    provider: metadata.provider,
    region: metadata.region,
    deploymentScope: metadata.deploymentScope,
    purpose,
    model: metadata.model,
  };
}

function assertQwenAdapterMetadata(
  metadata: MessagesAdapter['metadata'] | ResponsesAdapter['metadata'],
  region: 'cn' | 'intl',
  protocol: 'messages' | 'responses',
): void {
  if (
    metadata.provider !== 'alibaba-model-studio' ||
    metadata.region !== region ||
    metadata.protocol !== protocol
  ) {
    throw new Error('Core Qwen runtime received invalid adapter metadata');
  }
}

function emitObservation(
  observe: (observation: CoreModelObservation) => void,
  observation: CoreModelObservation,
): void {
  try {
    observe(observation);
  } catch {
    // Operational observation failures must not change the user-facing model outcome.
  }
}

function elapsedMs(startedAt: number, endedAt: number): number {
  const elapsed = endedAt - startedAt;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : 0;
}
