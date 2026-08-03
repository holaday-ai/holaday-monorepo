import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findMissingRequiredIndexes,
  isSkippableAlreadyAppliedError,
  splitMigrationStatements,
} from './release-db-contract.mjs';

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
  ];

  it('accepts the required unique payment provider-order index', () => {
    assert.deepEqual(findMissingRequiredIndexes(validRows), []);
  });

  it('rejects a non-unique payment provider-order index', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(validRows.map((row) => ({ ...row, non_unique: 1 }))),
      ['payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)'],
    );
  });

  it('rejects an incomplete payment provider-order index', () => {
    assert.deepEqual(findMissingRequiredIndexes(validRows.slice(0, 1)), [
      'payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)',
    ]);
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
