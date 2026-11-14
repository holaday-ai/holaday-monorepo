-- Public-cloud continuation: at most one replacement task per original, ever.
-- `tasks.create` first claims the original with a conditional update
-- (`... IS NULL`), then swaps the claim for the replacement id inside the
-- replacement's own insert transaction. The unique key also stops one
-- replacement from being linked to two originals.
-- Additive (one nullable column + one index). Apply before the orchestrator
-- that writes it; replays skip as already applied.
ALTER TABLE `tasks` ADD COLUMN `public_cloud_continuation_task_id` varchar(64) NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_tasks_public_cloud_continuation` ON `tasks` (`public_cloud_continuation_task_id`);
