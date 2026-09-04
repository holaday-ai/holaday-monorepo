import {
  type CoreModelRuntimeEnvironment,
  type CoreModelRuntimeInput,
  type CoreModelRuntimeResolution,
  resolveCoreModelRuntime,
} from './core-model-runtime.js';
import type { CoreModelLane, UnmigratedModelLane } from './model-runtime-policy.js';

export type ModelTaskUnavailableReason =
  | 'MODEL_DATA_REGION_UNASSIGNED'
  | 'REGION_SERVICE_NOT_CONFIGURED'
  | 'MODEL_MIGRATION_IN_PROGRESS'
  | 'MODEL_ROLLOUT_NOT_ALLOWED';

export const MODEL_TASK_FAILURE_COPY: Readonly<Record<ModelTaskUnavailableReason, string>> = {
  MODEL_DATA_REGION_UNASSIGNED: '请先选择模型数据区域，再开始任务。',
  REGION_SERVICE_NOT_CONFIGURED: '该区域的模型服务尚未配置，请稍后再试。',
  MODEL_MIGRATION_IN_PROGRESS: '这项能力正在迁移到千问，暂时不可用。',
  MODEL_ROLLOUT_NOT_ALLOWED: '这项能力正在小范围验证，暂未对当前账号开放。',
};

export type ProductionModelRuntimeResolution =
  | Extract<CoreModelRuntimeResolution, { kind: 'ready' }>
  | { kind: 'unavailable'; reasonCode: ModelTaskUnavailableReason };

type RuntimeFactories = Pick<
  CoreModelRuntimeInput,
  'createMessages' | 'createResponses' | 'observe' | 'now'
>;

export interface ProductionModelRuntimeWiring {
  readonly policy: 'qwen_only';
  resolveCore(input: {
    actorExternalId: string;
    lane: CoreModelLane;
    ownership: CoreModelRuntimeInput['ownership'];
  }): ProductionModelRuntimeResolution;
  resolveUnmigrated(
    lane: UnmigratedModelLane,
  ): { kind: 'unavailable'; reasonCode: 'MODEL_MIGRATION_IN_PROGRESS' };
}

export function createProductionModelRuntimeWiring(
  environment: CoreModelRuntimeEnvironment,
  factories: RuntimeFactories = {},
): ProductionModelRuntimeWiring {
  if (environment.MODEL_RUNTIME_POLICY !== 'qwen_only') {
    throw new Error('Production model runtime wiring requires MODEL_RUNTIME_POLICY=qwen_only');
  }

  return {
    policy: 'qwen_only',
    resolveCore(input) {
      const resolution = resolveCoreModelRuntime({
        environment,
        ...input,
        ...factories,
      });
      if (resolution.kind === 'ready') return resolution;
      return { kind: 'unavailable', reasonCode: mapCoreUnavailableReason(resolution.reason) };
    },
    resolveUnmigrated(_lane) {
      return { kind: 'unavailable', reasonCode: 'MODEL_MIGRATION_IN_PROGRESS' };
    },
  };
}

function mapCoreUnavailableReason(
  reason: Extract<CoreModelRuntimeResolution, { kind: 'unavailable' }>['reason'],
): ModelTaskUnavailableReason {
  if (reason === 'LANE_DISABLED') return 'MODEL_MIGRATION_IN_PROGRESS';
  if (reason === 'ROLLOUT_NOT_ALLOWED') return 'MODEL_ROLLOUT_NOT_ALLOWED';
  return reason;
}
