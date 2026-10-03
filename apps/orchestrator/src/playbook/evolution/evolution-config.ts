/**
 * Batch 06 — self-evolution loop switches. EVERYTHING DEFAULTS OFF.
 *
 *   PLAYBOOK_SEDIMENT_ENABLED          sediment sweep (generalise ≥N same-capability trajectories)
 *   PLAYBOOK_CANARY_ENABLED            canary replay of template paths in an isolated browser
 *   PLAYBOOK_REUSE_ENABLED             executor-side reuse of verified paths (read by the hook)
 *   PLAYBOOK_EXPLORER_SCHEDULE_ENABLED BullMQ-scheduled explorer over EXPLORER_SCHEDULED_SITES
 *                                      (the explorer's own EXPLORER_ENABLED lock still applies)
 *   PLAYBOOK_CANARY_PASS_THRESHOLD     consecutive passes to reach `verified` (default 3)
 *   PLAYBOOK_SEDIMENT_MIN_SUPPORT      successful same-site same-capability runs (default 2)
 *   PLAYBOOK_{SEDIMENT,CANARY,EXPLORER}_INTERVAL_MS  repeat intervals
 */

export interface EvolutionConfig {
  sedimentEnabled: boolean;
  canaryEnabled: boolean;
  reuseEnabled: boolean;
  explorerScheduleEnabled: boolean;
  canaryPassThreshold: number;
  sedimentMinSupport: number;
  sedimentIntervalMs: number;
  canaryIntervalMs: number;
  explorerIntervalMs: number;
  canaryBatchSize: number;
}

const HOUR = 60 * 60 * 1000;

function positiveInt(
  raw: string | undefined,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function readEvolutionConfig(env: NodeJS.ProcessEnv = process.env): EvolutionConfig {
  return {
    sedimentEnabled: env.PLAYBOOK_SEDIMENT_ENABLED === 'true',
    canaryEnabled: env.PLAYBOOK_CANARY_ENABLED === 'true',
    reuseEnabled: env.PLAYBOOK_REUSE_ENABLED === 'true',
    explorerScheduleEnabled: env.PLAYBOOK_EXPLORER_SCHEDULE_ENABLED === 'true',
    canaryPassThreshold: positiveInt(env.PLAYBOOK_CANARY_PASS_THRESHOLD, 3, 1, 20),
    sedimentMinSupport: positiveInt(env.PLAYBOOK_SEDIMENT_MIN_SUPPORT, 2, 2, 50),
    sedimentIntervalMs: positiveInt(env.PLAYBOOK_SEDIMENT_INTERVAL_MS, 6 * HOUR, 60_000),
    canaryIntervalMs: positiveInt(env.PLAYBOOK_CANARY_INTERVAL_MS, 6 * HOUR, 60_000),
    explorerIntervalMs: positiveInt(env.PLAYBOOK_EXPLORER_INTERVAL_MS, 24 * HOUR, 60_000),
    canaryBatchSize: positiveInt(env.PLAYBOOK_CANARY_BATCH_SIZE, 20, 1, 500),
  };
}

/** True when any background part of the loop would run. */
export function anyEvolutionBackgroundEnabled(config: EvolutionConfig): boolean {
  return config.sedimentEnabled || config.canaryEnabled || config.explorerScheduleEnabled;
}
