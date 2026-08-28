import type { DataCategoryId } from '../data-governance/types.js';

export interface AccountClosureTableOwnership {
  readonly tableName: string;
  readonly categoryId: DataCategoryId;
}

const own = (
  categoryId: DataCategoryId,
  ...tableNames: readonly string[]
): AccountClosureTableOwnership[] => tableNames.map((tableName) => ({ tableName, categoryId }));

/**
 * Closed-world ownership for every persistent table exported by Drizzle.
 *
 * A table must be reviewed here before it can reach a closure-enabled runtime.
 * Object-backed task files and evidence are assigned to `media_assets`; the
 * task handler may consume its explicitly disjoint non-media partition through
 * the reviewed shared object-first primitive.
 */
export const ACCOUNT_CLOSURE_TABLE_OWNERSHIP: readonly AccountClosureTableOwnership[] = [
  ...own(
    'account_security',
    'account_closure_challenges',
    'account_closure_effects',
    'account_closure_receipts',
    'account_closure_requests',
    'account_closure_steps',
    'api_keys',
    'sessions',
    'user_mfa_recovery_codes',
    'user_profiles',
    'users',
    'verification_codes',
    'webhook_idempotency',
  ),
  ...own(
    'task_execution',
    'batch_task_items',
    'batch_tasks',
    'canary_results',
    'claim_evidence_links',
    'claims',
    'exploration_runs',
    'llm_calls',
    'operation_path_steps',
    'operation_paths',
    'planned_task_items',
    'planned_task_occurrence_overrides',
    'planned_task_run_items',
    'planned_task_runs',
    'planned_tasks',
    'projects',
    'scheduled_tasks',
    'site_capabilities',
    'sites',
    'skills',
    'task_action_captures',
    'task_events',
    'task_steps',
    'tasks',
    'video_edit_action_quotes',
    'video_edit_projects',
    'video_edit_render_attempts',
    'video_edit_versions',
  ),
  ...own('cross_task_memory', 'execution_memory', 'execution_stats'),
  ...own(
    'stock_preference_profile',
    'stock_dashboard_snapshots',
    'stock_preference_profiles',
    'stock_preference_signals',
    'stock_risk_monitors',
    'watchlists',
  ),
  ...own('feedback_support', 'feedback_cases'),
  ...own('external_notifications', 'notification_channels', 'notifications'),
  ...own('extension_site_stats', 'user_site_stats'),
  ...own('extension_login_cookies', 'pending_cookies'),
  ...own('payments_entitlements', 'payments', 'task_quotas'),
  ...own(
    'partner_kyc_ledger',
    'api_cost_pool_events',
    'hola_credit_ledger_entries',
    'partner_activity_events',
    'partner_daily_allocations',
    'partner_kyc_profiles',
    'partner_lots',
    'partner_memberships',
    'partner_monthly_releases',
    'partner_recharge_orders',
    'partner_referrals',
    'partner_risk_events',
    'partner_withdrawal_requests',
  ),
  ...own('media_assets', 'evidence_artifacts', 'task_files'),
  ...own(
    'analytics_logs',
    'energy_daily_metrics',
    'energy_daily_visitors',
    'energy_event_receipts',
  ),
];

export const ACCOUNT_CLOSURE_TABLE_OWNER_BY_NAME: ReadonlyMap<string, DataCategoryId> = new Map(
  ACCOUNT_CLOSURE_TABLE_OWNERSHIP.map(({ tableName, categoryId }) => [tableName, categoryId]),
);
