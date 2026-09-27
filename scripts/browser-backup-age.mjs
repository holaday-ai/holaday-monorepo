import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
const guarded =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch {
      throw new Error('CUTOVER_AGE_BACKUP_UNPROVEN');
    }
  };

async function privateDirectory(path) {
  if (!isAbsolute(path) || (await fs.realpath(path)) !== path) throw new Error('path');
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700)
    throw new Error('directory');
  return stat;
}

async function checkedFile(path, privateFile = true) {
  if (!isAbsolute(path) || (await fs.realpath(path)) !== path) throw new Error('path');
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      (privateFile
        ? before.uid !== process.getuid() || (before.mode & 0o7777) !== 0o600
        : ![0, process.getuid()].includes(before.uid) ||
          (before.mode & 0o022) !== 0 ||
          !(before.mode & 0o111))
    )
      throw new Error('file');
    return { handle, before, path };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function unchanged(file) {
  if (!same(file.before, await file.handle.stat()) || !same(file.before, await fs.lstat(file.path)))
    throw new Error('file changed');
}

async function fileHash(file) {
  const buffer = Buffer.alloc(128 * 1024);
  const hash = createHash('sha256');
  let offset = 0;
  for (;;) {
    const { bytesRead } = await file.handle.read(buffer, 0, buffer.length, offset);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  await unchanged(file);
  return hash.digest('hex');
}

async function inspect(profile) {
  if (
    !profile ||
    Object.keys(profile).sort().join(',') !==
      'executable,executableDigest,recipientDigest,recipientFile' ||
    !validHash(profile.executableDigest) ||
    !validHash(profile.recipientDigest)
  )
    throw new Error('profile');
  const executable = await checkedFile(profile.executable, false);
  try {
    if ((await fileHash(executable)) !== profile.executableDigest) throw new Error('executable');
  } finally {
    await executable.handle.close();
  }
  const recipient = await checkedFile(profile.recipientFile);
  try {
    if (recipient.before.size !== 63) throw new Error('recipient size');
    const text = await recipient.handle.readFile('utf8');
    await unchanged(recipient);
    if (
      !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}\n$/.test(text) ||
      sha(text) !== profile.recipientDigest
    )
      throw new Error('recipient');
    return {
      recipient: text.trim(),
      encryptionProfileDigest: sha(
        JSON.stringify({ format: 'age-x25519-v1', recipientDigest: profile.recipientDigest }),
      ),
    };
  } finally {
    await recipient.handle.close();
  }
}

export const inspectAgeBackupFacility = guarded(async (profile) => {
  const { encryptionProfileDigest } = await inspect(profile);
  return { encryptionProfileDigest };
});

async function scope(options) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(options.attempt ?? ''))
    throw new Error('attempt');
  const directory = await privateDirectory(options.directory);
  const facility = await inspect(options.facility);
  return { directory, facility };
}

async function recheck(options, observed) {
  const current = await privateDirectory(options.directory);
  if (
    current.dev !== observed.directory.dev ||
    current.ino !== observed.directory.ino ||
    JSON.stringify(await inspect(options.facility)) !== JSON.stringify(observed.facility)
  )
    throw new Error('scope changed');
}

async function exclusiveOutput(path) {
  try {
    await fs.lstat(path);
    throw new Error('already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return fs.open(
    `${path}.partial`,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
}

async function publish(output, path, directory) {
  await output.sync();
  const before = await output.stat();
  if (
    before.size === 0 ||
    before.nlink !== 1 ||
    before.uid !== process.getuid() ||
    (before.mode & 0o7777) !== 0o600 ||
    !same(before, await fs.lstat(`${path}.partial`))
  )
    throw new Error('output changed');
  // link is no-replace, unlike rename. Only our successful partial is unlinked.
  await fs.link(`${path}.partial`, path);
  await fs.unlink(`${path}.partial`);
  const folder = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

async function ageProcess(executable, args, output, input, identity, producer) {
  const child = spawn(executable, args, {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    stdio: [
      input ? input.handle.fd : 'pipe',
      output.fd,
      'ignore',
      ...(identity ? [identity.handle.fd] : []),
    ],
  });
  child.stdin?.on('error', () => {}); // Pipeline/exit errors below are authoritative.
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('age failed'))));
  });
  try {
    await Promise.all([
      exited,
      producer
        ? Promise.resolve().then(async () => {
            await producer(child.stdin);
            if (!child.stdin.writableEnded) child.stdin.end();
          })
        : Promise.resolve(),
    ]);
  } catch (error) {
    // Only the helper spawned here is terminated, never mysqldump or a service.
    child.stdin?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited.catch(() => {});
    throw error;
  }
}

/** Host primitive, not stop-writer evidence or a deploy entrypoint. The trusted
 * producer must await BOTH stream completion AND its source process exit status.
 * It receives only age stdin. No plaintext file, keys, retry or backup receipt.
 */
export const encryptAgeBackup = guarded(async (options, producer) => {
  if (typeof producer !== 'function') throw new Error('producer required');
  const observed = await scope(options);
  const reference = join(options.directory, `${options.attempt}.sql.age`);
  const output = await exclusiveOutput(reference);
  try {
    await ageProcess(
      options.facility.executable,
      ['--encrypt', '--recipient', observed.facility.recipient],
      output,
      null,
      null,
      producer,
    );
    await recheck(options, observed);
    await publish(output, reference, options.directory);
    return { reference, encryptionProfileDigest: observed.facility.encryptionProfileDigest };
  } finally {
    await output.close();
  }
});

function checkArtifact(artifact, options, observed) {
  if (
    !artifact ||
    Object.keys(artifact).sort().join(',') !== 'encryptionProfileDigest,reference' ||
    artifact.reference !== join(options.directory, `${options.attempt}.sql.age`) ||
    artifact.encryptionProfileDigest !== observed.facility.encryptionProfileDigest
  )
    throw new Error('artifact');
}

export const hashAgeBackupArtifact = guarded(async (artifact, options) => {
  const observed = await scope(options);
  checkArtifact(artifact, options, observed);
  const file = await checkedFile(artifact.reference);
  try {
    return await fileHash(file);
  } finally {
    await file.handle.close();
  }
});

/** Ciphertext-only source for the authenticated SSH channel. The destination
 * must wait for both stream EOF AND this function/process to finish successfully.
 * No private key or SQL is read. Does not end the caller-owned destination.
 */
export const streamAgeBackupArtifact = guarded(
  async (artifact, options, expectedBackupDigest, expectedBytes, sink) => {
    if (
      !validHash(expectedBackupDigest) ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes <= 0
    )
      throw new Error('transfer binding');
    const observed = await scope(options);
    checkArtifact(artifact, options, observed);
    const input = await checkedFile(artifact.reference);
    try {
      if (input.before.size !== expectedBytes || (await fileHash(input)) !== expectedBackupDigest)
        throw new Error('source binding');
      await pipeline(
        input.handle.createReadStream({ start: 0, end: expectedBytes - 1, autoClose: false }),
        sink,
        { end: false },
      );
      if ((await fileHash(input)) !== expectedBackupDigest) throw new Error('source changed');
      await recheck(options, observed);
    } finally {
      await input.handle.close();
    }
  },
);

/** Recovery-machine receipt of one exact encrypted artifact. The producer is a
 * trusted transport, not a success report: await its process exit even after EOF.
 * Failure retains a private partial, never overwrites/retries an earlier attempt,
 * and never returns a path accepted by decryption. No SQL consumer is involved.
 */
export const receiveAgeBackup = guarded(async (options, producer) => {
  if (
    typeof producer !== 'function' ||
    !validHash(options.expectedBackupDigest) ||
    !Number.isSafeInteger(options.expectedBytes) ||
    options.expectedBytes <= 0
  )
    throw new Error('transfer binding');
  const observed = await scope(options);
  const reference = join(options.directory, `${options.attempt}.sql.age`);
  const output = await exclusiveOutput(reference);
  let received = 0;
  const sink = new Writable({
    write(chunk, _encoding, next) {
      (async () => {
        if (received + chunk.length > options.expectedBytes) throw new Error('oversized');
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
          if (bytesWritten < 1) throw new Error('short write');
          offset += bytesWritten;
        }
        received += chunk.length;
      })().then(() => next(), next);
    },
  });
  const complete = finished(sink, { cleanup: true });
  try {
    await Promise.all([
      complete,
      Promise.resolve().then(async () => {
        await producer(sink);
        if (!sink.writableEnded) sink.end();
      }),
    ]);
    if (received !== options.expectedBytes) throw new Error('short transfer');
    const receivedFile = await checkedFile(`${reference}.partial`);
    try {
      if (
        !same(receivedFile.before, await output.stat()) ||
        (await fileHash(receivedFile)) !== options.expectedBackupDigest
      )
        throw new Error('received checksum');
    } finally {
      await receivedFile.handle.close();
    }
    await recheck(options, observed);
    await publish(output, reference, options.directory);
    return { reference, encryptionProfileDigest: observed.facility.encryptionProfileDigest };
  } catch (error) {
    sink.destroy();
    await complete.catch(() => {});
    throw error;
  } finally {
    await output.close();
  }
});

/** Run on the designated recovery machine, NEVER the production database host.
 * No SQL consumer receives data until authenticated EOF and checksum rechecks.
 * A failure retains a private .partial for operator review, never a verified path.
 * Caller still must prove isolation, import into the exact owned target, compare
 * all objects/data, migrate and seal the existing coordinator's final receipt.
 */
export const decryptAgeBackupToFile = guarded(async (options) => {
  if (!validHash(options.expectedBackupDigest)) throw new Error('digest');
  const observed = await scope(options);
  checkArtifact(options.artifact, options, observed);
  const input = await checkedFile(options.artifact.reference);
  let identity;
  let output;
  try {
    if ((await fileHash(input)) !== options.expectedBackupDigest) throw new Error('checksum');
    identity = await checkedFile(options.identityFile);
    if (identity.before.size < 1 || identity.before.size > 4096) throw new Error('identity size');
    const reference = join(options.directory, `${options.attempt}.verified.sql`);
    output = await exclusiveOutput(reference);
    await ageProcess(
      options.facility.executable,
      ['--decrypt', '--identity', '/dev/fd/3'],
      output,
      input,
      identity,
    );
    await unchanged(identity);
    if ((await fileHash(input)) !== options.expectedBackupDigest)
      throw new Error('ciphertext changed');
    await recheck(options, observed);
    await publish(output, reference, options.directory);
    return { reference, backupDigest: options.expectedBackupDigest };
  } finally {
    await output?.close();
    await identity?.handle.close();
    await input.handle.close();
  }
});
