-- User-owned embedded video editing. Projects point to immutable versions;
-- one-use quotes bind paid scene regeneration to an exact base revision.

CREATE TABLE `video_edit_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `source_task_id` BIGINT UNSIGNED NULL,
  `source_file_id` BIGINT UNSIGNED NULL,
  `source_kind` VARCHAR(16) NOT NULL,
  `provider` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `current_version_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_video_edit_projects_external_id` (`external_id`),
  KEY `ix_video_edit_projects_user_updated` (`user_id`, `updated_at`),
  CONSTRAINT `fk_video_edit_projects_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_edit_projects_source_task` FOREIGN KEY (`source_task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_video_edit_projects_source_file` FOREIGN KEY (`source_file_id`) REFERENCES `task_files` (`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `video_edit_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `parent_version_id` BIGINT UNSIGNED NULL,
  `revision` INT UNSIGNED NOT NULL,
  `document_json` JSON NOT NULL,
  `operation_json` JSON NULL,
  `sdk_document` MEDIUMTEXT NULL,
  `output_file_id` BIGINT UNSIGNED NULL,
  `render_status` VARCHAR(16) NOT NULL DEFAULT 'idle',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_video_edit_versions_external_id` (`external_id`),
  UNIQUE KEY `uk_video_edit_versions_project_revision` (`project_id`, `revision`),
  KEY `ix_video_edit_versions_project_created` (`project_id`, `created_at`),
  CONSTRAINT `fk_video_edit_versions_project` FOREIGN KEY (`project_id`) REFERENCES `video_edit_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_edit_versions_parent` FOREIGN KEY (`parent_version_id`) REFERENCES `video_edit_versions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_video_edit_versions_output_file` FOREIGN KEY (`output_file_id`) REFERENCES `task_files` (`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `video_edit_projects`
  ADD CONSTRAINT `fk_video_edit_projects_current_version`
  FOREIGN KEY (`current_version_id`) REFERENCES `video_edit_versions` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE `video_edit_action_quotes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `base_version_id` BIGINT UNSIGNED NOT NULL,
  `operation_hash` CHAR(64) NOT NULL,
  `operation_json` JSON NOT NULL,
  `cost_units` INT UNSIGNED NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_video_edit_action_quotes_external_id` (`external_id`),
  KEY `ix_video_edit_action_quotes_user_status_expiry` (`user_id`, `status`, `expires_at`),
  CONSTRAINT `fk_video_edit_action_quotes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_edit_action_quotes_project` FOREIGN KEY (`project_id`) REFERENCES `video_edit_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_edit_action_quotes_version` FOREIGN KEY (`base_version_id`) REFERENCES `video_edit_versions` (`id`) ON DELETE CASCADE
);
