-- Phase 1 Playbook ① 被动结晶 — operation_paths / operation_path_steps 结晶来源列 (migration 0037).
--
-- Source of truth: ① 被动结晶 v1 (单成功 task → draft operation_path).
--
-- Pure ADDITIVE / expand-first: 只 ADD COLUMN / KEY / CONSTRAINT，两表都【全空 0 行】→
-- 加列零风险。NOT 改/删任何现有列，NOT 动其他表。Rollback =
--   ALTER TABLE operation_paths DROP FOREIGN KEY fk_operation_path_source_task,
--     DROP KEY ix_operation_path_source_task, DROP COLUMN source_task_id, DROP COLUMN metadata_json;
--   ALTER TABLE operation_path_steps DROP COLUMN frame_path;
--
-- 为什么：① 结晶批处理需要 (a) 幂等去重键 + 回溯 source task 的 provenance 链，
-- (b) source task 原始 intent 文本的家 (v2 聚类料)。operation_paths 两样都没有
-- (无 metadata_json / 无 source 引用——不像 sites / evidence_artifacts 都带 metadata_json)。
-- operation_path_steps 没有 frame_path (B3 捕到了，但 step 无处存)。
--
-- Numbering: 0036 (task_action_captures) 在前；this 排其后 = 0037.
-- source_task_id 与 tasks.id 同类型 (BIGINT UNSIGNED)；FK/索引名全仓唯一
-- (fk_operation_path_* 现有 site/capability/parent 三个，source_task 是新的)。

ALTER TABLE `operation_paths`
  ADD COLUMN `source_task_id` BIGINT UNSIGNED NULL AFTER `parent_path_id`,
  ADD COLUMN `metadata_json` JSON NULL AFTER `metrics_updated_at`,
  ADD KEY `ix_operation_path_source_task` (`source_task_id`),
  ADD CONSTRAINT `fk_operation_path_source_task` FOREIGN KEY (`source_task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL;

ALTER TABLE `operation_path_steps`
  ADD COLUMN `frame_path` VARCHAR(255) NULL AFTER `coordinate_fallback_json`;
