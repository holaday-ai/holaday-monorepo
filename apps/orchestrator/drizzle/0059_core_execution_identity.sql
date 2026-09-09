-- Additive core execution ownership. Existing tasks keep legacy identity null/0/0.
ALTER TABLE `tasks` ADD COLUMN `execution_id` varchar(64) NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `execution_revision` bigint unsigned NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `core_record_version` bigint unsigned NOT NULL DEFAULT 0;
