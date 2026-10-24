-- Batch 06 — playbook self-evolution loop (capture → sediment → canary → reuse).
--
-- Pure ADDITIVE: only ADD COLUMN / CREATE TABLE. No existing column changes,
-- no data rewrite. One column per statement so a partially applied run can be
-- replayed (duplicate-column errors are skipped by the migration runner).
--
-- task_action_captures (capture, reused ACTION_CAPTURE table):
--   replay_json      — {op, locator:{role,name,textContains?,nth?}, wait?, submit?}
--                      the role+name locator and wait condition for replay.
--   outcome_json     — result evidence {finalUrl, evidenceTexts[]}; set only on
--                      the last capture row of a successful task.
--   executor_source  — 'cloud' | 'extension' (which executor produced the row).
-- operation_paths (sediment / verify):
--   template_json      — parameterised, deterministically validated template.
--   generalizer        — 'qwen' | 'deterministic' | 'repair'.
--   canary_pass_streak — consecutive canary passes; ≥ N (default 3) → verified.
-- operation_path_replays (reuse metrics): one row per reuse attempt of a path.
--
-- Rollback:
--   DROP TABLE operation_path_replays;
--   ALTER TABLE operation_paths DROP COLUMN canary_pass_streak, DROP COLUMN generalizer, DROP COLUMN template_json;
--   ALTER TABLE task_action_captures DROP COLUMN executor_source, DROP COLUMN outcome_json, DROP COLUMN replay_json;

ALTER TABLE `task_action_captures`
  ADD COLUMN `replay_json` JSON NULL AFTER `coordinate_json`;
--> statement-breakpoint
ALTER TABLE `task_action_captures`
  ADD COLUMN `outcome_json` JSON NULL AFTER `replay_json`;
--> statement-breakpoint
ALTER TABLE `task_action_captures`
  ADD COLUMN `executor_source` VARCHAR(16) NULL AFTER `outcome_json`;
--> statement-breakpoint
ALTER TABLE `operation_paths`
  ADD COLUMN `template_json` JSON NULL AFTER `metadata_json`;
--> statement-breakpoint
ALTER TABLE `operation_paths`
  ADD COLUMN `generalizer` VARCHAR(32) NULL AFTER `template_json`;
--> statement-breakpoint
ALTER TABLE `operation_paths`
  ADD COLUMN `canary_pass_streak` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `generalizer`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `operation_path_replays` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `path_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NULL,
  `outcome` VARCHAR(16) NOT NULL,
  `steps_total` INT UNSIGNED NOT NULL DEFAULT 0,
  `steps_deterministic` INT UNSIGNED NOT NULL DEFAULT 0,
  `steps_repaired` INT UNSIGNED NOT NULL DEFAULT 0,
  `model_calls` INT UNSIGNED NOT NULL DEFAULT 0,
  `model_calls_saved` INT UNSIGNED NOT NULL DEFAULT 0,
  `repaired_path_id` BIGINT UNSIGNED NULL,
  `failed_step_index` INT UNSIGNED NULL,
  `failure_reason` VARCHAR(255) NULL,
  `duration_ms` INT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_operation_path_replays_external_id` (`external_id`),
  KEY `ix_operation_path_replays_path_created` (`path_id`, `created_at`),
  KEY `ix_operation_path_replays_task` (`task_id`),
  KEY `ix_operation_path_replays_repaired_path` (`repaired_path_id`),
  CONSTRAINT `fk_operation_path_replays_path` FOREIGN KEY (`path_id`) REFERENCES `operation_paths` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_operation_path_replays_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_operation_path_replays_repaired_path` FOREIGN KEY (`repaired_path_id`) REFERENCES `operation_paths` (`id`) ON DELETE SET NULL
);
