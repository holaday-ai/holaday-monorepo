// Actual recovery-machine Docker/age/import exercise. The caller creates the
// dedicated no-network container/volume; this fixture never stops/removes one.
// Payload and key are synthetic. Source SSH and physical stopped facts are
// simulated; recovery session pipes and the coordinator's journal are real.
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
import { serveFirstCutoverRecoverySession } from '../browser-first-cutover-recovery-session.mjs';
import { buildMaintenanceMigrationManifest } from '../browser-maintenance-manifest.mjs';

const [containerId, imageId, attempt, runtimeRoot] = process.argv.slice(2);
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
const io = {
  pull: (input) =>
    pullFirstCutoverAgeBackup(input, {
      spawn: () =>
        spawn(process.execPath, ['--input-type=module'], { stdio: ['pipe', 'pipe', 'ignore'] }),
    }),
};
const request = { transfer, identityFile, target };
const migrationManifest = runtimeRoot
  ? buildMaintenanceMigrationManifest(runtimeRoot).manifest
  : [];
const binding = {
  attempt,
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: hash(JSON.stringify(migrationManifest)),
  inventoryDigest: 'd'.repeat(64),
};
const scope = {
  schemaVersion: 1,
  binding,
  maintenanceEndsAtMs: Date.now() + 120000,
  sourceOptions,
  destination,
  identityFile,
  target,
  sourceIdentity: {
    serverUuid: '11111111-1111-4111-8111-111111111111',
    database: 'synthetic_source',
  },
};
if (runtimeRoot) {
  const bytes = await readFile(join(runtimeRoot, 'runtime.json'));
  const runtime = JSON.parse(bytes);
  assert.equal(runtime.migrationDigest, binding.migrationDigest);
  assert.equal(migrationManifest.migrations.length, 61);
  scope.runtime = {
    manifestDigest: hash(bytes),
    nodeDigest: runtime.files.node,
    toolDigest: runtime.files['recovery-tool.mjs'],
  };
}
const scopeBytes = JSON.stringify(scope);
await writeFile(join(directory, `first-cutover-${attempt}.json`), scopeBytes, {
  mode: 0o600,
  flag: 'wx',
});
const scopeDigest = hash(scopeBytes);
const publicScope = {
  binding,
  maintenanceEndsAtMs: scope.maintenanceEndsAtMs,
  scopeDigest,
  sourceIdentity: scope.sourceIdentity,
  isolatedTarget: identity,
};
const journalDirectory = join(directory, 'journal');
await mkdir(journalDirectory, { mode: 0o700 });
// Child models the original Linux coordinator over exactly its stdin/stdout.
// Only public metadata is sent, never the Mac identity file or private key.
const script = `
import assert from 'node:assert/strict';
import { acquireReleaseJournal } from ${JSON.stringify(new URL('../browser-maintenance-journal.mjs', import.meta.url).href)};
import { connectFirstCutoverRecoverySession } from ${JSON.stringify(new URL('../browser-first-cutover-recovery-session.mjs', import.meta.url).href)};
const scope = ${JSON.stringify(publicScope)};
const journal = await acquireReleaseJournal(${JSON.stringify(journalDirectory)}, { ...scope.binding, kind:'first-cutover', legacyDigest:'e'.repeat(64) });
try {
  await journal.bindManifest(${JSON.stringify(migrationManifest)});
  for (const phase of ['prepared','orders_fenced','legacy_settled','producers_stopped','all_fenced','stopped','backup_verified']) await journal.persist(phase, {candidate:scope.binding.candidate});
  const baseline = await journal.readFirstCutoverEffects();
  let checks=0;
  const client = await connectFirstCutoverRecoverySession(scope, { input:process.stdin, output:process.stdout, assertScope:async()=>{
    assert.deepEqual(await journal.assertOwnership(),scope.binding);
    assert.deepEqual(await journal.readFirstCutoverEffects(),baseline);
    assert.equal(baseline.phase,'backup_verified');
    checks++;
  }});
  assert.deepEqual(await client.inspect(),scope.isolatedTarget);
  assert.deepEqual(await client.restore(${JSON.stringify({ artifact, expectedBackupDigest: transfer.expectedBackupDigest, expectedBytes: transfer.expectedBytes })}),scope.isolatedTarget);
  assert.deepEqual(await client.inspect(),scope.isolatedTarget);
  ${
    runtimeRoot
      ? `const before = await client.snapshot();
  assert.equal(before.objects.find(v=>v.name==='sample').rowCount,1);
  assert.deepEqual(await client.migrate(),{migrationDigest:scope.binding.migrationDigest});
  const verified = await client.verify();
  assert.equal(verified.businessDigest,before.businessDigest);
  assert.notEqual(verified.schemaDigest,before.schemaDigest);`
      : ''
  }
  await client.close();
  assert(checks>=8);
} finally { await journal.close(); }
`;
const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
  stdio: ['pipe', 'pipe', 'ignore'],
});
const exited = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code) =>
    code === 0 ? resolve() : reject(new Error('QA_COORDINATOR_FAILED')),
  );
});
// Retain the child outcome even if local serving fails; never restart imports.
exited.catch(() => {});
try {
  await serveFirstCutoverRecoverySession(
    { directory, attempt, scopeDigest },
    {
      input: child.stdout,
      output: child.stdin,
      restore: (input, deps) => restoreFirstCutoverAgeBackup(input, { ...io, ...deps }),
    },
  );
} finally {
  child.stdin.end();
}
await exited;
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
await assert.rejects(
  restoreFirstCutoverAgeBackup(request, { ...io, assertScope: async () => {} }),
  {
    message: 'CUTOVER_RECOVERY_IMPORT_UNPROVEN',
  },
);
assert.equal(await query('SELECT COUNT(*) FROM sample'), '1');
console.log(
  runtimeRoot
    ? 'PASS actual same coordinator child pipes/file journal + pinned no-network Docker + age fd import + original full snapshot + all61 original migrations + schema/business check. Physical stopped facts/source SSH synthetic; not production/complete release proof.'
    : 'PASS actual pinned no-network Docker + authenticated age import over real coordinator child pipes and file journal; UTF8/BLOB/NULL/trigger/event and repeat refusal; physical stopped facts/source SSH synthetic, no production or migration proof',
);
