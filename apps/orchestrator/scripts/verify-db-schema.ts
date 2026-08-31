import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import mysql from 'mysql2/promise';
import {
  STOCK_PREFERENCE_REQUIRED_COLUMNS,
  STOCK_PREFERENCE_REQUIRED_TABLES,
  findMissingRequiredIndexes,
} from './release-db-contract.mjs';
import { findTeamWorkItemSchemaViolations } from './team-work-item-schema-contract.mjs';

function loadDotenvAllowingEmpty(path: string): void {
  const result = loadDotenv({ path, override: false });
  if (!result.parsed) return;
  for (const [key, value] of Object.entries(result.parsed)) {
    if (process.env[key] === '') process.env[key] = value;
  }
}

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
loadDotenvAllowingEmpty(resolve(repoRoot, '.env'));
loadDotenvAllowingEmpty(resolve(repoRoot, '.env.local'));
loadDotenvAllowingEmpty(resolve(appRoot, '.env.local'));

const REQUIRED_TABLES = [
  'account_closure_challenges',
  'account_closure_effects',
  'account_closure_receipts',
  'account_closure_requests',
  'account_closure_steps',
  'api_keys',
  'batch_task_items',
  'batch_tasks',
  'execution_memory',
  'execution_stats',
  'energy_daily_metrics',
  'energy_daily_visitors',
  'energy_event_receipts',
  'feedback_cases',
  'notifications',
  'notification_channels',
  'organization_invitations',
  'organization_members',
  'organizations',
  'payments',
  'pending_cookies',
  'planned_task_items',
  'planned_task_occurrence_overrides',
  'planned_task_run_items',
  'planned_task_runs',
  'planned_tasks',
  'projects',
  'project_members',
  'team_milestones',
  'team_work_items',
  'team_work_item_assignments',
  'team_work_item_dependencies',
  'acceptance_contract_versions',
  'team_work_item_submissions',
  'team_work_item_reviews',
  'team_task_review_delegations',
  'team_work_item_appeals',
  'team_arbitration_decisions',
  'team_work_item_events',
  'team_project_planning_events',
  'team_evidence_bindings',
  'team_ai_contributions',
  'scheduled_tasks',
  'sessions',
  'skills',
  'stock_dashboard_snapshots',
  ...STOCK_PREFERENCE_REQUIRED_TABLES,
  'stock_risk_monitors',
  'task_events',
  'task_files',
  'task_quotas',
  'task_steps',
  'tasks',
  'user_profiles',
  'user_mfa_recovery_codes',
  'user_site_stats',
  'users',
  'verification_codes',
  'video_edit_action_quotes',
  'video_edit_projects',
  'video_edit_render_attempts',
  'video_edit_versions',
  'webhook_idempotency',
] as const;

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  organizations: [
    'external_id',
    'name',
    'owner_user_id',
    'status',
    'team_projects_enabled',
    'created_at',
    'updated_at',
  ],
  organization_members: [
    'external_id',
    'organization_id',
    'user_id',
    'role',
    'manager_user_id',
    'status',
    'joined_at',
    'created_at',
    'updated_at',
  ],
  organization_invitations: [
    'external_id',
    'organization_id',
    'token_hash',
    'role',
    'manager_user_id',
    'invited_by_user_id',
    'expires_at',
    'accepted_at',
    'revoked_at',
    'created_at',
    'updated_at',
  ],
  project_members: [
    'external_id',
    'project_id',
    'user_id',
    'role',
    'status',
    'created_at',
    'updated_at',
  ],
  projects: ['user_id', 'organization_id'],
  team_milestones: [
    'external_id',
    'organization_id',
    'project_id',
    'created_by_user_id',
    'title',
    'status',
    'version',
    'sort_order',
    'due_at',
    'created_at',
    'updated_at',
  ],
  team_work_items: [
    'external_id',
    'organization_id',
    'project_id',
    'milestone_id',
    'created_by_user_id',
    'title',
    'assignment_mode',
    'status',
    'version',
    'current_contract_version_id',
    'due_at',
    'blocker_json',
    'revision_round',
    'closed_at',
    'created_at',
    'updated_at',
  ],
  team_work_item_assignments: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'user_id',
    'role',
    'status',
    'responsible_active_key',
    'offered_by_user_id',
    'responded_at',
    'created_at',
    'updated_at',
  ],
  team_work_item_dependencies: [
    'organization_id',
    'project_id',
    'work_item_id',
    'depends_on_work_item_id',
    'created_by_user_id',
    'created_at',
  ],
  acceptance_contract_versions: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'version',
    'objective',
    'deliverables_json',
    'criteria_json',
    'required_evidence_types_json',
    'approver_user_id',
    'arbitrator_user_id',
    'due_at',
    'max_revision_rounds',
    'version_note',
    'created_by_user_id',
    'confirmed_by_user_id',
    'confirmed_at',
    'created_at',
  ],
  team_work_item_submissions: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'contract_version_id',
    'submitted_by_user_id',
    'submission_version',
    'summary',
    'deliverables_json',
    'submitted_on_time',
    'submitted_at',
    'created_at',
  ],
  team_work_item_reviews: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'submission_id',
    'contract_version_id',
    'reviewer_user_id',
    'review_delegation_id',
    'review_attempt',
    'decision',
    'failed_criterion_ids_json',
    'evidence_refs_json',
    'revision_instructions_json',
    'rationale',
    'new_due_at',
    'reviewed_at',
    'created_at',
  ],
  team_task_review_delegations: [
    'external_id',
    'organization_id',
    'project_id',
    'delegator_user_id',
    'delegate_user_id',
    'valid_from',
    'valid_until',
    'revoked_at',
    'revoked_by_user_id',
    'created_at',
  ],
  team_work_item_appeals: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'submission_id',
    'review_id',
    'opened_by_user_id',
    'dispute_type',
    'grounds',
    'status',
    'opened_at',
    'resolved_at',
    'created_at',
    'updated_at',
  ],
  team_arbitration_decisions: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'appeal_id',
    'arbitrator_user_id',
    'conflict_snapshot_json',
    'decision',
    'criterion_ids_json',
    'evidence_refs_json',
    'rationale',
    'decided_at',
    'created_at',
  ],
  team_work_item_events: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'actor_user_id',
    'event_type',
    'from_state',
    'to_state',
    'contract_version_id',
    'idempotency_key',
    'metadata_json',
    'occurred_at',
  ],
  team_project_planning_events: [
    'external_id',
    'organization_id',
    'project_id',
    'milestone_id',
    'actor_user_id',
    'event_type',
    'idempotency_key',
    'metadata_json',
    'occurred_at',
  ],
  team_evidence_bindings: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'submission_id',
    'review_id',
    'appeal_id',
    'ai_contribution_id',
    'evidence_artifact_id',
    'task_file_id',
    'source_kind',
    'controlled_external_ref',
    'metadata_json',
    'bound_by_user_id',
    'created_at',
  ],
  team_ai_contributions: [
    'external_id',
    'organization_id',
    'project_id',
    'work_item_id',
    'contributed_by_user_id',
    'execution_task_id',
    'requested_scope',
    'input_source_summary_json',
    'result_version',
    'usage_snapshot_json',
    'human_confirmation_status',
    'human_changes_summary',
    'unverified_risks_json',
    'created_at',
    'confirmed_at',
  ],
  account_closure_requests: [
    'external_id',
    'user_id',
    'active_user_id',
    'status',
    'reason_code',
    'requested_at',
    'grace_ends_at',
    'processing_started_at',
    'completion_attempt_count',
    'completion_next_attempt_at',
    'completion_lease_owner',
    'completion_lease_until',
    'completion_last_error_code',
    'completed_at',
    'cancelled_at',
  ],
  account_closure_steps: [
    'request_id',
    'category_id',
    'handler_version',
    'status',
    'attempt_count',
    'next_attempt_at',
    'lease_owner',
    'lease_until',
    'checkpoint',
    'processed_count',
    'retention_outcome',
    'last_error_code',
    'started_at',
    'finished_at',
  ],
  account_closure_effects: [
    'request_id',
    'resource_type',
    'resource_id',
    'previous_state',
    'closure_applied_state',
    'restored_at',
  ],
  account_closure_challenges: [
    'external_id',
    'user_id',
    'request_id',
    'action',
    'channel',
    'code_hash',
    'attempt_count',
    'expires_at',
    'used_at',
  ],
  account_closure_receipts: [
    'request_id',
    'user_id',
    'receipt_number',
    'kind',
    'subject_digest',
    'completed_category_ids',
    'restricted_category_ids',
    'notification_status',
    'issued_at',
    'completed_at',
  ],
  video_edit_projects: [
    'external_id',
    'user_id',
    'source_kind',
    'provider',
    'status',
    'current_version_id',
  ],
  video_edit_versions: ['external_id', 'project_id', 'revision', 'document_json', 'render_status'],
  video_edit_action_quotes: [
    'external_id',
    'user_id',
    'project_id',
    'base_version_id',
    'operation_hash',
    'cost_units',
    'status',
    'expires_at',
  ],
  video_edit_render_attempts: [
    'external_id',
    'user_id',
    'project_id',
    'version_id',
    'output_file_id',
    'status',
    'expires_at',
  ],
  energy_daily_metrics: [
    'metric_date',
    'bucket_hash',
    'event_type',
    'experience_id',
    'mode_id',
    'energy_need',
    'duration_bucket',
    'outcome',
    'section_id',
    'target_type',
    'source_kind',
    'content_id',
    'range_key',
    'task_status',
    'batch_count',
    'event_count',
    'expires_at',
  ],
  energy_daily_visitors: ['activity_date', 'visitor_hash', 'expires_at'],
  energy_event_receipts: ['event_id', 'expires_at'],
  feedback_cases: [
    'external_id',
    'user_id',
    'closure_request_id',
    'message',
    'context',
    'user_agent',
    'hold_reason',
    'restricted_at',
    'created_at',
  ],
  users: [
    'external_id',
    'email',
    'password_hash',
    'plan',
    'role',
    'plan_expires_at',
    'status',
    'auth_version',
    'mfa_enabled',
    'mfa_secret_encrypted',
    'mfa_setup_created_at',
    'mfa_last_used_step',
    'mfa_failed_attempts',
    'mfa_locked_until',
    'display_name',
    'google_id',
    'avatar_url',
    'email_verified',
    'phone',
    'phone_verified',
    'selected_roles',
    'selected_skills',
    'role_changes_this_month',
    'role_changes_period_start',
  ],
  user_mfa_recovery_codes: ['user_id', 'code_hash', 'consumed_at', 'created_at'],
  tasks: [
    'external_id',
    'user_id',
    'session_id',
    'skill_id',
    'status',
    'pause_reason',
    'intent',
    'title',
    'role_id',
    'opus_used',
    'starred',
    'starred_at',
    'project_id',
    'plan',
    'plan_text',
    'plan_status',
    'awaiting_question',
    'awaiting_kind',
    'result',
    'source_context',
    'error_code',
    'error_message',
    'original_summary',
    'formatted_summary',
    'response_layer_metadata',
    'contract_json',
    'evidence_json',
    'verification_json',
    'verification_passed',
    'failure_level',
  ],
  task_steps: [
    'external_id',
    'task_id',
    'seq',
    'kind',
    'status',
    'input',
    'output',
    'error_message',
    'parent_step_id',
    'pending_confirm_payload',
    'retry_count',
    'heal_attempts',
    'heal_succeeded',
    'heal_elapsed_ms',
    'heal_input_tokens',
    'heal_output_tokens',
  ],
  scheduled_tasks: [
    'external_id',
    'user_id',
    'intent',
    'repeat_type',
    'cron_expression',
    'next_run_at',
    'timezone',
    'status',
    'last_run_at',
    'last_task_id',
    'last_run_status',
    'last_error',
    'rrule',
    'duration_minutes',
    'description',
    'reminder_minutes',
    'last_reminder_run',
  ],
  planned_tasks: [
    'external_id',
    'user_id',
    'title',
    'instruction',
    'scope',
    'repeat_type',
    'first_run_at',
    'ends_at',
    'next_run_at',
    'timezone',
    'status',
    'item_count',
    'last_run_status',
  ],
  planned_task_items: ['external_id', 'planned_task_id', 'seq', 'instruction', 'enabled'],
  planned_task_occurrence_overrides: [
    'external_id',
    'planned_task_id',
    'original_scheduled_for',
    'action',
    'scheduled_for',
  ],
  planned_task_runs: [
    'external_id',
    'planned_task_id',
    'title',
    'scheduled_for',
    'trigger',
    'status',
    'items_total',
    'result_json',
  ],
  planned_task_run_items: ['external_id', 'planned_task_run_id', 'seq', 'instruction', 'status'],
  task_files: ['external_id', 'user_id', 'task_id', 'kind', 'status', 'expires_at'],
  batch_tasks: [
    'external_id',
    'user_id',
    'status',
    'items_total',
    'items_done',
    'items_review',
    'items_failed',
  ],
  payments: ['provider', 'provider_order_id', 'provider_capture_id', 'kind', 'status'],
  pending_cookies: [
    'user_id',
    'cookies_json',
    'encrypted_blob',
    'encryption_iv',
    'encryption_tag',
    'encrypted_key',
    'cookie_count',
  ],
  webhook_idempotency: ['user_id', 'idempotency_key', 'request_hash', 'expires_at'],
  api_keys: ['external_id', 'user_id', 'name', 'key_prefix', 'key_hash', 'last_used_at'],
  ...STOCK_PREFERENCE_REQUIRED_COLUMNS,
  stock_risk_monitors: [
    'external_id',
    'user_id',
    'planned_task_id',
    'symbol',
    'name',
    'market',
    'risk_keys_json',
    'last_evaluated_data_as_of',
    'last_signals_json',
    'last_unavailable_checks_json',
    'last_notification_fingerprint',
  ],
  notifications: ['planned_task_id'],
};

type RequiredIndex = {
  table: string;
  name: string;
  unique: boolean;
  columns: readonly string[];
};

const TEAM_WORK_ITEM_REQUIRED_INDEXES: readonly RequiredIndex[] = [
  ...[
    'team_milestones',
    'team_work_items',
    'team_work_item_assignments',
    'acceptance_contract_versions',
    'team_work_item_submissions',
    'team_work_item_reviews',
    'team_task_review_delegations',
    'team_work_item_appeals',
    'team_arbitration_decisions',
    'team_work_item_events',
    'team_project_planning_events',
    'team_evidence_bindings',
    'team_ai_contributions',
  ].map((table) => ({
    table,
    name: `uk_${table}_external_id`,
    unique: true,
    columns: ['external_id'],
  })),
  {
    table: 'team_work_item_assignments',
    name: 'uk_team_work_item_assignments_responsible_active',
    unique: true,
    columns: ['responsible_active_key'],
  },
  {
    table: 'team_work_item_dependencies',
    name: 'uk_team_work_item_dependencies_edge',
    unique: true,
    columns: ['work_item_id', 'depends_on_work_item_id'],
  },
  {
    table: 'acceptance_contract_versions',
    name: 'uk_acceptance_contract_versions_work_item_version',
    unique: true,
    columns: ['work_item_id', 'version'],
  },
  {
    table: 'team_work_item_submissions',
    name: 'uk_team_work_item_submissions_work_item_version',
    unique: true,
    columns: ['work_item_id', 'submission_version'],
  },
  {
    table: 'team_work_item_reviews',
    name: 'uk_team_work_item_reviews_submission_attempt',
    unique: true,
    columns: ['submission_id', 'review_attempt'],
  },
  {
    table: 'team_task_review_delegations',
    name: 'uk_team_task_review_delegations_id_lineage',
    unique: true,
    columns: ['id', 'organization_id', 'project_id', 'delegate_user_id'],
  },
  {
    table: 'team_task_review_delegations',
    name: 'uk_team_task_review_delegations_grant',
    unique: true,
    columns: [
      'organization_id',
      'project_id',
      'delegator_user_id',
      'delegate_user_id',
      'valid_from',
    ],
  },
  {
    table: 'team_work_item_appeals',
    name: 'uk_team_work_item_appeals_submission',
    unique: true,
    columns: ['submission_id'],
  },
  {
    table: 'team_arbitration_decisions',
    name: 'uk_team_arbitration_decisions_appeal',
    unique: true,
    columns: ['appeal_id'],
  },
  {
    table: 'team_work_item_events',
    name: 'uk_team_work_item_events_organization_idempotency',
    unique: true,
    columns: ['organization_id', 'idempotency_key'],
  },
  {
    table: 'team_project_planning_events',
    name: 'uk_team_project_planning_events_organization_idempotency',
    unique: true,
    columns: ['organization_id', 'idempotency_key'],
  },
  {
    table: 'team_milestones',
    name: 'ix_team_milestones_tenant_status',
    unique: false,
    columns: ['organization_id', 'project_id', 'status'],
  },
  {
    table: 'team_work_items',
    name: 'ix_team_work_items_tenant_status',
    unique: false,
    columns: ['organization_id', 'project_id', 'status'],
  },
  {
    table: 'team_work_item_assignments',
    name: 'ix_team_work_item_assignments_tenant_status',
    unique: false,
    columns: ['organization_id', 'project_id', 'status'],
  },
  {
    table: 'team_work_item_dependencies',
    name: 'ix_team_work_item_dependencies_tenant',
    unique: false,
    columns: ['organization_id', 'project_id'],
  },
  {
    table: 'acceptance_contract_versions',
    name: 'ix_acceptance_contract_versions_tenant',
    unique: false,
    columns: ['organization_id', 'project_id', 'work_item_id'],
  },
  {
    table: 'team_work_item_submissions',
    name: 'ix_team_work_item_submissions_tenant',
    unique: false,
    columns: ['organization_id', 'project_id', 'work_item_id'],
  },
  {
    table: 'team_work_item_reviews',
    name: 'ix_team_work_item_reviews_tenant_decision',
    unique: false,
    columns: ['organization_id', 'project_id', 'decision'],
  },
  {
    table: 'team_task_review_delegations',
    name: 'ix_team_task_review_delegations_tenant_window',
    unique: false,
    columns: [
      'organization_id',
      'project_id',
      'delegator_user_id',
      'delegate_user_id',
      'valid_from',
      'valid_until',
    ],
  },
  {
    table: 'team_work_item_appeals',
    name: 'ix_team_work_item_appeals_tenant_status',
    unique: false,
    columns: ['organization_id', 'project_id', 'status'],
  },
  {
    table: 'team_arbitration_decisions',
    name: 'ix_team_arbitration_decisions_tenant',
    unique: false,
    columns: ['organization_id', 'project_id', 'decided_at'],
  },
  {
    table: 'team_work_item_events',
    name: 'ix_team_work_item_events_tenant_type',
    unique: false,
    columns: ['organization_id', 'project_id', 'event_type'],
  },
  {
    table: 'team_project_planning_events',
    name: 'ix_team_project_planning_events_tenant_type',
    unique: false,
    columns: ['organization_id', 'project_id', 'event_type'],
  },
  {
    table: 'team_evidence_bindings',
    name: 'ix_team_evidence_bindings_tenant',
    unique: false,
    columns: ['organization_id', 'project_id', 'work_item_id'],
  },
  {
    table: 'team_ai_contributions',
    name: 'ix_team_ai_contributions_tenant',
    unique: false,
    columns: ['organization_id', 'project_id', 'work_item_id'],
  },
];

function findMissingTeamWorkItemIndexes(
  rows: ReadonlyArray<{
    table_name: string;
    index_name: string;
    non_unique: number;
    seq_in_index: number;
    column_name: string;
    sub_part: number | null;
  }>,
): string[] {
  const byIndex = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.table_name}\0${row.index_name}`;
    byIndex.set(key, [...(byIndex.get(key) ?? []), row]);
  }

  const missing: string[] = [];
  for (const required of TEAM_WORK_ITEM_REQUIRED_INDEXES) {
    const actual = (byIndex.get(`${required.table}\0${required.name}`) ?? [])
      .slice()
      .sort((left, right) => Number(left.seq_in_index) - Number(right.seq_in_index));
    const columns = actual.map((row) => row.column_name);
    const unique = actual.length > 0 && actual.every((row) => Number(row.non_unique) === 0);
    const fullColumns = actual.every((row) => row.sub_part == null);
    if (
      columns.length !== required.columns.length ||
      columns.some((column, index) => column !== required.columns[index]) ||
      (required.unique && !unique) ||
      !fullColumns
    ) {
      missing.push(
        `${required.table}.${required.name}${required.unique ? ' UNIQUE' : ''}(${required.columns.join(', ')})`,
      );
    }
  }
  return missing;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  const conn = await mysql.createConnection({ uri: url });
  try {
    const [[dbRow]] = await conn.query<Array<{ db: string }>>('SELECT DATABASE() AS db');
    const database = dbRow?.db;
    if (!database) throw new Error('DATABASE_URL did not select a database');

    const [tableRows] = await conn.query<Array<{ table_name: string }>>(
      `SELECT table_name AS table_name
       FROM information_schema.tables
       WHERE table_schema = ?`,
      [database],
    );
    const tables = new Set(tableRows.map((r) => r.table_name));
    const missingTables = REQUIRED_TABLES.filter((t) => !tables.has(t));

    const [columnRows] = await conn.query<
      Array<{
        table_name: string;
        column_name: string;
        data_type: string;
        column_type: string;
        is_nullable: string;
        column_default: string | null;
        extra: string;
        generation_expression: string;
      }>
    >(
      `SELECT table_name AS table_name,
              column_name AS column_name,
              data_type AS data_type,
              column_type AS column_type,
              is_nullable AS is_nullable,
              column_default AS column_default,
              extra AS extra,
              generation_expression AS generation_expression
       FROM information_schema.columns
       WHERE table_schema = ?`,
      [database],
    );
    const columnsByTable = new Map<string, Set<string>>();
    for (const row of columnRows) {
      const set = columnsByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      columnsByTable.set(row.table_name, set);
    }

    const missingColumns: string[] = [];
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      if (!tables.has(table)) continue;
      const columns = columnsByTable.get(table) ?? new Set<string>();
      for (const column of required) {
        if (!columns.has(column)) missingColumns.push(`${table}.${column}`);
      }
    }

    const [indexRows] = await conn.query<
      Array<{
        table_name: string;
        index_name: string;
        non_unique: number;
        seq_in_index: number;
        column_name: string;
        sub_part: number | null;
      }>
    >(
      `SELECT table_name AS table_name,
              index_name AS index_name,
              non_unique AS non_unique,
              seq_in_index AS seq_in_index,
              column_name AS column_name,
              sub_part AS sub_part
       FROM information_schema.statistics
       WHERE table_schema = ?`,
      [database],
    );
    const missingIndexes = [
      ...findMissingRequiredIndexes(indexRows),
      ...findMissingTeamWorkItemIndexes(indexRows),
    ];

    const [foreignKeyRows] = await conn.query<
      Array<{
        table_name: string;
        constraint_name: string;
        delete_rule: string;
        ordinal_position: number;
        column_name: string;
        referenced_table_name: string;
        referenced_column_name: string;
      }>
    >(
      `SELECT kcu.table_name AS table_name,
              kcu.constraint_name AS constraint_name,
              rc.delete_rule AS delete_rule,
              kcu.ordinal_position AS ordinal_position,
              kcu.column_name AS column_name,
              kcu.referenced_table_name AS referenced_table_name,
              kcu.referenced_column_name AS referenced_column_name
       FROM information_schema.key_column_usage AS kcu
       INNER JOIN information_schema.referential_constraints AS rc
         ON rc.constraint_schema = kcu.constraint_schema
        AND rc.table_name = kcu.table_name
        AND rc.constraint_name = kcu.constraint_name
       WHERE kcu.table_schema = ?
         AND kcu.referenced_table_name IS NOT NULL`,
      [database],
    );
    const lifecycleViolations = findTeamWorkItemSchemaViolations({
      columns: columnRows,
      indexes: indexRows,
      foreignKeys: foreignKeyRows,
    });

    if (
      missingTables.length > 0 ||
      missingColumns.length > 0 ||
      missingIndexes.length > 0 ||
      lifecycleViolations.length > 0
    ) {
      console.error(`Database schema verification failed for ${database}.`);
      if (missingTables.length > 0) {
        console.error(`Missing tables: ${missingTables.join(', ')}`);
      }
      if (missingColumns.length > 0) {
        console.error(`Missing columns: ${missingColumns.join(', ')}`);
      }
      if (missingIndexes.length > 0) {
        console.error(`Missing indexes: ${missingIndexes.join(', ')}`);
      }
      if (lifecycleViolations.length > 0) {
        console.error(`Invalid lifecycle schema: ${lifecycleViolations.join('; ')}`);
      }
      console.error('Run the numbered migrations or drizzle push before starting orchestrator.');
      process.exitCode = 1;
      return;
    }

    console.log(`Database schema verified for ${database}.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
