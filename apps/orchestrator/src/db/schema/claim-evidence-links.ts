import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  decimal,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { claims } from './claims.js';
import { evidenceArtifacts } from './evidence-artifacts.js';

/**
 * `claim_evidence_links` — many-to-many between claims and artifacts
 * (Phase 1 指令 #3, design §4.4). One claim can be grounded by many
 * artifacts; one artifact can support many claims. Has NO external_id
 * and NO updated_at (link rows are immutable once written).
 *
 * Both FKs are ON DELETE CASCADE: a link has no meaning without both
 * endpoints. `uk_claim_artifact_support` dedupes the same
 * (claim, artifact, support_type) triple.
 */
export const claimEvidenceLinks = mysqlTable(
  'claim_evidence_links',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    claimId: bigint('claim_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    artifactId: bigint('artifact_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => evidenceArtifacts.id, { onDelete: 'cascade' }),
    supportType: varchar('support_type', { length: 32 }).notNull().default('supports'),
    excerptStart: int('excerpt_start', { unsigned: true }),
    excerptEnd: int('excerpt_end', { unsigned: true }),
    quotedExcerpt: text('quoted_excerpt'),
    confidence: decimal('confidence', { precision: 5, scale: 4 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_claim_artifact_support').on(t.claimId, t.artifactId, t.supportType),
    index('ix_claim_evidence_artifact').on(t.artifactId),
  ],
);

export type ClaimEvidenceLink = typeof claimEvidenceLinks.$inferSelect;
export type NewClaimEvidenceLink = typeof claimEvidenceLinks.$inferInsert;
