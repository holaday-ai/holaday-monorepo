import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Admin-switchable "brain" catalog (migration 0061). Each row is one model
 * family the product can route every capability lane through. Exactly one
 * row is the default; `admin.models.update` enforces it transactionally.
 * Credentials never live here — env keeps API keys and base URLs only.
 */
export const modelCatalog = mysqlTable(
  'model_catalog',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(),
    label: varchar('label', { length: 64 }).notNull(),
    userVisible: boolean('user_visible').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    adminOnly: boolean('admin_only').notNull().default(true),
    sortOrder: int('sort_order').notNull().default(0),
    laneModels: json('lane_models').notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  () => [
    check(
      'ck_model_catalog_provider',
      sql`provider IN ('alibaba-model-studio', 'anthropic', 'openai')`,
    ),
  ],
);

/** Append-only audit trail for admin catalog changes. */
export const modelCatalogEvents = mysqlTable(
  'model_catalog_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    modelId: varchar('model_id', { length: 32 }).notNull(),
    /** `users.id` of the admin; removed with that account on closure. */
    actorUserId: bigint('actor_user_id', { mode: 'number', unsigned: true }).notNull(),
    action: varchar('action', { length: 32 }).notNull(),
    beforeJson: json('before_json'),
    afterJson: json('after_json'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('ix_model_catalog_events_model_created').on(t.modelId, t.createdAt),
    index('ix_model_catalog_events_actor').on(t.actorUserId),
  ],
);

/**
 * Which brain a task actually ran with. A side table (not a `tasks` column)
 * so deploying code before migration 0061 cannot break `tasks` reads.
 */
export const taskModelSelections = mysqlTable(
  'task_model_selections',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    taskExternalId: varchar('task_external_id', { length: 32 }).notNull(),
    brainId: varchar('brain_id', { length: 32 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    requestedBrainId: varchar('requested_brain_id', { length: 32 }),
    fallbackReason: varchar('fallback_reason', { length: 32 }),
    laneModels: json('lane_models').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex('uk_task_model_selections_task').on(t.taskExternalId)],
);

/** Global catalog settings (migration 0064), e.g. `mcp_servers`. No user data. */
export const modelCatalogSettings = mysqlTable('model_catalog_settings', {
  id: varchar('id', { length: 64 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
});

export type ModelCatalogRow = typeof modelCatalog.$inferSelect;
