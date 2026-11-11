import type { Logger } from 'pino';
import {
  type BrowserBrainEnvironment,
  currentBrowserBrain,
  resolveBrowserBrainSelection,
} from '../../llm/browser-brain.js';
import type { CoreModelRuntimeInput } from '../../llm/core-model-runtime.js';
import { defaultRoleModel } from '../../llm/gateway/role-models.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { MessagesAdapterError, createQwenMessagesAdapter } from '../../llm/messages-adapter.js';
import type { LlmCallRecorder } from '../llm-call-recorder.js';
import { type PlanProviderEnvironment, resolvePlanProviderRoute } from './plan-provider.js';
import { type PlanGenerateResult, generatePlan } from './plan-service.js';
import { recordedBrowserAdapter } from './recorded-browser-adapter.js';

export type PlanRuntimeEnvironment = PlanProviderEnvironment & BrowserBrainEnvironment;

export interface PlanAdapterFactories {
  createQwenAdapter: NonNullable<CoreModelRuntimeInput['createMessages']>;
}

export async function generatePlanForUser(
  input: {
    environment: PlanRuntimeEnvironment;
    userExternalId: string;
    userModelDataRegion: unknown;
    intent: string;
    logger: Logger;
    taskId?: string;
    browserPlanning?: boolean;
    planningAdapter?: MessagesAdapter;
    recorder?: LlmCallRecorder;
  },
  factories: PlanAdapterFactories = { createQwenAdapter: createQwenMessagesAdapter },
): Promise<PlanGenerateResult> {
  let environment = input.environment;
  let adapter = input.planningAdapter;
  let route: ReturnType<typeof resolvePlanProviderRoute> | undefined;
  let modelPinned = false;
  try {
    if (input.browserPlanning && !adapter) {
      const selection =
        currentBrowserBrain() ?? resolveBrowserBrainSelection(environment, input.userExternalId);
      // No explicit selection: the plan role's default model (the gateway's role table when on).
      const planning = selection.planning ?? {
        provider: 'alibaba-model-studio',
        model: defaultRoleModel('plan'),
      };
      if (planning.provider !== 'alibaba-model-studio') return noPlan();
      environment = { ...environment, QWEN_STANDARD_MODEL: planning.model };
      modelPinned = selection.planning !== undefined;
    }
    route = adapter
      ? undefined
      : resolvePlanProviderRoute({
          environment,
          userExternalId: input.userExternalId,
          userModelDataRegion: input.userModelDataRegion,
          createMessages: factories.createQwenAdapter,
          ...(modelPinned ? { modelPinned } : {}),
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

  if (route?.provider === 'unavailable') {
    input.logger.warn(
      { taskId: input.taskId, reason: route.reason },
      'plan-service: provider unavailable',
    );
    return noPlan();
  }

  adapter ??= route?.provider === 'qwen' ? route.messagesAdapter : undefined;
  if (!adapter) return noPlan();
  input.logger.info(
    {
      taskId: input.taskId,
      provider: adapter.metadata.provider,
      model: adapter.metadata.model,
      region: 'region' in adapter.metadata ? adapter.metadata.region : undefined,
      deploymentScope:
        'deploymentScope' in adapter.metadata ? adapter.metadata.deploymentScope : undefined,
    },
    'plan-service: Qwen selected',
  );

  return generatePlan({
    messagesAdapter:
      input.recorder && input.taskId
        ? recordedBrowserAdapter(adapter, {
            recorder: input.recorder,
            userExternalId: input.userExternalId,
            taskId: input.taskId,
            iteration: 0,
            role: 'planning',
            onRecordError: () =>
              input.logger.warn({ taskId: input.taskId }, 'plan accounting failed'),
          })
        : adapter,
    intent: input.intent,
    logger: input.logger,
    taskId: input.taskId,
  });
}

function noPlan(): PlanGenerateResult {
  return { planText: null, planStatus: null };
}
