const SKIPPABLE_ALREADY_APPLIED_CODES = new Set([
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_FK_DUP_NAME',
  'ER_CHECK_CONSTRAINT_DUP_NAME',
  'ER_MULTIPLE_PRI_KEY',
]);

const REPLAYABLE_MISSING_DROP = {
  file: '0044_payments_provider_order_unique.sql',
  statement: 'DROP INDEX `ix_payments_provider_order` ON `payments`',
};

export const REQUIRED_PRE_APP_ROLLOUT_MIGRATIONS = [
  '0051_account_closures.sql',
  '0052_feedback_cases.sql',
];

export const STOCK_PREFERENCE_REQUIRED_TABLES = [
  'stock_preference_profiles',
  'stock_preference_signals',
];

export const STOCK_PREFERENCE_REQUIRED_COLUMNS = {
  stock_preference_profiles: ['user_id', 'enabled', 'manual_preferences_json', 'cleared_at'],
  stock_preference_signals: [
    'user_id',
    'kind',
    'dedupe_hash',
    'payload_json',
    'data_as_of',
    'occurred_at',
  ],
};

export function findMissingRequiredPreAppRolloutMigrations(files) {
  return REQUIRED_PRE_APP_ROLLOUT_MIGRATIONS.filter((migration) => !files.includes(migration));
}

export function assertDatabaseReadyForAppRollout(appliedMigrations) {
  const missing = findMissingRequiredPreAppRolloutMigrations(appliedMigrations);
  if (missing.length > 0) {
    throw new Error(
      `Account closure migrations must run before application rollout: ${missing.join(', ')}`,
    );
  }
}

export function findNonAdditiveMigrationStatements(statements) {
  return statements.filter((statement) => {
    const normalized = statement.trim().replace(/\s+/g, ' ');
    return /^(?:DROP|TRUNCATE)\b|^DELETE\s+FROM\b/i.test(normalized);
  });
}

export function findDuplicateMigrationNumbers(files) {
  const counts = new Map();
  for (const file of files) {
    const match = /^(\d{4})_.+\.sql$/.exec(file);
    if (!match) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort();
}

export function isSkippableAlreadyAppliedError(error, context = {}) {
  if (!error || typeof error !== 'object') return false;
  if (error.code) {
    if (SKIPPABLE_ALREADY_APPLIED_CODES.has(error.code)) return true;
    return (
      error.code === 'ER_CANT_DROP_FIELD_OR_KEY' &&
      context.file === REPLAYABLE_MISSING_DROP.file &&
      context.statement?.trim() === REPLAYABLE_MISSING_DROP.statement
    );
  }
  const message = error.message ?? '';
  return /already exists|duplicate column|duplicate key name|duplicate foreign key/i.test(message);
}

export function splitMigrationStatements(sql) {
  return sql
    .split(/--> statement-breakpoint/g)
    .flatMap((chunk) =>
      chunk.split(
        /;\s*(?=(?:--[^\n]*\n\s*)*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|RENAME|TRUNCATE|$))/i,
      ),
    )
    .map((statement) => statement.trim().replace(/;$/, '').trim())
    .filter(Boolean);
}

export const REQUIRED_INDEXES = [
  {
    table: 'organizations',
    name: 'uk_organizations_external_id',
    unique: true,
    columns: ['external_id'],
  },
  {
    table: 'organizations',
    name: 'ix_organizations_owner',
    unique: false,
    columns: ['owner_user_id'],
  },
  {
    table: 'organizations',
    name: 'ix_organizations_status',
    unique: false,
    columns: ['status'],
  },
  {
    table: 'organization_members',
    name: 'uk_organization_members_external_id',
    unique: true,
    columns: ['external_id'],
  },
  {
    table: 'organization_members',
    name: 'uk_organization_members_organization_user',
    unique: true,
    columns: ['organization_id', 'user_id'],
  },
  {
    table: 'organization_members',
    name: 'ix_organization_members_organization_status',
    unique: false,
    columns: ['organization_id', 'status'],
  },
  {
    table: 'organization_members',
    name: 'ix_organization_members_user_status',
    unique: false,
    columns: ['user_id', 'status'],
  },
  {
    table: 'organization_members',
    name: 'ix_organization_members_manager_status',
    unique: false,
    columns: ['organization_id', 'manager_user_id', 'status'],
  },
  {
    table: 'organization_invitations',
    name: 'uk_organization_invitations_external_id',
    unique: true,
    columns: ['external_id'],
  },
  {
    table: 'organization_invitations',
    name: 'uk_organization_invitations_token_hash',
    unique: true,
    columns: ['token_hash'],
  },
  {
    table: 'organization_invitations',
    name: 'ix_organization_invitations_active',
    unique: false,
    columns: ['organization_id', 'accepted_at', 'revoked_at', 'expires_at'],
  },
  {
    table: 'projects',
    name: 'ix_projects_organization_id',
    unique: false,
    columns: ['organization_id'],
  },
  {
    table: 'project_members',
    name: 'uk_project_members_external_id',
    unique: true,
    columns: ['external_id'],
  },
  {
    table: 'project_members',
    name: 'uk_project_members_project_user',
    unique: true,
    columns: ['project_id', 'user_id'],
  },
  {
    table: 'project_members',
    name: 'ix_project_members_project_status',
    unique: false,
    columns: ['project_id', 'status'],
  },
  {
    table: 'project_members',
    name: 'ix_project_members_user_status',
    unique: false,
    columns: ['user_id', 'status'],
  },
  {
    table: 'feedback_cases',
    name: 'uk_feedback_cases_external_id',
    unique: true,
    columns: ['external_id'],
  },
  {
    table: 'feedback_cases',
    name: 'ix_feedback_cases_user_id_id',
    unique: false,
    columns: ['user_id', 'id'],
  },
  {
    table: 'feedback_cases',
    name: 'ix_feedback_cases_closure_request_id',
    unique: false,
    columns: ['closure_request_id'],
  },
  {
    table: 'account_closure_requests',
    name: 'uk_account_closure_requests_external_id',
    unique: true,
    columns: ['external_id'],
  },
  {
    table: 'account_closure_requests',
    name: 'uk_account_closure_requests_active_user',
    unique: true,
    columns: ['active_user_id'],
  },
  {
    table: 'account_closure_requests',
    name: 'ix_account_closure_requests_status_grace',
    unique: false,
    columns: ['status', 'grace_ends_at'],
  },
  {
    table: 'account_closure_requests',
    name: 'ix_account_closure_requests_completion_due',
    unique: false,
    columns: ['status', 'completion_next_attempt_at', 'completion_lease_until'],
  },
  {
    table: 'account_closure_steps',
    name: 'uk_account_closure_steps_request_category',
    unique: true,
    columns: ['request_id', 'category_id'],
  },
  {
    table: 'account_closure_steps',
    name: 'ix_account_closure_steps_status_next_attempt',
    unique: false,
    columns: ['status', 'next_attempt_at'],
  },
  {
    table: 'account_closure_steps',
    name: 'ix_account_closure_steps_lease_until',
    unique: false,
    columns: ['lease_until'],
  },
  {
    table: 'account_closure_effects',
    name: 'uk_account_closure_effects_request_resource',
    unique: true,
    columns: ['request_id', 'resource_type', 'resource_id'],
  },
  {
    table: 'account_closure_challenges',
    name: 'uk_account_closure_challenges_external_id',
    unique: true,
    columns: ['external_id'],
  },
  {
    table: 'account_closure_challenges',
    name: 'ix_account_closure_challenges_user_action_expiry',
    unique: false,
    columns: ['user_id', 'action', 'expires_at'],
  },
  {
    table: 'account_closure_receipts',
    name: 'uk_account_closure_receipts_number',
    unique: true,
    columns: ['receipt_number'],
  },
  {
    table: 'account_closure_receipts',
    name: 'uk_account_closure_receipts_request_kind',
    unique: true,
    columns: ['request_id', 'kind'],
  },
  {
    table: 'payments',
    name: 'uk_payments_provider_order',
    unique: true,
    columns: ['provider', 'provider_order_id'],
  },
  {
    table: 'energy_daily_metrics',
    name: 'uk_energy_daily_metrics_bucket',
    unique: true,
    columns: ['metric_date', 'bucket_hash'],
  },
  {
    table: 'energy_daily_metrics',
    name: 'ix_energy_daily_metrics_expires_at',
    unique: false,
    columns: ['expires_at'],
  },
  {
    table: 'energy_daily_metrics',
    name: 'ix_energy_daily_metrics_date_type',
    unique: false,
    columns: ['metric_date', 'event_type'],
  },
  {
    table: 'energy_daily_visitors',
    name: 'uk_energy_daily_visitors_day_hash',
    unique: true,
    columns: ['activity_date', 'visitor_hash'],
  },
  {
    table: 'energy_daily_visitors',
    name: 'ix_energy_daily_visitors_expires_at',
    unique: false,
    columns: ['expires_at'],
  },
  {
    table: 'energy_event_receipts',
    name: 'ix_energy_event_receipts_expires_at',
    unique: false,
    columns: ['expires_at'],
  },
];

export function findMissingRequiredIndexes(rows) {
  const byIndex = new Map();
  for (const row of rows) {
    const key = `${row.table_name}\0${row.index_name}`;
    const entries = byIndex.get(key) ?? [];
    entries.push(row);
    byIndex.set(key, entries);
  }

  const missing = [];
  for (const required of REQUIRED_INDEXES) {
    const rowsForIndex = byIndex.get(`${required.table}\0${required.name}`) ?? [];
    const ordered = rowsForIndex
      .slice()
      .sort((a, b) => Number(a.seq_in_index) - Number(b.seq_in_index));
    const columns = ordered.map((row) => row.column_name);
    const isUnique = ordered.length > 0 && ordered.every((row) => Number(row.non_unique) === 0);
    const usesFullColumns = ordered.every((row) => row.sub_part == null);
    const columnsMatch =
      columns.length === required.columns.length &&
      columns.every((column, index) => column === required.columns[index]);
    if ((required.unique && !isUnique) || !usesFullColumns || !columnsMatch) {
      missing.push(
        `${required.table}.${required.name}${required.unique ? ' UNIQUE' : ''}(${required.columns.join(', ')})`,
      );
    }
  }
  return missing;
}
