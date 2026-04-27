-- Phase 10 Tier 3 — Files API + Skills API.
--
-- One table for both directions of the file flow:
--   - kind='input'  → user-uploaded attachments (CSV / PDF / image / …)
--                     that the agent will read into a user message.
--   - kind='output' → files the agent generates via the create_file
--                     tool (xlsx / pdf / docx / …) for the user to
--                     download.
--
-- Storage paths live on disk under /tmp/holaday-files/<userId>/<taskId>/;
-- this row is the audit + retrieval index. `expires_at` is set on
-- output rows (24h TTL per BOSS spec) and NULL on input rows
-- (uploaded files are kept as long as the parent task exists).
--
-- `task_id` is nullable because the upload endpoint runs BEFORE the
-- task is created — we hand back an `external_id`, the SPA includes
-- it in the next tasks.create call, and tasks.create back-fills the
-- task_id link in the same transaction that inserts the task row.

CREATE TABLE `task_files` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `task_id` bigint unsigned,
  `kind` varchar(8) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `mimetype` varchar(96) NOT NULL,
  `size_bytes` int unsigned NOT NULL,
  `storage_path` varchar(512) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` datetime(3),
  CONSTRAINT `task_files_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_task_files_external_id` UNIQUE(`external_id`)
);--> statement-breakpoint
CREATE INDEX `ix_task_files_user_id` ON `task_files` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_task_files_task_kind` ON `task_files` (`task_id`,`kind`);--> statement-breakpoint
CREATE INDEX `ix_task_files_expires_at` ON `task_files` (`expires_at`);
