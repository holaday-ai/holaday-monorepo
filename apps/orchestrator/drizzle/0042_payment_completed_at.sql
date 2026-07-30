ALTER TABLE `payments`
  ADD COLUMN `completed_at` datetime(3) NULL AFTER `metadata`;

UPDATE `payments`
SET `completed_at` = `updated_at`
WHERE `status` = 'completed'
  AND `completed_at` IS NULL;

CREATE INDEX `ix_payments_status_completed`
  ON `payments` (`status`, `completed_at`);
