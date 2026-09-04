export const CORE_MODEL_LANES = [
  'suggestions',
  'plan',
  'generate',
  'scrape',
  'video_edit_planner',
  'verifier',
] as const;

export type ModelRuntimePolicy = 'qwen_only' | 'legacy_fixture';
export type CoreModelLane = (typeof CORE_MODEL_LANES)[number];
export type CoreRolloutMode = 'off' | 'synthetic' | 'internal' | 'all';
export type CoreModelLaneAccess =
  | { kind: 'enabled' }
  | { kind: 'unavailable'; reason: 'LANE_DISABLED' | 'ROLLOUT_NOT_ALLOWED' };

export type UnmigratedModelLane = 'browser' | 'image' | 'video_generation' | 'voice' | 'memory';
export type UnmigratedModelLaneAccess = {
  kind: 'unavailable';
  reason: 'MIGRATION_IN_PROGRESS';
};

type NodeEnvironment = 'development' | 'test' | 'production';

const CORE_MODEL_LANE_SET: ReadonlySet<string> = new Set(CORE_MODEL_LANES);

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseCoreModelLaneCsv(value: string): CoreModelLane[] {
  const lanes = parseCsv(value);
  for (const lane of lanes) {
    if (!CORE_MODEL_LANE_SET.has(lane)) {
      throw new Error(`Unknown QWEN_CORE_ENABLED_LANES value: ${lane}`);
    }
  }
  return [...new Set(lanes)] as CoreModelLane[];
}

export function assertProductionModelRuntimePolicy(
  nodeEnv: NodeEnvironment,
  policy: ModelRuntimePolicy,
): void {
  if (nodeEnv === 'production' && policy !== 'qwen_only') {
    throw new Error('MODEL_RUNTIME_POLICY must be qwen_only in production');
  }
}

export function resolveCoreModelLaneAccess(input: {
  mode: CoreRolloutMode;
  enabledLanes: string;
  allowlist: string;
  actorExternalId: string;
  lane: CoreModelLane;
}): CoreModelLaneAccess {
  const enabledLanes = new Set(parseCoreModelLaneCsv(input.enabledLanes));
  if (input.mode === 'off' || !enabledLanes.has(input.lane)) {
    return { kind: 'unavailable', reason: 'LANE_DISABLED' };
  }
  if (input.mode === 'all') {
    return { kind: 'enabled' };
  }
  const allowedActors = new Set(parseCsv(input.allowlist));
  return allowedActors.has(input.actorExternalId)
    ? { kind: 'enabled' }
    : { kind: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' };
}

export function resolveUnmigratedModelLane(
  _lane: UnmigratedModelLane,
): UnmigratedModelLaneAccess {
  return { kind: 'unavailable', reason: 'MIGRATION_IN_PROGRESS' };
}
