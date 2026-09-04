import type { Logger } from 'pino';
import type { CoreModelRuntimeInput } from '../../llm/core-model-runtime.js';
import {
  MessagesAdapterError,
  createQwenMessagesAdapter,
} from '../../llm/messages-adapter.js';
import { type PlanProviderEnvironment, resolvePlanProviderRoute } from './plan-provider.js';
import { type PlanGenerateResult, generatePlan } from './plan-service.js';

export type PlanRuntimeEnvironment = PlanProviderEnvironment;

export interface PlanAdapterFactories {
  createQwenAdapter: NonNullable<CoreModelRuntimeInput['createMessages']>;
}

const DEFAULT_FACTORIES: PlanAdapterFactories = {
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
  let route;
  try {
    route = resolvePlanProviderRoute({
      environment: input.environment,
      userExternalId: input.userExternalId,
      userModelDataRegion: input.userModelDataRegion,
      createMessages: factories.createQwenAdapter,
    });
  } catch (error) {
    input.logger.warn(
      {
        taskId: input.taskId,
        reason:
          error instanceof MessagesAdapterError ? error.code : 'PROVIDER_CONFIGURATION_ERROR',
      },
      'plan-service: provider unavailable',
    );
    return noPlan();
  }

  if (route.provider === 'unavailable') {
    input.logger.warn(
      { taskId: input.taskId, reason: route.reason },
      'plan-service: provider unavailable',
    );
    return noPlan();
  }

  input.logger.info(
    {
      taskId: input.taskId,
      provider: route.messagesAdapter.metadata.provider,
      model: route.messagesAdapter.metadata.model,
      region: route.region,
      deploymentScope: route.messagesAdapter.metadata.deploymentScope,
    },
    'plan-service: Qwen selected',
  );

  return generatePlan({
    messagesAdapter: route.messagesAdapter,
    intent: input.intent,
    logger: input.logger,
    taskId: input.taskId,
  });
}

function noPlan(): PlanGenerateResult {
  return { planText: null, planStatus: null };
}
