ALTER TABLE `projects` ADD UNIQUE KEY `uk_projects_id_organization` (`id`, `organization_id`);
--> statement-breakpoint
ALTER TABLE `tasks` ADD UNIQUE KEY `uk_tasks_id_project_user` (`id`, `project_id`, `user_id`);
--> statement-breakpoint
CREATE TABLE `team_milestones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `created_by_user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'open',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `due_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_milestones_external_id` (`external_id`),
  UNIQUE KEY `uk_team_milestones_id_tenant` (`id`, `organization_id`, `project_id`),
  KEY `ix_team_milestones_tenant_status` (`organization_id`, `project_id`, `status`),
  KEY `ix_team_milestones_project_sort` (`project_id`, `sort_order`),
  CONSTRAINT `fk_team_milestones_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_milestones_project_tenant`
    FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`) ON DELETE RESTRICT,
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
  UNIQUE KEY `uk_team_work_items_id_tenant` (`id`, `organization_id`, `project_id`),
  KEY `ix_team_work_items_tenant_status` (`organization_id`, `project_id`, `status`),
  KEY `ix_team_work_items_project_due` (`project_id`, `due_at`),
  KEY `ix_team_work_items_milestone` (`milestone_id`, `status`),
  CONSTRAINT `fk_team_work_items_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_items_project_tenant`
    FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_items_milestone_lineage`
    FOREIGN KEY (`milestone_id`, `organization_id`, `project_id`) REFERENCES `team_milestones` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  CONSTRAINT `fk_team_work_item_assignments_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  CONSTRAINT `fk_team_work_item_dependencies_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_dependencies_predecessor_lineage`
    FOREIGN KEY (`depends_on_work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  UNIQUE KEY `uk_acceptance_contract_versions_id_lineage` (`id`, `work_item_id`, `organization_id`, `project_id`),
  KEY `ix_acceptance_contract_versions_tenant` (`organization_id`, `project_id`, `work_item_id`),
  KEY `ix_acceptance_contract_versions_approver` (`approver_user_id`, `confirmed_at`),
  CONSTRAINT `fk_acceptance_contract_versions_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_acceptance_contract_versions_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  ADD CONSTRAINT `fk_team_work_items_current_contract_lineage`
    FOREIGN KEY (`current_contract_version_id`, `id`, `organization_id`, `project_id`) REFERENCES `acceptance_contract_versions` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT;
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
  UNIQUE KEY `uk_team_work_item_submissions_id_lineage` (`id`, `contract_version_id`, `work_item_id`, `organization_id`, `project_id`),
  UNIQUE KEY `uk_team_work_item_submissions_id_tenant_item` (`id`, `work_item_id`, `organization_id`, `project_id`),
  KEY `ix_team_work_item_submissions_tenant` (`organization_id`, `project_id`, `work_item_id`),
  KEY `ix_team_work_item_submissions_submitter` (`submitted_by_user_id`, `submitted_at`),
  CONSTRAINT `fk_team_work_item_submissions_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_submissions_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_submissions_contract_lineage`
    FOREIGN KEY (`contract_version_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `acceptance_contract_versions` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  `review_delegation_id` BIGINT UNSIGNED NULL,
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
  UNIQUE KEY `uk_team_work_item_reviews_id_lineage` (`id`, `submission_id`, `work_item_id`, `organization_id`, `project_id`),
  UNIQUE KEY `uk_team_work_item_reviews_id_tenant_item` (`id`, `work_item_id`, `organization_id`, `project_id`),
  KEY `ix_team_work_item_reviews_tenant_decision` (`organization_id`, `project_id`, `decision`),
  KEY `ix_team_work_item_reviews_reviewer` (`reviewer_user_id`, `reviewed_at`),
  CONSTRAINT `fk_team_work_item_reviews_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_submission_lineage`
    FOREIGN KEY (`submission_id`, `contract_version_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_item_submissions` (`id`, `contract_version_id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_reviews_reviewer`
    FOREIGN KEY (`reviewer_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_task_review_delegations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `delegator_user_id` BIGINT UNSIGNED NOT NULL,
  `delegate_user_id` BIGINT UNSIGNED NOT NULL,
  `valid_from` DATETIME(3) NOT NULL,
  `valid_until` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `revoked_by_user_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_task_review_delegations_external_id` (`external_id`),
  UNIQUE KEY `uk_team_task_review_delegations_id_lineage` (`id`, `organization_id`, `project_id`, `delegate_user_id`),
  UNIQUE KEY `uk_team_task_review_delegations_grant` (`organization_id`, `project_id`, `delegator_user_id`, `delegate_user_id`, `valid_from`),
  KEY `ix_team_task_review_delegations_tenant_window` (`organization_id`, `project_id`, `delegator_user_id`, `delegate_user_id`, `valid_from`, `valid_until`),
  CHECK (`valid_until` > `valid_from`),
  CHECK (`delegator_user_id` <> `delegate_user_id`),
  CHECK ((`revoked_at` IS NULL AND `revoked_by_user_id` IS NULL) OR (`revoked_at` IS NOT NULL AND `revoked_by_user_id` IS NOT NULL AND `revoked_at` >= `valid_from`)),
  CONSTRAINT `fk_team_task_review_delegations_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_task_review_delegations_project_tenant`
    FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_task_review_delegations_delegator`
    FOREIGN KEY (`delegator_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_task_review_delegations_delegate`
    FOREIGN KEY (`delegate_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_task_review_delegations_revoked_by`
    FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE `team_work_item_reviews`
  ADD CONSTRAINT `fk_team_work_item_reviews_delegation_lineage`
    FOREIGN KEY (`review_delegation_id`, `organization_id`, `project_id`, `reviewer_user_id`) REFERENCES `team_task_review_delegations` (`id`, `organization_id`, `project_id`, `delegate_user_id`) ON DELETE RESTRICT;
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
  UNIQUE KEY `uk_team_work_item_appeals_id_tenant_item` (`id`, `work_item_id`, `organization_id`, `project_id`),
  KEY `ix_team_work_item_appeals_tenant_status` (`organization_id`, `project_id`, `status`),
  KEY `ix_team_work_item_appeals_opened_by` (`opened_by_user_id`, `opened_at`),
  CONSTRAINT `fk_team_work_item_appeals_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_appeals_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_appeals_review_lineage`
    FOREIGN KEY (`review_id`, `submission_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_item_reviews` (`id`, `submission_id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  CONSTRAINT `fk_team_arbitration_decisions_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_arbitration_decisions_appeal_lineage`
    FOREIGN KEY (`appeal_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_item_appeals` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  CONSTRAINT `fk_team_work_item_events_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_events_actor`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_work_item_events_contract_lineage`
    FOREIGN KEY (`contract_version_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `acceptance_contract_versions` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `team_project_planning_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `milestone_id` BIGINT UNSIGNED NULL,
  `actor_user_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(48) NOT NULL,
  `idempotency_key` VARCHAR(64) NOT NULL,
  `metadata_json` JSON NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_project_planning_events_external_id` (`external_id`),
  UNIQUE KEY `uk_team_project_planning_events_organization_idempotency` (`organization_id`, `idempotency_key`),
  KEY `ix_team_project_planning_events_tenant_type` (`organization_id`, `project_id`, `event_type`),
  KEY `ix_team_project_planning_events_milestone_time` (`milestone_id`, `occurred_at`),
  KEY `ix_team_project_planning_events_actor` (`actor_user_id`, `occurred_at`),
  CONSTRAINT `fk_team_project_planning_events_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_project_planning_events_project_tenant`
    FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_project_planning_events_milestone_lineage`
    FOREIGN KEY (`milestone_id`, `organization_id`, `project_id`) REFERENCES `team_milestones` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_project_planning_events_actor`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
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
  CONSTRAINT `fk_team_evidence_bindings_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_submission_lineage`
    FOREIGN KEY (`submission_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_item_submissions` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_review_lineage`
    FOREIGN KEY (`review_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_item_reviews` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_evidence_bindings_appeal_lineage`
    FOREIGN KEY (`appeal_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_item_appeals` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
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
  UNIQUE KEY `uk_team_ai_contributions_id_tenant_item` (`id`, `work_item_id`, `organization_id`, `project_id`),
  KEY `ix_team_ai_contributions_tenant` (`organization_id`, `project_id`, `work_item_id`),
  KEY `ix_team_ai_contributions_execution_task` (`execution_task_id`),
  KEY `ix_team_ai_contributions_contributor` (`contributed_by_user_id`, `created_at`),
  CONSTRAINT `fk_team_ai_contributions_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_ai_contributions_work_item_lineage`
    FOREIGN KEY (`work_item_id`, `organization_id`, `project_id`) REFERENCES `team_work_items` (`id`, `organization_id`, `project_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_ai_contributions_contributed_by`
    FOREIGN KEY (`contributed_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_team_ai_contributions_execution_task_lineage`
    FOREIGN KEY (`execution_task_id`, `project_id`, `contributed_by_user_id`) REFERENCES `tasks` (`id`, `project_id`, `user_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE `team_evidence_bindings`
  ADD CONSTRAINT `fk_team_evidence_bindings_ai_lineage`
    FOREIGN KEY (`ai_contribution_id`, `work_item_id`, `organization_id`, `project_id`) REFERENCES `team_ai_contributions` (`id`, `work_item_id`, `organization_id`, `project_id`) ON DELETE RESTRICT;
