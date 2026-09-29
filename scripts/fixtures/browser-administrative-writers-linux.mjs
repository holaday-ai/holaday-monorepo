// Disposable, network-isolated Linux/MySQL fixture only. No production files.
// The driver must mount the QA socket at /var/run/mysqld and dependencies /deps.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  readFirstCutoverAdministrativeWriters,
  readFirstCutoverDatabaseWriters,
} from '../browser-first-cutover-host.mjs';
import { acquireReleaseJournal } from '../browser-maintenance-journal.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0);
assert.equal(process.env.CUTOVER_QA_ADMIN_WRITERS, 'synthetic-only');
const mysql = createRequire('/deps/.pnpm/mysql2@3.11.5/node_modules/mysql2/promise.js')(
  'mysql2/promise',
);
const socketPath = '/var/run/mysqld/mysqld.sock';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const connections = [];
const connect = async (user, database) => {
  const connection = await mysql.createConnection({
    socketPath,
    user,
    database,
    connectTimeout: 5000,
  });
  connections.push(connection);
  return connection;
};
let journal;
try {
  const root = await connect('root');
  await root.query('CREATE DATABASE source_qa');
  await root.query('CREATE DATABASE other_qa');
  await root.query('CREATE TABLE source_qa.probe (id INT PRIMARY KEY, value INT) ENGINE=InnoDB');
  await root.query('INSERT INTO source_qa.probe VALUES (1, 0)');
  await root.query("CREATE USER 'limited'@'localhost'");
  await root.query('GRANT SELECT ON source_qa.* TO limited@localhost');
  await root.query("CREATE USER 'observer'@'localhost' IDENTIFIED BY 'synthetic-private'");
  await root.query('GRANT PROCESS, EVENT, REPLICATION CLIENT ON *.* TO observer@localhost');
  await root.query('GRANT SELECT ON performance_schema.* TO observer@localhost');
  await root.query('GRANT SELECT ON source_qa.* TO observer@localhost');
  await root.query(
    'CREATE EVENT other_qa.qa_event ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 DAY DO SELECT 1',
  );
  const limited = await connect('limited', 'source_qa');
  const grants = JSON.stringify((await limited.query('SHOW GRANTS FOR CURRENT_USER'))[0]);
  const [[server]] = await root.query('SELECT @@server_uuid AS serverUuid');
  const sourceIdentity = { ...server, database: 'source_qa' };
  const config = Buffer.from(
    '[client]\nhost = localhost\nuser = observer\npassword = synthetic-private\nsocket = /var/run/mysqld/mysqld.sock\n',
  );
  await fs.mkdir('/etc/mysql', { recursive: true });
  await fs.writeFile('/etc/mysql/debian.cnf', config, { flag: 'wx', mode: 0o600 });
  const appConfig = Buffer.from('DATABASE_URL=mysql://limited@127.0.0.1/source_qa');
  const inventory = { databaseObserver: { configDigest: hash(config), sourceIdentity } };
  const binding = {
    attempt: randomUUID(),
    candidate: 'a'.repeat(40),
    configDigest: hash(appConfig),
    migrationDigest: hash('[]'),
    inventoryDigest: hash(JSON.stringify(inventory)),
  };
  const approval = {
    ...binding,
    kind: 'first-cutover',
    legacyDigest: 'e'.repeat(64),
    maintenanceEndsAtMs: Date.now() + 60000,
  };
  const candidateRoot = `/opt/holaday-releases/${binding.candidate}`;
  await fs.mkdir(`${candidateRoot}/apps/orchestrator`, { recursive: true });
  await fs.symlink(
    '/deps/.pnpm/mysql2@3.11.5/node_modules',
    `${candidateRoot}/apps/orchestrator/node_modules`,
  );
  const journalRoot = await fs.mkdtemp('/tmp/admin-writer-journal-');
  journal = await acquireReleaseJournal(journalRoot, approval);
  await journal.bindManifest([]);
  const context = { binding, approval, root: candidateRoot, journal };
  const io = {
    readConfig: async () => appConfig,
    parseConfig: () => ({ DATABASE_URL: 'mysql://limited@127.0.0.1/source_qa' }),
  };
  // Existing app-only reader remains restricted; no fallback/promotion.
  await assert.rejects(
    readFirstCutoverDatabaseWriters(context, sourceIdentity, {
      ...io,
      connectWorkDatabase: () =>
        mysql.createConnection({ socketPath, user: 'limited', database: 'source_qa' }),
    }),
    { message: 'CUTOVER_DATABASE_WRITERS_UNPROVEN' },
  );
  const observed = await readFirstCutoverAdministrativeWriters(context, inventory, io);
  assert.equal(observed.scope, 'mysql-server-observation-only');
  assert.equal(observed.unknownWriters, undefined);
  assert.ok(observed.counts.sessions >= 2);
  assert.equal(observed.counts.enabledEvents, 1);
  assert.equal(observed.counts.replicationReceivers, 0);
  assert.equal(observed.counts.replicationAppliers, 0);
  await root.query('START TRANSACTION');
  await root.query('UPDATE source_qa.probe SET value=1 WHERE id=1');
  let active;
  const deadline = Date.now() + 4000;
  do {
    active = await readFirstCutoverAdministrativeWriters(context, inventory, io);
    if (active.counts.transactions > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.ok(active.counts.transactions > 0);
  await root.query('ROLLBACK');
  assert.equal(JSON.stringify((await limited.query('SHOW GRANTS FOR CURRENT_USER'))[0]), grants);
  assert.equal((await limited.query('SELECT value FROM probe WHERE id=1'))[0][0].value, 0);
  await root.query('REVOKE PROCESS ON *.* FROM observer@localhost');
  await assert.rejects(readFirstCutoverAdministrativeWriters(context, inventory, io), {
    message: 'CUTOVER_DATABASE_WRITERS_UNPROVEN',
  });
  await fs.appendFile('/etc/mysql/debian.cnf', '# drift\n');
  await assert.rejects(readFirstCutoverAdministrativeWriters(context, inventory, io), {
    message: 'CUTOVER_DATABASE_WRITERS_UNPROVEN',
  });
  console.log(
    'PASS Linux original administrative adapter: real private CNF, original connector/query/journal; restricted app unchanged; sessions/event/transaction visible; revoked permission and config drift rejected. Synthetic observation only, not release readiness.',
  );
} finally {
  for (const connection of connections.reverse()) await connection.end();
  await journal?.close();
}
