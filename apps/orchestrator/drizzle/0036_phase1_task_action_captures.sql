-- Phase 1 Playbook B 捕获层 — `task_action_captures` (raw per-action capture trajectory).
--
-- Source of truth: Playbook B 捕获层 spec (多信号动作捕获:文本锚为主 + 选择器 + 坐标兜底).
-- This is the DISTILLATION SOURCE for ① passive crystallization — deliberately
-- DISTINCT from `operation_path_steps` (0033), which holds the DISTILLED, verified
-- path prior. Captures are append-only and cheap; paths are curated.
--
-- Numbering: 0035 (video self-use consent) is the prior; this 排其后 = 0036.
--
-- Pure ADDITIVE / expand-first: ONE new leaf table, NO change to any existing
-- table or column. It FKs OUT to `tasks` (ON DELETE CASCADE — drop the task, drop
-- its captures) and `evidence_artifacts` (ON DELETE SET NULL — the retention reaper
-- may sweep an anchor screenshot without orphaning the capture). Both referents
-- pre-exist (tasks: 0001; evidence_artifacts: 0033), so the FKs are INLINE — no
-- create-order cycle, no deferred ALTER. NOTHING FKs INTO this table.
-- Rollback: DROP TABLE `task_action_captures`.
--
-- This migration builds the table ONLY — no code reads or writes it yet (the B2
-- capture writer + redaction land separately). `input_value` is a placeholder
-- column: sensitive / password field values are NEVER persisted here (redacted at
-- write time in B2). `frame_path` is reserved for B3 frame-routed capture.

CREATE TABLE `task_action_captures` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `site_domain` VARCHAR(255) NULL,
  `action_index` INT UNSIGNED NOT NULL,
  `step_type` VARCHAR(48) NOT NULL,
  `visible_text` TEXT NULL,
  `target_selector_json` JSON NULL,
  `coordinate_json` JSON NULL,
  `frame_path` VARCHAR(255) NULL,
  `entry_url` TEXT NULL,
  `input_value` TEXT NULL,
  `screenshot_anchor_id` BIGINT UNSIGNED NULL,
  `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_action_captures_external_id` (`external_id`),
  KEY `ix_task_action_captures_site` (`site_domain`),
  KEY `ix_task_action_captures_task_action` (`task_id`, `action_index`),
  CONSTRAINT `fk_action_capture_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_action_capture_anchor` FOREIGN KEY (`screenshot_anchor_id`) REFERENCES `evidence_artifacts` (`id`) ON DELETE SET NULL
);
