-- Phase 16 — first batch of "feature graduation" from sidebar 即将推出
-- to live: Stars (favourites) + Projects (task grouping). Skills
-- (third graduate) reuses users.selected_roles which already exists
-- (Phase 10 Tier 2) — no schema change there, only new endpoints.
--
-- Stars: per-task boolean + timestamp. starredAt is set when starred
-- flips to true and cleared on unstar — lets the sidebar "收藏" group
-- order by most-recently-pinned without needing a separate table.
-- Composite index (user_id, starred) makes the sidebar starred-list
-- query a covering scan since user_id is the natural filter on every
-- task list query.
--
-- Projects: top-level user-owned grouping; tasks gain optional
-- project_id FK. ON DELETE SET NULL on the FK so a project deletion
-- preserves the tasks (orphaned to the default 所有任务 list) rather
-- than losing them — the user's task history is more valuable than
-- the project label. external_id mirrors the rest of the schema's
-- nanoid pattern so the SPA never sees raw bigints.

ALTER TABLE `tasks` ADD `starred` tinyint(1) NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `tasks` ADD `starred_at` datetime(3);--> statement-breakpoint
CREATE INDEX `ix_tasks_user_starred` ON `tasks` (`user_id`, `starred`);--> statement-breakpoint

CREATE TABLE `projects` (
  `id` bigint unsigned PRIMARY KEY AUTO_INCREMENT,
  `external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` varchar(500),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `fk_projects_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_projects_external_id` ON `projects` (`external_id`);--> statement-breakpoint
CREATE INDEX `ix_projects_user_id` ON `projects` (`user_id`);--> statement-breakpoint

ALTER TABLE `tasks` ADD `project_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `fk_tasks_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `ix_tasks_project_id` ON `tasks` (`project_id`);
