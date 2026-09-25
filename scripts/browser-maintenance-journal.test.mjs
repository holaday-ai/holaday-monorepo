import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

const metadata = {
  candidate: 'c'.repeat(40),
  configDigest: 'e'.repeat(64),
  migrationDigest: createHash('sha256')
    .update(
      JSON.stringify({
        replaysNumberedSql: true,
        runnerSha256: '1'.repeat(64),
        migrations: [{ name: '0042_core.sql', sha256: '2'.repeat(64) }],
      }),
    )
    .digest('hex'),
  oldIdentity: { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) },
};
const manifest = {
  replaysNumberedSql: true,
  runnerSha256: '1'.repeat(64),
  migrations: [{ name: '0042_core.sql', sha256: '2'.repeat(64) }],
};
async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-release-journal-')));
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('exclusive journal persists phase and identity before allowing lock release after opened', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, metadata);
  await journal.bindManifest(manifest);
  await assert.rejects(acquireReleaseJournal(directory, metadata), {
    message: 'MAINTENANCE_RELEASE_LOCKED',
  });
  await journal.persist('closed', {
    candidate: metadata.candidate,
    identity: metadata.oldIdentity,
  });
  const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(record.phase, 'closed');
  assert.deepEqual(record.identity, metadata.oldIdentity);
  assert.equal(record.configDigest, metadata.configDigest);
  assert.equal(record.migrationDigest, metadata.migrationDigest);
  assert.deepEqual(record.migrationManifest, manifest);
  await assert.rejects(journal.finish(), { message: 'MAINTENANCE_RELEASE_NOT_OPENED' });
  const identity = { candidate: metadata.candidate, bootId: 'd'.repeat(32) };
  await journal.persist('opened', { candidate: metadata.candidate, identity });
  await journal.finish();
  await assert.rejects(fs.lstat(join(directory, 'release.lock')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).phase, 'opened');
});

test('abandoning a release preserves lock and last phase for explicit recovery', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, metadata);
  await journal.bindManifest(manifest);
  await journal.persist('migration_started', {
    candidate: metadata.candidate,
    identity: metadata.oldIdentity,
  });
  await journal.close();
  await assert.rejects(acquireReleaseJournal(directory, metadata), {
    message: 'MAINTENANCE_RELEASE_LOCKED',
  });
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).phase, 'migration_started');
});

test('unbound or different migration manifest cannot cross the closed phase', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, metadata);
  await assert.rejects(
    journal.persist('closed', { candidate: metadata.candidate, identity: metadata.oldIdentity }),
    /MAINTENANCE_MIGRATIONS_UNPROVEN/,
  );
  await assert.rejects(
    journal.bindManifest({ ...manifest, runnerSha256: '9'.repeat(64) }),
    /MAINTENANCE_MIGRATIONS_UNPROVEN/,
  );
  await journal.close();
});

test('phase rename failure retains exclusive lock and does not invent the next phase', async (t) => {
  const directory = await fixture(t);
  let rejectRename = false;
  const journal = await acquireReleaseJournal(directory, metadata, {
    ...fs,
    rename: async (...args) => {
      if (rejectRename) throw Object.assign(new Error('disk failure'), { code: 'EIO' });
      return fs.rename(...args);
    },
  });
  await journal.bindManifest(manifest);
  rejectRename = true;
  await assert.rejects(
    journal.persist('closed', { candidate: metadata.candidate, identity: metadata.oldIdentity }),
    { message: 'MAINTENANCE_JOURNAL_UNPROVEN' },
  );
  await journal.close();
  await assert.rejects(acquireReleaseJournal(directory, metadata), {
    message: 'MAINTENANCE_RELEASE_LOCKED',
  });
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).phase, 'preflight');
});

test('symlink/nonprivate directory refuses before creating release evidence', async (t) => {
  const directory = await fixture(t);
  const link = `${directory}-link`;
  t.after(() => fs.unlink(link).catch(() => {}));
  await fs.symlink(directory, link);
  await assert.rejects(acquireReleaseJournal(link, metadata), {
    message: 'MAINTENANCE_JOURNAL_UNPROVEN',
  });
  await fs.chmod(directory, 0o755);
  await assert.rejects(acquireReleaseJournal(directory, metadata), {
    message: 'MAINTENANCE_JOURNAL_UNPROVEN',
  });
  assert.deepEqual(await fs.readdir(directory), []);
});

test('replaced lock is never removed by the original release', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, metadata);
  await journal.bindManifest(manifest);
  await journal.persist('opened', {
    candidate: metadata.candidate,
    identity: { candidate: metadata.candidate, bootId: 'd'.repeat(32) },
  });
  const lock = join(directory, 'release.lock');
  await fs.rename(lock, `${lock}.old`);
  await fs.writeFile(lock, 'another owner', { mode: 0o600 });
  await assert.rejects(journal.finish(), { message: 'MAINTENANCE_JOURNAL_UNPROVEN' });
  await journal.close();
  assert.equal(await fs.readFile(lock, 'utf8'), 'another owner');
});
