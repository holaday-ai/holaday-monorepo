// Actual recovery-machine Docker/age/import exercise. The caller creates the
// dedicated no-network container/volume; this fixture never stops/removes one.
// Payload and key are synthetic. Source SSH and live coordinator are simulated.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  encryptAgeBackup,
  inspectFirstCutoverRecoveryTarget,
  pullFirstCutoverAgeBackup,
  restoreFirstCutoverAgeBackup,
} from '../browser-first-cutover-backup.mjs';

const [containerId, imageId, attempt] = process.argv.slice(2);
assert.match(containerId ?? '', /^[a-f0-9]{64}$/);
assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/);
assert.match(attempt ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const run = promisify(execFile);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const query = async (sql) =>
  (
    await run('docker', [
      'exec',
      containerId,
      '/usr/bin/mysql',
      '--no-defaults',
      '-uroot',
      '--database=restore_qa',
      '--batch',
      '--raw',
      '--skip-column-names',
      '--execute',
      sql,
    ])
  ).stdout.trim();
const identity = JSON.parse(
  await query("SELECT JSON_OBJECT('serverUuid',@@server_uuid,'database',DATABASE())"),
);
const target = {
  containerId,
  imageId,
  attempt,
  volume: `holaday-cutover-restore-${attempt}`,
  identity,
};
assert.deepEqual(await inspectFirstCutoverRecoveryTarget(target), identity);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'holaday-recovery-target-')));
await chmod(directory, 0o700);
const sourceDirectory = join(directory, 'source');
const recoveryDirectory = join(directory, 'recovery');
await mkdir(sourceDirectory, { mode: 0o700 });
await mkdir(recoveryDirectory, { mode: 0o700 });
const age = await realpath(process.env.CUTOVER_TEST_AGE_EXECUTABLE);
const identityFile = join(recoveryDirectory, 'identity.txt');
await run(join(dirname(age), 'age-keygen'), ['-o', identityFile]);
await chmod(identityFile, 0o600);
const recipient = (await run(join(dirname(age), 'age-keygen'), ['-y', identityFile])).stdout;
const facility = {
  executable: age,
  executableDigest: hash(await readFile(age)),
  recipientDigest: hash(recipient),
};
const optionsFor = async (path) => {
  const recipientFile = join(path, 'recipient.txt');
  await writeFile(recipientFile, recipient, { mode: 0o600, flag: 'wx' });
  return { facility: { ...facility, recipientFile }, directory: path, attempt };
};
const sourceOptions = await optionsFor(sourceDirectory);
const destination = await optionsFor(recoveryDirectory);
const sql = Buffer.from(
  "SET NAMES utf8mb4; CREATE TABLE sample(id INT PRIMARY KEY, text_value TEXT, payload BLOB, optional_value INT NULL); INSERT INTO sample VALUES(1,'海边',0x00ff5c27,NULL); CREATE TABLE audit(id INT); CREATE TRIGGER qa_trigger AFTER INSERT ON sample FOR EACH ROW INSERT INTO audit VALUES(NEW.id); CREATE EVENT qa_event ON SCHEDULE EVERY 1 DAY DISABLE DO INSERT INTO audit VALUES(99);\n",
);
const artifact = await encryptAgeBackup(sourceOptions, (sink) =>
  pipeline(Readable.from([sql]), sink),
);
const bytes = await readFile(artifact.reference);
const transfer = {
  source: { options: sourceOptions, artifact },
  destination,
  expectedBackupDigest: hash(bytes),
  expectedBytes: bytes.length,
};
let checks = 0;
const io = {
  assertScope: async () => {
    checks++;
  }, // synthetic coordinator, not production stop proof
  pull: (input) =>
    pullFirstCutoverAgeBackup(input, {
      spawn: () =>
        spawn(process.execPath, ['--input-type=module'], { stdio: ['pipe', 'pipe', 'ignore'] }),
    }),
};
const request = { transfer, identityFile, target };
assert.deepEqual(await restoreFirstCutoverAgeBackup(request, io), identity);
assert(checks >= 8);
assert.equal(
  await query('SELECT HEX(text_value), HEX(payload), optional_value IS NULL FROM sample'),
  'E6B5B7E8BEB9\t00FF5C27\t1',
);
assert.equal(
  await query('SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'),
  '1',
);
assert.equal(
  await query('SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()'),
  '1',
);
await assert.rejects(restoreFirstCutoverAgeBackup(request, io), {
  message: 'CUTOVER_RECOVERY_IMPORT_UNPROVEN',
});
assert.equal(await query('SELECT COUNT(*) FROM sample'), '1');
console.log(
  'PASS actual pinned no-network Docker target + authenticated age descriptor import; UTF8/BLOB/NULL/trigger/event and repeat refusal; no production or migration proof',
);
