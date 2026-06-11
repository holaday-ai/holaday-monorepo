import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  decimal,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { siteCapabilities } from './site-capabilities.js';
import { sites } from './sites.js';
import { tasks } from './tasks.js';

/**
 * `claims` — conclusions produced by a task / exploration / watch
 * (Phase 1 指令 #3, design §4.3). A claim is grounded in evidence via
 * `claim_evidence_links`.
 *
 * `task_id` is ON DELETE CASCADE (a task's conclusions die with it),
 * while `site_id` / `capability_id` are SET NULL so a claim survives a
 * playbook entity being retired. The structured value lives in
 * `object_json`; `object_text` is the human-readable form.
 */
export const claims = mysqlTable(
  'claims',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).references(() => tasks.id, {
      onDelete: 'cascade',
    }),
    siteId: bigint('site_id', { mode: 'number', unsigned: true }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    capabilityId: bigint('capability_id', { mode: 'number', unsigned: true }).references(
      () => siteCapabilities.id,
      { onDelete: 'set null' },
    ),
    claimType: varchar('claim_type', { length: 64 }).notNull(),
    subject: varchar('subject', { length: 512 }).notNull(),
    predicate: varchar('predicate', { length: 128 }).notNull(),
    objectText: text('object_text'),
    objectJson: json('object_json'),
    confidence: decimal('confidence', { precision: 5, scale: 4 }),
    verificationStatus: varchar('verification_status', { length: 32 })
      .notNull()
      .default('unverified'),
    createdByLane: varchar('created_by_lane', { length: 64 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_claim_external_id').on(t.externalId),
    index('ix_claim_task').on(t.taskId, t.verificationStatus),
    index('ix_claim_site').on(t.siteId, t.claimType),
    index('ix_claim_capability').on(t.capabilityId),
  ],
);

export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;
