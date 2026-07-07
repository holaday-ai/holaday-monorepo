-- Split batch parent counters so review-needed items are not reported as failed.
--
-- Pure additive / expand-first:
--   - Existing batch_task_items rows already carry per-item status.
--   - Routers recompute counters from item rows for list/detail, so old rows do not
--     rely on this cached parent column.
--   - New finalize runs will persist items_review alongside items_failed/items_done.

ALTER TABLE `batch_tasks`
  ADD COLUMN `items_review` INT NOT NULL DEFAULT 0 AFTER `items_done`;
