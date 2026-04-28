import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sessions } from './sessions.js';
import { skills } from './skills.js';
import { users } from './users.js';

/**
 * `tasks` — main Agent Loop tasks.
 * Status machine: pending → planning → executing ↔ awaiting_user ↔ paused
 *                                   → completed / failed / cancelled
 */
export const tasks = mysqlTable(
  'tasks',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: bigint('session_id', { mode: 'number', unsigned: true }).references(
      () => sessions.id,
      { onDelete: 'set null' },
    ),
    skillId: bigint('skill_id', { mode: 'number', unsigned: true }).references(() => skills.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    /**
     * Populated while status='paused'. One of: user, retries_exhausted,
     * quota_exceeded. Nullable everywhere else.
     */
    pauseReason: varchar('pause_reason', { length: 32 }),
    intent: text('intent').notNull(),
    /**
     * User-renamed display title. When null, the UI falls back to
     * summariseIntent(intent). Stays null on creation — only set when
     * the user explicitly renames via the sidebar context menu.
     */
    title: varchar('title', { length: 255 }),
    /**
     * Phase 10 Tier 2 — role injected into the supercar prompt for
     * this task (or null if vision-loop / pre-Tier-2). Populated at
     * task creation by `classifyRole + gateRoleForUser`. Powers the
     * role-popularity heatmap and audits which roles drove value.
     */
    roleId: varchar('role_id', { length: 48 }),
    /**
     * Whether the task burned an Opus quota slot (Pro only). Phase 10
     * Tier 1 routes complex roles to Opus 4.7; this flag captures
     * whether that happened so the quota counter and the Pro user's
     * Opus-remaining display stay in sync without recomputing the
     * routing decision after the fact.
     */
    opusUsed: boolean('opus_used').notNull().default(false),
    plan: json('plan'),
    /**
     * Phase 13 — first-frame plan output (markdown-ish text) emitted
     * BEFORE any tool calls so the SPA can render the upcoming steps
     * up-front. Null for simple-search tasks that skip the plan phase.
     */
    planText: text('plan_text'),
    /**
     * Per-step status array, parallel to the bullet list in
     * `planText`. Each entry: { idx, status: 'pending'|'running'|
     * 'done'|'failed', note?: string }. Updated as the loop
     * progresses.
     */
    planStatus: json('plan_status'),
    result: json('result'),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_tasks_external_id').on(t.externalId),
    index('ix_tasks_user_id_created_at').on(t.userId, t.createdAt),
    index('ix_tasks_status').on(t.status),
    index('ix_tasks_session_id').on(t.sessionId),
    index('ix_tasks_role_id').on(t.roleId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
