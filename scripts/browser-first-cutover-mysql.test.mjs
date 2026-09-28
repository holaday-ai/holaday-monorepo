import assert from 'node:assert/strict';
import test from 'node:test';

const api = await import('./browser-first-cutover-mysql.mjs').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const identity = { serverUuid: '11111111-1111-4111-8111-111111111111', database: 'source_db' };

function writerFixture() {
  const state = {
    calls: [],
    reads: 0,
    grants: ['GRANT PROCESS, EVENT ON *.* TO `observer`@`localhost`'],
    server: { ...identity, version: '8.0.46', performanceSchema: 1, partialRevokes: 0 },
    sources: {
      PROCESSLIST: [{ id: 7, command: 'Sleep' }],
      INNODB_TRX: [],
      EVENTS: [],
      replication_connection_status: [],
      replication_applier_status: [],
    },
  };
  const db = {
    query: async (input) => {
      const sql = input.sql;
      assert.equal(input.timeout, 4000);
      state.calls.push(sql);
      if (state.fail?.(sql)) throw new Error('password=must-not-escape');
      if (sql.includes('@@server_uuid')) return [[{ ...state.server }]];
      if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [state.grants.map((grant) => ({ grant }))];
      const key = Object.keys(state.sources).find((key) => sql.includes(`.${key} `));
      if (!key) throw new Error('unexpected query');
      if (key === 'PROCESSLIST') state.reads++;
      return [structuredClone(state.sources[key])];
    },
  };
  return { state, db };
}
async function readWriters(f, options = {}) {
  assert.equal(typeof api.readCutoverMysqlWriters, 'function');
  return api.readCutoverMysqlWriters(f.db, identity, { now: () => 1000, ...options });
}

test('writer observation checks full metadata visibility before reading any sessions', async () => {
  const f = writerFixture();
  const result = await readWriters(f);
  assert.deepEqual(result.counts, {
    sessions: 1,
    transactions: 0,
    enabledEvents: 0,
    replicationReceivers: 0,
    replicationAppliers: 0,
  });
  assert.equal(result.scope, 'mysql-server-observation-only');
  assert.equal(result.observedAtMs, 1000);
  assert.match(result.sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(f.state.reads, 2);
  assert.ok(!JSON.stringify(result).includes('observer'));
  assert.ok(f.state.calls.every((sql) => /^(SELECT|SHOW) /.test(sql)));
  assert.ok(
    f.state.calls
      .filter((sql) => sql.includes('.EVENTS '))
      .every((sql) => !sql.includes('EVENT_SCHEMA=DATABASE()')),
  );
  assert.ok(
    f.state.calls
      .filter((sql) => sql.includes('.PROCESSLIST '))
      .every((sql) => sql.includes('ID<>CONNECTION_ID()') && !sql.includes('INFO')),
  );
});

for (const grants of [
  ['GRANT USAGE ON *.* TO `observer`@`localhost`'],
  [
    'GRANT PROCESS ON *.* TO `observer`@`localhost`',
    'GRANT EVENT ON `source_db`.* TO `observer`@`localhost`',
  ],
  ['GRANT `PROCESS`@`localhost` TO `observer`@`localhost`'],
  ['GRANT SELECT ON `PROCESS ON *.* TO observer`.* TO `observer`@`localhost`'],
])
  test('partial or role-only grants cannot prove writer observation coverage', async () => {
    const f = writerFixture();
    f.state.grants = grants;
    await assert.rejects(readWriters(f), /CUTOVER_MYSQL_WRITERS_UNPROVEN/);
    assert.equal(f.state.reads, 0);
  });

for (const fault of [
  'performance-off',
  'partial-revokes',
  'foreign-server',
  'foreign-database',
  'wrong-version',
  'query-denied',
  'clock-backwards',
  'stale',
  'session-drift',
  'grant-drift',
  'overflow',
  'null-row',
  'null-field',
  'missing-field',
  'extra-field',
]) {
  test(`writer observations refuse ${fault} without a zero fallback`, async () => {
    const f = writerFixture();
    let calls = 0;
    if (fault === 'performance-off') f.state.server.performanceSchema = 0;
    if (fault === 'partial-revokes') f.state.server.partialRevokes = 1;
    if (fault === 'foreign-server')
      f.state.server.serverUuid = '22222222-2222-4222-8222-222222222222';
    if (fault === 'foreign-database') f.state.server.database = 'other';
    if (fault === 'wrong-version') f.state.server.version = '10.11.0-MariaDB';
    if (fault === 'query-denied') f.state.fail = (sql) => sql.includes('.INNODB_TRX ');
    if (fault === 'overflow')
      f.state.sources.PROCESSLIST = Array.from({ length: 10001 }, (_, id) => ({
        id,
        command: 'Sleep',
      }));
    if (fault === 'null-row') f.state.sources.PROCESSLIST = [null];
    if (fault === 'null-field') f.state.sources.PROCESSLIST[0].id = null;
    if (fault === 'missing-field') f.state.sources.PROCESSLIST = [{ id: 7 }];
    if (fault === 'extra-field') f.state.sources.PROCESSLIST[0].INFO = 'private SQL';
    const query = f.db.query;
    f.db.query = async (input) => {
      if (f.state.reads === 1 && fault === 'session-drift') f.state.sources.PROCESSLIST[0].id = 8;
      if (f.state.reads === 1 && fault === 'grant-drift')
        f.state.grants = ['GRANT PROCESS ON *.* TO `observer`@`localhost`'];
      return query(input);
    };
    await assert.rejects(
      readWriters(f, {
        now: () =>
          ++calls === 1
            ? 1000
            : fault === 'clock-backwards'
              ? 999
              : fault === 'stale'
                ? 61001
                : 1000,
      }),
      { message: 'CUTOVER_MYSQL_WRITERS_UNPROVEN' },
    );
  });
}
function fixture(database = 'source_db') {
  const state = {
    database,
    serverUuid: identity.serverUuid,
    calls: [],
    tables: [
      { name: 'payments', kind: 'BASE TABLE', engine: 'InnoDB' },
      { name: 'payment_view', kind: 'VIEW', engine: null },
    ],
    columns: ['id', 'amount', 'note'],
    data: [
      { id: '9007199254740993', amount: '9.900000', note: 'source_db is literal business text' },
    ],
    routines: [
      { name: 'probe', kind: 'PROCEDURE' },
      { name: 'value_fn', kind: 'FUNCTION' },
    ],
    triggers: [{ name: 'payment_trigger' }],
    events: [{ name: 'payment_event' }],
    failQuery: null,
    definitionOverride: null,
    listReads: 0,
    driftList: false,
  };
  const db = {
    query: async (sql, values) => {
      state.calls.push(sql);
      if (state.failQuery?.(sql)) throw new Error('secret=must-not-escape');
      if (
        sql.startsWith('SET TRANSACTION') ||
        sql.startsWith('START TRANSACTION') ||
        sql === 'ROLLBACK'
      )
        return [[], []];
      if (sql.includes('@@server_uuid'))
        return [[{ serverUuid: state.serverUuid, database: state.database }]];
      if (sql.includes('information_schema.SCHEMATA'))
        return [[{ charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }]];
      if (sql.includes('information_schema.TABLES')) {
        state.listReads++;
        return [
          [
            ...state.tables,
            ...(state.driftList && state.listReads > 1
              ? [{ name: 'late_table', kind: 'BASE TABLE', engine: 'InnoDB' }]
              : []),
          ],
        ];
      }
      if (sql.includes('information_schema.COLUMNS'))
        return [
          state.columns.map((name, index) => ({
            COLUMN_NAME: name,
            ORDINAL_POSITION: index + 1,
            COLUMN_TYPE: 'varchar(255)',
            CHARACTER_SET_NAME: 'utf8mb4',
            COLLATION_NAME: 'utf8mb4_0900_ai_ci',
          })),
        ];
      if (sql.includes('information_schema.TRIGGERS')) return [state.triggers];
      if (sql.includes('information_schema.EVENTS')) return [state.events];
      if (sql.includes('information_schema.ROUTINES')) return [state.routines];
      if (sql.startsWith('SHOW CREATE')) {
        const [kind, name] = /^SHOW CREATE (TABLE|VIEW|TRIGGER|EVENT|PROCEDURE|FUNCTION) `([^`]+)`$/
          .exec(sql)
          .slice(1);
        const ddl =
          state.definitionOverride ??
          (kind === 'TABLE'
            ? 'CREATE TABLE `payments` (`id` bigint, `amount` decimal(12,6), `note` text)'
            : `CREATE ${kind} \`${name}\` SELECT \`amount\` FROM \`${state.database}\`.\`payments\` WHERE note = 'source_db is literal business text'`);
        return [
          [
            {
              name,
              definition: ddl,
              sql_mode: '',
              ...(kind === 'TRIGGER'
                ? { Created: database === 'source_db' ? '2020-01-01' : '2026-09-27' }
                : {}),
            },
          ],
        ];
      }
      if (sql.startsWith('SELECT COUNT(*)')) return [[{ rowCount: state.data.length }]];
      if (sql.startsWith('SELECT ') && sql.includes('FROM `payments`')) {
        const selected = [...sql.slice(0, sql.indexOf(' FROM')).matchAll(/`([^`]+)`/g)].map(
          (m) => m[1],
        );
        return [state.data.map((r) => Object.fromEntries(selected.map((name) => [name, r[name]])))];
      }
      throw new Error(`unexpected query: ${sql}, ${values}`);
    },
  };
  return { state, db };
}
const read = async (f, options = {}) => {
  assert.equal(typeof api.readCutoverMysqlSnapshot, 'function');
  return api.readCutoverMysqlSnapshot(f.db, { ...identity, database: f.state.database }, options);
};

test('real snapshot reader covers tables, views, triggers, events and both routine kinds in read-only transaction', async () => {
  const f = fixture();
  const snapshot = await read(f);
  assert.deepEqual(
    snapshot.objects.map((o) => [o.kind, o.name]),
    [
      ['BASE TABLE', 'payments'],
      ['EVENT', 'payment_event'],
      ['FUNCTION', 'value_fn'],
      ['PROCEDURE', 'probe'],
      ['TRIGGER', 'payment_trigger'],
      ['VIEW', 'payment_view'],
    ],
  );
  assert.deepEqual(snapshot.projection, [{ table: 'payments', columns: ['id', 'amount', 'note'] }]);
  assert.equal(snapshot.objects[0].rowCount, 1);
  assert.match(snapshot.sourceDigest, /^[a-f0-9]{64}$/);
  assert.ok(f.state.calls.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
  assert.equal(f.state.calls.at(-1), 'ROLLBACK');
  assert.ok(
    !JSON.stringify(snapshot).includes('literal business text'),
    'return digests, not business values',
  );
  assert.ok(
    !f.state.calls.some((s) => /FROM `payment_view`/.test(s)),
    'views are definitions, not a second mutable row source',
  );
});

test('restored comparison allows only qualified schema renaming and trigger creation metadata', async () => {
  const source = await read(fixture());
  const restored = await read(fixture('restored_db'));
  assert.equal(typeof api.compareCutoverMysqlSnapshots, 'function');
  const result = api.compareCutoverMysqlSnapshots(source, restored);
  assert.equal(result.sourceDigest, source.sourceDigest);
  assert.equal(result.businessDigest, source.businessDigest);
  assert.match(result.comparisonDigest, /^[a-f0-9]{64}$/);
});

for (const [name, change] of [
  [
    'missing function',
    (f) => {
      f.state.routines.pop();
    },
  ],
  [
    'missing event',
    (f) => {
      f.state.events = [];
    },
  ],
  [
    'missing trigger',
    (f) => {
      f.state.triggers = [];
    },
  ],
  [
    'missing view',
    (f) => {
      f.state.tables.pop();
    },
  ],
  [
    'changed historical amount',
    (f) => {
      f.state.data[0].amount = '9.900001';
    },
  ],
  [
    'lost large integer precision',
    (f) => {
      f.state.data[0].id = '9007199254740992';
    },
  ],
  [
    'rewritten schema-like literal',
    (f) => {
      f.state.data[0].note = 'restored_db is literal business text';
    },
  ],
  [
    'missing duplicate row',
    (f) => {
      f.state.data.push({ ...f.state.data[0] });
    },
  ],
]) {
  test(`restore comparison refuses ${name}`, async () => {
    const source = await read(fixture());
    const f = fixture('restored_db');
    change(f);
    const restored = await read(f);
    assert.throws(
      () => api.compareCutoverMysqlSnapshots(source, restored),
      /CUTOVER_MYSQL_COMPARISON_UNPROVEN/,
    );
  });
}

test('migration comparison projects every original column and does not mistake new columns for data loss', async () => {
  const source = await read(fixture());
  const f = fixture('restored_db');
  f.state.columns.push('new_column');
  f.state.data[0].new_column = null;
  const migrated = await read(f, { projection: source.projection });
  assert.equal(migrated.businessDigest, source.businessDigest);
  f.state.data[0].amount = '0.000000';
  assert.notEqual(
    (await read(f, { projection: source.projection })).businessDigest,
    source.businessDigest,
  );
});

test('migration projection refuses a disappeared original column', async () => {
  const source = await read(fixture());
  const f = fixture('restored_db');
  f.state.columns.pop();
  await assert.rejects(
    read(f, { projection: source.projection }),
    /CUTOVER_MYSQL_SNAPSHOT_UNPROVEN/,
  );
});

for (const [name, change] of [
  [
    'unsafe numeric precision',
    (f) => {
      f.state.data[0].id = 9007199254740992;
    },
  ],
  [
    'driver date conversion',
    (f) => {
      f.state.data[0].note = new Date();
    },
  ],
  [
    'nontransactional table',
    (f) => {
      f.state.tables[0].engine = 'MyISAM';
    },
  ],
  [
    'invalid SQL identifier',
    (f) => {
      f.state.tables[0].name = 'payments`; DELETE';
    },
  ],
  [
    'metadata changes during read',
    (f) => {
      f.state.driftList = true;
    },
  ],
  [
    'read failure',
    (f) => {
      f.state.failQuery = (s) => s.startsWith('SELECT COUNT');
    },
  ],
]) {
  test(`snapshot refuses ${name} and rolls back without committing`, async () => {
    const f = fixture();
    change(f);
    await assert.rejects(read(f), { message: 'CUTOVER_MYSQL_SNAPSHOT_UNPROVEN' });
    assert.equal(f.state.calls.at(-1), 'ROLLBACK');
    assert.ok(!f.state.calls.some((s) => /^(INSERT|UPDATE|DELETE|DROP|COMMIT|CREATE)/.test(s)));
  });
}

test('wrong database identity refuses before scanning business rows', async () => {
  assert.equal(typeof api.readCutoverMysqlSnapshot, 'function');
  const f = fixture();
  await assert.rejects(
    api.readCutoverMysqlSnapshot(f.db, { ...identity, database: 'other_db' }),
    /CUTOVER_MYSQL_SNAPSHOT_UNPROVEN/,
  );
  assert.ok(!f.state.calls.some((s) => s.includes('FROM `payments`')));
});

test('snapshot ignores row order but retains duplicate multiplicity and binary bytes', async () => {
  const f = fixture();
  f.state.data = [
    { id: '1', amount: '0.100000', note: Buffer.from([0, 255]) },
    { id: '2', amount: '0.200000', note: null },
  ];
  const before = await read(f);
  f.state.data.reverse();
  assert.equal((await read(f)).businessDigest, before.businessDigest);
  f.state.data[1].note = Buffer.from([0, 254]);
  assert.notEqual((await read(f)).businessDigest, before.businessDigest);
});

test('DDL business literals are never normalized as schema or charset syntax', async () => {
  const source = fixture();
  const restored = fixture('restored_db');
  source.state.definitionOverride =
    "SELECT 'source_db', ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'";
  restored.state.definitionOverride = "SELECT 'restored_db', ' COLLATE utf8mb4_bin'";
  const sourceSnapshot = await read(source);
  const restoredSnapshot = await read(restored);
  assert.throws(
    () => api.compareCutoverMysqlSnapshots(sourceSnapshot, restoredSnapshot),
    /CUTOVER_MYSQL_COMPARISON_UNPROVEN/,
  );
});
