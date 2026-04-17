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

/**
 * `skills` — index of Skills. Skill bodies live in Git (`skills/` folder).
 * DB stores the pointer + metadata for discovery / routing.
 */
export const skills = mysqlTable(
  'skills',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    version: varchar('version', { length: 32 }).notNull(),
    occupationTag: varchar('occupation_tag', { length: 64 }),
    description: text('description'),
    manifest: json('manifest'),
    gitCommit: varchar('git_commit', { length: 64 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_skills_external_id').on(t.externalId),
    uniqueIndex('uk_skills_slug_version').on(t.slug, t.version),
    index('ix_skills_occupation_tag').on(t.occupationTag),
    index('ix_skills_status').on(t.status),
  ],
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
