import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export {
  decryptAgeBackupToFile,
  encryptAgeBackup,
  hashAgeBackupArtifact,
  inspectAgeBackupFacility,
} from './browser-backup-age.mjs';

const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys = (value, names) =>
  value &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const identityValid = (value) =>
  keys(value, ['serverUuid', 'database']) &&
  uuid(value.serverUuid) &&
  typeof value.database === 'string' &&
  /^[a-zA-Z0-9_]{1,64}$/.test(value.database);

/** The fixed backup stage, not a production CLI or a default success adapter.
 * Host I/O must observe identities, prove isolation, export using its approved
 * encrypted facility, restore ONLY to the isolated target, compare ALL objects
 * and data, and persist a private receipt. No booleans, retries, SQL rollback,
 * cleanup or implicit encryption/key generation substitute for those effects.
 * Missing host I/O rejects before export. Failure retains artifacts for review.
 */
export async function backupAndRestoreCheck(input, io) {
  try {
    const { binding, sourceIdentity, isolatedTarget, maintenanceEndsAtMs } = structuredClone(input);
    if (
      !keys(input, ['binding', 'sourceIdentity', 'isolatedTarget', 'maintenanceEndsAtMs']) ||
      !keys(binding, [
        'attempt',
        'candidate',
        'configDigest',
        'migrationDigest',
        'inventoryDigest',
      ]) ||
      !uuid(binding.attempt) ||
      !/^[a-f0-9]{40}$/.test(binding.candidate ?? '') ||
      !['configDigest', 'migrationDigest', 'inventoryDigest'].every((name) =>
        hash(binding[name]),
      ) ||
      !identityValid(sourceIdentity) ||
      !identityValid(isolatedTarget) ||
      isDeepStrictEqual(sourceIdentity, isolatedTarget) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      maintenanceEndsAtMs <= 0 ||
      ![
        'now',
        'assertOwnership',
        'assertWritersStopped',
        'readDatabaseIdentity',
        'inspectBackupFacility',
        'exportDatabase',
        'hashArtifact',
        'restoreIsolated',
        'compareInventoryAndData',
        'runApprovedMigrations',
        'verifySchema',
        'readSourceDigest',
        'sealReceipt',
      ].every((name) => typeof io?.[name] === 'function')
    )
      throw new Error('input');

    let lastTime = -1;
    let facility;
    const clock = () => {
      const now = io.now();
      if (!Number.isSafeInteger(now) || now < 0 || now < lastTime || now >= maintenanceEndsAtMs)
        throw new Error('window');
      lastTime = now;
      return now;
    };
    const context = { binding, sourceIdentity, isolatedTarget, maintenanceEndsAtMs };
    const guard = async () => {
      clock();
      if (!isDeepStrictEqual(await io.assertOwnership(), binding)) throw new Error('ownership');
      await io.assertWritersStopped(structuredClone(context));
      for (const identity of [sourceIdentity, isolatedTarget]) {
        const actual = await io.readDatabaseIdentity(structuredClone(identity));
        if (!isDeepStrictEqual(actual, identity)) throw new Error('database identity');
      }
      const observed = await io.inspectBackupFacility(structuredClone(context));
      if (
        !keys(observed, ['encryptionProfileDigest']) ||
        !hash(observed.encryptionProfileDigest) ||
        (facility && !isDeepStrictEqual(facility, observed))
      )
        throw new Error('facility');
      facility = structuredClone(observed);
      clock(); // Asynchronous checks may have crossed the deadline.
    };
    await guard();
    const artifact = structuredClone(
      await io.exportDatabase(
        structuredClone(sourceIdentity),
        structuredClone({ binding, facility }),
      ),
    );
    if (
      !keys(artifact, ['reference', 'encryptionProfileDigest']) ||
      typeof artifact.reference !== 'string' ||
      !artifact.reference ||
      artifact.reference.length > 4096 ||
      artifact.encryptionProfileDigest !== facility.encryptionProfileDigest
    )
      throw new Error('artifact');
    await guard();
    const backupDigest = await io.hashArtifact(structuredClone(artifact));
    if (!hash(backupDigest)) throw new Error('digest');
    const unchangedArtifact = async () => {
      if ((await io.hashArtifact(structuredClone(artifact))) !== backupDigest)
        throw new Error('artifact changed');
      await guard();
    };
    await unchangedArtifact();
    await io.restoreIsolated(structuredClone(artifact), structuredClone(isolatedTarget));
    await unchangedArtifact();
    const comparison = structuredClone(await io.compareInventoryAndData(structuredClone(context)));
    if (
      !keys(comparison, ['comparisonDigest', 'sourceDigest', 'businessDigest']) ||
      !Object.values(comparison).every(hash)
    )
      throw new Error('comparison');
    await guard();
    await io.runApprovedMigrations(structuredClone(isolatedTarget), binding.migrationDigest);
    await unchangedArtifact();
    const verified = await io.verifySchema(structuredClone(isolatedTarget));
    if (
      !keys(verified, ['schemaDigest', 'businessDigest']) ||
      !hash(verified.schemaDigest) ||
      verified.businessDigest !== comparison.businessDigest
    )
      throw new Error('business drift');
    if ((await io.readSourceDigest(structuredClone(sourceIdentity))) !== comparison.sourceDigest)
      throw new Error('source changed');
    await unchangedArtifact();
    const receipt = {
      ...binding,
      backupDigest,
      databaseIdentityDigest: digest(sourceIdentity),
      isolatedTargetDigest: digest(isolatedTarget),
      encryptionProfileDigest: facility.encryptionProfileDigest,
      comparisonDigest: comparison.comparisonDigest,
      schemaDigest: verified.schemaDigest,
      businessDigest: comparison.businessDigest,
      restoredAtMs: clock(),
    };
    const sealed = await io.sealReceipt(structuredClone(receipt));
    if (!isDeepStrictEqual(sealed, receipt)) throw new Error('receipt');
    await guard();
    return receipt;
  } catch {
    throw new Error('CUTOVER_BACKUP_UNPROVEN');
  }
}
