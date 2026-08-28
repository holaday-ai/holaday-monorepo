-- Bind every browser-export upload to one owned editing project version.

CREATE TABLE `video_edit_render_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `version_id` BIGINT UNSIGNED NOT NULL,
  `output_file_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_video_edit_render_attempts_external_id` (`external_id`),
  KEY `ix_video_edit_render_attempts_user_status_expiry` (`user_id`, `status`, `expires_at`),
  CONSTRAINT `fk_video_edit_render_attempts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_edit_render_attempts_project` FOREIGN KEY (`project_id`) REFERENCES `video_edit_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_edit_render_attempts_version` FOREIGN KEY (`version_id`) REFERENCES `video_edit_versions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_edit_render_attempts_output_file` FOREIGN KEY (`output_file_id`) REFERENCES `task_files` (`id`) ON DELETE CASCADE
);
