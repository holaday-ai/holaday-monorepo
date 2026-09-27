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

test('first-cutover effects are read from the owned durable journal without mutable aliases', async (t) => {
  const journal = await acquireReleaseJournal(await fixture(t), firstMetadata);
  t.after(() => journal.close());
  assert.equal(typeof journal.readFirstCutoverEffects, 'function');
  const binding = await journal.assertOwnership();
  const initial = await journal.readFirstCutoverEffects();
  assert.deepEqual(initial, {
    ...binding,
    recordDigest: createHash('sha256')
      .update(await fs.readFile(journal.path))
      .digest('hex'),
    legacyDigest: firstMetadata.legacyDigest,
    phase: 'preflight',
    startupEvents: [],
    registrationEvents: [],
  });
  initial.startupEvents.push({ phase: 'forged' });
  assert.deepEqual((await journal.readFirstCutoverEffects()).startupEvents, []);
  await journal.bindManifest(manifest);
  const bound = await journal.readFirstCutoverEffects();
  assert.equal(bound.phase, initial.phase);
  assert.notEqual(bound.recordDigest, initial.recordDigest);
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await journal.persist(phase, { candidate: metadata.candidate });
  const event = {
    attempt: binding.attempt,
    inventoryDigest: binding.inventoryDigest,
    host: 'vultr',
    phase: 'registration-backup-intent',
  };
  await journal.recordRegistrationEvent(event);
  const current = await journal.readFirstCutoverEffects();
  assert.equal(current.phase, 'producers_stopped');
  assert.deepEqual(current.registrationEvents, [event]);
  assert.ok(!JSON.stringify(current).includes('migrationManifest'));
});

test('effect reads reject normal releases, closed handles and in-place journal tampering', async (t) => {
  const normal = await acquireReleaseJournal(await fixture(t), metadata);
  t.after(() => normal.close());
  assert.equal(typeof normal.readFirstCutoverEffects, 'function');
  await assert.rejects(normal.readFirstCutoverEffects(), /UNPROVEN/);
  for (const change of ['bytes', 'mode', 'close']) {
    const journal = await acquireReleaseJournal(await fixture(t), firstMetadata);
    t.after(() => journal.close());
    if (change === 'bytes') {
      const bytes = await fs.readFile(journal.path, 'utf8');
      await fs.writeFile(journal.path, bytes.replace('preflight', 'reconciled'));
    } else if (change === 'mode') await fs.chmod(journal.path, 0o644);
    else await journal.close();
    await assert.rejects(journal.readFirstCutoverEffects(), /UNPROVEN/);
  }
});

const backupReceiptFor = async (journal) => ({
  ...(await journal.assertOwnership()),
  backupDigest: '1'.repeat(64),
  databaseIdentityDigest: '2'.repeat(64),
  isolatedTargetDigest: '3'.repeat(64),
  encryptionProfileDigest: '4'.repeat(64),
  comparisonDigest: '5'.repeat(64),
  schemaDigest: '6'.repeat(64),
  businessDigest: '7'.repeat(64),
  restoredAtMs: 1000,
});
const reachBackup = async (journal) => {
  await journal.bindManifest(manifest);
  for (const phase of [
    'prepared',
    'orders_fenced',
    'legacy_settled',
    'producers_stopped',
    'all_fenced',
    'stopped',
    'backup_verified',
  ])
    await journal.persist(phase, { candidate: metadata.candidate });
};
test('a backup phase intent alone cannot authorize the first production migration', async (t) => {
  const journal = await acquireReleaseJournal(await fixture(t), firstMetadata);
  t.after(() => journal.close());
  await reachBackup(journal);
  await assert.rejects(
    journal.persist('migration_started', { candidate: metadata.candidate }),
    /UNPROVEN/,
  );
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).phase, 'backup_verified');
});
test('a bound backup receipt is durable, immutable and preserved into migration', async (t) => {
  const journal = await acquireReleaseJournal(await fixture(t), firstMetadata);
  t.after(() => journal.close());
  await reachBackup(journal);
  const receipt = await backupReceiptFor(journal);
  assert.equal(typeof journal.bindBackupReceipt, 'function');
  assert.deepEqual(await journal.bindBackupReceipt(receipt), receipt);
  assert.deepEqual(JSON.parse(await fs.readFile(journal.path, 'utf8')).backupReceipt, receipt);
  await assert.rejects(journal.bindBackupReceipt(receipt), /UNPROVEN/);
  await journal.persist('migration_started', { candidate: metadata.candidate });
  assert.deepEqual(JSON.parse(await fs.readFile(journal.path, 'utf8')).backupReceipt, receipt);
});
test('receipt rejects wrong release, extra payload, identical source/target and non-digests', async (t) => {
  const journal = await acquireReleaseJournal(await fixture(t), firstMetadata);
  t.after(() => journal.close());
  await reachBackup(journal);
  const receipt = await backupReceiptFor(journal);
  assert.equal(typeof journal.bindBackupReceipt, 'function');
  for (const overrides of [
    { candidate: '0'.repeat(40) },
    { restored: true },
    { backupDigest: true },
    { isolatedTargetDigest: receipt.databaseIdentityDigest },
    { restoredAtMs: -1 },
  ])
    await assert.rejects(journal.bindBackupReceipt({ ...receipt, ...overrides }), /UNPROVEN/);
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).backupReceipt, undefined);
});

test('backup receipts cannot be attached to a normal release or before backup intent', async (t) => {
  for (const meta of [metadata, firstMetadata]) {
    const journal = await acquireReleaseJournal(await fixture(t), meta);
    t.after(() => journal.close());
    await assert.rejects(journal.bindBackupReceipt(await backupReceiptFor(journal)), /UNPROVEN/);
    assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).backupReceipt, undefined);
  }
});
test('a failed backup receipt disk write retains the intent and refuses migration', async (t) => {
  let failWrite = false;
  const journal = await acquireReleaseJournal(await fixture(t), firstMetadata, {
    ...fs,
    rename: async (...args) => {
      if (failWrite) throw new Error('disk failure');
      return fs.rename(...args);
    },
  });
  t.after(() => journal.close());
  await reachBackup(journal);
  const receipt = await backupReceiptFor(journal);
  failWrite = true;
  await assert.rejects(journal.bindBackupReceipt(receipt), /UNPROVEN/);
  await assert.rejects(
    journal.persist('migration_started', { candidate: metadata.candidate }),
    /UNPROVEN/,
  );
  const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(record.phase, 'backup_verified');
  assert.equal(record.backupReceipt, undefined);
});

test('registration journal requires backup then exact delete intents and blocks advancing a partial removal', async (t) => {
  const directory = await fixture(t);
  const journal = await acquireReleaseJournal(directory, firstMetadata);
  t.after(() => journal.close());
  assert.equal(typeof journal.recordRegistrationEvent, 'function');
  await journal.bindManifest(manifest);
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await journal.persist(phase, { candidate: metadata.candidate });
  const b = { attempt: journal.attempt, inventoryDigest: firstMetadata.inventoryDigest };
  // Use binding from the actual lock; no fabricated attempt.
  b.attempt = (await journal.assertOwnership()).attempt;
  const registration = { pmId: 5, name: 'holaday-files-cron', configDigest: 'a'.repeat(64) };
  await journal.recordRegistrationEvent({ ...b, phase: 'registration-backup-intent' });
  await assert.rejects(
    journal.persist('all_fenced', { candidate: metadata.candidate }),
    /UNPROVEN/,
  );
  await journal.recordRegistrationEvent({
    ...b,
    phase: 'registration-backed-up',
    backupDigest: 'b'.repeat(64),
    registrations: [registration],
  });
  await assert.rejects(
    journal.recordRegistrationEvent({ ...b, ...registration, phase: 'registration-deleted' }),
    /UNPROVEN/,
  );
  await journal.recordRegistrationEvent({
    ...b,
    ...registration,
    phase: 'registration-delete-intent',
  });
  await assert.rejects(
    journal.persist('all_fenced', { candidate: metadata.candidate }),
    /UNPROVEN/,
  );
  await journal.recordRegistrationEvent({ ...b, ...registration, phase: 'registration-deleted' });
  const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(record.registrationEvents.length, 4);
  await assert.rejects(
    journal.recordRegistrationEvent({ ...b, phase: 'registration-backup-intent' }),
    /UNPROVEN/,
  );
  await journal.persist('all_fenced', { candidate: metadata.candidate });
});

async function firstEventFixture(t) {
  const journal = await acquireReleaseJournal(await fixture(t), firstMetadata);
  t.after(() => journal.close());
  await journal.bindManifest(manifest);
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await journal.persist(phase, { candidate: metadata.candidate });
  const { attempt, inventoryDigest } = await journal.assertOwnership();
  return {
    journal,
    binding: { attempt, inventoryDigest },
    advance: () => journal.persist('all_fenced', { candidate: metadata.candidate }),
  };
}

test('one actual journal records both hosts same startup paths and refuses a partially written second host', async (t) => {
  const { journal, binding, advance } = await firstEventFixture(t);
  for (const host of ['vultr', 'aliyun'])
    await journal.recordStartupEvent({ ...binding, host, phase: 'startup-backup-intent' });
  for (const host of ['vultr', 'aliyun']) {
    const files = [
      {
        path: '/root/.pm2/dump.pm2',
        beforeDigest: (host === 'vultr' ? 'a' : 'b').repeat(64),
        afterDigest: 'c'.repeat(64),
      },
      { path: '/root/.pm2/dump.pm2.bak', beforeDigest: null, afterDigest: null },
    ];
    await journal.recordStartupEvent({ ...binding, host, phase: 'startup-backed-up', files });
    await journal.recordStartupEvent({
      ...binding,
      host,
      phase: 'startup-file-intent',
      ...files[0],
    });
    await assert.rejects(advance(), /UNPROVEN/);
    await journal.recordStartupEvent({
      ...binding,
      host,
      phase: 'startup-file-written',
      ...files[0],
    });
  }
  await assert.rejects(
    journal.recordStartupEvent({ ...binding, host: 'vultr', phase: 'startup-backup-intent' }),
    /UNPROVEN/,
  );
  await advance();
  const saved = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(saved.startupEvents.length, 8);
  for (const host of ['vultr', 'aliyun']) {
    const events = saved.startupEvents.filter((e) => e.host === host);
    assert.deepEqual(
      events.map((e) => e.phase),
      ['startup-backup-intent', 'startup-backed-up', 'startup-file-intent', 'startup-file-written'],
    );
    assert.equal(events[1].files[0].beforeDigest, (host === 'vultr' ? 'a' : 'b').repeat(64));
  }
});

test('registration deletion binds host as well as PM2 id and can span the approved two phases', async (t) => {
  const { journal, binding, advance } = await firstEventFixture(t);
  for (const host of ['vultr', 'aliyun']) {
    const entry = {
      pmId: 5,
      name: host === 'vultr' ? 'holaday-files-cron' : 'holaday-cn-payment',
      configDigest: (host === 'vultr' ? 'a' : 'b').repeat(64),
    };
    await journal.recordRegistrationEvent({
      ...binding,
      host,
      phase: 'registration-backup-intent',
    });
    await journal.recordRegistrationEvent({
      ...binding,
      host,
      phase: 'registration-backed-up',
      backupDigest: 'c'.repeat(64),
      registrations: [entry],
    });
    if (host === 'aliyun')
      await assert.rejects(
        journal.persist('stopped', { candidate: metadata.candidate }),
        /UNPROVEN/,
      );
    await journal.recordRegistrationEvent({
      ...binding,
      host,
      phase: 'registration-delete-intent',
      ...entry,
    });
    await journal.recordRegistrationEvent({
      ...binding,
      host,
      phase: 'registration-deleted',
      ...entry,
    });
    if (host === 'vultr') await advance();
  }
  await journal.persist('stopped', { candidate: metadata.candidate });
  const saved = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(saved.registrationEvents.length, 8);
  assert.deepEqual(
    saved.registrationEvents
      .filter((e) => e.phase === 'registration-deleted')
      .map((e) => [e.host, e.pmId, e.name]),
    [
      ['vultr', 5, 'holaday-files-cron'],
      ['aliyun', 5, 'holaday-cn-payment'],
    ],
  );
});

test('host-tagged first events reject unknown hosts and cannot mix named and legacy local records', async (t) => {
  for (const namedFirst of [true, false]) {
    const { journal, binding } = await firstEventFixture(t);
    await assert.rejects(
      journal.recordStartupEvent({ ...binding, host: 'other', phase: 'startup-backup-intent' }),
      /UNPROVEN/,
    );
    await journal.recordStartupEvent({
      ...binding,
      ...(namedFirst ? { host: 'vultr' } : {}),
      phase: 'startup-backup-intent',
    });
    await assert.rejects(
      journal.recordRegistrationEvent({
        ...binding,
        ...(namedFirst ? {} : { host: 'aliyun' }),
        phase: 'registration-backup-intent',
      }),
      /UNPROVEN/,
    );
  }
});

test('malformed first event payloads refuse without creating a host batch', async (t) => {
  const { journal, binding } = await firstEventFixture(t);
  for (const event of [null, undefined, [], 1]) {
    await assert.rejects(journal.recordStartupEvent(event), /MAINTENANCE_JOURNAL_UNPROVEN/);
    await assert.rejects(journal.recordRegistrationEvent(event), /MAINTENANCE_JOURNAL_UNPROVEN/);
  }
  await journal.recordStartupEvent({ ...binding, host: 'aliyun', phase: 'startup-backup-intent' });
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).startupEvents.length, 1);
});

test('registration journal rejects normal releases, wrong phases, foreign ownership and secret payload', async (t) => {
  for (const kind of ['normal', 'phase', 'owner', 'secret']) {
    const directory = await fixture(t);
    const journal = await acquireReleaseJournal(
      directory,
      kind === 'normal' ? metadata : firstMetadata,
    );
    t.after(() => journal.close());
    assert.equal(typeof journal.recordRegistrationEvent, 'function');
    await journal.bindManifest(manifest);
    if (!['normal', 'phase'].includes(kind))
      for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
        await journal.persist(phase, { candidate: metadata.candidate });
    const binding = await journal.assertOwnership();
    const e = {
      attempt: binding.attempt,
      inventoryDigest: firstMetadata.inventoryDigest,
      phase: 'registration-backup-intent',
    };
    if (kind === 'owner') e.attempt = '11111111-1111-4111-8111-111111111111';
    if (kind === 'secret') e.config = 'secret';
    await assert.rejects(journal.recordRegistrationEvent(e), /UNPROVEN/);
    assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).registrationEvents, undefined);
  }
});
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
test('normal journal binds inventory to its immutable lock and report ownership proof', async (t) => {
  const directory = await fixture(t);
  const input = { ...metadata, inventoryDigest: '7'.repeat(64) };
  const journal = await acquireReleaseJournal(directory, input);
  t.after(() => journal.close());
  input.inventoryDigest = '8'.repeat(64);
  await journal.bindManifest(manifest);
  assert.equal((await journal.assertOwnership()).inventoryDigest, '7'.repeat(64));
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).inventoryDigest, '7'.repeat(64));
  assert.equal(
    JSON.parse(await fs.readFile(join(directory, 'release.lock'), 'utf8')).inventoryDigest,
    '7'.repeat(64),
  );
});
test('invalid optional normal inventory binding is rejected before creating a lock', async (t) => {
  const directory = await fixture(t);
  for (const inventoryDigest of ['', 'wrong', null]) {
    await assert.rejects(
      acquireReleaseJournal(directory, { ...metadata, inventoryDigest }),
      /JOURNAL_UNPROVEN/,
    );
    assert.deepEqual(await fs.readdir(directory), []);
  }
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
test('a protected first-cutover reservation becomes the actual journal attempt without a fabricated old identity', async (t) => {
  const directory = await fixture(t);
  const attempt = '12345678-1234-4234-8234-123456789abc';
  const journal = await acquireReleaseJournal(directory, { ...firstMetadata, attempt });
  t.after(() => journal.close());
  assert.equal((await journal.assertOwnership()).attempt, attempt);
  assert.equal(journal.path, join(directory, `${attempt}.json`));
  const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(record.attempt, attempt);
  assert.equal(record.oldIdentity, undefined);
});
test('first-cutover reservation cannot overwrite any earlier record even after explicit lock recovery', async (t) => {
  const directory = await fixture(t);
  const attempt = '12345678-1234-4234-8234-123456789abc';
  const path = join(directory, `${attempt}.json`);
  const previous = '{"phase":"migration_started","operator":"inspect-before-recovery"}\n';
  await fs.writeFile(path, previous, { mode: 0o600 });
  await assert.rejects(
    acquireReleaseJournal(directory, { ...firstMetadata, attempt }),
    /JOURNAL_UNPROVEN/,
  );
  assert.equal(await fs.readFile(path, 'utf8'), previous);
});
test('caller-selected attempts are forbidden for normal release and invalid first reservations', async (t) => {
  const directory = await fixture(t);
  for (const input of [
    { ...metadata, attempt: '12345678-1234-4234-8234-123456789abc' },
    { ...firstMetadata, attempt: '../other' },
    { ...firstMetadata, attempt: '' },
    { ...firstMetadata, attempt: null },
  ]) {
    await assert.rejects(acquireReleaseJournal(directory, input), /JOURNAL_UNPROVEN/);
    assert.deepEqual(await fs.readdir(directory), []);
  }
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
    'producers_stopped',
    'all_fenced',
    'stopped',
    'backup_verified',
    'migration_started',
  ]) {
    await journal.persist(phase, detail);
    if (phase === 'backup_verified')
      await journal.bindBackupReceipt(await backupReceiptFor(journal));
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

test('startup journal refuses normal release, wrong phase, foreign binding and arbitrary payload', async (t) => {
  for (const fault of ['normal', 'phase', 'binding', 'payload', 'order']) {
    const directory = await fixture(t);
    const journal = await acquireReleaseJournal(
      directory,
      fault === 'normal' ? metadata : firstMetadata,
    );
    t.after(() => journal.close());
    await journal.bindManifest(manifest);
    if (!['normal', 'phase'].includes(fault))
      for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
        await journal.persist(phase, { candidate: metadata.candidate });
    const b = await journal.assertOwnership();
    const event = {
      phase: 'startup-backup-intent',
      attempt: b.attempt,
      inventoryDigest: b.inventoryDigest,
    };
    if (fault === 'binding') event.inventoryDigest = '0'.repeat(64);
    if (fault === 'payload') event.secret = 'must-not-be-recorded';
    if (fault === 'order') event.phase = 'startup-file-written';
    await assert.rejects(journal.recordStartupEvent(event), /JOURNAL_UNPROVEN/);
    assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).startupEvents, undefined);
  }
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
    'producers_stopped',
    'all_fenced',
    'stopped',
    'backup_verified',
    'migration_started',
  ]) {
    await journal.persist(phase, detail);
    if (phase === 'backup_verified')
      await journal.bindBackupReceipt(await backupReceiptFor(journal));
  }
  await journal.bindBootstrapSeed('5'.repeat(32));
  await journal.persist('candidate_started', detail);
  assert.equal('identity' in JSON.parse(await fs.readFile(journal.path, 'utf8')), false);
  await assert.rejects(journal.persist('verified', detail), /UNPROVEN/);
  await journal.persist('verified', {
    ...detail,
    identity: { candidate: metadata.candidate, bootId: '6'.repeat(32) },
  });
});
