import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  bigint,
  char,
  datetime,
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { VideoEditDocument, VideoEditOperation } from '../../video-editing/types.js';
import { taskFiles } from './task-files.js';
import { tasks } from './tasks.js';
import { users } from './users.js';

export const videoEditProjects = mysqlTable(
  'video_edit_projects',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceTaskId: bigint('source_task_id', { mode: 'number', unsigned: true }).references(
      () => tasks.id,
      { onDelete: 'set null' },
    ),
    sourceFileId: bigint('source_file_id', { mode: 'number', unsigned: true }).references(
      () => taskFiles.id,
      { onDelete: 'set null' },
    ),
    sourceKind: varchar('source_kind', { length: 16 }).notNull(),
    provider: varchar('provider', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    currentVersionId: bigint('current_version_id', {
      mode: 'number',
      unsigned: true,
    }).references((): AnyMySqlColumn => videoEditVersions.id, { onDelete: 'set null' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_video_edit_projects_external_id').on(table.externalId),
    index('ix_video_edit_projects_user_updated').on(table.userId, table.updatedAt),
  ],
);

export const videoEditVersions = mysqlTable(
  'video_edit_versions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    projectId: bigint('project_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => videoEditProjects.id, { onDelete: 'cascade' }),
    parentVersionId: bigint('parent_version_id', {
      mode: 'number',
      unsigned: true,
    }).references((): AnyMySqlColumn => videoEditVersions.id, { onDelete: 'set null' }),
    revision: int('revision', { unsigned: true }).notNull(),
    documentJson: json('document_json').$type<VideoEditDocument>().notNull(),
    operationJson: json('operation_json').$type<VideoEditOperation[] | null>(),
    sdkDocument: mediumtext('sdk_document'),
    outputFileId: bigint('output_file_id', { mode: 'number', unsigned: true }).references(
      () => taskFiles.id,
      { onDelete: 'set null' },
    ),
    renderStatus: varchar('render_status', { length: 16 }).notNull().default('idle'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_video_edit_versions_external_id').on(table.externalId),
    uniqueIndex('uk_video_edit_versions_project_revision').on(table.projectId, table.revision),
    index('ix_video_edit_versions_project_created').on(table.projectId, table.createdAt),
  ],
);

export const videoEditActionQuotes = mysqlTable(
  'video_edit_action_quotes',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => videoEditProjects.id, { onDelete: 'cascade' }),
    baseVersionId: bigint('base_version_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => videoEditVersions.id, { onDelete: 'cascade' }),
    operationHash: char('operation_hash', { length: 64 }).notNull(),
    operationJson: json('operation_json').$type<VideoEditOperation[]>().notNull(),
    costUnits: int('cost_units', { unsigned: true }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    consumedAt: datetime('consumed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_video_edit_action_quotes_external_id').on(table.externalId),
    index('ix_video_edit_action_quotes_user_status_expiry').on(
      table.userId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const videoEditRenderAttempts = mysqlTable(
  'video_edit_render_attempts',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => videoEditProjects.id, { onDelete: 'cascade' }),
    versionId: bigint('version_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => videoEditVersions.id, { onDelete: 'cascade' }),
    outputFileId: bigint('output_file_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => taskFiles.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_video_edit_render_attempts_external_id').on(table.externalId),
    index('ix_video_edit_render_attempts_user_status_expiry').on(
      table.userId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export type VideoEditProject = typeof videoEditProjects.$inferSelect;
export type NewVideoEditProject = typeof videoEditProjects.$inferInsert;
export type VideoEditVersion = typeof videoEditVersions.$inferSelect;
export type NewVideoEditVersion = typeof videoEditVersions.$inferInsert;
export type VideoEditActionQuote = typeof videoEditActionQuotes.$inferSelect;
export type NewVideoEditActionQuote = typeof videoEditActionQuotes.$inferInsert;
export type VideoEditRenderAttempt = typeof videoEditRenderAttempts.$inferSelect;
export type NewVideoEditRenderAttempt = typeof videoEditRenderAttempts.$inferInsert;
