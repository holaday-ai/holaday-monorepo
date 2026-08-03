const SKIPPABLE_ALREADY_APPLIED_CODES = new Set([
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_FK_DUP_NAME',
  'ER_MULTIPLE_PRI_KEY',
]);

const REPLAYABLE_MISSING_DROP = {
  file: '0044_payments_provider_order_unique.sql',
  statement: 'DROP INDEX `ix_payments_provider_order` ON `payments`',
};

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
  return /already exists|duplicate column|duplicate key name|duplicate foreign key/i.test(
    message,
  );
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
    table: 'payments',
    name: 'uk_payments_provider_order',
    unique: true,
    columns: ['provider', 'provider_order_id'],
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
