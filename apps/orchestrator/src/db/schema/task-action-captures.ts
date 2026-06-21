import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { tasks } from './tasks.js';

/**
 * `task_action_captures` — RAW per-action capture trajectory (Phase 1
 * Playbook B 捕获层). One row per executed browser action (navigate /
 * click / type / scroll / …), recording the multi-signal descriptor of
 * the target at action time: visible text (PRIMARY anchor — real Chinese
 * sites: ~96% unique text vs ~3% stable selector), stable selector when
 * present, coordinate fallback, frame path, navigate entry URL, and an
 * optional screenshot anchor.
 *
 * This is the DISTILLATION SOURCE for ① passive crystallization — it is
 * deliberately DISTINCT from `operation_path_steps`, which holds the
 * DISTILLED, verified path prior. Captures are append-only and cheap;
 * paths are curated. A leaf table: it FKs OUT to `tasks` (cascade — drop
 * the task, drop its captures) and `evidence_artifacts` (set null — the
 * retention reaper may sweep an anchor screenshot without orphaning the
 * capture), and NOTHING FKs INTO it.
 *
 * Pure additive (migration 0036): no existing table/column is touched;
 * rollback is `DROP TABLE task_action_captures`.
 *
 * NOTE: `input_value` is a placeholder column only. The B2 capture writer
 * is responsible for redaction — sensitive / password field values are
 * NEVER persisted here. `frame_path` is reserved for B3 frame-routed
 * capture (left null until then).
 */
export const taskActionCaptures = mysqlTable(
  'task_action_captures',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    taskId: bigint('task_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** Bare host the action targeted (no scheme/www). Indexed — distillation queries by site. */
    siteDomain: varchar('site_domain', { length: 255 }),
    /** Task-internal action sequence. Non-unique by design: an append-only capture may emit
     *  more than one row per logical action (retries / multi-signal). */
    actionIndex: int('action_index', { unsigned: true }).notNull(),
    stepType: varchar('step_type', { length: 48 }).notNull(),
    /** PRIMARY anchor — the target element's visible text. */
    visibleText: text('visible_text'),
    /** Stable selector candidate(s) when present (~3% of real targets). */
    targetSelectorJson: json('target_selector_json'),
    /** Coordinate fallback (~1% of real targets). */
    coordinateJson: json('coordinate_json'),
    /** Frame-routing path for in-iframe captures — reserved for B3. */
    framePath: varchar('frame_path', { length: 255 }),
    /** navigate landed URL. */
    entryUrl: text('entry_url'),
    /** Typed value — REDACTED at write time (B2); sensitive fields never land here. */
    inputValue: text('input_value'),
    /** Optional anchor screenshot in `evidence_artifacts` (set by B4 for key steps). */
    screenshotAnchorId: bigint('screenshot_anchor_id', {
      mode: 'number',
      unsigned: true,
    }).references(() => evidenceArtifacts.id, { onDelete: 'set null' }),
    capturedAt: datetime('captured_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_task_action_captures_external_id').on(t.externalId),
    index('ix_task_action_captures_site').on(t.siteDomain),
    index('ix_task_action_captures_task_action').on(t.taskId, t.actionIndex),
  ],
);

export type TaskActionCapture = typeof taskActionCaptures.$inferSelect;
export type NewTaskActionCapture = typeof taskActionCaptures.$inferInsert;
