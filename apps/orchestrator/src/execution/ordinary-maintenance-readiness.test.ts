import { expect, it, vi } from 'vitest';
import {
  checkMaintenanceRecords,
  checkMaintenanceSchema,
  checkMaintenanceServices,
} from './ordinary-maintenance-readiness.js';

const columns = [
  ['tasks', 'execution_id', 'varchar', 'varchar(64)', 'YES', null],
  ['tasks', 'execution_revision', 'bigint', 'bigint unsigned', 'NO', '0'],
  ['tasks', 'core_record_version', 'bigint', 'bigint unsigned', 'NO', '0'],
  ...['prompt_tokens', 'completion_tokens', 'cache_read_tokens', 'cache_write_tokens'].map(
    (name) => ['llm_calls', name, 'int', 'int', 'YES', null],
  ),
  ['llm_calls', 'cost_usd', 'decimal', 'decimal(12,6)', 'YES', null],
  ...['cost_status', 'usage_status', 'region', 'provider_request_id'].map((name) => [
    'llm_calls',
    name,
    'varchar',
    'varchar(24)',
    'NO',
    'legacy',
  ]),
].map(([table_name, column_name, data_type, column_type, is_nullable, column_default]) => ({
  table_name,
  column_name,
  data_type,
  column_type,
  is_nullable,
  column_default,
}));
it('requires execution identity columns and nullable unknown accounting, read-only', async () => {
  const query = vi.fn(async (_sql: string) => columns);
  await checkMaintenanceSchema(query);
  expect(query.mock.calls[0]?.[0]).toMatch(/^SELECT /);
  for (const rows of [
    [],
    columns.filter((c) => c.column_name !== 'execution_id'),
    columns.map((c) => (c.column_name === 'cost_usd' ? { ...c, column_default: '0' } : c)),
    columns.map((c) =>
      c.column_name === 'execution_revision' ? { ...c, column_type: 'bigint' } : c,
    ),
  ]) {
    await expect(checkMaintenanceSchema(async () => rows)).rejects.toThrow(
      'MAINTENANCE_SCHEMA_UNPROVEN',
    );
  }
});
function recordsQuery(
  overrides: {
    active?: number;
    record?: Record<string, unknown>;
    cost?: Record<string, unknown>;
  } = {},
) {
  return vi.fn(async (sql: string) => {
    if (!sql.startsWith('SELECT ')) throw new Error('write attempted');
    if (sql.includes('AS active')) return [{ active: overrides.active ?? 0 }];
    if (sql.includes('FROM tasks WHERE id >')) return overrides.record ? [overrides.record] : [];
    if (sql.includes('FROM llm_calls'))
      return [{ known: null, unknown: 1, ...(overrides.cost as object) }];
    throw new Error(`unexpected query: ${sql}`);
  });
}
it('rejects unowned in-flight work without modifying or silently recovering it', async () => {
  const query = recordsQuery({ active: 1 });
  await expect(checkMaintenanceRecords(query)).rejects.toThrow('MAINTENANCE_RECORDS_UNSETTLED');
  expect(query).toHaveBeenCalledTimes(1);
});
it('reads preserved paused legacy records and unknown costs without turning them into zero', async () => {
  const query = recordsQuery();
  query.mockImplementationOnce(async () => [{ active: 0 }] as never);
  query.mockImplementationOnce(
    async () =>
      [
        {
          id: 1,
          status: 'paused',
          executionId: null,
          executionRevision: 0,
          recordVersion: 0,
          result: null,
        },
      ] as never,
  );
  await checkMaintenanceRecords(query);
  const sql = query.mock.calls.map(([text]) => text).join('\n');
  expect(sql).toContain("'paused'");
  expect(sql).toContain("'awaiting_user'");
});
it('rejects malformed core ownership and uncertain cost evidence', async () => {
  const invalid = recordsQuery({
    record: { id: 1, executionId: 'x', executionRevision: 1, recordVersion: 1, result: {} },
  });
  await expect(checkMaintenanceRecords(invalid)).rejects.toThrow('MAINTENANCE_RECORD_FORMAT');
  await expect(checkMaintenanceRecords(recordsQuery({ cost: { unknown: null } }))).rejects.toThrow(
    'MAINTENANCE_ACCOUNTING_UNPROVEN',
  );
});
it('does not mistake payment configuration or an operator success flag for retry/boundary proof', async () => {
  vi.stubEnv('PAYPAL_PREFLIGHT_VERIFIED', '1');
  vi.stubEnv('CN_PAYMENT_PREFLIGHT_VERIFIED', '1');
  try {
    await expect(checkMaintenanceServices()).rejects.toThrow(
      'MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN',
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
