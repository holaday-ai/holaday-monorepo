CREATE TABLE `team_milestones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `created_by_user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'open',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `due_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_milestones_external_id` (`external_id`),
  KEY `ix_team_milestones_tenant_status` (`organization_id`, `project_id`, `status`),
  KEY `ix_team_milestones_project_sort` (`project_id`, `sort_order`),
  CONSTRAINT `fk_team_milestones_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_milestones_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_milestones_created_by`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_work_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `milestone_id` BIGINT UNSIGNED NULL,
  `created_by_user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `assignment_mode` VARCHAR(24) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `due_at` DATETIME(3) NULL,
  `blocker_json` JSON NULL,
  `revision_round` INT UNSIGNED NOT NULL DEFAULT 0,
  `closed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_work_items_external_id` (`external_id`),
  KEY `ix_team_work_items_tenant_status` (`organization_id`, `project_id`, `status`),
  KEY `ix_team_work_items_project_due` (`project_id`, `due_at`),
  KEY `ix_team_work_items_milestone` (`milestone_id`, `status`),
  CONSTRAINT `fk_team_work_items_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_items_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_items_milestone`
    FOREIGN KEY (`milestone_id`) REFERENCES `team_milestones` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_items_created_by`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_work_item_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role` VARCHAR(24) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `responsible_active_key` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `role` = 'responsible' AND `status` = 'accepted' THEN `work_item_id` ELSE NULL END) STORED,
  `offered_by_user_id` BIGINT UNSIGNED NULL,
  `responded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_work_item_assignments_external_id` (`external_id`),
  UNIQUE KEY `uk_team_work_item_assignments_responsible_active` (`responsible_active_key`),
  KEY `ix_team_work_item_assignments_tenant_status` (`organization_id`, `project_id`, `status`),
  KEY `ix_team_work_item_assignments_item_role_status` (`work_item_id`, `role`, `status`),
  KEY `ix_team_work_item_assignments_user_status` (`user_id`, `status`),
  CONSTRAINT `fk_team_work_item_assignments_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_assignments_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_assignments_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_assignments_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_assignments_offered_by`
    FOREIGN KEY (`offered_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_work_item_dependencies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `depends_on_work_item_id` BIGINT UNSIGNED NOT NULL,
  `created_by_user_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_work_item_dependencies_edge` (`work_item_id`, `depends_on_work_item_id`),
  KEY `ix_team_work_item_dependencies_tenant` (`organization_id`, `project_id`),
  KEY `ix_team_work_item_dependencies_predecessor` (`depends_on_work_item_id`),
  CONSTRAINT `fk_team_work_item_dependencies_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_dependencies_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_dependencies_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_dependencies_predecessor`
    FOREIGN KEY (`depends_on_work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_dependencies_created_by`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `acceptance_contract_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `objective` TEXT NOT NULL,
  `deliverables_json` JSON NOT NULL,
  `criteria_json` JSON NOT NULL,
  `required_evidence_types_json` JSON NOT NULL,
  `approver_user_id` BIGINT UNSIGNED NOT NULL,
  `arbitrator_user_id` BIGINT UNSIGNED NOT NULL,
  `due_at` DATETIME(3) NOT NULL,
  `max_revision_rounds` INT UNSIGNED NOT NULL DEFAULT 2,
  `version_note` TEXT NULL,
  `created_by_user_id` BIGINT UNSIGNED NOT NULL,
  `confirmed_by_user_id` BIGINT UNSIGNED NULL,
  `confirmed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_acceptance_contract_versions_external_id` (`external_id`),
  UNIQUE KEY `uk_acceptance_contract_versions_work_item_version` (`work_item_id`, `version`),
  KEY `ix_acceptance_contract_versions_tenant` (`organization_id`, `project_id`, `work_item_id`),
  KEY `ix_acceptance_contract_versions_approver` (`approver_user_id`, `confirmed_at`),
  CONSTRAINT `fk_acceptance_contract_versions_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_acceptance_contract_versions_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_acceptance_contract_versions_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_acceptance_contract_versions_approver`
    FOREIGN KEY (`approver_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_acceptance_contract_versions_arbitrator`
    FOREIGN KEY (`arbitrator_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_acceptance_contract_versions_created_by`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_acceptance_contract_versions_confirmed_by`
    FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE `team_work_items`
  ADD COLUMN `current_contract_version_id` BIGINT UNSIGNED NULL,
  ADD KEY `ix_team_work_items_current_contract` (`current_contract_version_id`),
  ADD CONSTRAINT `fk_team_work_items_current_contract`
    FOREIGN KEY (`current_contract_version_id`) REFERENCES `acceptance_contract_versions` (`id`) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE `team_work_item_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `contract_version_id` BIGINT UNSIGNED NOT NULL,
  `submitted_by_user_id` BIGINT UNSIGNED NOT NULL,
  `submission_version` INT UNSIGNED NOT NULL,
  `summary` TEXT NOT NULL,
  `deliverables_json` JSON NOT NULL,
  `submitted_on_time` BOOLEAN NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_work_item_submissions_external_id` (`external_id`),
  UNIQUE KEY `uk_team_work_item_submissions_work_item_version` (`work_item_id`, `submission_version`),
  KEY `ix_team_work_item_submissions_tenant` (`organization_id`, `project_id`, `work_item_id`),
  KEY `ix_team_work_item_submissions_submitter` (`submitted_by_user_id`, `submitted_at`),
  CONSTRAINT `fk_team_work_item_submissions_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_submissions_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_submissions_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_submissions_contract`
    FOREIGN KEY (`contract_version_id`) REFERENCES `acceptance_contract_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_submissions_submitted_by`
    FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_work_item_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `submission_id` BIGINT UNSIGNED NOT NULL,
  `contract_version_id` BIGINT UNSIGNED NOT NULL,
  `reviewer_user_id` BIGINT UNSIGNED NOT NULL,
  `decision` VARCHAR(32) NOT NULL,
  `failed_criterion_ids_json` JSON NULL,
  `evidence_refs_json` JSON NULL,
  `revision_instructions_json` JSON NULL,
  `rationale` TEXT NULL,
  `new_due_at` DATETIME(3) NULL,
  `reviewed_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_work_item_reviews_external_id` (`external_id`),
  UNIQUE KEY `uk_team_work_item_reviews_submission` (`submission_id`),
  KEY `ix_team_work_item_reviews_tenant_decision` (`organization_id`, `project_id`, `decision`),
  KEY `ix_team_work_item_reviews_reviewer` (`reviewer_user_id`, `reviewed_at`),
  CONSTRAINT `fk_team_work_item_reviews_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_submission`
    FOREIGN KEY (`submission_id`) REFERENCES `team_work_item_submissions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_contract`
    FOREIGN KEY (`contract_version_id`) REFERENCES `acceptance_contract_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_reviewer`
    FOREIGN KEY (`reviewer_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_work_item_appeals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `submission_id` BIGINT UNSIGNED NOT NULL,
  `review_id` BIGINT UNSIGNED NOT NULL,
  `opened_by_user_id` BIGINT UNSIGNED NOT NULL,
  `dispute_type` VARCHAR(32) NOT NULL,
  `grounds` TEXT NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'appeal_open',
  `opened_at` DATETIME(3) NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_work_item_appeals_external_id` (`external_id`),
  UNIQUE KEY `uk_team_work_item_appeals_submission` (`submission_id`),
  KEY `ix_team_work_item_appeals_tenant_status` (`organization_id`, `project_id`, `status`),
  KEY `ix_team_work_item_appeals_opened_by` (`opened_by_user_id`, `opened_at`),
  CONSTRAINT `fk_team_work_item_appeals_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_appeals_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_appeals_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_appeals_submission`
    FOREIGN KEY (`submission_id`) REFERENCES `team_work_item_submissions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_appeals_review`
    FOREIGN KEY (`review_id`) REFERENCES `team_work_item_reviews` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_appeals_opened_by`
    FOREIGN KEY (`opened_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_arbitration_decisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `appeal_id` BIGINT UNSIGNED NOT NULL,
  `arbitrator_user_id` BIGINT UNSIGNED NOT NULL,
  `conflict_snapshot_json` JSON NOT NULL,
  `decision` VARCHAR(32) NOT NULL,
  `criterion_ids_json` JSON NOT NULL,
  `evidence_refs_json` JSON NOT NULL,
  `rationale` TEXT NOT NULL,
  `decided_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_arbitration_decisions_external_id` (`external_id`),
  UNIQUE KEY `uk_team_arbitration_decisions_appeal` (`appeal_id`),
  KEY `ix_team_arbitration_decisions_tenant` (`organization_id`, `project_id`, `decided_at`),
  KEY `ix_team_arbitration_decisions_arbitrator` (`arbitrator_user_id`, `decided_at`),
  CONSTRAINT `fk_team_arbitration_decisions_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_arbitration_decisions_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_arbitration_decisions_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_arbitration_decisions_appeal`
    FOREIGN KEY (`appeal_id`) REFERENCES `team_work_item_appeals` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_arbitration_decisions_arbitrator`
    FOREIGN KEY (`arbitrator_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_work_item_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(48) NOT NULL,
  `from_state` VARCHAR(32) NULL,
  `to_state` VARCHAR(32) NULL,
  `contract_version_id` BIGINT UNSIGNED NULL,
  `idempotency_key` VARCHAR(64) NOT NULL,
  `metadata_json` JSON NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_work_item_events_external_id` (`external_id`),
  UNIQUE KEY `uk_team_work_item_events_organization_idempotency` (`organization_id`, `idempotency_key`),
  KEY `ix_team_work_item_events_item_time` (`work_item_id`, `occurred_at`),
  KEY `ix_team_work_item_events_tenant_type` (`organization_id`, `project_id`, `event_type`),
  KEY `ix_team_work_item_events_actor` (`actor_user_id`, `occurred_at`),
  CONSTRAINT `fk_team_work_item_events_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_events_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_events_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_events_actor`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_events_contract`
    FOREIGN KEY (`contract_version_id`) REFERENCES `acceptance_contract_versions` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_evidence_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `submission_id` BIGINT UNSIGNED NULL,
  `review_id` BIGINT UNSIGNED NULL,
  `appeal_id` BIGINT UNSIGNED NULL,
  `ai_contribution_id` BIGINT UNSIGNED NULL,
  `evidence_artifact_id` BIGINT UNSIGNED NULL,
  `task_file_id` BIGINT UNSIGNED NULL,
  `source_kind` VARCHAR(32) NOT NULL,
  `controlled_external_ref` VARCHAR(512) NULL,
  `metadata_json` JSON NULL,
  `bound_by_user_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_evidence_bindings_external_id` (`external_id`),
  KEY `ix_team_evidence_bindings_tenant` (`organization_id`, `project_id`, `work_item_id`),
  KEY `ix_team_evidence_bindings_submission` (`submission_id`),
  KEY `ix_team_evidence_bindings_review` (`review_id`),
  KEY `ix_team_evidence_bindings_appeal` (`appeal_id`),
  KEY `ix_team_evidence_bindings_ai` (`ai_contribution_id`),
  KEY `ix_team_evidence_bindings_artifact` (`evidence_artifact_id`),
  KEY `ix_team_evidence_bindings_task_file` (`task_file_id`),
  CONSTRAINT `fk_team_evidence_bindings_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_submission`
    FOREIGN KEY (`submission_id`) REFERENCES `team_work_item_submissions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_review`
    FOREIGN KEY (`review_id`) REFERENCES `team_work_item_reviews` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_appeal`
    FOREIGN KEY (`appeal_id`) REFERENCES `team_work_item_appeals` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_artifact`
    FOREIGN KEY (`evidence_artifact_id`) REFERENCES `evidence_artifacts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_task_file`
    FOREIGN KEY (`task_file_id`) REFERENCES `task_files` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_bound_by`
    FOREIGN KEY (`bound_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_ai_contributions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `contributed_by_user_id` BIGINT UNSIGNED NOT NULL,
  `execution_task_id` BIGINT UNSIGNED NOT NULL,
  `requested_scope` TEXT NOT NULL,
  `input_source_summary_json` JSON NOT NULL,
  `result_version` VARCHAR(64) NOT NULL,
  `usage_snapshot_json` JSON NOT NULL,
  `human_confirmation_status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `human_changes_summary` TEXT NULL,
  `unverified_risks_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_ai_contributions_external_id` (`external_id`),
  KEY `ix_team_ai_contributions_tenant` (`organization_id`, `project_id`, `work_item_id`),
  KEY `ix_team_ai_contributions_execution_task` (`execution_task_id`),
  KEY `ix_team_ai_contributions_contributor` (`contributed_by_user_id`, `created_at`),
  CONSTRAINT `fk_team_ai_contributions_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_ai_contributions_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_ai_contributions_work_item`
    FOREIGN KEY (`work_item_id`) REFERENCES `team_work_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_ai_contributions_contributed_by`
    FOREIGN KEY (`contributed_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_ai_contributions_execution_task`
    FOREIGN KEY (`execution_task_id`) REFERENCES `tasks` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE `team_evidence_bindings`
  ADD CONSTRAINT `fk_team_evidence_bindings_ai_contribution`
    FOREIGN KEY (`ai_contribution_id`) REFERENCES `team_ai_contributions` (`id`) ON DELETE RESTRICT;
