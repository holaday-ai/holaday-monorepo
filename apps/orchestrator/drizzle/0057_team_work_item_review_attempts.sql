-- Allow one immutable review row per explicit submission review attempt.

ALTER TABLE `team_work_item_reviews`
  ADD COLUMN `review_attempt` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `review_delegation_id`;

ALTER TABLE `team_work_item_reviews`
  DROP INDEX `uk_team_work_item_reviews_submission`;

ALTER TABLE `team_work_item_reviews`
  ADD UNIQUE KEY `uk_team_work_item_reviews_submission_attempt` (`submission_id`, `review_attempt`);
