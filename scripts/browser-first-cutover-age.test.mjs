import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  link,
  mkdir,
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
    'streamAgeBackupArtifact',
    'receiveAgeBackup',
    'pullFirstCutoverAgeBackup',
  ]) {
    assert.equal(typeof backup[method], 'function', `${method} is not implemented`);
  }
});

// Catch publishing a partial transfer, accepting a different backup, or sending
// plaintext/key material between hosts. Real age and filesystem, no DB/network.
test(
  'ciphertext transfers to a separate private recovery directory before decryption',
  { skip: !age },
  async (t) => {
    const f = await fixture(t);
    const source = await backup.encryptAgeBackup(f.options, f.producer);
    const bytes = await readFile(source.reference);
    const expectedBackupDigest = hash(bytes);
    const destination = join(f.directory, 'recovery');
    await mkdir(destination, { mode: 0o700 });
    const options = {
      ...f.options,
      directory: destination,
      expectedBackupDigest,
      expectedBytes: bytes.length,
    };
    const artifact = await backup.receiveAgeBackup(options, (sink) =>
      backup.streamAgeBackupArtifact(source, f.options, expectedBackupDigest, bytes.length, sink),
    );
    assert.equal(artifact.reference, join(destination, `${f.options.attempt}.sql.age`));
    assert.deepEqual(await readFile(artifact.reference), bytes);
    const restored = await backup.decryptAgeBackupToFile({
      ...options,
      artifact,
      identityFile: f.identityFile,
    });
    assert.deepEqual(await readFile(restored.reference), f.plaintext);
    assert.deepEqual(await readFile(source.reference), bytes);
    assert.equal((await stat(artifact.reference)).mode & 0o777, 0o600);
  },
);

for (const fault of ['short', 'long', 'checksum', 'late-exit']) {
  test(`transfer ${fault} does not publish or overwrite a backup`, { skip: !age }, async (t) => {
    const f = await fixture(t);
    const source = await backup.encryptAgeBackup(f.options, f.producer);
    const bytes = await readFile(source.reference);
    const destination = join(f.directory, 'recovery');
    await mkdir(destination, { mode: 0o700 });
    const options = {
      ...f.options,
      directory: destination,
      expectedBackupDigest: hash(bytes),
      expectedBytes: bytes.length,
    };
    const payload = Buffer.from(bytes);
    if (fault === 'checksum') payload[22] ^= 1;
    const producer = async (sink) => {
      await pipeline(
        Readable.from([
          fault === 'short'
            ? payload.subarray(0, -1)
            : fault === 'long'
              ? Buffer.concat([payload, Buffer.from('!')])
              : payload,
        ]),
        sink,
      );
      if (fault === 'late-exit') throw new Error('private SSH diagnostic');
    };
    await assert.rejects(backup.receiveAgeBackup(options, producer), {
      message: 'CUTOVER_AGE_BACKUP_UNPROVEN',
    });
    assert.deepEqual(await readdir(destination), [`${f.options.attempt}.sql.age.partial`]);
    const partial = await readFile(join(destination, `${f.options.attempt}.sql.age.partial`));
    let calls = 0;
    await assert.rejects(
      backup.receiveAgeBackup(options, () => {
        calls++;
      }),
      /UNPROVEN/,
    );
    assert.equal(calls, 0);
    assert.deepEqual(
      await readFile(join(destination, `${f.options.attempt}.sql.age.partial`)),
      partial,
    );
  });
}

test(
  'source rejects a wrong checksum or size before exposing ciphertext',
  { skip: !age },
  async (t) => {
    const f = await fixture(t);
    const source = await backup.encryptAgeBackup(f.options, f.producer);
    const bytes = await readFile(source.reference);
    for (const [expected, size] of [
      ['0'.repeat(64), bytes.length],
      [hash(bytes), bytes.length + 1],
    ]) {
      const chunks = [];
      const { Writable } = await import('node:stream');
      const sink = new Writable({
        write(chunk, _encoding, next) {
          chunks.push(Buffer.from(chunk));
          next();
        },
      });
      await assert.rejects(
        backup.streamAgeBackupArtifact(source, f.options, expected, size, sink),
        /UNPROVEN/,
      );
      assert.equal(chunks.length, 0);
      sink.end();
    }
  },
);

async function transportFixture(t) {
  const f = await fixture(t);
  const artifact = await backup.encryptAgeBackup(f.options, f.producer);
  const ciphertext = await readFile(artifact.reference);
  const directory = join(f.directory, 'download');
  await mkdir(directory, { mode: 0o700 });
  const input = {
    source: { options: f.options, artifact },
    destination: { ...f.options, directory },
    expectedBackupDigest: hash(ciphertext),
    expectedBytes: ciphertext.length,
  };
  const calls = [];
  const children = [];
  const io = {
    spawn(command, argv, options) {
      calls.push({ command, argv, options });
      // Only external SSH is substituted. Execute the EXACT transmitted source
      // using a real child, private source files and real streams/exit status.
      const child = spawn(process.execPath, ['--input-type=module'], { stdio: options.stdio });
      children.push(child);
      return child;
    },
  };
  return { f, input, ciphertext, calls, children, io };
}

test(
  'fixed SSH download consumes the actual remote reader and preserves exact ciphertext',
  { skip: !age },
  async (t) => {
    const f = await transportFixture(t);
    const result = await backup.pullFirstCutoverAgeBackup(f.input, f.io);
    assert.deepEqual(await readFile(result.reference), f.ciphertext);
    assert.equal(f.calls.length, 1);
    const [{ command, argv, options }] = f.calls;
    assert.equal(command, 'ssh');
    assert.deepEqual(argv.slice(-2), [
      'root@207.148.70.106',
      '/opt/node22/bin/node --input-type=module',
    ]);
    for (const setting of [
      'StrictHostKeyChecking=yes',
      'ForwardAgent=no',
      'ClearAllForwardings=yes',
    ])
      assert(argv.includes(setting));
    assert(
      argv.includes(
        'ProxyCommand=ssh -o StrictHostKeyChecking=yes -o ForwardAgent=no -o ConnectTimeout=15 -W %h:%p root@47.99.169.186',
      ),
    );
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']);
    assert.equal(f.children[0].exitCode, 0);
    const restored = await backup.decryptAgeBackupToFile({
      ...f.input.destination,
      artifact: result,
      identityFile: f.f.identityFile,
      expectedBackupDigest: f.input.expectedBackupDigest,
    });
    assert.deepEqual(await readFile(restored.reference), f.f.plaintext);
  },
);

for (const fault of [
  'different-attempt',
  'different-recipient',
  'private-key-field',
  'extra-host',
]) {
  test(
    `SSH download rejects ${fault} before opening the remote channel`,
    { skip: !age },
    async (t) => {
      const f = await transportFixture(t);
      if (fault === 'different-attempt') f.input.destination.attempt = randomUUID();
      if (fault === 'different-recipient')
        f.input.destination = {
          ...f.input.destination,
          facility: { ...f.input.destination.facility, recipientDigest: '0'.repeat(64) },
        };
      if (fault === 'private-key-field')
        f.input.source.options = { ...f.input.source.options, identityFile: f.f.identityFile };
      if (fault === 'extra-host') f.input.host = 'unapproved.example';
      await assert.rejects(backup.pullFirstCutoverAgeBackup(f.input, f.io), {
        message: 'CUTOVER_BACKUP_TRANSFER_UNPROVEN',
      });
      assert.equal(f.calls.length, 0);
      assert.deepEqual(await readdir(f.input.destination.directory), []);
    },
  );
}

test(
  'remote failure after ciphertext EOF retains partial and is never retried',
  { skip: !age },
  async (t) => {
    const f = await transportFixture(t);
    f.io.readSource = async () =>
      `${await readFile(new URL('./browser-backup-age.mjs', import.meta.url), 'utf8')}\nprocess.once('beforeExit', () => { process.exitCode = 23; });\n`;
    await assert.rejects(backup.pullFirstCutoverAgeBackup(f.input, f.io), {
      message: 'CUTOVER_BACKUP_TRANSFER_UNPROVEN',
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.children[0].exitCode, 23);
    assert.deepEqual(await readdir(f.input.destination.directory), [
      `${f.f.options.attempt}.sql.age.partial`,
    ]);
  },
);

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
