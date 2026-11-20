-- Personal Home downloads use the existing owner-scoped file index without inventing tasks.
-- Apply before deploying the application that selects this new nullable column.
ALTER TABLE `task_files` ADD COLUMN `browser_source` JSON NULL;
