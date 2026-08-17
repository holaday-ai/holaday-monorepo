import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findDuplicateMigrationNumbers,
  findMissingRequiredIndexes,
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
          row.index_name === 'uk_energy_daily_visitors_day_hash'
            ? { ...row, non_unique: 1 }
            : row,
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
            !(row.index_name === 'uk_payments_provider_order' && row.column_name === 'provider_order_id'),
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
