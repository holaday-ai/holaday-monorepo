// Shared QA-only read-only proof of the fixed copied runtime on either role.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFirstCutoverRecoveryRuntime } from '../browser-first-cutover-recovery-runtime.mjs';
export async function verifyFirstCutoverQaRuntimeMaterials({
  containerId,
  imageId,
  attempt,
  root,
}) {
  const run = promisify(execFile);
  const docker = (args) => run('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
  const resource = JSON.parse((await docker(['inspect', containerId])).stdout)[0];
  assert.equal(resource.Id, containerId);
  assert.equal(resource.Image, imageId);
  assert.equal(resource.Config.Labels['holaday.cutover.attempt'], attempt);
  assert.equal(resource.HostConfig.NetworkMode, 'none');
  const metadata = await readFile(join(root, 'runtime.json'));
  const manifest = JSON.parse(metadata);
  const manifestDigest = createHash('sha256').update(metadata).digest('hex');
  await readFirstCutoverRecoveryRuntime({
    root,
    runtimeDigest: manifestDigest,
    migrationDigest: manifest.migrationDigest,
  });
  const expectedFiles = { ...manifest.files, 'runtime.json': manifestDigest };
  const paths = Object.keys(expectedFiles).map((name) => `/opt/holaday-recovery/${name}`);
  const actualHashes = (await docker(['exec', containerId, '/usr/bin/sha256sum', ...paths])).stdout;
  assert.equal(
    actualHashes,
    Object.entries(expectedFiles)
      .map(([name, digest]) => `${digest}  /opt/holaday-recovery/${name}\n`)
      .join(''),
  );
  const actualStats = (
    await docker(['exec', containerId, '/usr/bin/stat', '-c', '%u %a %h %F', ...paths])
  ).stdout
    .trim()
    .split('\n');
  assert.deepEqual(
    actualStats,
    Object.keys(expectedFiles).map((name) => `0 ${name === 'node' ? '700' : '600'} 1 regular file`),
  );
  const directories = [
    ...new Set([
      '',
      ...Object.keys(expectedFiles).flatMap((name) => {
        const parts = name.split('/');
        return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
      }),
    ]),
  ].map((name) => `/opt/holaday-recovery${name ? '/' + name : ''}`);
  const directoryStats = (
    await docker(['exec', containerId, '/usr/bin/stat', '-c', '%u %a %F', ...directories])
  ).stdout
    .trim()
    .split('\n');
  assert.ok(directoryStats.every((value) => value === '0 700 directory'));

  return { manifestDigest, migrationDigest: manifest.migrationDigest, files: paths.length };
}
