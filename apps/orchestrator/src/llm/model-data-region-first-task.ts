/**
 * FIX-60 BOSS 决定 (2026-11-09): with the region choice off, an account that has no region gets
 * one when it creates its first task — the region of the entry that task came in through (or
 * MODEL_DATA_REGION_DEFAULT when the entry cannot be told) — and it is written to the account,
 * so a later task from another network or with a VPN on stays in the same region.
 *
 * An account that has a region keeps it. With the choice on, nothing is decided here: the
 * account is asked, exactly as before.
 */
import type { Logger } from 'pino';
import type { DB } from '../db/client.js';
import { unassignedModelDataRegion } from './core-model-runtime.js';
import { ensurePersonalModelDataRegion } from './model-data-region-assignment.js';
import {
  type EntryRegionEnvironment,
  type EntryRequest,
  entryModelDataRegion,
} from './model-data-region-entry.js';
import type { ModelDataRegion } from './model-data-region.js';

export interface FirstTaskRegionEnvironment extends EntryRegionEnvironment {
  MODEL_DATA_REGION_SELECTION_ENABLED: boolean;
  MODEL_DATA_REGION_DEFAULT: ModelDataRegion;
}

export async function settleFirstTaskModelDataRegion(input: {
  db: DB;
  actorExternalId: string;
  current: ModelDataRegion | null;
  request: EntryRequest;
  environment: FirstTaskRegionEnvironment;
  logger?: Pick<Logger, 'info' | 'warn'>;
  ensure?: typeof ensurePersonalModelDataRegion;
}): Promise<ModelDataRegion | null> {
  if (input.current != null) return input.current;
  const fallback = unassignedModelDataRegion(input.environment);
  if (!fallback) return input.current;

  const entry = entryModelDataRegion(input.request, input.environment);
  const region = entry.region ?? fallback;
  try {
    const settled = await (input.ensure ?? ensurePersonalModelDataRegion)({
      db: input.db,
      actorExternalId: input.actorExternalId,
      region,
    });
    input.logger?.info(
      {
        code: 'MODEL_DATA_REGION_ENTRY',
        userId: input.actorExternalId,
        reason: entry.reason,
        region: settled.region,
        assigned: settled.assigned,
      },
      'model data region: first task settles the account region',
    );
    return settled.region;
  } catch (error) {
    input.logger?.warn(
      {
        code: 'MODEL_DATA_REGION_ENTRY_WRITE_FAILED',
        userId: input.actorExternalId,
        reason: entry.reason,
        region,
        error: error instanceof Error ? error.name : 'unknown',
      },
      'model data region: could not write the entry region; this task runs in it unwritten',
    );
    return region;
  }
}
