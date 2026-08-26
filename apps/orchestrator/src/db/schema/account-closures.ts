import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  ACCOUNT_CLOSURE_CHANNELS,
  ACCOUNT_CLOSURE_CHALLENGE_ACTIONS,
  ACCOUNT_CLOSURE_NOTIFICATION_STATUSES,
  ACCOUNT_CLOSURE_REASON_CODES,
  ACCOUNT_CLOSURE_RECEIPT_KINDS,
  ACCOUNT_CLOSURE_REQUEST_STATUSES,
  ACCOUNT_CLOSURE_STEP_ERROR_CODES,
  ACCOUNT_CLOSURE_STEP_STATUSES,
  type AccountClosureCheckpoint,
} from '../../account-closure/types.js';
import { users } from './users.js';

export const accountClosureRequests = mysqlTable(
  'account_closure_requests',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    activeUserId: bigint('active_user_id', { mode: 'number', unsigned: true }).references(
      () => users.id,
      { onDelete: 'restrict' },
    ),
    status: mysqlEnum('status', ACCOUNT_CLOSURE_REQUEST_STATUSES).notNull(),
    reasonCode: mysqlEnum('reason_code', ACCOUNT_CLOSURE_REASON_CODES),
    requestedAt: datetime('requested_at', { mode: 'date', fsp: 3 }).notNull(),
    graceEndsAt: datetime('grace_ends_at', { mode: 'date', fsp: 3 }).notNull(),
    processingStartedAt: datetime('processing_started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    cancelledAt: datetime('cancelled_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_account_closure_requests_external_id').on(table.externalId),
    uniqueIndex('uk_account_closure_requests_active_user').on(table.activeUserId),
    index('ix_account_closure_requests_status_grace').on(table.status, table.graceEndsAt),
  ],
);

export const accountClosureSteps = mysqlTable(
  'account_closure_steps',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    requestId: bigint('request_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => accountClosureRequests.id, { onDelete: 'restrict' }),
    categoryId: varchar('category_id', { length: 64 }).notNull(),
    handlerVersion: int('handler_version').notNull(),
    status: mysqlEnum('status', ACCOUNT_CLOSURE_STEP_STATUSES).notNull().default('pending'),
    attemptCount: int('attempt_count').notNull().default(0),
    nextAttemptAt: datetime('next_attempt_at', { mode: 'date', fsp: 3 }),
    leaseOwner: varchar('lease_owner', { length: 64 }),
    leaseUntil: datetime('lease_until', { mode: 'date', fsp: 3 }),
    checkpoint: json('checkpoint').$type<AccountClosureCheckpoint | null>(),
    processedCount: int('processed_count', { unsigned: true }).notNull().default(0),
    lastErrorCode: mysqlEnum('last_error_code', ACCOUNT_CLOSURE_STEP_ERROR_CODES),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    finishedAt: datetime('finished_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_account_closure_steps_request_category').on(table.requestId, table.categoryId),
    index('ix_account_closure_steps_status_next_attempt').on(table.status, table.nextAttemptAt),
    index('ix_account_closure_steps_lease_until').on(table.leaseUntil),
  ],
);

export const accountClosureEffects = mysqlTable(
  'account_closure_effects',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    requestId: bigint('request_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => accountClosureRequests.id, { onDelete: 'restrict' }),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    resourceId: varchar('resource_id', { length: 128 }).notNull(),
    previousState: varchar('previous_state', { length: 64 }).notNull(),
    closureAppliedState: varchar('closure_applied_state', { length: 64 }).notNull(),
    restoredAt: datetime('restored_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_account_closure_effects_request_resource').on(
      table.requestId,
      table.resourceType,
      table.resourceId,
    ),
  ],
);

export const accountClosureChallenges = mysqlTable(
  'account_closure_challenges',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestId: bigint('request_id', { mode: 'number', unsigned: true }).references(
      () => accountClosureRequests.id,
      { onDelete: 'restrict' },
    ),
    action: mysqlEnum('action', ACCOUNT_CLOSURE_CHALLENGE_ACTIONS).notNull(),
    channel: mysqlEnum('channel', ACCOUNT_CLOSURE_CHANNELS).notNull(),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    attemptCount: int('attempt_count').notNull().default(0),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    usedAt: datetime('used_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_account_closure_challenges_external_id').on(table.externalId),
    index('ix_account_closure_challenges_user_action_expiry').on(
      table.userId,
      table.action,
      table.expiresAt,
    ),
  ],
);

export const accountClosureReceipts = mysqlTable(
  'account_closure_receipts',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    requestId: bigint('request_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => accountClosureRequests.id, { onDelete: 'restrict' }),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    receiptNumber: varchar('receipt_number', { length: 32 }).notNull(),
    kind: mysqlEnum('kind', ACCOUNT_CLOSURE_RECEIPT_KINDS).notNull(),
    subjectDigest: varchar('subject_digest', { length: 64 }),
    completedCategoryIds: json('completed_category_ids').$type<string[]>().notNull(),
    restrictedCategoryIds: json('restricted_category_ids').$type<string[]>().notNull(),
    notificationStatus: mysqlEnum('notification_status', ACCOUNT_CLOSURE_NOTIFICATION_STATUSES)
      .notNull()
      .default('pending'),
    issuedAt: datetime('issued_at', { mode: 'date', fsp: 3 }).notNull(),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_account_closure_receipts_number').on(table.receiptNumber),
    uniqueIndex('uk_account_closure_receipts_request_kind').on(table.requestId, table.kind),
  ],
);

export type AccountClosureRequest = typeof accountClosureRequests.$inferSelect;
export type NewAccountClosureRequest = typeof accountClosureRequests.$inferInsert;
