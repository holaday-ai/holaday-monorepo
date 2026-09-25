import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
const firstMetadata = {
  ...metadata,
  oldIdentity: undefined,
  kind: 'first-cutover',
  legacyDigest: '3'.repeat(64),
  inventoryDigest: '4'.repeat(64),
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

test('first cutover shares the normal mutex without inventing an old protocol identity', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, firstMetadata);
  t.after(() => journal.close());
  await assert.rejects(acquireReleaseJournal(directory, metadata), /MAINTENANCE_RELEASE_LOCKED/);
  const proof = await journal.assertOwnership();
  assert.match(proof.attempt, /^[a-f0-9-]{36}$/);
  assert.equal(proof.inventoryDigest, firstMetadata.inventoryDigest);
  const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(record.kind, 'first-cutover');
  assert.equal(record.legacyDigest, firstMetadata.legacyDigest);
  assert.equal('oldIdentity' in record, false);
  assert.equal('identity' in record, false);
});

test('normal mutex also blocks first cutover, and normal metadata still requires identity', async (t) => {
  const directory = await fixture(t);
  await assert.rejects(
    acquireReleaseJournal(directory, { ...metadata, oldIdentity: undefined }),
    /UNPROVEN/,
  );
  await assert.rejects(
    acquireReleaseJournal(directory, { ...firstMetadata, oldIdentity: metadata.oldIdentity }),
    /UNPROVEN/,
  );
  const journal = await acquireReleaseJournal(directory, metadata);
  t.after(() => journal.close());
  await assert.rejects(
    acquireReleaseJournal(directory, firstMetadata),
    /MAINTENANCE_RELEASE_LOCKED/,
  );
});

test('bootstrap seed is recorded separately and cannot serve as a real candidate boot', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, firstMetadata);
  t.after(() => journal.close());
  await journal.bindManifest(manifest);
  const detail = { candidate: metadata.candidate };
  await assert.rejects(journal.bindBootstrapSeed('5'.repeat(32)), /UNPROVEN/);
  for (const phase of [
    'prepared',
    'orders_fenced',
    'legacy_settled',
    'all_fenced',
    'stopped',
    'backup_verified',
    'migration_started',
  ]) {
    await journal.persist(phase, detail);
  }
  await journal.bindBootstrapSeed('5'.repeat(32));
  const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(record.bootstrapSeed, '5'.repeat(32));
  assert.equal('identity' in record, false);
  await assert.rejects(journal.bindBootstrapSeed('6'.repeat(32)), /UNPROVEN/);
  await assert.rejects(journal.persist('opened', detail), /UNPROVEN/);
  await assert.rejects(
    journal.persist('candidate_started', {
      ...detail,
      identity: { candidate: metadata.candidate, bootId: '5'.repeat(32) },
    }),
    /UNPROVEN/,
  );
  const identity = { candidate: metadata.candidate, bootId: '6'.repeat(32) };
  for (const phase of ['candidate_started', 'verified', 'opened', 'reconciled'])
    await journal.persist(phase, { ...detail, identity });
  await journal.finish();
  await assert.rejects(fs.lstat(join(directory, 'release.lock')), { code: 'ENOENT' });
  await assert.rejects(journal.assertOwnership(), /UNPROVEN/);
});

test('journal ownership proof refuses a replaced lock', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, firstMetadata);
  t.after(() => journal.close());
  await fs.rename(join(directory, 'release.lock'), join(directory, 'original.lock'));
  await fs.writeFile(join(directory, 'release.lock'), '{}', { mode: 0o600 });
  await assert.rejects(journal.assertOwnership(), /UNPROVEN/);
});

test('candidate-start intent precedes creation of its real boot identity', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, firstMetadata);
  t.after(() => journal.close());
  await journal.bindManifest(manifest);
  const detail = { candidate: metadata.candidate };
  for (const phase of [
    'prepared',
    'orders_fenced',
    'legacy_settled',
    'all_fenced',
    'stopped',
    'backup_verified',
    'migration_started',
  ])
    await journal.persist(phase, detail);
  await journal.bindBootstrapSeed('5'.repeat(32));
  await journal.persist('candidate_started', detail);
  assert.equal('identity' in JSON.parse(await fs.readFile(journal.path, 'utf8')), false);
  await assert.rejects(journal.persist('verified', detail), /UNPROVEN/);
  await journal.persist('verified', {
    ...detail,
    identity: { candidate: metadata.candidate, bootId: '6'.repeat(32) },
  });
});
