import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const portableTarScript = fileURLToPath(
  new URL('../../scripts/create-portable-tar.sh', import.meta.url),
);

test('creates a portable tarball without macOS extended attributes', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'holaday-portable-tar-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const sourceRoot = join(fixture, 'source');
  const extractRoot = join(fixture, 'extract');
  const sourcePath = join(sourceRoot, 'payload.txt');
  const archivePath = join(fixture, 'release.tar.gz');
  await mkdir(sourceRoot);
  await mkdir(extractRoot);
  await writeFile(sourcePath, 'portable release\n');

  const xattr = spawnSync('xattr', ['-w', 'com.holaday.test', 'release-marker', sourcePath], {
    encoding: 'utf8',
  });
  if (process.platform === 'darwin') {
    assert.equal(xattr.status, 0, xattr.stderr);
  }

  const archive = spawnSync(
    'bash',
    [portableTarScript, archivePath, '-C', sourceRoot, 'payload.txt'],
    { encoding: 'utf8' },
  );
  assert.equal(archive.status, 0, archive.stderr);

  const listing = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.deepEqual(listing.stdout.trim().split('\n'), ['payload.txt']);

  const rawArchive = gunzipSync(await readFile(archivePath)).toString('latin1');
  assert.doesNotMatch(rawArchive, /LIBARCHIVE\.xattr|SCHILY\.xattr/);
  assert.doesNotMatch(rawArchive, /\._payload\.txt/);

  const extract = spawnSync('tar', ['-xzf', archivePath, '-C', extractRoot], {
    encoding: 'utf8',
  });
  assert.equal(extract.status, 0, extract.stderr);
  assert.equal(await readFile(join(extractRoot, 'payload.txt'), 'utf8'), 'portable release\n');
});
