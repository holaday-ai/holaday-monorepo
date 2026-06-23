import { inArray, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { llmCalls } from '../../db/schema/llm-calls.js';

/**
 * Playbook ④ explorer — BUDGET CIRCUIT BREAKERS (charter §A, v1).
 *
 * Philosophy (BOSS-defined): the budget fences ABNORMAL spend, it does NOT cap a
 * normal completion. A normal site completes at ~$0.5-2; the per-site breaker
 * ($5 default) only trips when a single site burns past that without finishing
 * (stuck / looping) → stop THAT site + flag. Batch / day / month breakers bound
 * the totals and stop the whole batch.
 *
 * All thresholds are placeholder constants (env-overridable) with the BOSS v1
 * DEFAULTS baked in ($5 seed / $3 stranger / $50 day / $200 month / ×1.2 batch).
 * Unlike a "must-set-to-run" cap, these default to REAL values — the run gate is
 * the EXPLORER_ENABLED master switch (default off), not the budget being unset.
 * Calibrate $5 after the first 1-3 calibration sites. Pure + DB-read only.
 */

export interface BudgetBreakers {
  /** Phase-1 seed site single-site abnormal breaker (USD). */
  perSiteSeedUsd: number;
  /** Phase-2 stranger (heat-trigger) site breaker — tighter (USD). */
  perSiteStrangerUsd: number;
  /** Per-batch breaker = siteCount × perSite × this factor (headroom). */
  perBatchFactor: number;
  /** Daily hard breaker — whole-day stop (USD). */
  perDayUsd: number;
  /** Monthly hard breaker — all exploration stops (USD). */
  perMonthUsd: number;
}

/** BOSS v1 defaults — see charter §A. */
export const BUDGET_DEFAULTS: BudgetBreakers = {
  perSiteSeedUsd: 5,
  perSiteStrangerUsd: 3,
  perBatchFactor: 1.2,
  perDayUsd: 50,
  perMonthUsd: 200,
};

/**
 * Parse a positive plain-decimal env override, else the supplied default. Junk /
 * hex / scientific / negative all fall back to the default (these are breakers, so
 * the fallback is the safe baked-in value — NOT 0, which would mean "never spend").
 */
function parsePositive(v: string | undefined, dflt: number): number {
  if (v === undefined || !/^\d+(?:\.\d+)?$/.test(v.trim())) return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export function readBudgetBreakersFromEnv(): BudgetBreakers {
  return {
    perSiteSeedUsd: parsePositive(
      process.env.EXPLORER_BREAKER_PER_SITE_SEED_USD,
      BUDGET_DEFAULTS.perSiteSeedUsd,
    ),
    perSiteStrangerUsd: parsePositive(
      process.env.EXPLORER_BREAKER_PER_SITE_STRANGER_USD,
      BUDGET_DEFAULTS.perSiteStrangerUsd,
    ),
    perBatchFactor: parsePositive(
      process.env.EXPLORER_BREAKER_BATCH_FACTOR,
      BUDGET_DEFAULTS.perBatchFactor,
    ),
    perDayUsd: parsePositive(process.env.EXPLORER_BREAKER_PER_DAY_USD, BUDGET_DEFAULTS.perDayUsd),
    perMonthUsd: parsePositive(
      process.env.EXPLORER_BREAKER_PER_MONTH_USD,
      BUDGET_DEFAULTS.perMonthUsd,
    ),
  };
}

/** Per-batch breaker = siteCount × perSiteUsd × factor. */
export function perBatchBreakerUsd(siteCount: number, perSiteUsd: number, factor: number): number {
  return Math.max(0, siteCount) * perSiteUsd * factor;
}

export interface BreakerVerdict {
  tripped: boolean;
  reason: string;
}

/**
 * The single breaker decision. TRIPPED when spend has REACHED the breaker (>=).
 * A non-positive breaker is a misconfig → fail-SAFE (tripped), so a zeroed-out
 * threshold halts rather than runs.
 */
export function checkBreaker(spentUsd: number, breakerUsd: number, label: string): BreakerVerdict {
  if (!(breakerUsd > 0)) {
    return { tripped: true, reason: `${label} breaker invalid (=${breakerUsd}) — fail-safe trip` };
  }
  if (spentUsd >= breakerUsd) {
    return {
      tripped: true,
      reason: `${label} breaker TRIPPED: spent $${spentUsd.toFixed(4)} >= $${breakerUsd.toFixed(4)}`,
    };
  }
  return {
    tripped: false,
    reason: `${label} ok: $${spentUsd.toFixed(4)} < $${breakerUsd.toFixed(4)}`,
  };
}

/** First tripped verdict in priority order, or null if all clear. */
export function firstTripped(verdicts: BreakerVerdict[]): BreakerVerdict | null {
  return verdicts.find((v) => v.tripped) ?? null;
}

/**
 * Conservative per-scrape Firecrawl cost estimate (USD). Doc-first exploration's
 * ONLY v1 spend is the Firecrawl scrape — NOT an `llm_calls` row — so the doc-first
 * impl reports it as `exploreSite` costUsd and the breakers can fence it. Override
 * with `EXPLORER_FIRECRAWL_COST_USD`; default $0.01.
 */
export function firecrawlScrapeCostUsd(): number {
  const n = Number(process.env.EXPLORER_FIRECRAWL_COST_USD);
  return Number.isFinite(n) && n >= 0 ? n : 0.01;
}

/**
 * Real spend incurred by a set of internal task ids — `SUM(llm_calls.cost_usd)`.
 * The source of truth for browse-试用 spend (the supercar-loop `supercar.turn`
 * accounting). Returns 0 for an empty set.
 */
export async function sumLlmCostForTasks(db: DB, taskInternalIds: number[]): Promise<number> {
  if (taskInternalIds.length === 0) return 0;
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(inArray(llmCalls.taskId, taskInternalIds));
  return Number(row?.total ?? 0) || 0;
}
