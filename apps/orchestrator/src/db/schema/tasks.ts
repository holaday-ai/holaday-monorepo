import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  json,
  mediumtext,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { projects } from './projects.js';
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
    /**
     * Phase 16 — user-toggled favourite ("收藏") flag. starredAt is
     * the timestamp of the most recent star action; cleared on
     * unstar so the sidebar can sort the 收藏 group most-recent-first
     * with a single column.
     */
    starred: boolean('starred').notNull().default(false),
    starredAt: datetime('starred_at', { mode: 'date', fsp: 3 }),
    /**
     * Phase 16 — optional project this task belongs to. Null = the
     * default 所有任务 bucket. ON DELETE SET NULL preserves tasks
     * when a project is deleted (the task history is more valuable
     * than the project label).
     */
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).references(
      () => projects.id,
      { onDelete: 'set null' },
    ),
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
    /**
     * Phase 24 follow-up — when the supercar agent suspends to ask
     * the user a question, the question text lands here so a page
     * refresh during the pause re-renders the input box. Cleared
     * when the task next moves out of `awaiting_user`.
     */
    awaitingQuestion: text('awaiting_question'),
    /**
     * P2-A — what kind of input the supercar is waiting on. One of
     * 'clarification' | 'login' | 'captcha' | 'permission' |
     * 'browser_action'. NULL = legacy row, treated as the safe
     * default ('clarification') by the SPA. Cleared when the task
     * next moves out of awaiting_user. `permission` (Phase 3 R1)
     * means a 403 / paywall / VIP gate — login alone won't unstick
     * it; the user needs an authorised account.
     */
    awaitingKind: varchar('awaiting_kind', { length: 32 }),
    result: json('result'),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    /**
     * Optimization #2 — OpenAI response formatter / style layer.
     *
     * `original_summary` is the agent's raw output BEFORE the formatter
     * runs; `formatted_summary` is the polished version (or `=
     * original` when the formatter falls back). `response_layer_metadata`
     * stores `{model, latency_ms, changes[], fallbackReason}` so we
     * can audit fallback rates + post-check trips per prompt class.
     *
     * All three are NULL until the formatter runs at least once on the
     * row; rows pre-dating the feature stay NULL forever. Off by
     * default (OPENAI_RESPONSE_LAYER_ENABLED=false) so existing
     * traffic is unaffected.
     */
    originalSummary: mediumtext('original_summary'),
    formattedSummary: mediumtext('formatted_summary'),
    responseLayerMetadata: json('response_layer_metadata'),
    /**
     * Phase 1 Day 5 — execution-pipeline persistence.
     *
     * All NULL until the corresponding feature flag (in
     * `apps/orchestrator/src/execution/feature-flags.ts`) is flipped on.
     * Existing queries are unaffected — the columns are append-only
     * and never required.
     *
     *   contractJson        — ExecutionContract.toJSON snapshot
     *   evidenceJson        — EvidenceLedger.toJSON snapshot at terminal
     *   verificationJson    — VerificationResult (deterministic ± LLM)
     *   verificationPassed  — quick-filter boolean for analytics
     *   failureLevel        — 'fixable' | 'needs_clarification' | 'hard_fail'
     */
    contractJson: json('contract_json'),
    evidenceJson: json('evidence_json'),
    verificationJson: json('verification_json'),
    verificationPassed: boolean('verification_passed'),
    failureLevel: varchar('failure_level', { length: 32 }),
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
    index('ix_tasks_user_starred').on(t.userId, t.starred),
    index('ix_tasks_project_id').on(t.projectId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
