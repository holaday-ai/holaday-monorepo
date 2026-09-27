import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  link,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import * as backup from './browser-first-cutover-backup.mjs';

const run = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const age = process.env.CUTOVER_TEST_AGE_EXECUTABLE;

// Actual filesystem and age process; temporary keys only, never the user's key.
// Catch: truncated source accepted, plaintext exposed before authenticated EOF,
// recipient/digest drift, and overwriting an earlier attempt's only backup.
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'holaday-age-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o700);
  const executable = await realpath(age);
  const identityFile = join(directory, 'identity.txt');
  await run(join(dirname(executable), 'age-keygen'), ['-o', identityFile]);
  await chmod(identityFile, 0o600);
  const recipientFile = join(directory, 'recipient.txt');
  const { stdout } = await run(join(dirname(executable), 'age-keygen'), ['-y', identityFile]);
  await writeFile(recipientFile, stdout, { mode: 0o600, flag: 'wx' });
  const facility = {
    executable,
    executableDigest: hash(await readFile(executable)),
    recipientFile,
    recipientDigest: hash(stdout),
  };
  const options = { facility, directory, attempt: randomUUID() };
  const plaintext = Buffer.from('INSERT INTO qa VALUES ("海边", NULL, 4900);\n'.repeat(30000));
  const producer = (sink) =>
    pipeline(Readable.from([plaintext.subarray(0, 777), plaintext.subarray(777)]), sink);
  return { directory, identityFile, options, plaintext, producer };
}

test('age host I/O is exported by the existing backup module', () => {
  for (const method of [
    'inspectAgeBackupFacility',
    'encryptAgeBackup',
    'hashAgeBackupArtifact',
    'decryptAgeBackupToFile',
  ]) {
    assert.equal(typeof backup[method], 'function', `${method} is not implemented`);
  }
});

test(
  'real age backup roundtrip publishes only authenticated private files',
  { skip: !age },
  async (t) => {
    const f = await fixture(t);
    const facility = await backup.inspectAgeBackupFacility(f.options.facility);
    const artifact = await backup.encryptAgeBackup(f.options, f.producer);
    assert.deepEqual(Object.keys(artifact).sort(), ['encryptionProfileDigest', 'reference']);
    assert.equal(artifact.encryptionProfileDigest, facility.encryptionProfileDigest);
    const ciphertext = await readFile(artifact.reference);
    assert.equal(ciphertext.includes(f.plaintext.subarray(0, 80)), false);
    const expectedBackupDigest = hash(ciphertext);
    assert.equal(await backup.hashAgeBackupArtifact(artifact, f.options), expectedBackupDigest);
    const restored = await backup.decryptAgeBackupToFile({
      ...f.options,
      artifact,
      identityFile: f.identityFile,
      expectedBackupDigest,
    });
    assert.deepEqual(await readFile(restored.reference), f.plaintext);
    assert.equal(restored.backupDigest, expectedBackupDigest);
    for (const file of [artifact.reference, restored.reference]) {
      const info = await stat(file);
      assert.equal(info.mode & 0o777, 0o600);
      assert.equal(info.nlink, 1);
    }
    assert.equal(
      (await readdir(f.directory)).some((name) => name.endsWith('.partial')),
      false,
    );
  },
);

test(
  'late producer failure never publishes ciphertext, even after EOF',
  { skip: !age },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      backup.encryptAgeBackup(f.options, async (sink) => {
        await f.producer(sink);
        throw new Error('sensitive upstream diagnostic must not escape');
      }),
      { message: 'CUTOVER_AGE_BACKUP_UNPROVEN' },
    );
    const names = await readdir(f.directory);
    assert(names.includes(`${f.options.attempt}.sql.age.partial`));
    assert(!names.includes(`${f.options.attempt}.sql.age`));
  },
);

test('same attempt cannot overwrite a completed or failed export', { skip: !age }, async (t) => {
  const f = await fixture(t);
  const artifact = await backup.encryptAgeBackup(f.options, f.producer);
  const before = await readFile(artifact.reference);
  let calls = 0;
  await assert.rejects(
    backup.encryptAgeBackup(f.options, () => {
      calls++;
    }),
    /UNPROVEN/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await readFile(artifact.reference), before);
});

test('failed export cannot be retried over its retained partial', { skip: !age }, async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    backup.encryptAgeBackup(f.options, async (sink) => {
      await f.producer(sink);
      throw new Error('dump exit failed');
    }),
    /UNPROVEN/,
  );
  const partial = join(f.directory, `${f.options.attempt}.sql.age.partial`);
  const before = await readFile(partial);
  let calls = 0;
  await assert.rejects(
    backup.encryptAgeBackup(f.options, () => {
      calls++;
    }),
    /UNPROVEN/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await readFile(partial), before);
});

test(
  'output permissions changed during export never produce an accepted artifact',
  { skip: !age },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      backup.encryptAgeBackup(f.options, async (sink) => {
        await f.producer(sink);
        await chmod(join(f.directory, `${f.options.attempt}.sql.age.partial`), 0o644);
      }),
      /UNPROVEN/,
    );
    assert.equal((await readdir(f.directory)).includes(`${f.options.attempt}.sql.age`), false);
  },
);

test(
  'recipient changed while exporting retains the partial without publication',
  { skip: !age },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      backup.encryptAgeBackup(f.options, async (sink) => {
        await f.producer(sink);
        await writeFile(f.options.facility.recipientFile, 'unapproved recipient');
      }),
      /UNPROVEN/,
    );
    assert.equal((await readdir(f.directory)).includes(`${f.options.attempt}.sql.age`), false);
  },
);

for (const fault of [
  'recipient-digest',
  'executable-digest',
  'directory-permission',
  'recipient-symlink',
  'recipient-hardlink',
]) {
  test(`${fault} rejects before starting the plaintext producer`, { skip: !age }, async (t) => {
    const f = await fixture(t);
    if (fault === 'recipient-digest') f.options.facility.recipientDigest = '0'.repeat(64);
    if (fault === 'executable-digest') f.options.facility.executableDigest = '0'.repeat(64);
    if (fault === 'directory-permission') await chmod(f.directory, 0o755);
    if (fault === 'recipient-symlink') {
      await symlink(f.options.facility.recipientFile, join(f.directory, 'link'));
      f.options.facility.recipientFile = join(f.directory, 'link');
    }
    if (fault === 'recipient-hardlink')
      await link(f.options.facility.recipientFile, join(f.directory, 'link'));
    let calls = 0;
    await assert.rejects(
      backup.encryptAgeBackup(f.options, () => {
        calls++;
      }),
      /UNPROVEN/,
    );
    assert.equal(calls, 0);
    assert.equal(
      (await readdir(f.directory)).some((n) => n.endsWith('.sql.age')),
      false,
    );
  });
}

for (const fault of ['checksum', 'authenticated-tail', 'wrong-key', 'repeated-restore']) {
  test(`${fault} never publishes a new verified SQL file`, { skip: !age }, async (t) => {
    const f = await fixture(t);
    const artifact = await backup.encryptAgeBackup(f.options, f.producer);
    let expectedBackupDigest = await backup.hashAgeBackupArtifact(artifact, f.options);
    if (fault === 'checksum') expectedBackupDigest = '0'.repeat(64);
    if (fault === 'authenticated-tail') {
      const corrupted = await readFile(artifact.reference);
      corrupted[corrupted.length - 1] ^= 1;
      await writeFile(artifact.reference, corrupted);
      // Even a self-consistent hash is insufficient: age MUST reject the tail.
      expectedBackupDigest = hash(corrupted);
    }
    if (fault === 'wrong-key') {
      const other = await fixture(t);
      await copyFile(other.identityFile, f.identityFile);
    }
    const options = { ...f.options, artifact, identityFile: f.identityFile, expectedBackupDigest };
    let prior;
    if (fault === 'repeated-restore') prior = await backup.decryptAgeBackupToFile(options);
    await assert.rejects(backup.decryptAgeBackupToFile(options), {
      message: 'CUTOVER_AGE_BACKUP_UNPROVEN',
    });
    const verified = (await readdir(f.directory)).filter((n) => n.endsWith('.verified.sql'));
    assert.equal(verified.length, prior ? 1 : 0);
    if (prior) assert.deepEqual(await readFile(prior.reference), f.plaintext);
  });
}
