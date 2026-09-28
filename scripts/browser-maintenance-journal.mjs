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
  let latestBytes;
  let chain = Promise.resolve();
  const candidate = metadata?.candidate;
  const configDigest = metadata?.configDigest;
  const migrationDigest = metadata?.migrationDigest;
  const inventoryDigest = metadata?.inventoryDigest;
  const inventoryFields = inventoryDigest === undefined ? {} : { inventoryDigest };
  let migrationManifest;
  let bootstrapSeed;
  let backupReceipt;
  let currentIdentity;
  const startupEvents = [];
  const candidateStartupEvents = [];
  const registrationEvents = [];
  const unmanagedEvents = [];
  const startupBatches = new Map();
  const registrationBatches = new Map();
  let eventHostMode;
  const eventBatch = (event, batches) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw unproven();
    const { host, ...value } = event;
    const mode = host === undefined ? 'local' : 'named';
    if (
      (host !== undefined && !['aliyun', 'vultr'].includes(host)) ||
      (eventHostMode !== undefined && eventHostMode !== mode)
    )
      throw unproven();
    const key = host ?? 'local';
    return { value, mode, key, batch: batches.get(key) ?? { events: [], phase: undefined } };
  };
  const registrationDone = () =>
    [...registrationBatches.values()].every(
      ({ events }) =>
        events.length >= 2 && events.length === 2 + events[1].registrations.length * 2,
    );
  const startupChanges = (events) =>
    (events[1]?.files ?? []).filter((f) => f.beforeDigest !== f.afterDigest).reverse();
  const startupDone = () =>
    [...startupBatches.values()].every(
      ({ events }) => events.length >= 2 && events.length === 2 + startupChanges(events).length * 2,
    );
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
        const bytes = `${JSON.stringify({
          schemaVersion: 1,
          attempt,
          candidate,
          configDigest,
          migrationDigest,
          migrationManifest,
          ...inventoryFields,
          ...firstFields,
          bootstrapSeed,
          ...(backupReceipt ? { backupReceipt } : {}),
          ...(startupEvents.length ? { startupEvents } : {}),
          ...(candidateStartupEvents.length ? { candidateStartupEvents } : {}),
          ...(registrationEvents.length ? { registrationEvents } : {}),
          ...(unmanagedEvents.length ? { unmanagedEvents } : {}),
          oldIdentity,
          phase: next,
          identity,
        })}\n`;
        await handle.writeFile(bytes);
        await handle.sync();
        latestBytes = bytes;
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
    // Observers consume the same live journal, not an uploaded receipt or an
    // in-memory success flag. Intent events remain intents; callers must still
    // reconcile actual processes and source bytes with completed events.
    readFirstCutoverEffects: (options) =>
      serial(async () => {
        let handle;
        try {
          if (
            !first ||
            (options !== undefined &&
              (!isDeepStrictEqual(options, { forBackupRecovery: true }) ||
                phase !== 'backup_verified'))
          )
            throw unproven();
          await assertOwnership();
          handle = await io.open(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          const before = await handle.stat();
          if (
            !privateFile(before) ||
            !sameFile(latest, before) ||
            before.size !== Buffer.byteLength(latestBytes)
          )
            throw unproven();
          const bytes = Buffer.alloc(before.size + 1);
          let length = 0;
          while (length < bytes.length) {
            const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
          }
          const after = await handle.stat();
          const current = await io.lstat(path);
          if (
            length !== before.size ||
            bytes.subarray(0, length).toString() !== latestBytes ||
            !privateFile(after) ||
            !privateFile(current) ||
            !sameFile(before, current) ||
            ['size', 'mtimeMs', 'ctimeMs', 'mode'].some(
              (key) => before[key] !== after[key] || after[key] !== current[key],
            )
          )
            throw unproven();
          await assertOwnership();
          const record = JSON.parse(latestBytes);
          // The original backup coordinator appends its receipt BEFORE its
          // final identity/stop guard. Recovery scope excludes only that owned
          // append; every byte/inode check above still uses the complete file.
          // All other observers retain the original full-record digest.
          const scopeBytes =
            options === undefined
              ? latestBytes
              : JSON.stringify(
                  Object.fromEntries(
                    Object.entries(record).filter(([key]) => key !== 'backupReceipt'),
                  ),
                );
          return {
            recordDigest: createHash('sha256').update(scopeBytes).digest('hex'),
            attempt,
            candidate,
            configDigest,
            migrationDigest,
            inventoryDigest,
            legacyDigest: firstFields.legacyDigest,
            ...(record.identity ? { identity: record.identity } : {}),
            ...(record.bootstrapSeed ? { bootstrapSeed: record.bootstrapSeed } : {}),
            phase: record.phase,
            startupEvents: record.startupEvents ?? [],
            ...(record.candidateStartupEvents
              ? { candidateStartupEvents: record.candidateStartupEvents }
              : {}),
            registrationEvents: record.registrationEvents ?? [],
            unmanagedEvents: record.unmanagedEvents ?? [],
          };
        } catch {
          throw unproven();
        } finally {
          await handle?.close();
        }
      }),
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
    bindBackupReceipt: (value) =>
      serial(async () => {
        const receipt = structuredClone(value);
        const bindings = { attempt, candidate, configDigest, migrationDigest, inventoryDigest };
        const hashes = [
          'backupDigest',
          'databaseIdentityDigest',
          'isolatedTargetDigest',
          'encryptionProfileDigest',
          'comparisonDigest',
          'schemaDigest',
          'businessDigest',
        ];
        const allowed = [...Object.keys(bindings), ...hashes, 'restoredAtMs'];
        if (
          !first ||
          phase !== 'backup_verified' ||
          backupReceipt ||
          !receipt ||
          Object.keys(receipt).length !== allowed.length ||
          !allowed.every((key) => Object.hasOwn(receipt, key)) ||
          !Object.entries(bindings).every(([key, expected]) => receipt[key] === expected) ||
          !hashes.every(
            (key) => typeof receipt[key] === 'string' && /^[a-f0-9]{64}$/.test(receipt[key]),
          ) ||
          receipt.databaseIdentityDigest === receipt.isolatedTargetDigest ||
          !Number.isSafeInteger(receipt.restoredAtMs) ||
          receipt.restoredAtMs < 0
        )
          throw unproven();
        backupReceipt = receipt;
        await write(phase);
        return structuredClone(backupReceipt);
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
    recordUnmanagedEvent: (event) => {
      const e = structuredClone(event);
      return serial(async () => {
        if (
          !first ||
          phase !== 'stopped' ||
          !migrationManifest ||
          eventHostMode === 'local' ||
          e?.host !== 'aliyun' ||
          e.attempt !== attempt ||
          e.inventoryDigest !== inventoryDigest ||
          Object.keys(e).length !== 5 ||
          !Array.isArray(e.targets) ||
          !e.targets.length ||
          e.targets.length > 128 ||
          new Set(e.targets.map((p) => p.pid)).size !== e.targets.length ||
          e.targets.some(
            (p) =>
              !p ||
              Object.keys(p).length !== 2 ||
              !Number.isSafeInteger(p.pid) ||
              p.pid <= 1 ||
              !/^[a-f0-9]{64}$/.test(p.identityDigest ?? ''),
          ) ||
          (unmanagedEvents.length === 0
            ? e.phase !== 'unmanaged-stop-intent'
            : unmanagedEvents.length !== 1 ||
              !isDeepStrictEqual(e, { ...unmanagedEvents[0], phase: 'unmanaged-stopped' }))
        )
          throw unproven();
        eventHostMode = 'named';
        unmanagedEvents.push(e);
        await write(phase, currentIdentity);
      });
    },
    recordRegistrationEvent: (event) => {
      const original = structuredClone(event);
      return serial(async () => {
        const { value: e, key, mode, batch } = eventBatch(original, registrationBatches);
        const events = batch.events;
        if (
          !first ||
          !['producers_stopped', 'all_fenced', 'stopped'].includes(phase) ||
          !migrationManifest ||
          e?.attempt !== attempt ||
          e.inventoryDigest !== inventoryDigest ||
          (batch.phase !== undefined && batch.phase !== phase)
        )
          throw unproven();
        const base = { attempt, inventoryDigest };
        if (!events.length) {
          if (!isDeepStrictEqual(e, { ...base, phase: 'registration-backup-intent' }))
            throw unproven();
        } else if (events.length === 1) {
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
          const registration = events[1].registrations[Math.floor((events.length - 2) / 2)];
          const next =
            events.length % 2 === 0 ? 'registration-delete-intent' : 'registration-deleted';
          if (!registration || !isDeepStrictEqual(e, { ...base, ...registration, phase: next }))
            throw unproven();
        }
        batch.phase = phase;
        events.push(e);
        registrationBatches.set(key, batch);
        eventHostMode = mode;
        registrationEvents.push(original);
        await write(phase, currentIdentity);
      });
    },
    recordStartupEvent: (event) => {
      const original = structuredClone(event);
      return serial(async () => {
        const { value: e, key, mode, batch } = eventBatch(original, startupBatches);
        const events = batch.events;
        if (
          !first ||
          phase !== 'producers_stopped' ||
          !migrationManifest ||
          e?.attempt !== attempt ||
          e.inventoryDigest !== inventoryDigest
        )
          throw unproven();
        const base = { attempt, inventoryDigest };
        if (events.length === 0) {
          if (!isDeepStrictEqual(e, { ...base, phase: 'startup-backup-intent' })) throw unproven();
        } else if (events.length === 1) {
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
          const index = Math.floor((events.length - 2) / 2);
          const change = startupChanges(events)[index];
          const next = events.length % 2 === 0 ? 'startup-file-intent' : 'startup-file-written';
          if (!change || !isDeepStrictEqual(e, { ...base, phase: next, ...change }))
            throw unproven();
        }
        events.push(e);
        startupBatches.set(key, batch);
        eventHostMode = mode;
        startupEvents.push(original);
        await write(phase, currentIdentity);
      });
    },
    recordCandidateStartupEvent: (event) => {
      const e = structuredClone(event);
      return serial(async () => {
        const base = { attempt, inventoryDigest, candidate, bootId: currentIdentity?.bootId };
        if (
          !first ||
          phase !== 'verified' ||
          !identityValid(currentIdentity) ||
          !migrationManifest ||
          !e ||
          !Object.entries(base).every(([k, v]) => e[k] === v)
        )
          throw unproven();
        const events = candidateStartupEvents;
        if (!events.length) {
          if (!isDeepStrictEqual(e, { ...base, phase: 'candidate-startup-backup-intent' }))
            throw unproven();
        } else if (events.length === 1) {
          if (
            !isDeepStrictEqual(
              Object.keys(e).sort(),
              [...Object.keys(base), 'phase', 'files'].sort(),
            ) ||
            e.phase !== 'candidate-startup-backed-up' ||
            !Array.isArray(e.files) ||
            e.files.length !== 2 ||
            e.files.some(
              (f, i) =>
                !f ||
                Object.keys(f).length !== 3 ||
                f.path !== `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}` ||
                !(f.beforeDigest === null || /^[a-f0-9]{64}$/.test(f.beforeDigest ?? '')) ||
                !/^[a-f0-9]{64}$/.test(f.afterDigest ?? '') ||
                f.beforeDigest === f.afterDigest,
            )
          )
            throw unproven();
        } else {
          const file = events[1].files[1 - Math.floor((events.length - 2) / 2)];
          if (
            !file ||
            !isDeepStrictEqual(e, {
              ...base,
              phase:
                events.length % 2 === 0
                  ? 'candidate-startup-file-intent'
                  : 'candidate-startup-file-written',
              ...file,
            })
          )
            throw unproven();
        }
        events.push(e);
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
          if (
            next === 'opened' &&
            candidateStartupEvents.length &&
            candidateStartupEvents.length !== 6
          )
            throw unproven();
          if (next === 'backup_verified' && unmanagedEvents.length === 1) throw unproven();
          if (next === 'migration_started' && !backupReceipt) throw unproven();
          if (next === 'all_fenced' && startupEvents.length && !startupDone()) throw unproven();
          if (
            ['all_fenced', 'stopped', 'backup_verified'].includes(next) &&
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
