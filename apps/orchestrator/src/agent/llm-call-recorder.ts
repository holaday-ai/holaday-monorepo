import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
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
   */
  purpose:
    | 'commander.plan'
    | 'commander.heal'
    | 'commander.vision'
    | 'commander.accessibility'
    | 'commander.replan'
    | 'skill.body'
    | 'safety.filter';
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
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
          .where(eq(tasks.externalId, call.taskExternalId))
          .limit(1);
        taskInternalId = taskRow?.id ?? null;
      }

      const cacheRead = call.cacheReadInputTokens ?? 0;
      const cacheWrite = call.cacheCreationInputTokens ?? 0;
      const costUsd = estimateCostUsd(
        call.model,
        call.inputTokens,
        call.outputTokens,
        cacheRead,
        cacheWrite,
      );

      await this.db.insert(llmCalls).values({
        externalId: newExternalId('llmCall'),
        userId: userRow.id,
        ...(taskInternalId !== null ? { taskId: taskInternalId } : {}),
        provider: call.provider,
        model: call.model,
        purpose: call.purpose,
        promptTokens: call.inputTokens,
        completionTokens: call.outputTokens,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        // drizzle MySQL decimal accepts a string; pass with 6-digit precision.
        costUsd: costUsd.toFixed(6),
        latencyMs: call.latencyMs,
        status: call.status,
        ...(call.errorMessage ? { errorMessage: call.errorMessage } : {}),
        ...(call.requestMeta ? { requestMeta: call.requestMeta } : {}),
      });
    } catch (err) {
      this.opts.onError?.(err, call);
    }
  }
}
