import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  date,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

const createdAt = () =>
  datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`);

export const energyDailyMetrics = mysqlTable(
  'energy_daily_metrics',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    metricDate: date('metric_date', { mode: 'string' }).notNull(),
    bucketHash: char('bucket_hash', { length: 64 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    experienceId: varchar('experience_id', { length: 32 }).notNull().default(''),
    modeId: varchar('mode_id', { length: 64 }).notNull().default(''),
    energyNeed: varchar('energy_need', { length: 16 }).notNull().default(''),
    durationBucket: varchar('duration_bucket', { length: 32 }).notNull().default(''),
    outcome: varchar('outcome', { length: 16 }).notNull().default(''),
    sectionId: varchar('section_id', { length: 32 }).notNull().default(''),
    targetType: varchar('target_type', { length: 32 }).notNull().default(''),
    sourceKind: varchar('source_kind', { length: 32 }).notNull().default(''),
    contentId: varchar('content_id', { length: 64 }).notNull().default(''),
    rangeKey: varchar('range_key', { length: 16 }).notNull().default(''),
    taskStatus: varchar('task_status', { length: 16 }).notNull().default(''),
    batchCount: int('batch_count', { unsigned: true }).notNull().default(0),
    eventCount: bigint('event_count', { mode: 'number', unsigned: true }).notNull().default(1),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: createdAt(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_energy_daily_metrics_bucket').on(table.metricDate, table.bucketHash),
    index('ix_energy_daily_metrics_expires_at').on(table.expiresAt),
    index('ix_energy_daily_metrics_date_type').on(table.metricDate, table.eventType),
  ],
);

export const energyDailyVisitors = mysqlTable(
  'energy_daily_visitors',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    activityDate: date('activity_date', { mode: 'string' }).notNull(),
    visitorHash: char('visitor_hash', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('uk_energy_daily_visitors_day_hash').on(table.activityDate, table.visitorHash),
    index('ix_energy_daily_visitors_expires_at').on(table.expiresAt),
  ],
);

export const energyEventReceipts = mysqlTable(
  'energy_event_receipts',
  {
    eventId: char('event_id', { length: 36 }).primaryKey(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('ix_energy_event_receipts_expires_at').on(table.expiresAt)],
);

export type EnergyDailyMetric = typeof energyDailyMetrics.$inferSelect;
export type EnergyDailyVisitor = typeof energyDailyVisitors.$inferSelect;
export type EnergyEventReceipt = typeof energyEventReceipts.$inferSelect;
