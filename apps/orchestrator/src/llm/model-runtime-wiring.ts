import {
  type CoreModelRuntimeEnvironment,
  type CoreModelRuntimeInput,
  type CoreModelRuntimeResolution,
  resolveCoreModelRuntime,
} from './core-model-runtime.js';
import { createAnthropicMessagesAdapter } from './dormant/anthropic-messages-adapter.js';
import type { MessagesAdapter } from './messages-adapter.js';
import {
  BUILTIN_MODEL_CATALOG,
  type BrainEntry,
  type BrainLane,
  type BrainProvider,
  brainLaneModel,
  currentBrain,
  selectDefaultBrain,
} from './model-catalog.js';
import type { CoreModelLane, UnmigratedModelLane } from './model-runtime-policy.js';
import { createMessagesBackedResponsesAdapter } from './providers/messages-backed-responses-adapter.js';
import { createOpenAIMessagesAdapter } from './providers/openai-messages-adapter.js';
import { createOpenAIResponsesAdapter } from './providers/openai-responses-adapter.js';
import type { QwenPurpose } from './qwen-route.js';
import type { ResponsesAdapter } from './responses-adapter.js';

export type ModelTaskUnavailableReason =
  | 'MODEL_DATA_REGION_UNASSIGNED'
  | 'REGION_SERVICE_NOT_CONFIGURED'
  | 'MODEL_MIGRATION_IN_PROGRESS'
  | 'MODEL_ROLLOUT_NOT_ALLOWED'
  | 'MODEL_PROVIDER_NOT_CONFIGURED';

export const MODEL_TASK_FAILURE_COPY: Readonly<Record<ModelTaskUnavailableReason, string>> = {
  MODEL_DATA_REGION_UNASSIGNED: '请先选择模型数据区域，再开始任务。',
  REGION_SERVICE_NOT_CONFIGURED: '该区域的模型服务尚未配置，请稍后再试。',
  MODEL_MIGRATION_IN_PROGRESS: '这项能力正在迁移到千问，暂时不可用。',
  MODEL_ROLLOUT_NOT_ALLOWED: '这项能力正在小范围验证，暂未对当前账号开放。',
  MODEL_PROVIDER_NOT_CONFIGURED: '所选模型的服务尚未配置，请切换到千问后重试。',
};

/** Keys and base URLs only — never on/off switches. */
export interface ExternalProviderEnvironment {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
}

export type ModelRuntimeEnvironment = CoreModelRuntimeEnvironment & ExternalProviderEnvironment;

export interface ReadyModelRuntime {
  kind: 'ready';
  brainId: string;
  provider: BrainProvider;
  /** Alibaba data region; null for brains outside the Qwen region rules. */
  region: 'cn' | 'intl' | null;
  messages(purpose: QwenPurpose): MessagesAdapter;
  responses(purpose: QwenPurpose): ResponsesAdapter;
}

export type ProductionModelRuntimeResolution =
  | ReadyModelRuntime
  | { kind: 'unavailable'; reasonCode: ModelTaskUnavailableReason };

type ExternalProvider = Exclude<BrainProvider, 'alibaba-model-studio'>;

export interface RuntimeFactories
  extends Pick<CoreModelRuntimeInput, 'createMessages' | 'createResponses' | 'observe' | 'now'> {
  createExternalMessages?: (input: {
    provider: ExternalProvider;
    model: string;
    environment: ExternalProviderEnvironment;
  }) => MessagesAdapter;
  createExternalResponses?: (input: {
    provider: ExternalProvider;
    model: string;
    environment: ExternalProviderEnvironment;
    messages: () => MessagesAdapter;
  }) => ResponsesAdapter;
}

export interface ProductionModelRuntimeWiring {
  readonly policy: 'model_catalog';
  resolveCore(input: {
    actorExternalId: string;
    lane: CoreModelLane;
    ownership: CoreModelRuntimeInput['ownership'];
    /** Explicit brain; otherwise the task's bound brain, otherwise the catalog default. */
    brain?: BrainEntry;
  }): ProductionModelRuntimeResolution;
  resolveUnmigrated(
    lane: UnmigratedModelLane,
  ): { kind: 'unavailable'; reasonCode: 'MODEL_MIGRATION_IN_PROGRESS' };
}

export function isExternalProviderConfigured(
  environment: ExternalProviderEnvironment,
  provider: BrainProvider,
): boolean {
  if (provider === 'anthropic') return Boolean(environment.ANTHROPIC_API_KEY?.trim());
  if (provider === 'openai') return Boolean(environment.OPENAI_API_KEY?.trim());
  return true;
}

export function createProductionModelRuntimeWiring(
  environment: ModelRuntimeEnvironment,
  factories: RuntimeFactories = {},
  options: { catalog?: () => readonly BrainEntry[] } = {},
): ProductionModelRuntimeWiring {
  const catalog = options.catalog ?? (() => BUILTIN_MODEL_CATALOG);
  const { createExternalMessages, createExternalResponses, ...qwenFactories } = factories;

  return {
    policy: 'model_catalog',
    resolveCore(input) {
      const brain = input.brain ?? currentBrain()?.brain ?? selectDefaultBrain(catalog());
      if (brain.provider !== 'alibaba-model-studio') {
        return resolveExternalRuntime({
          brain,
          provider: brain.provider,
          lane: input.lane,
          environment,
          createMessages: createExternalMessages ?? defaultExternalMessages,
          createResponses: createExternalResponses ?? defaultExternalResponses,
        });
      }
      const resolution = resolveCoreModelRuntime({
        environment: withBrainQwenModels(environment, brain, input.lane),
        actorExternalId: input.actorExternalId,
        lane: input.lane,
        ownership: input.ownership,
        ...qwenFactories,
      });
      if (resolution.kind === 'ready') {
        return {
          kind: 'ready',
          brainId: brain.id,
          provider: 'alibaba-model-studio',
          region: resolution.region,
          messages: resolution.messages,
          responses: resolution.responses,
        };
      }
      return { kind: 'unavailable', reasonCode: mapCoreUnavailableReason(resolution.reason) };
    },
    resolveUnmigrated(_lane) {
      return { kind: 'unavailable', reasonCode: 'MODEL_MIGRATION_IN_PROGRESS' };
    },
  };
}

/**
 * The catalog names one model per lane. Every non-vision purpose inside a lane
 * uses that lane's model; screenshots use the vision model. Missing entries
 * keep the env route default. Region selection is untouched.
 */
function withBrainQwenModels(
  environment: CoreModelRuntimeEnvironment,
  brain: BrainEntry,
  lane: CoreModelLane,
): CoreModelRuntimeEnvironment {
  const laneModel = brainLaneModel(brain, lane);
  const visionModel = brainLaneModel(brain, 'vision');
  if (!laneModel && !visionModel) return environment;
  return {
    ...environment,
    ...(laneModel
      ? {
          QWEN_REASONING_MODEL: laneModel,
          QWEN_STANDARD_MODEL: laneModel,
          QWEN_FAST_MODEL: laneModel,
          QWEN_CODING_MODEL: laneModel,
          QWEN_VERIFIER_MODEL: laneModel,
          QWEN_VERIFY_FAST_MODEL: laneModel,
          QWEN_VERIFY_STRICT_MODEL: laneModel,
        }
      : {}),
    ...(visionModel ? { QWEN_VISION_MODEL: visionModel } : {}),
  };
}

function resolveExternalRuntime(input: {
  brain: BrainEntry;
  provider: ExternalProvider;
  lane: CoreModelLane;
  environment: ExternalProviderEnvironment;
  createMessages: NonNullable<RuntimeFactories['createExternalMessages']>;
  createResponses: NonNullable<RuntimeFactories['createExternalResponses']>;
}): ProductionModelRuntimeResolution {
  if (!isExternalProviderConfigured(input.environment, input.provider)) {
    return { kind: 'unavailable', reasonCode: 'MODEL_PROVIDER_NOT_CONFIGURED' };
  }
  const modelFor = (purpose: QwenPurpose): string => {
    const lanes: BrainLane[] =
      purpose === 'vision' ? ['vision', input.lane, 'generate'] : [input.lane, 'generate'];
    for (const lane of lanes) {
      const model = brainLaneModel(input.brain, lane);
      if (model) return model;
    }
    throw new Error(`model catalog entry ${input.brain.id} has no model for lane ${input.lane}`);
  };
  const messages = (purpose: QwenPurpose) =>
    input.createMessages({
      provider: input.provider,
      model: modelFor(purpose),
      environment: input.environment,
    });
  return {
    kind: 'ready',
    brainId: input.brain.id,
    provider: input.provider,
    region: null,
    messages,
    responses(purpose) {
      return input.createResponses({
        provider: input.provider,
        model: modelFor(purpose),
        environment: input.environment,
        messages: () => messages(purpose),
      });
    },
  };
}

function defaultExternalMessages(input: {
  provider: ExternalProvider;
  model: string;
  environment: ExternalProviderEnvironment;
}): MessagesAdapter {
  if (input.provider === 'anthropic') {
    return createAnthropicMessagesAdapter({
      apiKey: input.environment.ANTHROPIC_API_KEY ?? '',
      model: input.model,
    });
  }
  return createOpenAIMessagesAdapter({
    apiKey: input.environment.OPENAI_API_KEY ?? '',
    model: input.model,
    ...(input.environment.OPENAI_BASE_URL ? { baseURL: input.environment.OPENAI_BASE_URL } : {}),
  });
}

function defaultExternalResponses(input: {
  provider: ExternalProvider;
  model: string;
  environment: ExternalProviderEnvironment;
  messages: () => MessagesAdapter;
}): ResponsesAdapter {
  if (input.provider === 'openai') {
    return createOpenAIResponsesAdapter({
      apiKey: input.environment.OPENAI_API_KEY ?? '',
      model: input.model,
      ...(input.environment.OPENAI_BASE_URL ? { baseURL: input.environment.OPENAI_BASE_URL } : {}),
    });
  }
  return createMessagesBackedResponsesAdapter({ messages: input.messages(), provider: input.provider });
}

function mapCoreUnavailableReason(
  reason: Extract<CoreModelRuntimeResolution, { kind: 'unavailable' }>['reason'],
): ModelTaskUnavailableReason {
  if (reason === 'LANE_DISABLED') return 'MODEL_MIGRATION_IN_PROGRESS';
  if (reason === 'ROLLOUT_NOT_ALLOWED') return 'MODEL_ROLLOUT_NOT_ALLOWED';
  return reason;
}
