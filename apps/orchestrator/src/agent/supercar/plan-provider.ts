import type { ModelDataRegion } from '../../llm/model-data-region.js';
import {
  ModelDataRegionError,
  resolveModelDataRegionOwnership,
} from '../../llm/model-data-region.js';

export const PLAN_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export interface PlanProviderEnvironment {
  ANTHROPIC_API_KEY: string;
  QWEN_MESSAGES_ADAPTER_ENABLED: boolean;
  QWEN_PLAN_CANARY_ENABLED: boolean;
  QWEN_PLAN_SYNTHETIC_ALLOWLIST: string;
}

export type PlanProviderRoute =
  | { provider: 'anthropic'; model: typeof PLAN_ANTHROPIC_MODEL }
  | {
      provider: 'qwen';
      region: ModelDataRegion;
      deploymentScope: 'china_mainland' | 'international';
      purpose: 'standard';
    }
  | {
      provider: 'unavailable';
      reason: 'ANTHROPIC_UNAVAILABLE' | 'MODEL_DATA_REGION_UNAVAILABLE';
    };

export function resolvePlanProviderRoute(input: {
  environment: PlanProviderEnvironment;
  userExternalId: string;
  userModelDataRegion: unknown;
}): PlanProviderRoute {
  const allowlist = new Set(
    input.environment.QWEN_PLAN_SYNTHETIC_ALLOWLIST.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const qwenCanaryActive =
    input.environment.QWEN_MESSAGES_ADAPTER_ENABLED &&
    input.environment.QWEN_PLAN_CANARY_ENABLED &&
    allowlist.has(input.userExternalId);

  if (qwenCanaryActive) {
    try {
      const ownership = resolveModelDataRegionOwnership({
        scope: 'personal',
        userRegion: input.userModelDataRegion,
      });
      return {
        provider: 'qwen',
        region: ownership.region,
        deploymentScope: ownership.region === 'cn' ? 'china_mainland' : 'international',
        purpose: 'standard',
      };
    } catch (error) {
      if (error instanceof ModelDataRegionError) {
        return { provider: 'unavailable', reason: 'MODEL_DATA_REGION_UNAVAILABLE' };
      }
      throw error;
    }
  }

  return input.environment.ANTHROPIC_API_KEY.trim()
    ? { provider: 'anthropic', model: PLAN_ANTHROPIC_MODEL }
    : { provider: 'unavailable', reason: 'ANTHROPIC_UNAVAILABLE' };
}
