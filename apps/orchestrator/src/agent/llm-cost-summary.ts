import { sql } from 'drizzle-orm';
import { llmCalls } from '../db/schema/llm-calls.js';

/** COUNT includes failed attempts; SUM alone silently skips their unknown cost. */
export function costCoverageSelection() {
  return {
    unknownCostCalls: sql<number>`COUNT(*) - COUNT(${llmCalls.costUsd})`,
    incompleteUsageCalls: sql<number>`COALESCE(SUM(CASE WHEN NOT (${llmCalls.purpose} IN ('media.image', 'media.video', 'media.tts') AND ${llmCalls.usageStatus} = 'complete') AND (${llmCalls.promptTokens} IS NULL OR ${llmCalls.completionTokens} IS NULL OR ${llmCalls.cacheReadTokens} IS NULL OR ${llmCalls.cacheWriteTokens} IS NULL  ) THEN 1 ELSE 0 END), 0)`,
  };
}

export function summarizeCost(
  knownSum: string | number | null | undefined,
  unknownCount: string | number | null | undefined,
) {
  const knownCostUsd = Number(knownSum ?? 0);
  const unknownCostCalls = Number(unknownCount ?? 0);
  return {
    knownCostUsd,
    unknownCostCalls,
    totalCostUsd: unknownCostCalls > 0 ? null : knownCostUsd,
  };
}
