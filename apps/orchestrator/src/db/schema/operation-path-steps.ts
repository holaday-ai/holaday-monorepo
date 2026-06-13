import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { evidenceArtifacts } from './evidence-artifacts.js';
import { operationPaths } from './operation-paths.js';

/**
 * `operation_path_steps` — ordered step priors for a path (Phase 1 指令
 * #3, design §3.1.4). Has NO external_id: addressed by (path_id,
 * step_index).
 *
 * Compatible with the existing browser lane but intentionally NOT a
 * fixed script — each step is an agent prior (intent + selector/text
 * candidates + visual/coordinate fallback + expected observation +
 * failure modes). `step_type='ask_user'` maps to the existing
 * `awaiting_user` flow.
 *
 * `screenshot_anchor_id` points at an `evidence_artifacts` row; the FK
 * is ON DELETE SET NULL and is added as a deferred ALTER in migration
 * 0033 (after `evidence_artifacts` exists) to break the create-order
 * cycle.
 */
export const operationPathSteps = mysqlTable(
  'operation_path_steps',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    pathId: bigint('path_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => operationPaths.id, { onDelete: 'cascade' }),
    stepIndex: int('step_index', { unsigned: true }).notNull(),
    stepType: varchar('step_type', { length: 48 }).notNull(),
    intent: varchar('intent', { length: 255 }).notNull(),
    targetSelectorJson: json('target_selector_json'),
    targetTextJson: json('target_text_json'),
    coordinateFallbackJson: json('coordinate_fallback_json'),
    screenshotAnchorId: bigint('screenshot_anchor_id', {
      mode: 'number',
      unsigned: true,
    }).references(() => evidenceArtifacts.id, { onDelete: 'set null' }),
    inputKey: varchar('input_key', { length: 128 }),
    expectedObservationJson: json('expected_observation_json'),
    failureModesJson: json('failure_modes_json'),
    sensitiveAction: boolean('sensitive_action').notNull().default(false),
    sensitiveActionLevel: varchar('sensitive_action_level', { length: 32 })
      .notNull()
      .default('read_only'),
    notes: text('notes'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_path_step_index').on(t.pathId, t.stepIndex),
    index('ix_path_steps_path').on(t.pathId),
    index('ix_path_steps_anchor').on(t.screenshotAnchorId),
  ],
);

export type OperationPathStep = typeof operationPathSteps.$inferSelect;
export type NewOperationPathStep = typeof operationPathSteps.$inferInsert;
