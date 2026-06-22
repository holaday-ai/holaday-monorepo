import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  bigint,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { siteCapabilities } from './site-capabilities.js';
import { sites } from './sites.js';
import { tasks } from './tasks.js';

/**
 * `operation_paths` — a versioned executable path for a capability
 * (Phase 1 指令 #3, design §3.1.3). The core runtime-consumed object.
 *
 * A path is an agent PRIOR, not a hard script: `selector_strategy_json`
 * / `coordinate_fallback_json` / `screenshot_anchor_json` are kept as
 * separate strategy blobs so the agent can fall back across them. `status`
 * gates runtime trust — only `verified` paths become strong priors; a
 * `draft` path is at most a weak, "unverified"-labelled hint.
 *
 * `parent_path_id` is the version chain (site re-design → new version,
 * never overwrite). The `exec_count_30d` / `fail_count_30d` /
 * `success_rate_30d` / `metrics_updated_at` rolling columns are written
 * by the Pack C runtime-feedback hook; here they only carry their
 * zero/NULL defaults.
 */
export const operationPaths = mysqlTable(
  'operation_paths',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    siteId: bigint('site_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    capabilityId: bigint('capability_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => siteCapabilities.id, { onDelete: 'cascade' }),
    version: int('version', { unsigned: true }).notNull(),
    parentPathId: bigint('parent_path_id', { mode: 'number', unsigned: true }).references(
      (): AnyMySqlColumn => operationPaths.id,
      { onDelete: 'set null' },
    ),
    // Phase 1 ① crystallization (0037) — source task this path was crystallized
    // from: dedup key (idempotent re-runs skip an already-crystallized task) +
    // provenance link. SET NULL so deleting the task doesn't drop the path.
    sourceTaskId: bigint('source_task_id', { mode: 'number', unsigned: true }).references(
      () => tasks.id,
      { onDelete: 'set null' },
    ),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    entryUrlTemplate: varchar('entry_url_template', { length: 1024 }),
    inputBindingJson: json('input_binding_json'),
    preconditionsJson: json('preconditions_json'),
    postconditionsJson: json('postconditions_json'),
    laneHint: varchar('lane_hint', { length: 64 }),
    selectorStrategyJson: json('selector_strategy_json'),
    coordinateFallbackJson: json('coordinate_fallback_json'),
    screenshotAnchorJson: json('screenshot_anchor_json'),
    riskTagsJson: json('risk_tags_json'),
    sensitivePolicyRef: varchar('sensitive_policy_ref', { length: 128 }),
    authWallMapJson: json('auth_wall_map_json'),
    antiBotNotesJson: json('anti_bot_notes_json'),
    lastVerifiedAt: datetime('last_verified_at', { mode: 'date', fsp: 3 }),
    staleReason: varchar('stale_reason', { length: 255 }),
    successRate30d: decimal('success_rate_30d', { precision: 5, scale: 4 }),
    execCount30d: int('exec_count_30d', { unsigned: true }).notNull().default(0),
    failCount30d: int('fail_count_30d', { unsigned: true }).notNull().default(0),
    metricsUpdatedAt: datetime('metrics_updated_at', { mode: 'date', fsp: 3 }),
    // Phase 1 ① crystallization (0037) — source task raw intent text + crystallize
    // metadata (v2 clustering material). Mirrors sites / evidence_artifacts metadata_json.
    metadataJson: json('metadata_json'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_operation_path_external_id').on(t.externalId),
    uniqueIndex('uk_operation_path_capability_version').on(t.capabilityId, t.version),
    index('ix_operation_path_site_status').on(t.siteId, t.status),
    index('ix_operation_path_capability_status').on(t.capabilityId, t.status),
    index('ix_operation_path_source_task').on(t.sourceTaskId),
  ],
);

export type OperationPath = typeof operationPaths.$inferSelect;
export type NewOperationPath = typeof operationPaths.$inferInsert;
