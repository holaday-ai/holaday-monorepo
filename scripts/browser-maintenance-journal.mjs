import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

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
  const inventoryDigest = metadata?.inventoryDigest;
  const inventoryFields = inventoryDigest === undefined ? {} : { inventoryDigest };
  let migrationManifest;
  let bootstrapSeed;
  let currentIdentity;
  const startupEvents = [];
  const registrationEvents = [];
  let registrationPhase;
  const registrationDone = () =>
    registrationEvents.length >= 2 &&
    registrationEvents.length === 2 + registrationEvents[1].registrations.length * 2;
  const startupChanges = () =>
    (startupEvents[1]?.files ?? []).filter((f) => f.beforeDigest !== f.afterDigest).reverse();
  const startupDone = () =>
    startupEvents.length >= 2 && startupEvents.length === 2 + startupChanges().length * 2;
  const first = metadata?.kind === 'first-cutover';
  const reservedAttempt = metadata?.attempt;
  const oldIdentity = metadata?.oldIdentity && { ...metadata.oldIdentity };
  const firstFields = first
    ? {
        kind: 'first-cutover',
        legacyDigest: metadata.legacyDigest,
        inventoryDigest: metadata.inventoryDigest,
      }
    : {};
  if (
    !/^[a-f0-9]{40}$/.test(candidate ?? '') ||
    !/^[a-f0-9]{64}$/.test(configDigest ?? '') ||
    !/^[a-f0-9]{64}$/.test(migrationDigest ?? '') ||
    (inventoryDigest !== undefined && !/^[a-f0-9]{64}$/.test(inventoryDigest ?? '')) ||
    (reservedAttempt !== undefined &&
      (!first ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          reservedAttempt ?? '',
        ))) ||
    (first
      ? oldIdentity !== undefined ||
        !/^[a-f0-9]{64}$/.test(firstFields.legacyDigest ?? '') ||
        !/^[a-f0-9]{64}$/.test(firstFields.inventoryDigest ?? '')
      : metadata?.kind !== undefined || !identityValid(oldIdentity))
  )
    throw unproven();
  // Only the first-cutover root host may supply a reservation from its protected
  // approved manifest. It is a new operation, never permission to resume a lock.
  const attempt = reservedAttempt ?? randomUUID();
  const lockPath = join(directory, 'release.lock');
  const path = join(directory, `${attempt}.json`);
  const binding = {
    attempt,
    candidate,
    configDigest,
    migrationDigest,
    ...inventoryFields,
    ...firstFields,
  };
  const lockBytes = `${JSON.stringify({ ...binding, oldIdentity })}\n`;
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
            ...inventoryFields,
            ...firstFields,
            bootstrapSeed,
            ...(startupEvents.length ? { startupEvents } : {}),
            ...(registrationEvents.length ? { registrationEvents } : {}),
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
    // A reserved attempt must never replace historical evidence, including an
    // interrupted operation whose lock was separately recovered by an operator.
    const reservation = await io.open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      latest = await reservation.stat();
      await reservation.sync();
    } finally {
      await reservation.close();
    }
    await directoryHandle.sync();
    await write('preflight', oldIdentity);
  } catch (error) {
    await close();
    throw error.message === 'MAINTENANCE_RELEASE_LOCKED' ? error : unproven();
  }
  return {
    path,
    assertOwnership: () =>
      serial(async () => {
        await assertOwnership();
        return {
          attempt,
          candidate,
          configDigest,
          migrationDigest,
          ...inventoryFields,
        };
      }),
    bindBootstrapSeed: (seed) =>
      serial(async () => {
        if (
          !first ||
          phase !== 'migration_started' ||
          bootstrapSeed ||
          !/^[a-f0-9]{32}$/.test(seed ?? '')
        )
          throw unproven();
        bootstrapSeed = seed;
        await write(phase);
      }),
    recordRegistrationEvent: (event) => {
      const e = structuredClone(event);
      return serial(async () => {
        if (
          !first ||
          !['producers_stopped', 'all_fenced'].includes(phase) ||
          !migrationManifest ||
          e?.attempt !== attempt ||
          e.inventoryDigest !== inventoryDigest ||
          (registrationPhase !== undefined && registrationPhase !== phase)
        )
          throw unproven();
        const base = { attempt, inventoryDigest };
        if (!registrationEvents.length) {
          if (!isDeepStrictEqual(e, { ...base, phase: 'registration-backup-intent' }))
            throw unproven();
          registrationPhase = phase;
        } else if (registrationEvents.length === 1) {
          if (
            e.phase !== 'registration-backed-up' ||
            Object.keys(e).length !== 5 ||
            !/^[a-f0-9]{64}$/.test(e.backupDigest ?? '') ||
            !Array.isArray(e.registrations) ||
            !e.registrations.length ||
            e.registrations.length > 4 ||
            e.registrations.some(
              (r) =>
                !r ||
                Object.keys(r).length !== 3 ||
                !Number.isSafeInteger(r.pmId) ||
                r.pmId < 0 ||
                ![
                  'holaday-orchestrator',
                  'holaday-account-closure-worker',
                  'holaday-files-cron',
                  'holaday-cn-payment',
                ].includes(r.name) ||
                !/^[a-f0-9]{64}$/.test(r.configDigest ?? ''),
            ) ||
            new Set(e.registrations.map((r) => r.pmId)).size !== e.registrations.length ||
            new Set(e.registrations.map((r) => r.name)).size !== e.registrations.length
          )
            throw unproven();
        } else {
          const registration =
            registrationEvents[1].registrations[Math.floor((registrationEvents.length - 2) / 2)];
          const next =
            registrationEvents.length % 2 === 0
              ? 'registration-delete-intent'
              : 'registration-deleted';
          if (!registration || !isDeepStrictEqual(e, { ...base, ...registration, phase: next }))
            throw unproven();
        }
        registrationEvents.push(e);
        await write(phase, currentIdentity);
      });
    },
    recordStartupEvent: (event) => {
      const e = structuredClone(event);
      return serial(async () => {
        if (
          !first ||
          phase !== 'producers_stopped' ||
          !migrationManifest ||
          e?.attempt !== attempt ||
          e.inventoryDigest !== inventoryDigest
        )
          throw unproven();
        const base = { attempt, inventoryDigest };
        if (startupEvents.length === 0) {
          if (!isDeepStrictEqual(e, { ...base, phase: 'startup-backup-intent' })) throw unproven();
        } else if (startupEvents.length === 1) {
          if (
            e.phase !== 'startup-backed-up' ||
            Object.keys(e).length !== 4 ||
            !Array.isArray(e.files) ||
            e.files.length !== 2 ||
            e.files.some(
              (f, i) =>
                !f ||
                Object.keys(f).length !== 3 ||
                f.path !== `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}` ||
                !(
                  (f.beforeDigest === null && f.afterDigest === null) ||
                  (/^[a-f0-9]{64}$/.test(f.beforeDigest ?? '') &&
                    /^[a-f0-9]{64}$/.test(f.afterDigest ?? ''))
                ),
            ) ||
            !e.files.some((f) => f.beforeDigest !== f.afterDigest)
          )
            throw unproven();
        } else {
          const index = Math.floor((startupEvents.length - 2) / 2);
          const change = startupChanges()[index];
          const next =
            startupEvents.length % 2 === 0 ? 'startup-file-intent' : 'startup-file-written';
          if (!change || !isDeepStrictEqual(e, { ...base, phase: next, ...change }))
            throw unproven();
        }
        startupEvents.push(e);
        await write(phase, currentIdentity);
      });
    },
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
        if (first) {
          if (next === 'all_fenced' && startupEvents.length && !startupDone()) throw unproven();
          if (
            ['all_fenced', 'stopped'].includes(next) &&
            registrationEvents.length &&
            !registrationDone()
          )
            throw unproven();
          const phases = [
            'preflight',
            'prepared',
            'orders_fenced',
            'legacy_settled',
            'producers_stopped',
            'all_fenced',
            'stopped',
            'backup_verified',
            'migration_started',
            'candidate_started',
            'verified',
            'opened',
            'reconciled',
          ];
          const hasBoot = phases.indexOf(next) >= phases.indexOf('candidate_started');
          const startIntent = next === 'candidate_started' && detail?.identity === undefined;
          if (
            phases.indexOf(next) !== phases.indexOf(phase) + 1 ||
            detail?.candidate !== candidate ||
            (hasBoot
              ? !bootstrapSeed ||
                (!startIntent &&
                  (!identityValid(detail.identity) ||
                    detail.identity.candidate !== candidate ||
                    detail.identity.bootId === bootstrapSeed ||
                    (currentIdentity && detail.identity.bootId !== currentIdentity.bootId)))
              : detail.identity !== undefined)
          )
            throw unproven();
          await write(next, detail.identity);
          if (hasBoot && !startIntent) currentIdentity = { ...detail.identity };
          return;
        }
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
        if (phase !== (first ? 'reconciled' : 'opened'))
          throw new Error('MAINTENANCE_RELEASE_NOT_OPENED');
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
