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
import { sites } from './sites.js';

/**
 * `site_capabilities` — what a site can DO (Phase 1 指令 #3, design §3.1.2).
 *
 * A capability is a unit of work ("hotel search", "flight filter",
 * "pricing page read"), NOT an executable script — the steps live on
 * `operation_paths`. `input_schema_json` / `output_schema_json` let the
 * browser lane check whether a task's slots are complete and tell the
 * verifier which fields to validate.
 *
 * `uk_capability_site_key` makes `capability_key` stable + unique within
 * a site so the runtime can resolve a capability by (site, key).
 */
export const siteCapabilities = mysqlTable(
  'site_capabilities',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    siteId: bigint('site_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    capabilityKey: varchar('capability_key', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    inputSchemaJson: json('input_schema_json'),
    outputSchemaJson: json('output_schema_json'),
    authRequirement: varchar('auth_requirement', { length: 32 }).notNull().default('unknown'),
    credentialVaultRef: varchar('credential_vault_ref', { length: 128 }),
    riskTagsJson: json('risk_tags_json'),
    sensitiveActionLevel: varchar('sensitive_action_level', { length: 32 })
      .notNull()
      .default('read_only'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    confidence: decimal('confidence', { precision: 5, scale: 4 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_capability_external_id').on(t.externalId),
    uniqueIndex('uk_capability_site_key').on(t.siteId, t.capabilityKey),
    index('ix_capability_site_status').on(t.siteId, t.status),
  ],
);

export type SiteCapability = typeof siteCapabilities.$inferSelect;
export type NewSiteCapability = typeof siteCapabilities.$inferInsert;
