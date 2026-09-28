// Synthetic SQL semantics fixture. No production configuration, credentials,
// callbacks, migrations or source records. Only its new random database is writable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readCutoverWorkScope } from '../browser-cutover-evidence.mjs';
import { readFirstCutoverPaymentScope } from '../browser-first-cutover-host.mjs';

const container = process.argv[2];
assert.equal(process.argv.length, 3);
assert.match(container ?? '', /^holaday-first-cutover-qa-[a-f0-9]{16}$/);
const inspection = JSON.parse(
  execFileSync('docker', ['inspect', container], { encoding: 'utf8' }),
)[0];
assert.equal(inspection.Config.Labels?.['holaday.qa'], 'first-cutover-mysql');
assert.deepEqual(inspection.HostConfig.PortBindings?.['3306/tcp'], [
  { HostIp: '127.0.0.1', HostPort: '13316' },
]);
assert.notEqual(inspection.HostConfig.PidMode, 'host');
assert.equal(inspection.Mounts.length, 1);
assert.equal(inspection.Mounts[0].Type, 'volume');
assert.equal(inspection.Mounts[0].Destination, '/var/lib/mysql');
const mysql = createRequire(new URL('../../apps/orchestrator/package.json', import.meta.url))(
  'mysql2/promise',
);
const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 13316,
  user: 'root',
  supportBigNumbers: true,
  bigNumberStrings: true,
});
const database = `holaday_work_scope_${randomBytes(8).toString('hex')}`;
const identity = (await connection.query('SELECT @@server_uuid AS identity'))[0][0].identity;
let created = false;
const cases = [
  ['tasks', 'status', 'completed', 'executing'],
  ['scheduled_tasks', 'status', 'active', 'running'],
  ['planned_task_runs', 'status', 'completed', 'dispatching'],
  ['batch_tasks', 'status', 'completed', 'running'],
  ['exploration_runs', 'status', 'completed', 'running'],
  ['video_edit_render_attempts', 'status', 'completed', 'pending'],
  ['video_edit_versions', 'render_status', 'idle', 'rendering'],
  ['account_closure_requests', 'status', 'pending_grace', 'processing'],
  ['account_closure_steps', 'status', 'pending', 'running'],
  ['planned_task_run_items', 'status', 'completed', 'running'],
  ['batch_task_items', 'status', 'completed', 'running'],
  ['planned_tasks', 'status', 'active', 'running'],
];
try {
  await connection.query(`CREATE DATABASE \`${database}\``);
  created = true;
  await connection.query(`USE \`${database}\``);
  for (const [table, column, dormant] of cases) {
    const lease =
      table === 'account_closure_requests'
        ? ', completion_lease_owner VARCHAR(64), completion_lease_until DATETIME(3)'
        : table === 'account_closure_steps'
          ? ', lease_owner VARCHAR(64), lease_until DATETIME(3)'
          : '';
    // Only the real columns read by the collector are needed for this SQL test;
    // this is not the full migrated application schema or a restore rehearsal.
    await connection.query(
      `CREATE TABLE ${table} (id BIGINT UNSIGNED PRIMARY KEY, ${column} VARCHAR(32) NULL${lease}) ENGINE=InnoDB`,
    );
    await connection.query(`INSERT INTO ${table} (id, ${column}) VALUES (1, ?)`, [dormant]);
  }
  assert.deepEqual((await readCutoverWorkScope(connection)).unsettled, []);
  for (const [table, column, dormant, active] of cases) {
    await connection.query(`UPDATE ${table} SET ${column} = ? WHERE id = 1`, [active]);
    const before = JSON.stringify((await connection.query(`SELECT * FROM ${table}`))[0]);
    assert.deepEqual((await readCutoverWorkScope(connection)).unsettled, [
      { table, id: 1, status: active },
    ]);
    assert.equal(JSON.stringify((await connection.query(`SELECT * FROM ${table}`))[0]), before);
    await connection.query(`UPDATE ${table} SET ${column} = ? WHERE id = 1`, [dormant]);
  }
  for (const [table, prefix] of [
    ['account_closure_requests', 'completion_lease'],
    ['account_closure_steps', 'lease'],
  ]) {
    // Expiry is not proof that a worker's last external effect completed.
    await connection.query(
      `UPDATE ${table} SET ${prefix}_owner = 'synthetic-worker', ${prefix}_until = '2000-01-01' WHERE id = 1`,
    );
    assert.equal((await readCutoverWorkScope(connection)).unsettled[0].table, table);
    await connection.query(
      `UPDATE ${table} SET ${prefix}_owner = NULL, ${prefix}_until = NULL WHERE id = 1`,
    );
  }
  for (const table of [
    'exploration_runs',
    'video_edit_render_attempts',
    'planned_task_runs',
    'batch_tasks',
    'planned_task_run_items',
    'batch_task_items',
  ]) {
    await connection.query(`UPDATE ${table} SET status = 'unrecognized' WHERE id = 1`);
    assert.equal((await readCutoverWorkScope(connection)).unsettled[0].table, table);
    await connection.query(`UPDATE ${table} SET status = 'completed' WHERE id = 1`);
  }
  await connection.query('UPDATE exploration_runs SET status = NULL WHERE id = 1');
  await assert.rejects(readCutoverWorkScope(connection), /MAINTENANCE_WORK_SCOPE_UNPROVEN/);
  await connection.query("UPDATE exploration_runs SET status = 'completed' WHERE id = 1");
  for (let id = 2; id <= 101; id++)
    await connection.query("INSERT INTO tasks (id,status) VALUES (?, 'executing')", [id]);
  await assert.rejects(readCutoverWorkScope(connection), /MAINTENANCE_WORK_SCOPE_UNPROVEN/);
  await connection.query('DELETE FROM tasks WHERE id > 1');
  // Real SQL/connection boundary, synthetic approved scope and credentials. This
  // is not a provider query, historical merchant proof or production recovery.
  for (const table of ['payments', 'partner_recharge_orders']) {
    await connection.query(`CREATE TABLE ${table} (
      id BIGINT UNSIGNED PRIMARY KEY, external_id VARCHAR(64), provider VARCHAR(16),
      provider_order_id VARCHAR(64), provider_capture_id VARCHAR(64), amount_cents INT,
      amount_cny_cents INT, currency VARCHAR(3), status VARCHAR(32), metadata JSON,
      created_at DATETIME(3), updated_at DATETIME(3)
    ) ENGINE=InnoDB`);
  }
  await connection.query(`INSERT INTO payments VALUES
    (1,'SYNTHETIC','wechat','QA_ORDER',NULL,1234,1234,'CNY','pending',
    '{"env":"production"}','2026-01-01 00:00:00.123','2026-01-01 00:00:00.456'),
    (2,'SYNTHETIC_2','wechat','QA_ORDER_2','QA_CAPTURE',1234,1234,'CNY','completed',
    '{"env":"production"}','2026-01-01 00:00:00.123','2026-01-01 00:00:00.456'),
    (3,'SYNTHETIC_3','wechat','QA_ORDER_3','QA_CAPTURE_3',1234,1234,'CNY','completed',
    '{"env":"production"}','2026-01-01 00:00:00.123','2026-01-01 00:00:00.123')`);
  const uri = `mysql://root@127.0.0.1:13316/${database}`;
  const config = Buffer.from(`DATABASE_URL=${uri}`);
  const inventory = {
    paymentWindowStartMs: Date.parse('2026-01-01T00:00:00.200Z'),
    merchants: [{ provider: 'wechat', environment: 'production', merchantDigest: '9'.repeat(64) }],
  };
  const binding = {
    attempt: '11111111-1111-4111-8111-111111111111',
    candidate: 'a'.repeat(40),
    migrationDigest: 'b'.repeat(64),
    configDigest: createHash('sha256').update(config).digest('hex'),
    inventoryDigest: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
  };
  const context = {
    binding,
    approval: { ...binding, maintenanceEndsAtMs: Date.now() + 60000 },
    root: `/opt/holaday-releases/${binding.candidate}`,
    journal: { assertOwnership: async () => binding },
  };
  const before = JSON.stringify((await connection.query('SELECT * FROM payments'))[0]);
  const io = {
    platform: 'linux',
    uid: 0,
    readConfig: async () => config,
    parseConfig: () => ({ DATABASE_URL: uri }),
    connectWorkDatabase: (approvedUri) => {
      assert.equal(approvedUri, uri);
      return mysql.createConnection({
        uri,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        jsonStrings: true,
        timezone: 'Z',
      });
    },
  };
  const observed = await readFirstCutoverPaymentScope(context, inventory, io);
  assert.equal(observed.orders.length, 2);
  assert.deepEqual(
    observed.orders.map((row) => Number(row.id)),
    [1, 2],
  );
  assert.deepEqual(observed.unsettled, []);
  assert.equal(observed.orders[0].created_at, '2026-01-01 00:00:00.123');
  assert.equal(observed.orders[0].updated_at, '2026-01-01 00:00:00.456');
  assert.equal(typeof observed.orders[0].metadata, 'string');
  assert.equal(JSON.stringify((await connection.query('SELECT * FROM payments'))[0]), before);
  await connection.query('UPDATE payments SET metadata = \'{"env":"sandbox"}\' WHERE id = 1');
  await assert.rejects(
    readFirstCutoverPaymentScope(context, inventory, io),
    /CUTOVER_PAYMENT_OBSERVATION_UNPROVEN/,
  );
  console.log(
    'PASS real MySQL payment readiness: dedicated read-only connection, original scope, exact datetime/JSON and contradictory merchant refusal; synthetic metadata, no provider call',
  );
  await connection.query('DROP TABLE video_edit_render_attempts');
  await assert.rejects(readCutoverWorkScope(connection), /MAINTENANCE_WORK_SCOPE_UNPROVEN/);
  console.log(
    'PASS real MySQL: 12 work tables, dispatching, unchanged reads, expired leases, unknown/NULL states, truncation and missing-table refusal',
  );
} finally {
  try {
    assert.equal(
      (await connection.query('SELECT @@server_uuid AS identity'))[0][0].identity,
      identity,
    );
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
  } finally {
    await connection.end();
  }
}
