import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { explorationRuns } from './exploration-runs.js';
import { sites } from './sites.js';
import { tasks } from './tasks.js';
import { users } from './users.js';

/**
 * `evidence_artifacts` — the UNIFIED artifact table (Phase 1 指令 #3,
 * design §4.2). Backs both Playbook exploration artifacts (screenshot /
 * a11y_tree / html_snapshot) and Evidence-Ledger task evidence, keyed
 * apart by `purpose`. MySQL holds only metadata + the R2 pointer
 * (`r2_bucket` / `r2_key`); large blobs live in R2.
 *
 * ALL owner/relation FKs are ON DELETE SET NULL (NOT cascade) — design
 * §4.9: a user's delete-right (drop their task evidence) and audit
 * retention conflict, so deletion is resolved at the APPLICATION layer
 * by `purpose` / `retention_policy`, not by FK behavior. In particular
 * `task_id` SET NULL lets audit/manual_hold artifacts survive (scrubbed)
 * after the originating task is gone.
 *
 * `sha256` powers dedup + watch diff + reaper. `expires_at` +
 * `retention_policy` drive the Pack B retention reaper.
 */
export const evidenceArtifacts = mysqlTable(
  'evidence_artifacts',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    ownerUserId: bigint('owner_user_id', { mode: 'number', unsigned: true }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    siteId: bigint('site_id', { mode: 'number', unsigned: true }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    explorationRunId: bigint('exploration_run_id', {
      mode: 'number',
      unsigned: true,
    }).references(() => explorationRuns.id, { onDelete: 'set null' }),
    artifactKind: varchar('artifact_kind', { length: 48 }).notNull(),
    purpose: varchar('purpose', { length: 48 }).notNull(),
    sourceUrl: varchar('source_url', { length: 2048 }),
    finalUrl: varchar('final_url', { length: 2048 }),
    r2Bucket: varchar('r2_bucket', { length: 128 }).notNull(),
    r2Key: varchar('r2_key', { length: 512 }).notNull(),
    contentType: varchar('content_type', { length: 128 }).notNull(),
    sizeBytes: int('size_bytes', { unsigned: true }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    capturedAt: datetime('captured_at', { mode: 'date', fsp: 3 }).notNull(),
    collectorLane: varchar('collector_lane', { length: 64 }).notNull(),
    collectorVersion: varchar('collector_version', { length: 64 }),
    viewportJson: json('viewport_json'),
    domHash: char('dom_hash', { length: 64 }),
    screenshotHash: char('screenshot_hash', { length: 64 }),
    rawExcerpt: text('raw_excerpt'),
    confidence: varchar('confidence', { length: 32 }).notNull().default('observed'),
    retentionPolicy: varchar('retention_policy', { length: 32 }).notNull().default('task_30d'),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }),
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
    uniqueIndex('uk_evidence_artifact_external_id').on(t.externalId),
    index('ix_evidence_task').on(t.taskId, t.purpose),
    index('ix_evidence_site').on(t.siteId, t.purpose),
    index('ix_evidence_exploration').on(t.explorationRunId),
    index('ix_evidence_sha').on(t.sha256),
    index('ix_evidence_expires').on(t.expiresAt),
  ],
);

export type EvidenceArtifact = typeof evidenceArtifacts.$inferSelect;
export type NewEvidenceArtifact = typeof evidenceArtifacts.$inferInsert;
