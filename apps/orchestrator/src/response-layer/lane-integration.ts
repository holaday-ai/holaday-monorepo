/**
 * Optimization #2 — lane-integration helpers.
 *
 * Wraps the response-layer formatter so the three "vision-loop"
 * lanes (generate / scrape / handoff-generate) can opt in with one
 * call each instead of duplicating the supercar lane's inline
 * pattern. Supercar still keeps its bespoke formatter wiring because
 * its `outcome` shape differs (carries verifier evidence +
 * finalState), but it also reuses the post-persist stamp helper so
 * all lanes share the same stale-write guard.
 *
 * The contract is split into TWO helpers because the formatter
 * runs BEFORE persist (so the row stores the polished summary in
 * `result.summary`) and the metadata columns are stamped AFTER
 * persist (so we don't UPDATE a row that doesn't exist yet):
 *
 *   1. `runResponseLayerForLane({ status, summary, ... })` —
 *      → returns `{ summary, responseLayerOriginal, responseLayerMetadata }`.
 *      Caller substitutes `summary` into the outcome before persist.
 *
 *   2. `stampResponseLayerColumns(db, taskId, ...)` — UPDATE the row
 *      with original_summary / formatted_summary / response_layer_metadata.
 *      Best-effort: logs + swallows DB errors so a stamp failure
 *      can't tear down terminal broadcast.
 *
 * Both helpers no-op when the response layer flag is off — the
 * inline flag check avoids dynamic-importing the `openai-response-layer`
 * module + its `openai` SDK dep on every terminal task.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import { tasks as tasksTable } from '../db/schema/tasks.js';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { isTaskTerminalStatus, type TaskTerminalStatus } from '../task-status.js';

const RESPONSE_LAYER_STAMP_SOURCE_STATUSES = [
  'completed',
  'partial_success',
  'failed',
  'cancelled',
] as const;

export interface RunResponseLayerForLaneInput {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled' | string;
  summary: string;
  /** Set when this terminal came from a typed expert workflow. */
  expertWorkflowId?: string | null | undefined;
  logger: Logger;
}

export interface RunResponseLayerForLaneOutput {
  /** Possibly-formatted summary. Caller substitutes into outcome. */
  summary: string;
  /** Pre-format summary IFF the formatter actually rewrote text;
   *  undefined when fallback / flag off (no rewrite happened). */
  responseLayerOriginal: string | undefined;
  /** FormatMetadata when the formatter ran (incl. fallback); undefined
   *  when the flag was off (caller must NOT write a row in that case
   *  per Codex P2). */
  responseLayerMetadata: unknown | undefined;
}

/**
 * Inline flag gate — matches `openai-response-layer.isResponseLayerEnabled`
 * but reads process.env directly so flag-off callers don't pay a
 * dynamic-import cost.
 */
function isResponseLayerActive(): boolean {
  const flag = (process.env.OPENAI_RESPONSE_LAYER_ENABLED ?? 'false').toLowerCase();
  if (flag !== 'true' && flag !== '1') return false;
  if (!process.env.OPENAI_API_KEY) return false;
  return true;
}

/**
 * Returns true iff the status is one the formatter cares about.
 */
function isFormatterTerminalStatus(
  s: string,
): s is TaskTerminalStatus {
  return isTaskTerminalStatus(s);
}

/**
 * Run the response-layer formatter for a vision-loop lane. Returns
 * the (possibly-formatted) summary plus the metadata to stamp
 * AFTER persist via `stampResponseLayerColumns`. Never throws —
 * any infra failure (timeout, post-check trip, missing API key)
 * falls back to the original summary and the metadata carries a
 * `fallbackReason` for forensics.
 */
export async function runResponseLayerForLane(
  input: RunResponseLayerForLaneInput,
): Promise<RunResponseLayerForLaneOutput> {
  // Flag off → caller MUST NOT write a row (Codex P2: zero DB
  // writes for users who didn't opt in).
  if (!isResponseLayerActive()) {
    return {
      summary: input.summary,
      responseLayerOriginal: undefined,
      responseLayerMetadata: undefined,
    };
  }
  // Non-terminal / empty summary → nothing to format, no metadata
  // to stamp.
  if (!isFormatterTerminalStatus(input.status) || !input.summary) {
    return {
      summary: input.summary,
      responseLayerOriginal: undefined,
      responseLayerMetadata: undefined,
    };
  }
  try {
    const { format: formatResponse } = await import(
      './openai-response-layer.js'
    );
    const fmt = await formatResponse(
      {
        original: input.summary,
        terminalStatus: input.status,
        ...(input.expertWorkflowId ? { expertWorkflowId: input.expertWorkflowId } : {}),
      },
      { logger: input.logger },
    );
    return {
      summary: fmt.formatted,
      responseLayerOriginal:
        fmt.formatted !== input.summary ? input.summary : undefined,
      responseLayerMetadata: fmt.metadata,
    };
  } catch (err) {
    // Belt-and-braces — format() already catches its own errors;
    // a throw here would be a programming bug. Log + keep original.
    input.logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        taskId: input.taskId,
      },
      'openai-response-layer (lane): unexpected throw — keeping original',
    );
    return {
      summary: input.summary,
      responseLayerOriginal: undefined,
      responseLayerMetadata: undefined,
    };
  }
}

/**
 * Stamp the three response-layer columns AFTER the lane's persist
 * call succeeded. Best-effort — any DB failure logs + swallows so
 * a transient blip can't tear down the terminal flow.
 *
 * Pass `responseLayerOriginal=undefined` and the same `summary`
 * value to indicate "formatter ran but fell back" — the columns
 * still get stamped so audits can count fallbacks. Pass
 * `responseLayerMetadata=undefined` to skip the stamp entirely
 * (flag-off path — Codex P2).
 */
export async function stampResponseLayerColumns(
  db: DB,
  taskId: string,
  responseLayerOriginal: string | undefined,
  finalSummary: string,
  responseLayerMetadata: unknown,
  logger: Logger,
): Promise<boolean> {
  if (!responseLayerMetadata) return false;
  try {
    const result = await db
      .update(tasksTable)
      .set({
        // When formatter rewrote text: original = pre-format text;
        // when fallback (formatter ran but kept the input): original
        // = formatted = the input. Either way both columns carry
        // valid data for audits.
        originalSummary: responseLayerOriginal ?? finalSummary,
        formattedSummary: finalSummary,
        responseLayerMetadata: responseLayerMetadata as Record<string, unknown>,
      })
      .where(
        and(
          eq(tasksTable.externalId, taskId),
          inArray(tasksTable.status, [...RESPONSE_LAYER_STAMP_SOURCE_STATUSES]),
        ),
      );
    return readAffectedRows(result) > 0;
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        taskId,
      },
      'openai-response-layer (lane): stamp metadata failed (non-fatal)',
    );
    return false;
  }
}
