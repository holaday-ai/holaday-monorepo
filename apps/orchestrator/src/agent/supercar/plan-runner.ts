import type { Logger } from 'pino';
import {
  type MessagesAdapter,
  MessagesAdapterError,
  type QwenMessagesEnvironment,
  createAnthropicMessagesAdapter,
  createQwenMessagesAdapter,
} from '../../llm/messages-adapter.js';
import type { ModelDataRegion } from '../../llm/model-data-region.js';
import type { QwenPurpose } from '../../llm/qwen-route.js';
import { type PlanProviderEnvironment, resolvePlanProviderRoute } from './plan-provider.js';
import { type PlanGenerateResult, generatePlan } from './plan-service.js';

export type PlanRuntimeEnvironment = PlanProviderEnvironment & QwenMessagesEnvironment;

export interface PlanAdapterFactories {
  createAnthropicAdapter(input: { apiKey: string; model: string }): MessagesAdapter;
  createQwenAdapter(input: {
    environment: QwenMessagesEnvironment;
    region: ModelDataRegion;
    purpose: QwenPurpose;
  }): MessagesAdapter;
}

const DEFAULT_FACTORIES: PlanAdapterFactories = {
  createAnthropicAdapter: createAnthropicMessagesAdapter,
  createQwenAdapter: createQwenMessagesAdapter,
};

export async function generatePlanForUser(
  input: {
    environment: PlanRuntimeEnvironment;
    userExternalId: string;
    userModelDataRegion: unknown;
    intent: string;
    logger: Logger;
    taskId?: string;
  },
  factories: PlanAdapterFactories = DEFAULT_FACTORIES,
): Promise<PlanGenerateResult> {
  const route = resolvePlanProviderRoute({
    environment: input.environment,
    userExternalId: input.userExternalId,
    userModelDataRegion: input.userModelDataRegion,
  });
  if (route.provider === 'unavailable') {
    input.logger.warn(
      { taskId: input.taskId, reason: route.reason },
      'plan-service: provider unavailable',
    );
    return noPlan();
  }

  let adapter: MessagesAdapter;
  try {
    adapter =
      route.provider === 'qwen'
        ? factories.createQwenAdapter({
            environment: input.environment,
            region: route.region,
            purpose: route.purpose,
          })
        : factories.createAnthropicAdapter({
            apiKey: input.environment.ANTHROPIC_API_KEY,
            model: route.model,
          });
  } catch (error) {
    input.logger.warn(
      {
        taskId: input.taskId,
        reason: error instanceof MessagesAdapterError ? error.code : 'PROVIDER_CONFIGURATION_ERROR',
      },
      'plan-service: provider unavailable',
    );
    return noPlan();
  }

  if (route.provider === 'qwen') {
    input.logger.info(
      {
        taskId: input.taskId,
        provider: adapter.metadata.provider,
        model: adapter.metadata.model,
        region: route.region,
        deploymentScope: route.deploymentScope,
      },
      'plan-service: Qwen canary selected',
    );
  }

  return generatePlan({
    messagesAdapter: adapter,
    intent: input.intent,
    logger: input.logger,
    taskId: input.taskId,
  });
}

function noPlan(): PlanGenerateResult {
  return { planText: null, planStatus: null };
}
