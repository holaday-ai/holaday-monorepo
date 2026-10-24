-- Batch 10.3 — per-task outcome notification preferences + failure streak.
-- Additive only (ADD COLUMN with defaults); safe to apply before or after the
-- application rollout. Re-applying hits ER_DUP_FIELDNAME, which the release
-- runner treats as already-applied.
--
--   notify_on_success        0 = success is silent (default), 1 = inbox + IM push
--   failure_notify_threshold notify when the consecutive-failure streak hits N
--                            (and every N after), default 1 = every failure
--   consecutive_failures     current streak; reset on a successful outcome
--   pending_task_id          scheduled only: task created by the latest dispatch
--                            whose terminal state has not been settled yet
ALTER TABLE `scheduled_tasks`
  ADD COLUMN `notify_on_success` boolean NOT NULL DEFAULT false,
  ADD COLUMN `failure_notify_threshold` int unsigned NOT NULL DEFAULT 1,
  ADD COLUMN `consecutive_failures` int unsigned NOT NULL DEFAULT 0,
  ADD COLUMN `pending_task_id` bigint unsigned NULL;
--> statement-breakpoint
ALTER TABLE `planned_tasks`
  ADD COLUMN `notify_on_success` boolean NOT NULL DEFAULT false,
  ADD COLUMN `failure_notify_threshold` int unsigned NOT NULL DEFAULT 1,
  ADD COLUMN `consecutive_failures` int unsigned NOT NULL DEFAULT 0;
