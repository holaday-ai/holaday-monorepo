/**
 * Retired response-polishing boundary.
 *
 * Holaday now returns the primary model answer directly. Keeping this tiny
 * compatibility boundary lets existing task lanes converge without a risky
 * all-at-once router rewrite, while making the old environment flag and key
 * incapable of triggering a second model call or audit-column mutation.
 * Historical response-layer database columns remain readable for old rows.
 */

import type { Logger } from 'pino';
import type { DB } from '../db/client.js';

export interface RunResponseLayerForLaneInput {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled' | string;
  summary: string;
  expertWorkflowId?: string | null | undefined;
  logger: Logger;
}

export interface RunResponseLayerForLaneOutput {
  summary: string;
  responseLayerOriginal: undefined;
  responseLayerMetadata: undefined;
}

/** Return the primary answer byte-for-byte; never call a formatting model. */
export async function runResponseLayerForLane(
  input: RunResponseLayerForLaneInput,
): Promise<RunResponseLayerForLaneOutput> {
  return {
    summary: input.summary,
    responseLayerOriginal: undefined,
    responseLayerMetadata: undefined,
  };
}

/**
 * Compatibility no-op for callers that still contain the historical stamp.
 * New tasks must not write response-polishing audit columns.
 */
export async function stampResponseLayerColumns(
  _db: DB,
  _taskId: string,
  _responseLayerOriginal: string | undefined,
  _finalSummary: string,
  _responseLayerMetadata: unknown,
  _logger: Logger,
): Promise<false> {
  return false;
}
