// Run after browser-recovery-target-qa on that SAME owned synthetic target.
// Never retries migrations or imports; failed runs retain target and baseline.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { inspectFirstCutoverRecoveryTarget } from '../browser-first-cutover-backup.mjs';

const [containerId, imageId, attempt, pack] = process.argv.slice(2);
assert.match(containerId, /^[a-f0-9]{64}$/);
assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
assert.match(attempt, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const run = promisify(execFile);
const metadata = await readFile(join(pack, 'runtime.json'));
const { migrationDigest, files } = JSON.parse(metadata);
assert.equal(Object.keys(files).filter((v) => v.endsWith('.sql')).length, 61);
const runtimeDigest = createHash('sha256').update(metadata).digest('hex');
const identity = JSON.parse(
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
      "SELECT JSON_OBJECT('serverUuid',@@server_uuid,'database',DATABASE())",
    ])
  ).stdout,
);
const target = {
  containerId,
  imageId,
  attempt,
  volume: `holaday-cutover-restore-${attempt}`,
  identity,
};
async function tool(action, extra = {}) {
  await inspectFirstCutoverRecoveryTarget(target, { requireEmpty: false });
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      '--user',
      '0',
      containerId,
      '/usr/bin/env',
      '-i',
      '/opt/holaday-recovery/node',
      '/opt/holaday-recovery/recovery-tool.mjs',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  let errors = '';
  child.stdout.on('data', (v) => {
    output += v;
  });
  child.stderr.on('data', (v) => {
    errors += v;
  });
  child.stdin.on('error', () => {});
  const exited = new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });
  child.stdin.end(JSON.stringify({ action, identity, migrationDigest, runtimeDigest, ...extra }));
  const code = await exited;
  assert.equal(
    code,
    0,
    `QA_${action}_FAILED: ${errors === 'CUTOVER_RECOVERY_TOOL_UNPROVEN\n' ? errors.trim() : 'unrecognized diagnostic suppressed'}`,
  );
  assert.equal(errors, '');
  await inspectFirstCutoverRecoveryTarget(target, { requireEmpty: false });
  return JSON.parse(output);
}
const before = await tool('snapshot');
const directory = await realpath(await mkdtemp(join(tmpdir(), 'holaday-recovery-compare-')));
await writeFile(join(directory, 'before.json'), JSON.stringify(before), {
  mode: 0o600,
  flag: 'wx',
});
console.log(`QA baseline saved: ${directory}/before.json`);
assert.equal(before.objects.find((v) => v.name === 'sample').rowCount, 1);
await tool('migrate');
const verified = await tool('verify', { projection: before.projection });
assert.equal(verified.businessDigest, before.businessDigest);
assert.notEqual(verified.schemaDigest, before.schemaDigest);
await assert.rejects(tool('migrate'), /QA_migrate_FAILED/);
const after = await tool('verify', { projection: before.projection });
assert.deepEqual(after, verified);
console.log(
  'PASS actual no-network MySQL8 recovery + original 61 migrations + original schema check and historical full-column business digest unchanged; repeated migration refused. Synthetic data only, not production/source stop or release proof.',
);
