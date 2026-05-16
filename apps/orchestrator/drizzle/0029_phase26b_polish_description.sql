-- Phase 26B polish — scheduled_tasks.description.
--
-- The calendar's quick-create popover gains a collapsible "备注"
-- textarea so users can attach context to a recurring task without
-- bloating the intent. Stored separately from `intent` so the
-- runner's dispatch path stays unchanged (intent is what the
-- orchestrator hands to the agent; description is purely a
-- human-readable annotation surfaced in the event-detail popover).
--
-- Nullable + no default — existing rows stay at NULL until the
-- user edits them.

ALTER TABLE `scheduled_tasks` ADD COLUMN `description` TEXT NULL;
