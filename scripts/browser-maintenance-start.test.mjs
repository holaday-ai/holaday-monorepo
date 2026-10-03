import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyMaintenanceStart } from './browser-maintenance-start.mjs';

const sha = 'a'.repeat(40);
const root = `/opt/holaday-releases/${sha}`;
function fixture() {
  const probes = [];
  return {
    probes,
    input: {
      role: 'main',
      root,
      env: {
        HOLADAY_ORDINARY_MAINTENANCE: '1',
        HOLADAY_ORDINARY_CANDIDATE: sha,
      },
    },
    io: {
      uid: 998,
      markerExists: async () => true,
      realpath: async (path) => path,
      readHead: async (path) => {
        probes.push(['head', path]);
        return sha;
      },
      readRecord: async () => ({
        identity: { candidate: sha, bootId: 'b'.repeat(32) },
        mode: 'closed',
        needsReconciliation: false,
      }),
    },
  };
}

test('main starts only from exact immutable checkout with clean closed marker', async () => {
  const f = fixture();
  assert.equal(await verifyMaintenanceStart(f.input, f.io), 'ordinary');
  assert.deepEqual(f.probes, [['head', root]]);
});
test('worker waits until main is serving rather than exiting immediately during closed boot', async () => {
  const f = fixture();
  f.input.role = 'worker';
  await assert.rejects(verifyMaintenanceStart(f.input, f.io), {
    message: 'MAINTENANCE_WORKER_NOT_SERVING',
  });
  f.io.readRecord = async () => ({
    identity: { candidate: sha, bootId: 'b'.repeat(32) },
    mode: 'serving',
    needsReconciliation: true,
  });
  assert.equal(await verifyMaintenanceStart(f.input, f.io), 'ordinary');
});
test('lost flag, mixed native metadata or partial ordinary metadata cannot use legacy start', async () => {
  for (const env of [
    {},
    { HOLADAY_ORDINARY_CANDIDATE: sha },
    { HOLADAY_ORDINARY_MAINTENANCE: '0' },
    {
      HOLADAY_ORDINARY_MAINTENANCE: '1',
      HOLADAY_ORDINARY_CANDIDATE: sha,
      HOLADAY_POOL_BOOT: 'native',
    },
  ]) {
    const f = fixture();
    f.input.env = env;
    await assert.rejects(verifyMaintenanceStart(f.input, f.io), {
      message: 'MAINTENANCE_START_MODE',
    });
  }
});
test('root identity, symlink checkout or wrong HEAD rejects before launching application', async () => {
  for (const fault of ['uid', 'symlink', 'head']) {
    const f = fixture();
    if (fault === 'uid') f.io.uid = 0;
    if (fault === 'symlink') f.io.realpath = async () => '/opt/holaday-monorepo';
    if (fault === 'head') f.io.readHead = async () => 'c'.repeat(40);
    await assert.rejects(verifyMaintenanceStart(f.input, f.io), {
      message: 'MAINTENANCE_START_IDENTITY',
    });
  }
});
test('dirty, serving or unreadable marker never permits starting replacement main', async () => {
  for (const fault of ['dirty', 'serving', 'read-error']) {
    const f = fixture();
    f.io.readRecord = async () => {
      if (fault === 'read-error') throw new Error('private database password');
      return {
        mode: fault === 'serving' ? 'serving' : 'closed',
        needsReconciliation: fault === 'dirty',
      };
    };
    await assert.rejects(verifyMaintenanceStart(f.input, f.io), {
      message: 'MAINTENANCE_START_STATE',
    });
  }
});
test('legacy/native startup with no ordinary marker or metadata remains unchanged', async () => {
  const f = fixture();
  f.input.env = { HOLADAY_POOL_BOOT: 'native' };
  f.io.markerExists = async () => false;
  assert.equal(await verifyMaintenanceStart(f.input, f.io), 'legacy');
  assert.deepEqual(f.probes, []);
});
