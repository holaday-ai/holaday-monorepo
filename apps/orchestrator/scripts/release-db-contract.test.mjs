import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  assertDatabaseReadyForAppRollout,
  findDuplicateMigrationNumbers,
  findMissingRequiredIndexes,
  findMissingRequiredPreAppRolloutMigrations,
  findNonAdditiveMigrationStatements,
  isSkippableAlreadyAppliedError,
  splitMigrationStatements,
} from './release-db-contract.mjs';

describe('numbered migration filename contract', () => {
  it('rejects two migrations with the same numeric prefix', () => {
    assert.deepEqual(
      findDuplicateMigrationNumbers([
        '0045_planned_tasks.sql',
        '0046_energy_analytics.sql',
        '0046_tasks_source_context.sql',
      ]),
      ['0046'],
    );
  });

  it('keeps the shipped migration directory free of duplicate numeric prefixes', () => {
    const files = readdirSync(new URL('../drizzle/', import.meta.url));
    assert.deepEqual(findDuplicateMigrationNumbers(files), []);
  });

  it('ships closure migrations as discoverable additive migrations', () => {
    const files = readdirSync(new URL('../drizzle/', import.meta.url));
    const statements = ['0051_account_closures.sql', '0052_feedback_cases.sql'].flatMap(
      (migration) =>
        splitMigrationStatements(
          readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'),
        ),
    );

    assert.deepEqual(findMissingRequiredPreAppRolloutMigrations(files), []);
    assert.deepEqual(findNonAdditiveMigrationStatements(statements), []);
  });

  it('requires migrations 0051 and 0052 before application rollout', () => {
    assert.throws(
      () => assertDatabaseReadyForAppRollout(['0050_user_mfa.sql']),
      /0051_account_closures\.sql, 0052_feedback_cases\.sql/,
    );
    assert.throws(
      () => assertDatabaseReadyForAppRollout(['0050_user_mfa.sql', '0051_account_closures.sql']),
      /0052_feedback_cases\.sql/,
    );
    assert.doesNotThrow(() =>
      assertDatabaseReadyForAppRollout([
        '0050_user_mfa.sql',
        '0051_account_closures.sql',
        '0052_feedback_cases.sql',
      ]),
    );
  });

  it('keeps active and restricted feedback case states mutually exclusive', () => {
    const migration = readFileSync(
      new URL('../drizzle/0052_feedback_cases.sql', import.meta.url),
      'utf8',
    );
    assert.match(migration, /ck_feedback_cases_active_or_restricted/);
    assert.match(
      migration,
      /closure_request_id` IS NULL[\s\S]*user_id` IS NOT NULL[\s\S]*message` IS NOT NULL/,
    );
    assert.match(
      migration,
      /closure_request_id` IS NOT NULL[\s\S]*user_id` IS NULL[\s\S]*hold_reason` IS NOT NULL[\s\S]*message` IS NULL[\s\S]*context` IS NULL[\s\S]*user_agent` IS NULL/,
    );
  });

  it('includes the governed feedback table in the production schema verifier', () => {
    const verifier = readFileSync(new URL('./verify-db-schema.ts', import.meta.url), 'utf8');
    assert.match(verifier, /REQUIRED_TABLES[\s\S]*'feedback_cases'/);
    assert.match(
      verifier,
      /feedback_cases:\s*\[[\s\S]*'external_id'[\s\S]*'user_id'[\s\S]*'closure_request_id'[\s\S]*'message'[\s\S]*'context'[\s\S]*'user_agent'[\s\S]*'hold_reason'[\s\S]*'restricted_at'[\s\S]*'created_at'/,
    );
  });
});

describe('numbered migration replay safety', () => {
  it('treats an already-dropped index as an applied migration step', () => {
    assert.equal(
      isSkippableAlreadyAppliedError(
        { code: 'ER_CANT_DROP_FIELD_OR_KEY' },
        {
          file: '0044_payments_provider_order_unique.sql',
          statement: 'DROP INDEX `ix_payments_provider_order` ON `payments`',
        },
      ),
      true,
    );
  });

  it('does not suppress a missing-drop error in another migration', () => {
    assert.equal(
      isSkippableAlreadyAppliedError(
        { code: 'ER_CANT_DROP_FIELD_OR_KEY' },
        {
          file: '0004_task_events_simple_pk.sql',
          statement: 'ALTER TABLE task_events DROP PRIMARY KEY',
        },
      ),
      false,
    );
  });

  it('does not suppress unrelated migration failures', () => {
    assert.equal(
      isSkippableAlreadyAppliedError({
        code: 'ER_PARSE_ERROR',
        message: 'syntax error near already exists',
      }),
      false,
    );
  });

  it('splits a create-index statement followed by a drop-index statement', () => {
    assert.deepEqual(
      splitMigrationStatements(`
        CREATE UNIQUE INDEX \`uk_payments_provider_order\`
          ON \`payments\` (\`provider\`, \`provider_order_id\`);
        DROP INDEX \`ix_payments_provider_order\` ON \`payments\`;
      `),
      [
        'CREATE UNIQUE INDEX `uk_payments_provider_order`\n          ON `payments` (`provider`, `provider_order_id`)',
        'DROP INDEX `ix_payments_provider_order` ON `payments`',
      ],
    );
  });
});

describe('release database index contract', () => {
  const validRows = [
    {
      table_name: 'feedback_cases',
      index_name: 'uk_feedback_cases_external_id',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'external_id',
      sub_part: null,
    },
    {
      table_name: 'feedback_cases',
      index_name: 'ix_feedback_cases_user_id_id',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'user_id',
      sub_part: null,
    },
    {
      table_name: 'feedback_cases',
      index_name: 'ix_feedback_cases_user_id_id',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'id',
      sub_part: null,
    },
    {
      table_name: 'feedback_cases',
      index_name: 'ix_feedback_cases_closure_request_id',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'closure_request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'uk_account_closure_requests_external_id',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'external_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'uk_account_closure_requests_active_user',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'active_user_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_status_grace',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'status',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_completion_due',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'status',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_completion_due',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'completion_next_attempt_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_completion_due',
      non_unique: 1,
      seq_in_index: 3,
      column_name: 'completion_lease_until',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_status_grace',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'grace_ends_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'uk_account_closure_steps_request_category',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'uk_account_closure_steps_request_category',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'category_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'ix_account_closure_steps_status_next_attempt',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'status',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'ix_account_closure_steps_status_next_attempt',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'next_attempt_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'ix_account_closure_steps_lease_until',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'lease_until',
      sub_part: null,
    },
    {
      table_name: 'account_closure_effects',
      index_name: 'uk_account_closure_effects_request_resource',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_effects',
      index_name: 'uk_account_closure_effects_request_resource',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'resource_type',
      sub_part: null,
    },
    {
      table_name: 'account_closure_effects',
      index_name: 'uk_account_closure_effects_request_resource',
      non_unique: 0,
      seq_in_index: 3,
      column_name: 'resource_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'uk_account_closure_challenges_external_id',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'external_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'ix_account_closure_challenges_user_action_expiry',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'user_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'ix_account_closure_challenges_user_action_expiry',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'action',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'ix_account_closure_challenges_user_action_expiry',
      non_unique: 1,
      seq_in_index: 3,
      column_name: 'expires_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_receipts',
      index_name: 'uk_account_closure_receipts_number',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'receipt_number',
      sub_part: null,
    },
    {
      table_name: 'account_closure_receipts',
      index_name: 'uk_account_closure_receipts_request_kind',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_receipts',
      index_name: 'uk_account_closure_receipts_request_kind',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'kind',
      sub_part: null,
    },
    {
      table_name: 'payments',
      index_name: 'uk_payments_provider_order',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'provider',
      sub_part: null,
    },
    {
      table_name: 'payments',
      index_name: 'uk_payments_provider_order',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'provider_order_id',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'uk_energy_daily_metrics_bucket',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'metric_date',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'uk_energy_daily_metrics_bucket',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'bucket_hash',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'ix_energy_daily_metrics_expires_at',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'expires_at',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'ix_energy_daily_metrics_date_type',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'metric_date',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'ix_energy_daily_metrics_date_type',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'event_type',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_visitors',
      index_name: 'uk_energy_daily_visitors_day_hash',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'activity_date',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_visitors',
      index_name: 'uk_energy_daily_visitors_day_hash',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'visitor_hash',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_visitors',
      index_name: 'ix_energy_daily_visitors_expires_at',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'expires_at',
      sub_part: null,
    },
    {
      table_name: 'energy_event_receipts',
      index_name: 'ix_energy_event_receipts_expires_at',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'expires_at',
      sub_part: null,
    },
  ];

  it('accepts the required unique payment provider-order index', () => {
    assert.deepEqual(findMissingRequiredIndexes(validRows), []);
  });

  it('rejects an incomplete energy metric bucket key', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.filter(
          (row) =>
            !(
              row.index_name === 'uk_energy_daily_metrics_bucket' &&
              row.column_name === 'bucket_hash'
            ),
        ),
      ),
      ['energy_daily_metrics.uk_energy_daily_metrics_bucket UNIQUE(metric_date, bucket_hash)'],
    );
  });

  it('rejects a non-unique daily visitor identity key', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.map((row) =>
          row.index_name === 'uk_energy_daily_visitors_day_hash' ? { ...row, non_unique: 1 } : row,
        ),
      ),
      [
        'energy_daily_visitors.uk_energy_daily_visitors_day_hash UNIQUE(activity_date, visitor_hash)',
      ],
    );
  });

  it('rejects a non-unique payment provider-order index', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.map((row) =>
          row.index_name === 'uk_payments_provider_order' ? { ...row, non_unique: 1 } : row,
        ),
      ),
      ['payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)'],
    );
  });

  it('rejects an incomplete payment provider-order index', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.filter(
          (row) =>
            !(
              row.index_name === 'uk_payments_provider_order' &&
              row.column_name === 'provider_order_id'
            ),
        ),
      ),
      ['payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)'],
    );
  });

  it('rejects prefix columns and accepts numeric metadata strings in any row order', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.map((row) => ({ ...row, sub_part: row.column_name === 'provider' ? 4 : null })),
      ),
      ['payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)'],
    );
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows
          .map((row) => ({
            ...row,
            non_unique: String(row.non_unique),
            seq_in_index: String(row.seq_in_index),
          }))
          .reverse(),
      ),
      [],
    );
  });
});
