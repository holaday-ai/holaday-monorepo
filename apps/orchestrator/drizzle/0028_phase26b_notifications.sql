-- Phase 26B — notifications + notification channels.
--
-- Two new tables for the scheduled-task notification system:
--
--   notifications         Per-user inbox row written every time a
--                         scheduled task finishes (success or
--                         failure). The SPA polls this for the bell
--                         badge + dropdown.
--
--   notification_channels Per-user external webhook configuration.
--                         When set, every notification row is ALSO
--                         POSTed to the configured webhook(s) using
--                         the platform's expected JSON shape (企业
--                         微信 / 飞书 / 钉钉 / custom).
--
-- Schema notes:
--   - We use the existing bigint-PK + external_id-varchar pattern
--     (same as scheduled_tasks / api_keys) instead of the spec's
--     VARCHAR(36) UUID PK — keeps FK joins fast and matches our
--     internal id conventions.
--   - notifications.scheduled_task_id is nullable so future non-
--     scheduled-task notifications (manual / system) can reuse the
--     same inbox table.
--   - FK cascade on user delete drops both tables cleanly.
--   - Indexes:
--       ix_notifications_user_unread (user_id, is_read) drives the
--           bell-badge count query
--       ix_notifications_user_created (user_id, created_at DESC) is
--           covered implicitly by the composite above + the implicit
--           PK index — drizzle ORM's ORDER BY created_at picks up
--           the InnoDB clustered index
--       ix_notification_channels_user (user_id) for the per-user
--           list query

CREATE TABLE `notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `scheduled_task_id` BIGINT UNSIGNED NULL,
  `type` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notifications_external_id` (`external_id`),
  KEY `ix_notifications_user_unread` (`user_id`, `is_read`),
  KEY `ix_notifications_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notifications_scheduled_task` FOREIGN KEY (`scheduled_task_id`) REFERENCES `scheduled_tasks` (`id`) ON DELETE SET NULL
);

CREATE TABLE `notification_channels` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `platform` VARCHAR(16) NOT NULL,
  `webhook_url` TEXT NOT NULL,
  `custom_template` JSON NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notification_channels_external_id` (`external_id`),
  KEY `ix_notification_channels_user` (`user_id`),
  CONSTRAINT `fk_notification_channels_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
