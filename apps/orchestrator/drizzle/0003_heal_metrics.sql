ALTER TABLE `task_steps` ADD `heal_attempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_steps` ADD `heal_succeeded` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_steps` ADD `heal_elapsed_ms` int;--> statement-breakpoint
ALTER TABLE `task_steps` ADD `heal_input_tokens` int;--> statement-breakpoint
ALTER TABLE `task_steps` ADD `heal_output_tokens` int;--> statement-breakpoint
CREATE INDEX `ix_task_steps_heal_attempts` ON `task_steps` (`heal_attempts`);
