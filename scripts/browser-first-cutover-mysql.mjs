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

/** Dedicated MySQL 8.0 metadata observation, NOT a stopped-writer receipt.
 * PROCESSLIST/INNODB_TRX require global PROCESS; EVENTS requires global EVENT
 * to cover other schemas whose events may write into the selected database.
 * Do not provision these privileges on an application account here. Existing
 * roles/partial revokes are deliberately not inferred. No SQL text, user names,
 * event bodies or channel credentials leave this reader. Idle sessions count.
 * A stable double observation is not a lock, cannot exclude transient work or
 * future reconnects, and must never alone become facts.unknownWriters = 0.
 */
export async function readCutoverMysqlWriters(db, expectedIdentity, { now = Date.now } = {}) {
  const reject = () => {
    throw new Error('CUTOVER_MYSQL_WRITERS_UNPROVEN');
  };
  try {
    identifier(expectedIdentity.database);
    if (!/^[a-f0-9-]{36}$/i.test(expectedIdentity.serverUuid)) reject();
    const started = now();
    let last = started;
    const time = () => {
      const current = now();
      if (
        !Number.isSafeInteger(started) ||
        started < 0 ||
        !Number.isSafeInteger(current) ||
        current < last ||
        current - started > 60000
      )
        reject();
      last = current;
      return current;
    };
    time();
    const query = async (sql) => {
      time();
      const [rows] = await db.query({ sql, timeout: 4000 });
      time();
      if (
        !Array.isArray(rows) ||
        rows.length > 10000 ||
        rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))
      )
        reject();
      return rows;
    };
    const coverage = async () => {
      const rows = await query(
        'SELECT @@server_uuid AS serverUuid, DATABASE() AS `database`, VERSION() AS version, @@performance_schema AS performanceSchema, @@global.partial_revokes AS partialRevokes',
      );
      const s = rows[0];
      if (
        rows.length !== 1 ||
        s.serverUuid !== expectedIdentity.serverUuid ||
        s.database !== expectedIdentity.database ||
        !/^8\.0\.\d+(?:[-.].*)?$/.test(s.version) ||
        Number(s.performanceSchema) !== 1 ||
        ![0, '0'].includes(s.partialRevokes)
      )
        reject();
      const grants = (await query('SHOW GRANTS FOR CURRENT_USER'))
        .map((row) => {
          const values = Object.values(row);
          if (values.length !== 1 || typeof values[0] !== 'string' || values[0].length > 32768)
            reject();
          return values[0];
        })
        .sort();
      const privileges = new Set();
      for (const grant of grants) {
        if (grant.startsWith('REVOKE ')) reject();
        // Anchor the privilege list before the first ON; an identifier or role
        // named PROCESS must not be mistaken for the actual static privilege.
        const match = /^GRANT ([A-Z_ ]+(?:, [A-Z_ ]+)*) ON \*\.\* TO /.exec(grant);
        if (match) for (const p of match[1].split(', ')) privileges.add(p);
      }
      if (
        !privileges.has('ALL PRIVILEGES') &&
        (!privileges.has('PROCESS') || !privileges.has('EVENT'))
      )
        reject();
      return digest({ server: s, grants });
    };
    const queries = {
      sessions:
        'SELECT ID AS id, COMMAND AS command FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() LIMIT 10001',
      transactions:
        'SELECT trx_id AS id, trx_mysql_thread_id AS sessionId FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id<>CONNECTION_ID() LIMIT 10001',
      enabledEvents:
        "SELECT EVENT_SCHEMA AS schemaName, EVENT_NAME AS name FROM information_schema.EVENTS WHERE STATUS='ENABLED' LIMIT 10001",
      replicationReceivers:
        "SELECT CHANNEL_NAME AS name, SERVICE_STATE AS state FROM performance_schema.replication_connection_status WHERE SERVICE_STATE<>'OFF' LIMIT 10001",
      replicationAppliers:
        "SELECT CHANNEL_NAME AS name, SERVICE_STATE AS state FROM performance_schema.replication_applier_status WHERE SERVICE_STATE<>'OFF' LIMIT 10001",
    };
    const observe = async () => {
      const sources = {};
      const shapes = {
        sessions: ['command', 'id'],
        transactions: ['id', 'sessionId'],
        enabledEvents: ['name', 'schemaName'],
        replicationReceivers: ['name', 'state'],
        replicationAppliers: ['name', 'state'],
      };
      for (const [name, sql] of Object.entries(queries)) {
        const rows = await query(sql);
        for (const row of rows) {
          if (!same(Object.keys(row).sort(), shapes[name])) reject();
          for (const [key, value] of Object.entries(row)) {
            if (key === 'id' || key === 'sessionId') {
              if (
                !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) &&
                !(typeof value === 'string' && /^[0-9]{1,30}$/.test(value))
              )
                reject();
            } else if (
              typeof value !== 'string' ||
              value.length > 256 ||
              (!value && !(key === 'name' && name.startsWith('replication')))
            )
              reject();
          }
        }
        // Digest identities as well as counts: replacement at the same count
        // cannot be reported as a stable observation. Do not return raw rows.
        const records = rows.map(encode).sort();
        if (new Set(records).size !== records.length) reject();
        sources[name] = { count: rows.length, digest: digest(records) };
      }
      return sources;
    };
    const beforeCoverage = await coverage();
    const first = await observe();
    const second = await observe();
    const afterCoverage = await coverage();
    if (beforeCoverage !== afterCoverage || !same(first, second)) reject();
    const observedAtMs = time();
    return {
      schemaVersion: 1,
      scope: 'mysql-server-observation-only',
      startedAtMs: started,
      observedAtMs,
      counts: Object.fromEntries(
        Object.entries(second).map(([name, value]) => [name, value.count]),
      ),
      sourceDigest: digest({ coverage: afterCoverage, sources: second, started, observedAtMs }),
    };
  } catch {
    reject();
  }
}

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
