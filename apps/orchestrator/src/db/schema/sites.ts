import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * `sites` — Site Playbook root entity (Phase 1 指令 #3, design §3.1.1).
 *
 * One row per website the system knows how to operate. `owner_user_id`
 * NULL = system-global knowledge (BOSS/admin-curated); non-NULL = a
 * user/org-private site (schema reserved; private creation deferred).
 *
 * IMPORTANT — global-site dedup is enforced at the APPLICATION layer
 * (see SiteRepository), NOT by a unique index: MySQL unique indexes do
 * NOT treat multiple `owner_user_id IS NULL` rows as conflicting, so a
 * `UNIQUE(owner_user_id, canonical_domain)` would happily allow two
 * global rows for the same domain. The `ix_sites_domain_owner` index
 * only accelerates the dedup lookup `WHERE canonical_domain=? AND
 * owner_user_id IS NULL`.
 *
 * Risk / auth / sensitive fields here are site-level DEFAULTS; finer
 * grain lives on `site_capabilities` / `operation_paths`. The
 * `credential_vault_ref` / `sensitive_profile_id` columns are reserved
 * pointers for the future Credential Vault / Sensitive Site Protocol —
 * not implemented in Phase 1.
 */
export const sites = mysqlTable(
  'sites',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    ownerUserId: bigint('owner_user_id', { mode: 'number', unsigned: true }).references(
      () => users.id,
      { onDelete: 'cascade' },
    ),
    canonicalDomain: varchar('canonical_domain', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    homepageUrl: varchar('homepage_url', { length: 1024 }).notNull(),
    purposeSummary: text('purpose_summary'),
    category: varchar('category', { length: 64 }),
    language: varchar('language', { length: 16 }),
    region: varchar('region', { length: 32 }),
    siteStatus: varchar('site_status', { length: 32 }).notNull().default('active'),
    defaultAuthPolicy: varchar('default_auth_policy', { length: 32 }).notNull().default('unknown'),
    credentialVaultRef: varchar('credential_vault_ref', { length: 128 }),
    sensitiveProfileId: bigint('sensitive_profile_id', { mode: 'number', unsigned: true }),
    riskLevel: varchar('risk_level', { length: 32 }).notNull().default('medium'),
    antiBotLevel: varchar('anti_bot_level', { length: 32 }).notNull().default('unknown'),
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
    uniqueIndex('uk_sites_external_id').on(t.externalId),
    index('ix_sites_domain_owner').on(t.canonicalDomain, t.ownerUserId),
    index('ix_sites_status').on(t.siteStatus),
  ],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
