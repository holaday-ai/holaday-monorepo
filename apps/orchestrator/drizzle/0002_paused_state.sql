ALTER TABLE `tasks` ADD `pause_reason` varchar(32);--> statement-breakpoint
ALTER TABLE `task_steps` ADD `retry_count` int DEFAULT 0 NOT NULL;