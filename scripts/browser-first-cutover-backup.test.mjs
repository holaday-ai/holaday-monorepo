import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as backup from './browser-first-cutover-backup.mjs';
import { performFirstCutover } from './browser-first-cutover-transition.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};
const sourceIdentity = { serverUuid: '11111111-1111-1111-1111-111111111111', database: 'holaday' };
const isolatedTarget = {
  serverUuid: '22222222-2222-2222-2222-222222222222',
  database: 'restore_qa',
};
const input = { binding, sourceIdentity, isolatedTarget, maintenanceEndsAtMs: 2000 };
const artifact = { reference: 'private-backup', encryptionProfileDigest: 'e'.repeat(64) };

// These are trusted host I/O boundaries, NOT a production encryption or database
// adapter. Tests exercise coordinator ordering/rejection, not real restore claims.
function fixture() {
  const events = [];
  let clock = 1000;
  const io = {
    now: () => clock,
    assertOwnership: async () => structuredClone(binding),
    assertWritersStopped: async () => {},
    readDatabaseIdentity: async (target) => structuredClone(target),
    inspectBackupFacility: async () => ({ encryptionProfileDigest: 'e'.repeat(64) }),
    exportDatabase: async (source, scope) => {
      assert.deepEqual(source, sourceIdentity);
      assert.deepEqual(scope.binding, binding);
      events.push('export');
      return structuredClone(artifact);
    },
    hashArtifact: async (value) => {
      assert.deepEqual(value, artifact);
      return 'f'.repeat(64);
    },
    restoreIsolated: async (value, target) => {
      assert.deepEqual(value, artifact);
      assert.deepEqual(target, isolatedTarget);
      events.push('restore');
    },
    compareInventoryAndData: async (scope) => {
      assert.deepEqual(scope.sourceIdentity, sourceIdentity);
      assert.deepEqual(scope.isolatedTarget, isolatedTarget);
      events.push('compare');
      return {
        comparisonDigest: '1'.repeat(64),
        sourceDigest: '2'.repeat(64),
        businessDigest: '3'.repeat(64),
      };
    },
    runApprovedMigrations: async (target, approvedDigest) => {
      assert.deepEqual(target, isolatedTarget);
      assert.equal(approvedDigest, binding.migrationDigest);
      events.push('migrate');
    },
    verifySchema: async (target) => {
      assert.deepEqual(target, isolatedTarget);
      events.push('verify');
      return { schemaDigest: '4'.repeat(64), businessDigest: '3'.repeat(64) };
    },
    readSourceDigest: async (source) => {
      assert.deepEqual(source, sourceIdentity);
      return '2'.repeat(64);
    },
    sealReceipt: async (receipt) => {
      events.push('seal');
      return structuredClone(receipt);
    },
  };
  return {
    io,
    events,
    setTime: (time) => {
      clock = time;
    },
  };
}
const run = (f, value = input) => backup.backupAndRestoreCheck(value, f.io);

test('only a full matching restore and migration yields a bound receipt', async () => {
  const f = fixture();
  const result = await run(f);
  assert.deepEqual(f.events, ['export', 'restore', 'compare', 'migrate', 'verify', 'seal']);
  assert.deepEqual(result, {
    ...binding,
    backupDigest: 'f'.repeat(64),
    databaseIdentityDigest: digest(sourceIdentity),
    isolatedTargetDigest: digest(isolatedTarget),
    encryptionProfileDigest: 'e'.repeat(64),
    comparisonDigest: '1'.repeat(64),
    schemaDigest: '4'.repeat(64),
    businessDigest: '3'.repeat(64),
    restoredAtMs: 1000,
  });
});
for (const method of [
  'assertWritersStopped',
  'inspectBackupFacility',
  'readDatabaseIdentity',
  'assertOwnership',
]) {
  test(`cannot export if ${method} fails`, async () => {
    const f = fixture();
    f.io[method] = async () => {
      throw new Error('private failure');
    };
    await assert.rejects(run(f), /CUTOVER_BACKUP_UNPROVEN/);
    assert.deepEqual(f.events, []);
  });
}
test('same physical database or absent I/O cannot be used as a restore target', async () => {
  const f = fixture();
  await assert.rejects(
    run(f, { ...input, isolatedTarget: sourceIdentity }),
    /CUTOVER_BACKUP_UNPROVEN/,
  );
  f.io.inspectBackupFacility = undefined;
  await assert.rejects(run(f), /CUTOVER_BACKUP_UNPROVEN/);
  assert.deepEqual(f.events, []);
});
for (const kind of [
  'missing encryption',
  'wrong encryption',
  'foreign source',
  'foreign target',
  'lost ownership',
]) {
  test(`rejects ${kind} before export`, async () => {
    const f = fixture();
    if (kind === 'missing encryption') f.io.inspectBackupFacility = async () => ({});
    if (kind === 'wrong encryption')
      f.io.inspectBackupFacility = async () => ({ encryptionProfileDigest: true });
    if (kind.startsWith('foreign'))
      f.io.readDatabaseIdentity = async (target) => {
        const shouldChange =
          kind === 'foreign source'
            ? target.database === sourceIdentity.database
            : target.database === isolatedTarget.database;
        return shouldChange ? { ...target, serverUuid: 'foreign' } : target;
      };
    if (kind === 'lost ownership')
      f.io.assertOwnership = async () => ({ ...binding, candidate: '9'.repeat(40) });
    await assert.rejects(run(f), /CUTOVER_BACKUP_UNPROVEN/);
    assert.deepEqual(f.events, []);
  });
}
for (const kind of [
  'checksum changed',
  'wrong artifact encryption',
  'missing comparison',
  'business changed',
  'source changed',
  'receipt changed',
]) {
  test(`does not accept ${kind}`, async () => {
    const f = fixture();
    let hashes = 0;
    if (kind === 'checksum changed')
      f.io.hashArtifact = async () => (++hashes === 1 ? 'f' : '0').repeat(64);
    if (kind === 'wrong artifact encryption')
      f.io.exportDatabase = async () => ({ ...artifact, encryptionProfileDigest: '9'.repeat(64) });
    if (kind === 'missing comparison')
      f.io.compareInventoryAndData = async () => ({ restored: true });
    if (kind === 'business changed')
      f.io.verifySchema = async () => ({
        schemaDigest: '4'.repeat(64),
        businessDigest: '0'.repeat(64),
      });
    if (kind === 'source changed') f.io.readSourceDigest = async () => '0'.repeat(64);
    if (kind === 'receipt changed') f.io.sealReceipt = async (r) => ({ ...r, attempt: 'foreign' });
    await assert.rejects(run(f), /CUTOVER_BACKUP_UNPROVEN/);
    if (kind !== 'receipt changed') assert.ok(!f.events.includes('seal'));
  });
}
for (const stage of [
  'exportDatabase',
  'restoreIsolated',
  'compareInventoryAndData',
  'runApprovedMigrations',
  'verifySchema',
  'sealReceipt',
]) {
  test(`failure in ${stage} is never retried or rolled back`, async () => {
    const f = fixture();
    let calls = 0;
    f.io[stage] = async () => {
      calls++;
      throw new Error('private detail');
    };
    await assert.rejects(run(f), /CUTOVER_BACKUP_UNPROVEN/);
    assert.equal(calls, 1);
    if (stage !== 'sealReceipt') assert.ok(!f.events.includes('seal'));
  });
}
test('rechecks deadline after asynchronous ownership checks, before exporting', async () => {
  const f = fixture();
  f.io.assertOwnership = async () => {
    f.setTime(2000);
    return binding;
  };
  await assert.rejects(run(f), /CUTOVER_BACKUP_UNPROVEN/);
  assert.deepEqual(f.events, []);
});
test('writer reappearance after restore prevents migrations', async () => {
  const f = fixture();
  f.io.assertWritersStopped = async () => {
    if (f.events.includes('restore')) throw new Error('writer');
  };
  await assert.rejects(run(f), /CUTOVER_BACKUP_UNPROVEN/);
  assert.ok(!f.events.includes('migrate'));
});
test('first-cutover transition keeps maintenance when backup verification refuses', async () => {
  const f = fixture();
  f.io.verifySchema = async () => ({
    schemaDigest: '4'.repeat(64),
    businessDigest: '0'.repeat(64),
  });
  const phases = [];
  const adapter = Object.fromEntries(
    [
      'preflight',
      'stage',
      'fenceOrders',
      'settleLegacy',
      'stopProducers',
      'fenceAll',
      'stopLegacy',
      'initializeState',
      'verify',
      'beforeOpen',
      'afterOpen',
      'resumeWorker',
      'reconcile',
      'close',
      'status',
    ].map((name) => [name, async () => {}]),
  );
  Object.assign(adapter, {
    persist: async (phase) => phases.push(phase),
    backupAndRestoreCheck: () => run(f),
    migrate: async () => assert.fail('production migration must not start'),
    start: async () => assert.fail('candidate must not start'),
    open: async () => assert.fail('must not open'),
    holdMaintenance: async () => ({ closeAcknowledged: false }),
  });
  const result = await performFirstCutover({
    candidate: binding.candidate,
    adapter,
    window: { maintenanceEndsAtMs: 2000, reconcileByMs: 3000, operatorRef: 'qa' },
    clock: () => 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CUTOVER_BACKUP_UNPROVEN');
  assert.equal(result.action, 'hold_maintenance');
  assert.equal(phases.at(-1), 'backup_verified');
});
