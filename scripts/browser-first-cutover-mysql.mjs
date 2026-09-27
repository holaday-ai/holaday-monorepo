import { createHash } from 'node:crypto';

const fail = () => {
  throw new Error('CUTOVER_MYSQL_SNAPSHOT_UNPROVEN');
};
const identifier = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(value)) fail();
  return `\`${value}\``;
};
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return value;
  if (Buffer.isBuffer(value)) return { binaryHex: value.toString('hex') };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && !(value instanceof Date) && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  fail();
}
const encode = (value) => JSON.stringify(canonical(value));
const digest = (value) => createHash('sha256').update(encode(value)).digest('hex');
const same = (left, right) => encode(left) === encode(right);
const order = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

// SHOW CREATE is SQL, not free text: never replace database-like text inside
// string literals. Only the quoted qualifier followed by a dot is rebound.
function normalizeDefinition(sql, database, sqlMode) {
  const noBackslash = sqlMode.split(',').includes('NO_BACKSLASH_ESCAPES');
  const ansiQuotes = sqlMode.split(',').includes('ANSI_QUOTES');
  const tokens = [];
  for (let index = 0; index < sql.length; ) {
    const quote = sql[index];
    if (!["'", '"', '`'].includes(quote)) {
      const start = index++;
      while (index < sql.length && !["'", '"', '`'].includes(sql[index])) index++;
      tokens.push(
        sql.slice(start, index).replace(/ CHARACTER SET utf8mb4(?= COLLATE utf8mb4_)/g, ''),
      );
      continue;
    }
    const start = index++;
    let closed = false;
    while (index < sql.length) {
      if (sql[index] === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        index++;
        closed = true;
        break;
      }
      if (sql[index] === '\\' && quote !== '`' && !noBackslash) index++;
      index++;
    }
    if (!closed) fail();
    const token = sql.slice(start, index);
    const qualified = /^\s*\./.test(sql.slice(index));
    tokens.push(
      (quote === '`' || (quote === '"' && ansiQuotes)) &&
        token.slice(1, -1) === database &&
        qualified
        ? `${quote}CUTOVER_SCHEMA${quote}`
        : token,
    );
  }
  return tokens.join('');
}

/** Dedicated mysql2 connection: dateStrings, bigNumberStrings,
 * supportBigNumbers and jsonStrings must be enabled; decimalNumbers disabled.
 * Call only after the coordinator has proved all source writers stopped.
 * No data/definition text is returned or written to logs.
 */
export async function readCutoverMysqlSnapshot(db, expectedIdentity, { projection } = {}) {
  let transaction = false;
  try {
    identifier(expectedIdentity.database);
    if (!/^[a-f0-9-]{36}$/i.test(expectedIdentity.serverUuid)) fail();
    const rows = async (sql, values) => {
      const [result] = await db.query(sql, values);
      if (!Array.isArray(result)) fail();
      return result;
    };
    const assertIdentity = async () => {
      const actual = await rows('SELECT @@server_uuid AS serverUuid, DATABASE() AS `database`');
      if (actual.length !== 1 || !same(actual[0], expectedIdentity)) fail();
    };
    await assertIdentity();
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    transaction = true;
    const metadata = async () => {
      const schema = await rows(
        'SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()',
      );
      if (schema.length !== 1 || !schema[0].charset || !schema[0].collation) fail();
      const objects = await rows(
        'SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
      );
      objects.push(
        ...(
          await rows(
            'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()',
          )
        ).map((r) => ({ ...r, kind: 'TRIGGER' })),
      );
      objects.push(
        ...(
          await rows(
            'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()',
          )
        ).map((r) => ({ ...r, kind: 'EVENT' })),
      );
      objects.push(
        ...(await rows(
          'SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS kind FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()',
        )),
      );
      objects.sort((a, b) => order(`${a.kind}:${a.name}`, `${b.kind}:${b.name}`));
      if (
        objects.length === 0 ||
        objects.length > 10000 ||
        new Set(objects.map((r) => `${r.kind}:${r.name}`)).size !== objects.length
      )
        fail();
      const definitions = [];
      for (const object of objects) {
        const { kind, name, engine } = object;
        if (!['BASE TABLE', 'VIEW', 'TRIGGER', 'EVENT', 'PROCEDURE', 'FUNCTION'].includes(kind))
          fail();
        if (kind === 'BASE TABLE' && engine !== 'InnoDB') fail();
        const ddlRows = await rows(
          `SHOW CREATE ${kind === 'BASE TABLE' ? 'TABLE' : kind} ${identifier(name)}`,
        );
        if (ddlRows.length !== 1) fail();
        const ddl = {};
        for (const [key, value] of Object.entries(ddlRows[0])) {
          if (kind === 'TRIGGER' && key === 'Created') continue;
          if (value === null) fail(); // SHOW CREATE without routine visibility is not a complete inventory.
          ddl[key] =
            typeof value === 'string'
              ? normalizeDefinition(
                  value,
                  expectedIdentity.database,
                  String(ddlRows[0].sql_mode ?? ''),
                )
              : value;
        }
        const columns =
          kind === 'BASE TABLE' || kind === 'VIEW'
            ? await rows(
                'SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_DEFAULT,IS_NULLABLE,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
                [name],
              )
            : [];
        if ((kind === 'BASE TABLE' || kind === 'VIEW') && columns.length === 0) fail();
        for (const column of columns) identifier(column.COLUMN_NAME);
        definitions.push({
          ...object,
          definitionDigest: digest(ddl),
          columnsDigest: digest(columns),
          columns: columns.map((c) => c.COLUMN_NAME),
        });
      }
      return { schema, definitions };
    };
    const before = await metadata();
    const tables = before.definitions.filter((o) => o.kind === 'BASE TABLE');
    const selected = projection ?? tables.map((o) => ({ table: o.name, columns: o.columns }));
    if (
      !Array.isArray(selected) ||
      selected.length === 0 ||
      new Set(selected.map((p) => p.table)).size !== selected.length
    )
      fail();
    for (const item of selected) {
      const table = tables.find((t) => t.name === item.table);
      if (
        !table ||
        !Array.isArray(item.columns) ||
        item.columns.length === 0 ||
        new Set(item.columns).size !== item.columns.length ||
        item.columns.some((c) => !table.columns.includes(c))
      )
        fail();
    }
    const business = [];
    const objects = [];
    for (const object of before.definitions) {
      const { columns, ...result } = object;
      if (object.kind === 'BASE TABLE') {
        const [count] = await rows(`SELECT COUNT(*) AS rowCount FROM ${identifier(object.name)}`);
        const rowCount = Number(count?.rowCount);
        // Refuse oversized snapshots rather than silently sample/truncate.
        if (!Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount > 1000000) fail();
        const values = await rows(
          `SELECT ${columns.map(identifier).join(',')} FROM ${identifier(object.name)}`,
        );
        if (values.length !== rowCount) fail();
        for (const row of values)
          if (
            !same(Object.keys(row).sort(), [...columns].sort()) ||
            Object.values(row).some((v) => v && typeof v === 'object' && !Buffer.isBuffer(v))
          )
            fail();
        result.rowCount = rowCount;
        result.dataDigest = digest(values.map((r) => encode(columns.map((c) => r[c]))).sort());
        const projected = selected.find((p) => p.table === object.name);
        if (projected)
          business.push({
            table: object.name,
            columns: projected.columns,
            rowCount,
            dataDigest: digest(
              values.map((r) => encode(projected.columns.map((c) => r[c]))).sort(),
            ),
          });
      }
      objects.push(result);
    }
    if (!same(before, await metadata())) fail();
    await assertIdentity();
    const schemaDigest = digest(before);
    const businessDigest = digest(business);
    await db.query('ROLLBACK');
    transaction = false;
    return {
      identity: { ...expectedIdentity },
      objects,
      projection: selected.map((p) => ({ table: p.table, columns: [...p.columns] })),
      schemaDigest,
      sourceDigest: digest({ schemaDigest, objects }),
      businessDigest,
    };
  } catch {
    if (transaction) {
      try {
        await db.query('ROLLBACK');
      } catch {
        /* caller must discard this dedicated connection */
      }
    }
    fail();
  }
}

export function compareCutoverMysqlSnapshots(source, restored) {
  if (
    !source ||
    !restored ||
    same(source.identity, restored.identity) ||
    !/^[a-f0-9]{64}$/.test(source.sourceDigest) ||
    source.sourceDigest !== restored.sourceDigest ||
    source.businessDigest !== restored.businessDigest ||
    !same(source.objects, restored.objects) ||
    source.schemaDigest !== restored.schemaDigest ||
    !same(source.projection, restored.projection)
  ) {
    throw new Error('CUTOVER_MYSQL_COMPARISON_UNPROVEN');
  }
  return {
    sourceDigest: source.sourceDigest,
    businessDigest: source.businessDigest,
    comparisonDigest: digest({ source, restored }),
  };
}
