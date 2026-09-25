import { newExternalId } from '@holaday/shared-types';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { llmCalls } from '../db/schema/llm-calls.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';

/**
 * Single-call observation shape. Recorders translate this into a
 * `llm_calls` row (or a noop for tests that don't touch the DB).
 */
export interface LlmCallRecord {
  /** External user id (usr_...). Required — the DB row's user_id is NOT NULL. */
  userExternalId: string;
  /** External task id (tsk_...), if the call happened in a task context. */
  taskExternalId?: string | null;
  /** External step id (stp_...), if the call is attributable to one step. */
  stepExternalId?: string | null;
  provider: string;
  model: string;
  /**
   * What the call was for:
   *   - commander.plan: initial plan synthesis from intent (legacy
   *     AnthropicPlanner path)
   *   - commander.heal: single-selector self-heal on SELECTOR_NOT_FOUND
   *     (legacy path)
   *   - commander.vision: one tick of the VisionLoopCommander
   *     observe → decide cycle in screenshot mode (image input,
   *     coord-based tools)
   *   - commander.accessibility: one tick of the commander in a11y
   *     mode (text input, ref-based tools) — cheaper per tick
   *     because no image bytes
   *   - commander.replan: full re-plan on irrecoverable failure (W3)
   *   - skill.body: lazy-load a SKILL.md body (v0.2 §5.5)
   *   - safety.filter: SafetyFilter screening (W3)
   *   - supercar.turn: one messages.create turn of the supercar agent
   *     loop (the computer-use browse path). It builds its OWN Anthropic
   *     client, so unlike the vision-loop commander it was never wired to
   *     the recorder — browse tasks recorded $0. Wired for Playbook ④
   *     (budget caps / circuit breaker / per-task spend traceability).
   */
  purpose:
    | 'commander.plan'
    | 'commander.heal'
    | 'commander.vision'
    | 'commander.accessibility'
    | 'commander.replan'
    | 'skill.body'
    | 'safety.filter'
    | 'supercar.turn';
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  region?: string;
  providerRequestId?: string;
  latencyMs: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  requestMeta?: Record<string, unknown>;
}

export interface LlmCallRecorder {
  record(call: LlmCallRecord): Promise<void>;
}

/**
 * No-op — for tests or environments without DB access. AnthropicPlanner
 * defaults to this when the recorder option is not provided.
 */
export class NoopLlmCallRecorder implements LlmCallRecorder {
  async record(_call: LlmCallRecord): Promise<void> {
    /* intentionally empty */
  }
}

/**
 * Pricing table keyed by base model id (without trailing -YYYYMMDD date
 * stamps the API appends to some responses). Standard rate tier; 1M
 * token = 1_000_000. Cache-aware:
 *   cache_read  ≈ 0.1 × input price
 *   cache_write ≈ 1.25 × input price (5-minute TTL)
 *
 * Numbers sourced from the claude-api skill's models table (2026-04-15).
 * Phase 1 will move this to a DB table so operators can adjust without
 * a deploy; Phase 0 hard-codes.
 */
const MODEL_PRICES: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-opus-4-7': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-6': { inputPerM: 5, outputPerM: 25 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-20250514': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
};
const DEFAULT_PRICE = { inputPerM: 5, outputPerM: 25 } as const; // conservative: assume Opus-tier

function baseModelId(model: string): string {
  // Trim trailing "-YYYYMMDD" Anthropic sometimes appends in the response.
  return model.replace(/-\d{8}$/, '');
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens = 0,
  cacheCreationInputTokens = 0,
): number {
  const p = MODEL_PRICES[baseModelId(model)] ?? DEFAULT_PRICE;
  const input = (inputTokens * p.inputPerM) / 1_000_000;
  const output = (outputTokens * p.outputPerM) / 1_000_000;
  const cacheRead = (cacheReadInputTokens * p.inputPerM * 0.1) / 1_000_000;
  const cacheWrite = (cacheCreationInputTokens * p.inputPerM * 1.25) / 1_000_000;
  return input + output + cacheRead + cacheWrite;
}

function tokenCount(value: number | null | undefined): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
    ? value
    : null;
}

/** Provider-aware persistence/budget contract. Never applies fallback Opus rates. */
export function accountLlmCall(call: LlmCallRecord) {
  const promptTokens = tokenCount(call.inputTokens);
  const completionTokens = tokenCount(call.outputTokens);
  // Legacy Anthropic callers omit unsupported cache counters; explicit null stays unknown.
  const cacheReadTokens = tokenCount(
    call.cacheReadInputTokens === undefined && call.provider === 'anthropic'
      ? 0
      : call.cacheReadInputTokens,
  );
  const cacheWriteTokens = tokenCount(
    call.cacheCreationInputTokens === undefined && call.provider === 'anthropic'
      ? 0
      : call.cacheCreationInputTokens,
  );
  // Base prompt/completion coverage, matching NeutralMessagesResponse. Cache
  // counters stay independently nullable; combined totals require all four.
  const usageStatus =
    promptTokens === null && completionTokens === null
      ? 'missing'
      : promptTokens === null || completionTokens === null
        ? 'partial'
        : 'complete';
  const priced =
    call.provider === 'anthropic' && Object.hasOwn(MODEL_PRICES, baseModelId(call.model));
  const costStatus =
    usageStatus !== 'complete'
      ? 'usage_missing'
      : !priced
        ? 'unpriced'
        : cacheReadTokens === null || cacheWriteTokens === null
          ? 'usage_missing'
          : 'estimated';
  const costUsd =
    costStatus === 'estimated' &&
    promptTokens !== null &&
    completionTokens !== null &&
    cacheReadTokens !== null &&
    cacheWriteTokens !== null
      ? estimateCostUsd(
          call.model,
          promptTokens,
          completionTokens,
          cacheReadTokens,
          cacheWriteTokens,
        )
      : null;
  return {
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    usageStatus,
    costStatus,
    costUsd,
  };
}

/**
 * DB-backed recorder. Resolves user (and optionally task / step) external
 * ids to internal bigints, estimates cost, and inserts one row. Errors
 * are caught and logged — a failed billing write must never break the
 * Agent Loop.
 */
export class DrizzleLlmCallRecorder implements LlmCallRecorder {
  constructor(
    private readonly db: DB,
    private readonly opts: { onError?: (err: unknown, call: LlmCallRecord) => void } = {},
  ) {}

  async record(call: LlmCallRecord): Promise<void> {
    try {
      const [userRow] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, call.userExternalId))
        .limit(1);
      if (!userRow) {
        // User disappeared between planning and recording — can't write.
        // This is not expected in practice (planning happens inside a
        // protected tRPC call, user is already resolved). Log and drop.
        this.opts.onError?.(new Error(`user not found: ${call.userExternalId}`), call);
        return;
      }

      let taskInternalId: number | null = null;
      if (call.taskExternalId) {
        const [taskRow] = await this.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.externalId, call.taskExternalId), eq(tasks.userId, userRow.id)))
          .limit(1);
        taskInternalId = taskRow?.id ?? null;
      }

      const accounting = accountLlmCall(call);

      await this.db.insert(llmCalls).values({
        externalId: newExternalId('llmCall'),
        userId: userRow.id,
        ...(taskInternalId !== null ? { taskId: taskInternalId } : {}),
        provider: call.provider,
        model: call.model,
        purpose: call.purpose,
        ...accounting,
        costUsd: accounting.costUsd?.toFixed(6) ?? null,
        region: call.region ?? null,
        providerRequestId: call.providerRequestId?.slice(0, 128) ?? null,
        latencyMs: call.latencyMs,
        status: call.status,
        ...(call.errorMessage ? { errorMessage: call.errorMessage } : {}),
        requestMeta: {
          ...call.requestMeta,
          accountingVersion: 1,
          pricingSource:
            accounting.costStatus === 'estimated' ? 'legacy-anthropic-table-2026-04-15' : null,
        },
      });
    } catch (err) {
      this.opts.onError?.(err, call);
    }
  }
}
