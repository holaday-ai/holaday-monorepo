-- Phase 1 指令 #3 — Site Playbook + Evidence Ledger (Pack A storage foundation).
--
-- Source of truth: docs/PHASE1_PLAYBOOK_EVIDENCE_LEDGER_DESIGN.md v2 (§7 草案 / §8 Pack A).
-- This migration ONLY builds the storage foundation — no explorer, no
-- verifier wiring, no UI. 9 tables + the `tasks.origin` isolation column.
--
-- Numbering: #2 A股自选股 watchlists is 0032; this排其后 = 0033.
--
-- DEVIATIONS from the design §7 draft (both are correctness fixes, not
-- schema changes):
--   1. `tasks.origin` is added AFTER `status`, not AFTER `task_id` — the
--      `tasks` table has no `task_id` column, so the draft's `AFTER
--      task_id` would error. Column position is cosmetic in MySQL.
--   2. The draft file name placeholder 0031 is replaced by the real next
--      number 0033.
--
-- Ordering notes:
--   - `evidence_artifacts` is created BEFORE the deferred ALTER that adds
--     `operation_path_steps.screenshot_anchor_id`'s FK, breaking the
--     create-order cycle (steps reference artifacts, artifacts reference
--     exploration_runs).
--   - `evidence_artifacts.task_id` is ON DELETE SET NULL (design §4.9):
--     user delete-right vs. audit retention can't be expressed by a
--     single FK behavior, so deletion is resolved at the application
--     layer by purpose / retention_policy.
--   - Global-site dedup (sites with owner_user_id IS NULL) is NOT a
--     unique index — MySQL does not treat multiple NULLs as conflicting.
--     SiteRepository enforces "one global row per canonical_domain" in
--     the application layer.

ALTER TABLE `tasks`
  ADD COLUMN `origin` VARCHAR(32) NOT NULL DEFAULT 'user' AFTER `status`,
  ADD KEY `ix_tasks_origin_user_created` (`origin`, `user_id`, `created_at`),
  ADD KEY `ix_tasks_origin_status_created` (`origin`, `status`, `created_at`);

CREATE TABLE `sites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `owner_user_id` BIGINT UNSIGNED NULL,
  `canonical_domain` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `homepage_url` VARCHAR(1024) NOT NULL,
  `purpose_summary` TEXT NULL,
  `category` VARCHAR(64) NULL,
  `language` VARCHAR(16) NULL,
  `region` VARCHAR(32) NULL,
  `site_status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `default_auth_policy` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `credential_vault_ref` VARCHAR(128) NULL,
  `sensitive_profile_id` BIGINT UNSIGNED NULL,
  `risk_level` VARCHAR(32) NOT NULL DEFAULT 'medium',
  `anti_bot_level` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `metadata_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sites_external_id` (`external_id`),
  KEY `ix_sites_domain_owner` (`canonical_domain`, `owner_user_id`),
  KEY `ix_sites_status` (`site_status`),
  CONSTRAINT `fk_sites_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `site_capabilities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `site_id` BIGINT UNSIGNED NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `input_schema_json` JSON NULL,
  `output_schema_json` JSON NULL,
  `auth_requirement` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `credential_vault_ref` VARCHAR(128) NULL,
  `risk_tags_json` JSON NULL,
  `sensitive_action_level` VARCHAR(32) NOT NULL DEFAULT 'read_only',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `confidence` DECIMAL(5,4) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_capability_external_id` (`external_id`),
  UNIQUE KEY `uk_capability_site_key` (`site_id`, `capability_key`),
  KEY `ix_capability_site_status` (`site_id`, `status`),
  CONSTRAINT `fk_capability_site` FOREIGN KEY (`site_id`) REFERENCES `sites` (`id`) ON DELETE CASCADE
);

CREATE TABLE `operation_paths` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `site_id` BIGINT UNSIGNED NOT NULL,
  `capability_id` BIGINT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `parent_path_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `entry_url_template` VARCHAR(1024) NULL,
  `input_binding_json` JSON NULL,
  `preconditions_json` JSON NULL,
  `postconditions_json` JSON NULL,
  `lane_hint` VARCHAR(64) NULL,
  `selector_strategy_json` JSON NULL,
  `coordinate_fallback_json` JSON NULL,
  `screenshot_anchor_json` JSON NULL,
  `risk_tags_json` JSON NULL,
  `sensitive_policy_ref` VARCHAR(128) NULL,
  `auth_wall_map_json` JSON NULL,
  `anti_bot_notes_json` JSON NULL,
  `last_verified_at` DATETIME(3) NULL,
  `stale_reason` VARCHAR(255) NULL,
  `success_rate_30d` DECIMAL(5,4) NULL,
  `exec_count_30d` INT UNSIGNED NOT NULL DEFAULT 0,
  `fail_count_30d` INT UNSIGNED NOT NULL DEFAULT 0,
  `metrics_updated_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_operation_path_external_id` (`external_id`),
  UNIQUE KEY `uk_operation_path_capability_version` (`capability_id`, `version`),
  KEY `ix_operation_path_site_status` (`site_id`, `status`),
  KEY `ix_operation_path_capability_status` (`capability_id`, `status`),
  CONSTRAINT `fk_operation_path_site` FOREIGN KEY (`site_id`) REFERENCES `sites` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_operation_path_capability` FOREIGN KEY (`capability_id`) REFERENCES `site_capabilities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_operation_path_parent` FOREIGN KEY (`parent_path_id`) REFERENCES `operation_paths` (`id`) ON DELETE SET NULL
);

CREATE TABLE `operation_path_steps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `path_id` BIGINT UNSIGNED NOT NULL,
  `step_index` INT UNSIGNED NOT NULL,
  `step_type` VARCHAR(48) NOT NULL,
  `intent` VARCHAR(255) NOT NULL,
  `target_selector_json` JSON NULL,
  `target_text_json` JSON NULL,
  `coordinate_fallback_json` JSON NULL,
  `screenshot_anchor_id` BIGINT UNSIGNED NULL,
  `input_key` VARCHAR(128) NULL,
  `expected_observation_json` JSON NULL,
  `failure_modes_json` JSON NULL,
  `sensitive_action` TINYINT(1) NOT NULL DEFAULT 0,
  `sensitive_action_level` VARCHAR(32) NOT NULL DEFAULT 'read_only',
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_path_step_index` (`path_id`, `step_index`),
  KEY `ix_path_steps_path` (`path_id`),
  KEY `ix_path_steps_anchor` (`screenshot_anchor_id`),
  CONSTRAINT `fk_path_step_path` FOREIGN KEY (`path_id`) REFERENCES `operation_paths` (`id`) ON DELETE CASCADE
);

CREATE TABLE `exploration_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `site_id` BIGINT UNSIGNED NOT NULL,
  `watch_target_id` BIGINT UNSIGNED NULL,
  `trigger_type` VARCHAR(32) NOT NULL,
  `runner_type` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `summary` TEXT NULL,
  `error_code` VARCHAR(64) NULL,
  `error_message` TEXT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_exploration_run_external_id` (`external_id`),
  KEY `ix_exploration_site_created` (`site_id`, `created_at`),
  KEY `ix_exploration_status` (`status`),
  CONSTRAINT `fk_exploration_site` FOREIGN KEY (`site_id`) REFERENCES `sites` (`id`) ON DELETE CASCADE
);

CREATE TABLE `evidence_artifacts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `owner_user_id` BIGINT UNSIGNED NULL,
  `site_id` BIGINT UNSIGNED NULL,
  `task_id` BIGINT UNSIGNED NULL,
  `exploration_run_id` BIGINT UNSIGNED NULL,
  `artifact_kind` VARCHAR(48) NOT NULL,
  `purpose` VARCHAR(48) NOT NULL,
  `source_url` VARCHAR(2048) NULL,
  `final_url` VARCHAR(2048) NULL,
  `r2_bucket` VARCHAR(128) NOT NULL,
  `r2_key` VARCHAR(512) NOT NULL,
  `content_type` VARCHAR(128) NOT NULL,
  `size_bytes` INT UNSIGNED NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `captured_at` DATETIME(3) NOT NULL,
  `collector_lane` VARCHAR(64) NOT NULL,
  `collector_version` VARCHAR(64) NULL,
  `viewport_json` JSON NULL,
  `dom_hash` CHAR(64) NULL,
  `screenshot_hash` CHAR(64) NULL,
  `raw_excerpt` TEXT NULL,
  `confidence` VARCHAR(32) NOT NULL DEFAULT 'observed',
  `retention_policy` VARCHAR(32) NOT NULL DEFAULT 'task_30d',
  `expires_at` DATETIME(3) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_evidence_artifact_external_id` (`external_id`),
  KEY `ix_evidence_task` (`task_id`, `purpose`),
  KEY `ix_evidence_site` (`site_id`, `purpose`),
  KEY `ix_evidence_exploration` (`exploration_run_id`),
  KEY `ix_evidence_sha` (`sha256`),
  KEY `ix_evidence_expires` (`expires_at`),
  CONSTRAINT `fk_evidence_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_evidence_site` FOREIGN KEY (`site_id`) REFERENCES `sites` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_evidence_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_evidence_exploration` FOREIGN KEY (`exploration_run_id`) REFERENCES `exploration_runs` (`id`) ON DELETE SET NULL
);

-- Deferred FK: now that evidence_artifacts exists, wire the path step's
-- screenshot anchor (ON DELETE SET NULL — losing an anchor must not drop
-- the step).
ALTER TABLE `operation_path_steps`
  ADD CONSTRAINT `fk_path_step_anchor`
  FOREIGN KEY (`screenshot_anchor_id`) REFERENCES `evidence_artifacts` (`id`) ON DELETE SET NULL;

CREATE TABLE `claims` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `task_id` BIGINT UNSIGNED NULL,
  `site_id` BIGINT UNSIGNED NULL,
  `capability_id` BIGINT UNSIGNED NULL,
  `claim_type` VARCHAR(64) NOT NULL,
  `subject` VARCHAR(512) NOT NULL,
  `predicate` VARCHAR(128) NOT NULL,
  `object_text` TEXT NULL,
  `object_json` JSON NULL,
  `confidence` DECIMAL(5,4) NULL,
  `verification_status` VARCHAR(32) NOT NULL DEFAULT 'unverified',
  `created_by_lane` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_claim_external_id` (`external_id`),
  KEY `ix_claim_task` (`task_id`, `verification_status`),
  KEY `ix_claim_site` (`site_id`, `claim_type`),
  KEY `ix_claim_capability` (`capability_id`),
  CONSTRAINT `fk_claim_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_claim_site` FOREIGN KEY (`site_id`) REFERENCES `sites` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_claim_capability` FOREIGN KEY (`capability_id`) REFERENCES `site_capabilities` (`id`) ON DELETE SET NULL
);

CREATE TABLE `claim_evidence_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `claim_id` BIGINT UNSIGNED NOT NULL,
  `artifact_id` BIGINT UNSIGNED NOT NULL,
  `support_type` VARCHAR(32) NOT NULL DEFAULT 'supports',
  `excerpt_start` INT UNSIGNED NULL,
  `excerpt_end` INT UNSIGNED NULL,
  `quoted_excerpt` TEXT NULL,
  `confidence` DECIMAL(5,4) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_claim_artifact_support` (`claim_id`, `artifact_id`, `support_type`),
  KEY `ix_claim_evidence_artifact` (`artifact_id`),
  CONSTRAINT `fk_claim_evidence_claim` FOREIGN KEY (`claim_id`) REFERENCES `claims` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_claim_evidence_artifact` FOREIGN KEY (`artifact_id`) REFERENCES `evidence_artifacts` (`id`) ON DELETE CASCADE
);

CREATE TABLE `canary_results` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `path_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NULL,
  `exploration_run_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `failure_type` VARCHAR(64) NULL,
  `verified_outputs_json` JSON NULL,
  `evidence_summary_json` JSON NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_canary_external_id` (`external_id`),
  KEY `ix_canary_path_status` (`path_id`, `status`),
  KEY `ix_canary_task` (`task_id`),
  CONSTRAINT `fk_canary_path` FOREIGN KEY (`path_id`) REFERENCES `operation_paths` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_canary_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_canary_exploration` FOREIGN KEY (`exploration_run_id`) REFERENCES `exploration_runs` (`id`) ON DELETE SET NULL
);
