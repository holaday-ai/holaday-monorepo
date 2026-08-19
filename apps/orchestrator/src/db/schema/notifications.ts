import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { scheduledTasks } from './scheduled-tasks.js';
import { plannedTasks } from './planned-tasks.js';
import { users } from './users.js';

/**
 * Phase 26B — `notifications`: per-user inbox row.
 *
 * Written by `notification-service.notify(...)` every time a
 * scheduled task dispatch starts, fails, or sends a reminder. The
 * SPA polls this for the bell-badge count + dropdown render.
 *
 * `type` lives as a varchar (not enum) so new types can be added
 * without an ALTER. Today: 'task_started' | 'task_complete' |
 * 'task_failed' | 'task_skipped' | 'task_reminder'.
 *
 * `scheduled_task_id` is nullable so a future non-scheduled-task
 * notification path (manual / system) can reuse this table without
 * a migration.
 */
export const notifications = mysqlTable(
  'notifications',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Set when the notification is for a scheduled task; null
     *  otherwise. ON DELETE SET NULL so removing a schedule doesn't
     *  wipe the user's history. */
    scheduledTaskId: bigint('scheduled_task_id', { mode: 'number', unsigned: true }).references(
      () => scheduledTasks.id,
      { onDelete: 'set null' },
    ),
    plannedTaskId: bigint('planned_task_id', { mode: 'number', unsigned: true }).references(
      () => plannedTasks.id,
      { onDelete: 'set null' },
    ),
    type: varchar('type', { length: 32 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_notifications_external_id').on(t.externalId),
    // Composite drives the bell-badge unread COUNT query.
    index('ix_notifications_user_unread').on(t.userId, t.isRead),
    // Per-user list ordered by created_at desc.
    index('ix_notifications_user_created').on(t.userId, t.createdAt),
    index('ix_notifications_planned_task').on(t.plannedTaskId),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

/**
 * Phase 26B — `notification_channels`: per-user external webhook
 * configuration.
 *
 * When at least one channel exists + `enabled=true`, every
 * notification written above is ALSO POSTed to the channel's
 * webhook in the platform's expected JSON shape (企业微信 / 飞书 /
 * 钉钉 / custom).
 *
 * `platform` is a varchar so adding new presets later is additive
 * (the wire format mapping lives in `webhook-sender.ts`).
 *
 * `custom_template` is a JSON object used only when platform='custom'.
 * Caller's template is a JSON value with `{{title}}`, `{{message}}`,
 * `{{status}}`, `{{taskName}}` placeholders substituted before POST.
 */
export const notificationChannels = mysqlTable(
  'notification_channels',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 16 }).notNull(),
    webhookUrl: text('webhook_url').notNull(),
    /** JSON template for platform='custom'. Null for preset platforms. */
    customTemplate: json('custom_template'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_notification_channels_external_id').on(t.externalId),
    index('ix_notification_channels_user').on(t.userId),
  ],
);

export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;
