-- Codex P1 follow-up — scheduled-task dispatch failure visibility.
--
-- Until now the runner marked a one-shot scheduled task as
-- `status='completed'` even when dispatch failed (TRPCError, network
-- blip, quota gate, etc.). Recurring tasks similarly advanced
-- nextRunAt without any signal of the previous failure. Users opened
-- /scheduled and saw "已完成" / "下次：..." with no way to tell their
-- task never actually ran — a silent trust problem.
--
-- Two new nullable columns let the runner record per-fire outcome
-- without breaking back-compat with rows that pre-date the change:
--
--   last_run_status — 'success' | 'failed' | NULL (never run yet)
--   last_error      — short error message when last_run_status='failed',
--                     NULL when success / not-yet-run
--
-- The runner also now sets status='failed' for one-shot tasks whose
-- dispatch failed (instead of mislabelling them 'completed'); recurring
-- tasks keep advancing but the columns let the SPA show a red badge
-- + tooltip on the failed run. No new index — these columns are read
-- per-row in the list view, never as a filter predicate.

ALTER TABLE `scheduled_tasks` ADD COLUMN `last_run_status` VARCHAR(16) NULL;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD COLUMN `last_error` TEXT NULL;
