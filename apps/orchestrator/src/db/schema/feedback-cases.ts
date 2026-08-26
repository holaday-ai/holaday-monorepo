import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { accountClosureRequests } from './account-closures.js';
import { users } from './users.js';

export const FEEDBACK_CASE_HOLD_REASONS = ['legal_hold', 'active_dispute'] as const;

/**
 * Governed feedback source of truth. Identity and raw content are present only
 * while the owning account is active. Reviewed legal/dispute rows are reduced
 * to a request-bound case reference during closure; ordinary rows are deleted.
 */
export const feedbackCases = mysqlTable(
  'feedback_cases',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).references(() => users.id, {
      onDelete: 'restrict',
    }),
    closureRequestId: bigint('closure_request_id', { mode: 'number', unsigned: true }).references(
      () => accountClosureRequests.id,
      { onDelete: 'restrict' },
    ),
    message: text('message'),
    context: varchar('context', { length: 512 }),
    userAgent: varchar('user_agent', { length: 512 }),
    holdReason: mysqlEnum('hold_reason', FEEDBACK_CASE_HOLD_REASONS),
    restrictedAt: datetime('restricted_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_feedback_cases_external_id').on(table.externalId),
    index('ix_feedback_cases_user_id_id').on(table.userId, table.id),
    index('ix_feedback_cases_closure_request_id').on(table.closureRequestId),
    check(
      'ck_feedback_cases_active_or_restricted',
      sql`(
        ${table.closureRequestId} IS NULL
        AND ${table.userId} IS NOT NULL
        AND ${table.message} IS NOT NULL
        AND ${table.restrictedAt} IS NULL
      ) OR (
        ${table.closureRequestId} IS NOT NULL
        AND ${table.userId} IS NULL
        AND ${table.holdReason} IS NOT NULL
        AND ${table.restrictedAt} IS NOT NULL
        AND ${table.message} IS NULL
        AND ${table.context} IS NULL
        AND ${table.userAgent} IS NULL
      )`,
    ),
  ],
);

export type FeedbackCase = typeof feedbackCases.$inferSelect;
