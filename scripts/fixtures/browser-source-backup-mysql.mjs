// Run only inside a disposable, network-isolated MySQL8 container. All data,
// credentials and age identities here are synthetic. This checks the actual
// source adapter and client, NOT production stop or Mac target isolation. Source
// and restored QA databases share this disposable instance; target metadata is
// synthetic and no coordinator backup receipt may be inferred from this test.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  decryptAgeBackupToFile,
  hashAgeBackupArtifact,
  pullFirstCutoverAgeBackup,
} from '../browser-first-cutover-backup.mjs';
import { exportFirstCutoverSourceBackup } from '../browser-first-cutover-host.mjs';

assert.equal(process.env.HOLADAY_SOURCE_BACKUP_QA, 'isolated-mysql8');
assert.equal(process.platform, 'linux');
const mysql = createRequire(import.meta.url)('/qa/mysql2.cjs');
const run = promisify(execFile);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const root = await mysql.createConnection({ host: '127.0.0.1', user: 'root' });
const suffix = randomBytes(8).toString('hex');
const source = `source_qa_${suffix}`;
const target = `restore_qa_${suffix}`;
const username = `qa_${suffix}`;
const password = 'qa #"\\secret';
const directory = await mkdtemp('/tmp/holaday-source-backup-');
await chmod(directory, 0o700);
const recovery = join(directory, 'recovery');
const outgoing = join(directory, 'outgoing');
await mkdir(recovery, { mode: 0o700 });
await mkdir(outgoing, { mode: 0o700 });
const identityFile = join(recovery, 'identity.txt');
await run('/qa/age-keygen', ['-o', identityFile]);
await chmod(identityFile, 0o600);
const recipient = (await run('/qa/age-keygen', ['-y', identityFile])).stdout;
const recipientFile = join(outgoing, 'recipient.txt');
await writeFile(recipientFile, recipient, { mode: 0o600, flag: 'wx' });
const executable = await realpath('/usr/bin/mysqldump');
const facility = {
  executable: '/qa/age',
  executableDigest: hash(await readFile('/qa/age')),
  recipientFile,
  recipientDigest: hash(recipient),
};
let app;
try {
  assert.equal((await root.query('SELECT @@event_scheduler AS value'))[0][0].value, 'OFF');
  await root.query(`CREATE DATABASE ${source} CHARACTER SET utf8mb4`);
  await root.query(`CREATE DATABASE ${target} CHARACTER SET utf8mb4`);
  await root.query('CREATE USER ?@? IDENTIFIED BY ?', [username, '127.0.0.1', password]);
  await root.query(`GRANT ALL PRIVILEGES ON ${source}.* TO ?@?`, [username, '127.0.0.1']);
  const databaseUrl = `mysql://${username}:${encodeURIComponent(password)}@127.0.0.1/${source}`;
  app = await mysql.createConnection(databaseUrl);
  await app.query(
    'CREATE TABLE sample(id INT PRIMARY KEY, text_value TEXT, payload BLOB, optional_value INT NULL)',
  );
  await app.query('INSERT INTO sample VALUES (1, ?, ?, NULL)', [
    '海边\n"双引号"',
    Buffer.from([0, 255, 92, 39]),
  ]);
  await app.query('CREATE TABLE audit(id INT)');
  // The QA administrator creates fixtures under the restricted dump user's
  // DEFINER; no SUPER grant or global binlog setting is changed for that user.
  const definer = `${mysql.escape(username)}@'127.0.0.1'`;
  await root.query(
    `CREATE DEFINER=${definer} TRIGGER ${source}.qa_trigger AFTER INSERT ON ${source}.sample FOR EACH ROW INSERT INTO audit VALUES(NEW.id)`,
  );
  await root.query(`CREATE DEFINER=${definer} PROCEDURE ${source}.qa_procedure() SELECT 1`);
  await root.query(
    `CREATE DEFINER=${definer} FUNCTION ${source}.qa_function() RETURNS INT DETERMINISTIC NO SQL RETURN 1`,
  );
  await root.query(
    `CREATE DEFINER=${definer} EVENT ${source}.qa_event ON SCHEDULE EVERY 1 DAY DISABLE DO INSERT INTO audit VALUES(99)`,
  );
  const identity = (
    await app.query('SELECT @@server_uuid AS serverUuid, DATABASE() AS `database`')
  )[0][0];
  const inventory = {
    backupPlan: {
      sourceIdentity: identity,
      isolatedTarget: { serverUuid: '22222222-2222-4222-8222-222222222222', database: target },
    },
    backupSource: {
      facility,
      directory: outgoing,
      executable,
      executableDigest: hash(await readFile(executable)),
    },
  };
  const config = Buffer.from(`DATABASE_URL=${databaseUrl}`);
  const binding = {
    attempt: randomUUID(),
    candidate: 'a'.repeat(40),
    configDigest: hash(config),
    migrationDigest: 'b'.repeat(64),
    inventoryDigest: hash(JSON.stringify(inventory)),
  };
  const deadline = Date.now() + 120000;
  const context = {
    binding,
    root: `/opt/holaday-releases/${binding.candidate}`,
    approval: { ...binding, maintenanceEndsAtMs: deadline },
    journal: {
      assertOwnership: async () => binding,
      readFirstCutoverEffects: async () => ({ ...binding, phase: 'backup_verified' }),
    },
  };
  const io = {
    readConfig: async () => config,
    parseConfig: () => ({ DATABASE_URL: databaseUrl }),
    connectWorkDatabase: (url) => mysql.createConnection(url),
    assertWritersStopped: async () => {
      // Only this fixture and its owned observation connection may exist; no
      // application or provider workload is claimed to have been observed.
      const [rows] = await root.query(
        "SELECT COMMAND FROM information_schema.PROCESSLIST WHERE DB=? AND COMMAND <> 'Sleep'",
        [source],
      );
      assert.deepEqual(rows, []);
    },
  };
  const artifact = await exportFirstCutoverSourceBackup(context, inventory, io);
  const options = { facility, directory: outgoing, attempt: binding.attempt };
  const expectedBackupDigest = await hashAgeBackupArtifact(artifact, options);
  const ciphertext = await readFile(artifact.reference);
  assert(!ciphertext.includes(Buffer.from(password)));
  assert(!ciphertext.includes(Buffer.from('海边')));
  const destinationRecipient = join(recovery, 'recipient.txt');
  await writeFile(destinationRecipient, recipient, { mode: 0o600, flag: 'wx' });
  const destination = {
    facility: { ...facility, recipientFile: destinationRecipient },
    directory: recovery,
    attempt: binding.attempt,
  };
  const received = await pullFirstCutoverAgeBackup(
    {
      source: { options, artifact },
      destination,
      expectedBackupDigest,
      expectedBytes: ciphertext.length,
    },
    {
      // Same real reader/stream/receiver, separate child; only SSH is synthetic.
      spawn: () =>
        spawn(process.execPath, ['--input-type=module'], { stdio: ['pipe', 'pipe', 'ignore'] }),
    },
  );
  const decrypted = await decryptAgeBackupToFile({
    ...destination,
    artifact: received,
    expectedBackupDigest,
    identityFile,
  });
  const input = await open(decrypted.reference, 'r');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/mysql', ['--no-defaults', '-uroot', target], {
        stdio: [input.fd, 'ignore', 'ignore'],
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error('QA_RESTORE_FAILED')),
      );
    });
  } finally {
    await input.close();
  }
  const [original] = await root.query(`SELECT * FROM ${source}.sample`);
  assert.deepEqual((await root.query(`SELECT * FROM ${target}.sample`))[0], original);
  for (const [table, schemaColumn, nameColumn] of [
    ['TABLES', 'TABLE_SCHEMA', 'TABLE_NAME'],
    ['ROUTINES', 'ROUTINE_SCHEMA', 'ROUTINE_NAME'],
    ['TRIGGERS', 'TRIGGER_SCHEMA', 'TRIGGER_NAME'],
    ['EVENTS', 'EVENT_SCHEMA', 'EVENT_NAME'],
  ]) {
    const sql = `SELECT ${nameColumn} AS name FROM information_schema.${table} WHERE ${schemaColumn}=? ORDER BY name`;
    const names = (await root.query(sql, [source]))[0];
    assert(names.length > 0);
    assert.deepEqual((await root.query(sql, [target]))[0], names);
  }
  assert.deepEqual((await root.query(`SELECT * FROM ${source}.sample`))[0], original);
  assert.deepEqual(
    (await readdir(outgoing)).sort(),
    [`${binding.attempt}.sql.age`, 'recipient.txt'].sort(),
  );
  console.log(
    'PASS actual MySQL8 source adapter -> mysqldump -> age -> original transfer -> same-instance QA restore; data and objects preserved; no production proof',
  );
} finally {
  await app?.end();
  await root.query(`DROP DATABASE IF EXISTS ${source}`);
  await root.query(`DROP DATABASE IF EXISTS ${target}`);
  await root.query('DROP USER IF EXISTS ?@?', [username, '127.0.0.1']);
  await root.end();
}
