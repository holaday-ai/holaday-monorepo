-- Phase 10 Tier 3 follow-up — task_files.status for the cleanup cron.
--
-- Status values:
--   'active'   (default) — file is on disk and downloadable.
--   'expired'  — cron has unlinked the on-disk bytes; row stays for
--                audit. The download endpoint already 404s when
--                expires_at < now(), so flipping status='expired'
--                on a stale row is purely informational.
--
-- Additive migration; no data loss.

ALTER TABLE `task_files` ADD `status` varchar(16) NOT NULL DEFAULT 'active';--> statement-breakpoint
CREATE INDEX `ix_task_files_status_expires` ON `task_files` (`status`,`expires_at`);
