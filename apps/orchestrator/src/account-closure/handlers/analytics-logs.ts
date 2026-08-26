import { sql } from 'drizzle-orm';
import {
  type ClosureHandlerContext,
  ClosureHandlerError,
  createVerifiedRestrictedRetentionHandler,
} from '../handler-contract.js';
import { ACCOUNT_CLOSURE_TABLE_OWNER_BY_NAME } from '../table-ownership.js';

interface AnalyticsColumnDefinition {
  readonly columnType: string;
  readonly nullable: 'YES' | 'NO';
  readonly defaultValue: string | null;
  readonly columnKey: '' | 'MUL' | 'PRI';
  readonly extra: string;
}

type AnalyticsSchemaManifest = Readonly<
  Record<string, Readonly<Record<string, AnalyticsColumnDefinition>>>
>;

const required = (
  columnType: string,
  input: Partial<Omit<AnalyticsColumnDefinition, 'columnType' | 'nullable'>> = {},
): AnalyticsColumnDefinition => ({
  columnType,
  nullable: 'NO',
  defaultValue: null,
  columnKey: '',
  extra: '',
  ...input,
});

/**
 * The analytics category owns only the three anonymous tables introduced by
 * migration 0046. The global table ownership registry, rather than a naming
 * heuristic, closes the boundary around every other persistence table.
 */
export const ACCOUNT_CLOSURE_ANALYTICS_SCHEMA_MANIFEST: AnalyticsSchemaManifest = {
  energy_daily_metrics: {
    id: required('bigint unsigned', { columnKey: 'PRI', extra: 'auto_increment' }),
    metric_date: required('date', { columnKey: 'MUL' }),
    bucket_hash: required('char(64)'),
    event_type: required('varchar(64)'),
    experience_id: required('varchar(32)', { defaultValue: '' }),
    mode_id: required('varchar(64)', { defaultValue: '' }),
    energy_need: required('varchar(16)', { defaultValue: '' }),
    duration_bucket: required('varchar(32)', { defaultValue: '' }),
    outcome: required('varchar(16)', { defaultValue: '' }),
    section_id: required('varchar(32)', { defaultValue: '' }),
    target_type: required('varchar(32)', { defaultValue: '' }),
    source_kind: required('varchar(32)', { defaultValue: '' }),
    content_id: required('varchar(64)', { defaultValue: '' }),
    range_key: required('varchar(16)', { defaultValue: '' }),
    task_status: required('varchar(16)', { defaultValue: '' }),
    batch_count: required('int unsigned', { defaultValue: '0' }),
    event_count: required('bigint unsigned', { defaultValue: '1' }),
    expires_at: required('datetime(3)', { columnKey: 'MUL' }),
    created_at: required('datetime(3)', {
      defaultValue: 'CURRENT_TIMESTAMP(3)',
      extra: 'DEFAULT_GENERATED',
    }),
    updated_at: required('datetime(3)', {
      defaultValue: 'CURRENT_TIMESTAMP(3)',
      extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)',
    }),
  },
  energy_daily_visitors: {
    id: required('bigint unsigned', { columnKey: 'PRI', extra: 'auto_increment' }),
    activity_date: required('date', { columnKey: 'MUL' }),
    visitor_hash: required('char(64)'),
    expires_at: required('datetime(3)', { columnKey: 'MUL' }),
    created_at: required('datetime(3)', {
      defaultValue: 'CURRENT_TIMESTAMP(3)',
      extra: 'DEFAULT_GENERATED',
    }),
  },
  energy_event_receipts: {
    event_id: required('char(36)', { columnKey: 'PRI' }),
    expires_at: required('datetime(3)', { columnKey: 'MUL' }),
    created_at: required('datetime(3)', {
      defaultValue: 'CURRENT_TIMESTAMP(3)',
      extra: 'DEFAULT_GENERATED',
    }),
  },
};

interface InformationSchemaColumnRow {
  tableName: string;
  columnName: string;
  columnType: string;
  nullable: string;
  defaultValue: string | number | bigint | null;
  columnKey: string;
  extra: string;
}

/**
 * Anonymous aggregates remain restricted only after the external log
 * prerequisite and an exact schema-manifest match. No user/visitor link is
 * derived during this probe.
 */
export const analyticsLogsClosureHandler = createVerifiedRestrictedRetentionHandler(
  'analytics_logs',
  () => process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED === 'true',
  countAnalyticsSchemaMismatches,
);

async function countAnalyticsSchemaMismatches(context: ClosureHandlerContext): Promise<number> {
  const result = await context.db.execute(sql`
    SELECT
      governed_column.table_name AS tableName,
      governed_column.column_name AS columnName,
      governed_column.column_type AS columnType,
      governed_column.is_nullable AS nullable,
      governed_column.column_default AS defaultValue,
      governed_column.column_key AS columnKey,
      governed_column.extra AS extra
    FROM information_schema.columns AS governed_column
    INNER JOIN information_schema.tables AS governed_table
      ON governed_table.table_schema = governed_column.table_schema
      AND governed_table.table_name = governed_column.table_name
      AND governed_table.table_type = 'BASE TABLE'
    WHERE governed_column.table_schema = DATABASE()
      AND governed_column.table_name <> '__drizzle_migrations'
    ORDER BY governed_column.table_name, governed_column.ordinal_position
  `);
  context.signal.throwIfAborted();
  const rows = readColumnRows(result);
  const actual = new Map<string, InformationSchemaColumnRow>(
    rows.map((row) => [`${row.tableName}.${row.columnName}`, row] as const),
  );
  const actualTables = new Set(rows.map((row) => row.tableName));
  const expected = new Map<string, AnalyticsColumnDefinition>();
  for (const [tableName, columns] of Object.entries(ACCOUNT_CLOSURE_ANALYTICS_SCHEMA_MANIFEST)) {
    for (const [columnName, definition] of Object.entries(columns)) {
      expected.set(`${tableName}.${columnName}`, definition);
    }
  }

  let mismatches = 0;
  for (const tableName of actualTables) {
    if (!ACCOUNT_CLOSURE_TABLE_OWNER_BY_NAME.has(tableName)) mismatches += 1;
  }
  for (const [key, definition] of expected) {
    const row = actual.get(key);
    if (!row || !matchesDefinition(row, definition)) mismatches += 1;
  }
  for (const [key, row] of actual) {
    if (
      ACCOUNT_CLOSURE_TABLE_OWNER_BY_NAME.get(row.tableName) === 'analytics_logs' &&
      !expected.has(key)
    ) {
      mismatches += 1;
    }
  }
  return mismatches;
}

function readColumnRows(result: unknown): InformationSchemaColumnRow[] {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return rows.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new ClosureHandlerError('INVARIANT_VIOLATION');
    const row = raw as Record<string, unknown>;
    for (const key of ['tableName', 'columnName', 'columnType', 'nullable', 'columnKey', 'extra']) {
      if (typeof row[key] !== 'string') throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    const defaultValue = row.defaultValue;
    if (
      defaultValue !== null &&
      typeof defaultValue !== 'string' &&
      typeof defaultValue !== 'number' &&
      typeof defaultValue !== 'bigint'
    ) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    return {
      tableName: row.tableName as string,
      columnName: row.columnName as string,
      columnType: row.columnType as string,
      nullable: row.nullable as string,
      defaultValue,
      columnKey: row.columnKey as string,
      extra: row.extra as string,
    };
  });
}

function matchesDefinition(
  row: InformationSchemaColumnRow,
  expected: AnalyticsColumnDefinition,
): boolean {
  return (
    row.columnType.toLowerCase() === expected.columnType.toLowerCase() &&
    row.nullable === expected.nullable &&
    normalizeDefault(row.defaultValue) === expected.defaultValue &&
    row.columnKey === expected.columnKey &&
    row.extra === expected.extra
  );
}

function normalizeDefault(value: string | number | bigint | null): string | null {
  return value === null ? null : String(value);
}
