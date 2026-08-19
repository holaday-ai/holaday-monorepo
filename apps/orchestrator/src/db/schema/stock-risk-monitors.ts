import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { plannedTasks } from './planned-tasks.js';
import { users } from './users.js';

export const stockRiskMonitors = mysqlTable(
  'stock_risk_monitors',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plannedTaskId: bigint('planned_task_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => plannedTasks.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    market: varchar('market', { length: 16 }).notNull(),
    riskKeysJson: json('risk_keys_json').notNull(),
    lastEvaluatedDataAsOf: varchar('last_evaluated_data_as_of', { length: 10 }),
    lastSignalsJson: json('last_signals_json').notNull(),
    lastUnavailableChecksJson: json('last_unavailable_checks_json').notNull(),
    lastNotificationFingerprint: char('last_notification_fingerprint', { length: 64 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_stock_risk_monitors_external_id').on(table.externalId),
    uniqueIndex('uk_stock_risk_monitors_user_symbol').on(table.userId, table.symbol),
    uniqueIndex('uk_stock_risk_monitors_plan').on(table.plannedTaskId),
  ],
);

export type StockRiskMonitor = typeof stockRiskMonitors.$inferSelect;
export type NewStockRiskMonitor = typeof stockRiskMonitors.$inferInsert;
