// QA only: prepare a fresh synthetic source or empty isolated recovery target.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  executeFirstCutoverRecoveryTargetTool,
  inspectFirstCutoverRecoveryTarget,
} from '../browser-first-cutover-backup.mjs';
import { verifyFirstCutoverQaRuntimeMaterials } from './browser-first-cutover-runtime-materials.qa.mjs';
import { readFirstCutoverRecoveryRuntime } from '../browser-first-cutover-recovery-runtime.mjs';
const [containerId, imageId, attempt, root, kind] = process.argv.slice(2);
assert.equal(process.argv.length, 7);
assert.ok(['minimal', 'current-61', 'empty-target'].includes(kind));
assert.match(containerId ?? '', /^[a-f0-9]{64}$/);
assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/);
assert.match(attempt ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const run = promisify(execFile);
const docker = (args) => run('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
const query = async (sql) =>
  (
    await docker([
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
const resource = JSON.parse((await docker(['inspect', containerId])).stdout)[0];
assert.equal(resource.Id, containerId);
assert.equal(resource.Image, imageId);
assert.equal(resource.Config.Labels['holaday.cutover.attempt'], attempt);
assert.equal(resource.HostConfig.NetworkMode, 'none');
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
await inspectFirstCutoverRecoveryTarget(target);
const metadata = await readFile(join(root, 'runtime.json'));
const manifest = JSON.parse(metadata);
const manifestDigest = createHash('sha256').update(metadata).digest('hex');
await readFirstCutoverRecoveryRuntime({
  root,
  runtimeDigest: manifestDigest,
  migrationDigest: manifest.migrationDigest,
});
assert.equal(Object.keys(manifest.files).filter((v) => v.endsWith('.sql')).length, 61);
const guard = () => inspectFirstCutoverRecoveryTarget(target, { requireEmpty: false });
await guard();
await docker(['exec', containerId, '/usr/bin/test', '!', '-e', '/opt/holaday-recovery']);
await docker(['cp', root, `${containerId}:/opt/holaday-recovery`]);
await guard();
await docker([
  'exec',
  '--user',
  '0',
  containerId,
  '/usr/bin/chown',
  '-R',
  '0:0',
  '/opt/holaday-recovery',
]);
const materialProof = await verifyFirstCutoverQaRuntimeMaterials({
  containerId,
  imageId,
  attempt,
  root,
});
await guard();
if (kind === 'empty-target') {
  await inspectFirstCutoverRecoveryTarget(target);
  console.log(
    JSON.stringify({
      scope: 'fresh-empty-recovery-target',
      schemaBaseline: 'empty',
      runtimeInstalled: true,
      files: materialProof.files,
      manifestDigest,
      migrationDigest: manifest.migrationDigest,
    }),
  );
  process.exit(0);
}
const runtime = {
  manifestDigest,
  nodeDigest: manifest.files.node,
  toolDigest: manifest.files['recovery-tool.mjs'],
};
const tool = (action) =>
  executeFirstCutoverRecoveryTargetTool(
    { target, runtime, migrationDigest: manifest.migrationDigest, action },
    { assertScope: guard },
  );
// Exactly the original binary/Unicode/NULL/trigger/disabled-event fixture.
await query(
  "SET NAMES utf8mb4; CREATE TABLE sample(id INT PRIMARY KEY, text_value TEXT, payload BLOB, optional_value INT NULL); INSERT INTO sample VALUES(1,'海边',0x00ff5c27,NULL); CREATE TABLE audit(id INT); CREATE TRIGGER qa_trigger AFTER INSERT ON sample FOR EACH ROW INSERT INTO audit VALUES(NEW.id); CREATE EVENT qa_event ON SCHEDULE EVERY 1 DAY DISABLE DO INSERT INTO audit VALUES(99);",
);

const before = await tool('snapshot');
assert.equal(before.objects.find((v) => v.name === 'sample').rowCount, 1);
if (kind === 'current-61') await tool('migrate');
const after = await tool('snapshot');
assert.equal(
  await query('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'),
  kind === 'current-61' ? '90' : '2',
);
assert.equal(
  await query('SELECT HEX(text_value), HEX(payload), optional_value IS NULL FROM sample'),
  'E6B5B7E8BEB9\t00FF5C27\t1',
);
await guard();
console.log(
  JSON.stringify({
    scope: 'fresh-synthetic-source',
    schemaBaseline: kind,
    migrations: kind === 'current-61' ? 61 : 0,
    objects: after.objects.length,
    snapshotFrameBytes: Buffer.byteLength(
      JSON.stringify({ protocol: 1, type: 'result', seq: 99, value: after }) + '\n',
    ),
    verifyToolRequestBytes: Buffer.byteLength(
      JSON.stringify({
        action: 'verify',
        identity,
        migrationDigest: manifest.migrationDigest,
        runtimeDigest: manifestDigest,
        projection: after.projection,
      }),
    ),
    sourceDigest: after.sourceDigest,
    manifestDigest,
    migrationDigest: manifest.migrationDigest,
  }),
);
