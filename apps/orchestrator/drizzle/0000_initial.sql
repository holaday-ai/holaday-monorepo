CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`plan` varchar(32) NOT NULL DEFAULT 'free',
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`display_name` varchar(128),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_users_external_id` UNIQUE(`external_id`),
	CONSTRAINT `uk_users_email` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`occupation_raw` varchar(255) NOT NULL,
	`occupation_canonical` varchar(64),
	`locale` varchar(16) NOT NULL DEFAULT 'zh-CN',
	`fingerprint` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_user_profiles_external_id` UNIQUE(`external_id`),
	CONSTRAINT `uk_user_profiles_user_id` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`slug` varchar(96) NOT NULL,
	`name` varchar(128) NOT NULL,
	`version` varchar(32) NOT NULL,
	`occupation_tag` varchar(64),
	`description` text,
	`manifest` json,
	`git_commit` varchar(64),
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_skills_external_id` UNIQUE(`external_id`),
	CONSTRAINT `uk_skills_slug_version` UNIQUE(`slug`,`version`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`extension_version` varchar(32),
	`user_agent` varchar(512),
	`status` varchar(16) NOT NULL DEFAULT 'connected',
	`meta` json,
	`connected_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`disconnected_at` datetime(3),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_sessions_external_id` UNIQUE(`external_id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`session_id` bigint unsigned,
	`skill_id` bigint unsigned,
	`status` varchar(24) NOT NULL DEFAULT 'pending',
	`intent` text NOT NULL,
	`plan` json,
	`result` json,
	`error_code` varchar(64),
	`error_message` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`started_at` datetime(3),
	`completed_at` datetime(3),
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_tasks_external_id` UNIQUE(`external_id`)
);
--> statement-breakpoint
CREATE TABLE `task_steps` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`task_id` bigint unsigned NOT NULL,
	`parent_step_id` bigint unsigned,
	`seq` int NOT NULL,
	`kind` varchar(32) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'pending',
	`risk_level` varchar(16) NOT NULL DEFAULT 'low',
	`input` json,
	`output` json,
	`screenshot_key` varchar(255),
	`error_code` varchar(64),
	`error_message` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`started_at` datetime(3),
	`completed_at` datetime(3),
	CONSTRAINT `task_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_task_steps_external_id` UNIQUE(`external_id`),
	CONSTRAINT `uk_task_steps_task_seq` UNIQUE(`task_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`task_id` bigint unsigned NOT NULL,
	`step_id` bigint unsigned,
	`type` varchar(48) NOT NULL,
	`actor` varchar(32) NOT NULL DEFAULT 'system',
	`payload` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pk_task_events` PRIMARY KEY(`id`,`created_at`)
);
--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_id` varchar(32) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`task_id` bigint unsigned,
	`step_id` bigint unsigned,
	`provider` varchar(32) NOT NULL DEFAULT 'anthropic',
	`model` varchar(64) NOT NULL,
	`purpose` varchar(32) NOT NULL,
	`prompt_tokens` int NOT NULL DEFAULT 0,
	`completion_tokens` int NOT NULL DEFAULT 0,
	`cache_read_tokens` int NOT NULL DEFAULT 0,
	`cache_write_tokens` int NOT NULL DEFAULT 0,
	`cost_usd` decimal(12,6) NOT NULL DEFAULT '0',
	`latency_ms` int,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`error_message` text,
	`request_meta` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `llm_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_llm_calls_external_id` UNIQUE(`external_id`)
);
--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_skill_id_skills_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_steps` ADD CONSTRAINT `task_steps_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_users_plan` ON `users` (`plan`);--> statement-breakpoint
CREATE INDEX `ix_skills_occupation_tag` ON `skills` (`occupation_tag`);--> statement-breakpoint
CREATE INDEX `ix_skills_status` ON `skills` (`status`);--> statement-breakpoint
CREATE INDEX `ix_sessions_user_id_status` ON `sessions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_sessions_last_seen_at` ON `sessions` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `ix_tasks_user_id_created_at` ON `tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `ix_tasks_session_id` ON `tasks` (`session_id`);--> statement-breakpoint
CREATE INDEX `ix_task_steps_status` ON `task_steps` (`status`);--> statement-breakpoint
CREATE INDEX `ix_task_steps_parent` ON `task_steps` (`parent_step_id`);--> statement-breakpoint
CREATE INDEX `ix_task_events_task_id_created_at` ON `task_events` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_task_events_type` ON `task_events` (`type`);--> statement-breakpoint
CREATE INDEX `ix_task_events_external_id` ON `task_events` (`external_id`);--> statement-breakpoint
CREATE INDEX `ix_llm_calls_user_created_at` ON `llm_calls` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_llm_calls_task_id` ON `llm_calls` (`task_id`);--> statement-breakpoint
CREATE INDEX `ix_llm_calls_model` ON `llm_calls` (`model`);