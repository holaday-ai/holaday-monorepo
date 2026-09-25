import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';

const identityValid = (value) =>
  /^[a-f0-9]{40}$/.test(value?.candidate ?? '') && /^[a-f0-9]{32}$/.test(value?.bootId ?? '');
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;
const unproven = () => new Error('MAINTENANCE_JOURNAL_UNPROVEN');

/** The deployment CLI must first require Linux/root and verify capability.
 * Directory is pre-provisioned private storage, never a checkout. A crash or
 * failed attempt retains release.lock; there is deliberately no steal/reset. */
export async function acquireReleaseJournal(directory, metadata, io = fs) {
  let lock;
  let folder;
  let directoryHandle;
  let closed = false;
  let failed = false;
  let phase = 'preflight';
  let latest;
  let chain = Promise.resolve();
  const candidate = metadata?.candidate;
  const configDigest = metadata?.configDigest;
  const migrationDigest = metadata?.migrationDigest;
  let migrationManifest;
  const oldIdentity = metadata?.oldIdentity;
  if (
    !/^[a-f0-9]{40}$/.test(candidate ?? '') ||
    !/^[a-f0-9]{64}$/.test(configDigest ?? '') ||
    !/^[a-f0-9]{64}$/.test(migrationDigest ?? '') ||
    !identityValid(oldIdentity)
  )
    throw unproven();
  const attempt = randomUUID();
  const lockPath = join(directory, 'release.lock');
  const path = join(directory, `${attempt}.json`);
  const lockBytes = `${JSON.stringify({ attempt, candidate, configDigest, migrationDigest, oldIdentity })}\n`;
  let lockStat;
  const privateFile = (stat) =>
    stat.isFile() &&
    stat.uid === process.getuid() &&
    (stat.mode & 0o7777) === 0o600 &&
    stat.nlink === 1;
  async function assertOwnership() {
    if (closed || failed) throw unproven();
    const currentDirectory = await io.lstat(directory);
    const current = await io.lstat(lockPath);
    if (
      !sameFile(folder, currentDirectory) ||
      !currentDirectory.isDirectory() ||
      (currentDirectory.mode & 0o7777) !== 0o700 ||
      currentDirectory.uid !== process.getuid() ||
      (await io.realpath(directory)) !== directory ||
      !sameFile(lockStat, current) ||
      !privateFile(current)
    )
      throw unproven();
    const bytes = Buffer.alloc(Buffer.byteLength(lockBytes) + 1);
    const { bytesRead } = await lock.read(bytes, 0, bytes.length, 0);
    if (bytes.subarray(0, bytesRead).toString() !== lockBytes) throw unproven();
    if (latest && !sameFile(latest, await io.lstat(path))) throw unproven();
  }
  async function write(next, identity) {
    try {
      await assertOwnership();
      const temp = join(directory, `${attempt}.${randomUUID()}.tmp`);
      const handle = await io.open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(
          `${JSON.stringify({
            schemaVersion: 1,
            attempt,
            candidate,
            configDigest,
            migrationDigest,
            migrationManifest,
            oldIdentity,
            phase: next,
            identity,
          })}\n`,
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await assertOwnership();
      await io.rename(temp, path);
      await directoryHandle.sync();
      latest = await io.lstat(path);
      phase = next;
    } catch {
      failed = true;
      throw unproven();
    }
  }
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await lock?.close();
    } finally {
      await directoryHandle?.close();
    }
  }
  const serial = (fn) => {
    const result = chain.then(fn);
    chain = result.catch(() => {});
    return result;
  };
  try {
    folder = await io.lstat(directory);
    if (
      directory === '/' ||
      !folder.isDirectory() ||
      folder.uid !== process.getuid() ||
      (folder.mode & 0o7777) !== 0o700 ||
      (await io.realpath(directory)) !== directory
    )
      throw unproven();
    directoryHandle = await io.open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      lock = await io.open(
        lockPath,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('MAINTENANCE_RELEASE_LOCKED');
      throw error;
    }
    await lock.writeFile(lockBytes);
    await lock.sync();
    await directoryHandle.sync();
    lockStat = await lock.stat();
    await write('preflight', oldIdentity);
  } catch (error) {
    await close();
    throw error.message === 'MAINTENANCE_RELEASE_LOCKED' ? error : unproven();
  }
  return {
    path,
    bindManifest: (manifest) =>
      serial(async () => {
        const bytes = JSON.stringify(manifest);
        if (
          phase !== 'preflight' ||
          migrationManifest ||
          !bytes ||
          createHash('sha256').update(bytes).digest('hex') !== migrationDigest
        )
          throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
        migrationManifest = JSON.parse(bytes);
        await write('preflight', oldIdentity);
      }),
    persist: (next, detail) =>
      serial(async () => {
        if (!migrationManifest) throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
        if (
          ![
            'closed',
            'stopped',
            'migration_started',
            'candidate_started',
            'verified',
            'opened',
          ].includes(next) ||
          detail?.candidate !== candidate ||
          !identityValid(detail.identity) ||
          ![oldIdentity.candidate, candidate].includes(detail.identity.candidate)
        )
          throw unproven();
        await write(next, detail.identity);
      }),
    finish: () =>
      serial(async () => {
        if (phase !== 'opened') throw new Error('MAINTENANCE_RELEASE_NOT_OPENED');
        try {
          await assertOwnership();
          await io.unlink(lockPath);
          await directoryHandle.sync();
        } catch {
          failed = true;
          throw unproven();
        } finally {
          await close();
        }
      }),
    // Close handles, not the persisted lock. Caller may report uncertainty only.
    close: () => serial(close),
  };
}
