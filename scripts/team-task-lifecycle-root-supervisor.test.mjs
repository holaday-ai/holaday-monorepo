import assert from 'node:assert/strict';
import {
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ROOT_SUPERVISOR_MARKER,
  claimLifecycleCanaryPrepareReceipt,
  discoverLifecycleCanaryChildIdentityFromProc,
  lifecycleCanaryProcessGroupStateFromProc,
  parseLinuxProcessIdentity,
  parseLinuxProcessRecord,
  removeLifecycleCanaryClaim,
} from './team-task-lifecycle-root-supervisor.mjs';

const PREPARE_RECEIPT = `${JSON.stringify({
  schemaVersion: 1,
  source: 'holaday-team-task-lifecycle-qa-v1',
  receiptKind: 'prepare',
  revision: 'a'.repeat(40),
  boundaryDigest: 'b'.repeat(64),
  completedAt: '2026-08-31T00:00:00.000Z',
  phaseOne: {
    disabled: { personalProjects: true, teamProjects: true, filePath: true },
    enabled: null,
  },
  checks: {},
})}\n`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'holaday-root-supervisor-'));
  const receiptDirectory = join(root, 'receipt');
  const supervisorDirectory = join(root, 'supervisor');
  mkdirSync(receiptDirectory, { mode: 0o700 });
  mkdirSync(supervisorDirectory, { mode: 0o700 });
  const receiptPath = join(receiptDirectory, 'receipt.json');
  writeFileSync(receiptPath, PREPARE_RECEIPT, { mode: 0o600 });
  return { receiptPath, receiptDirectory, supervisorDirectory };
}

test('atomically claims one owner-only receipt into a root-only supervisor file', () => {
  const input = fixture();
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  const claimedPath = claimLifecycleCanaryPrepareReceipt({
    receiptPath: input.receiptPath,
    supervisorDirectory: input.supervisorDirectory,
    expectedReceiptOwnerUid: uid,
    expectedSupervisorOwnerUid: uid,
    expectedSupervisorOwnerGid: gid,
  });
  assert.equal(lstatSync(claimedPath).mode & 0o777, 0o600);
  assert.equal(readFileSync(claimedPath, 'utf8'), `${ROOT_SUPERVISOR_MARKER}${PREPARE_RECEIPT}`);
  assert.throws(() => lstatSync(input.receiptPath));
});

test('durably rejects a retained prepare receipt for the same revision and boundary', () => {
  const input = fixture();
  const retainedPath = join(input.receiptDirectory, 'retained.json');
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  copyFileSync(input.receiptPath, retainedPath);
  claimLifecycleCanaryPrepareReceipt({
    receiptPath: input.receiptPath,
    supervisorDirectory: input.supervisorDirectory,
    expectedReceiptOwnerUid: uid,
    expectedSupervisorOwnerUid: uid,
    expectedSupervisorOwnerGid: gid,
  });

  copyFileSync(retainedPath, input.receiptPath);
  assert.throws(
    () =>
      claimLifecycleCanaryPrepareReceipt({
        receiptPath: input.receiptPath,
        supervisorDirectory: input.supervisorDirectory,
        expectedReceiptOwnerUid: uid,
        expectedSupervisorOwnerUid: uid,
        expectedSupervisorOwnerGid: gid,
      }),
    /already consumed/u,
  );
});

test('removes a consumed claim through the root helper boundary', () => {
  const input = fixture();
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  const claimedPath = claimLifecycleCanaryPrepareReceipt({
    receiptPath: input.receiptPath,
    supervisorDirectory: input.supervisorDirectory,
    expectedReceiptOwnerUid: uid,
    expectedSupervisorOwnerUid: uid,
    expectedSupervisorOwnerGid: gid,
  });

  removeLifecycleCanaryClaim({
    claimedPath,
    supervisorDirectory: input.supervisorDirectory,
    expectedSupervisorOwnerUid: uid,
  });
  assert.throws(() => lstatSync(claimedPath));
});

test('binds a Linux process identity to its PID, process group, session, and start time', () => {
  const stat =
    '4242 (team canary child) S 1 4242 4242 0 -1 4194304 1 2 3 4 5 6 7 8 9 10 11 12 987654 13 14';
  assert.equal(parseLinuxProcessIdentity(stat, 4242), '4242:4242:4242:987654');
  assert.throws(
    () =>
      parseLinuxProcessIdentity(
        '4242 (reused) S 1 4242 4242 0 -1 4194304 1 2 3 4 5 6 7 8 9 10 11 12 999999',
        4243,
      ),
    /invalid canary process identity/u,
  );
});

test('discovers exactly one session leader owned by the setsid supervisor', () => {
  const stat =
    '5252 (team canary child) S 5151 5252 5252 0 -1 4194304 1 2 3 4 5 6 7 8 9 10 11 12 123456 13 14';
  assert.deepEqual(parseLinuxProcessRecord(stat, 5252), {
    pid: 5252,
    state: 'S',
    parentPid: 5151,
    processGroupId: 5252,
    sessionId: 5252,
    startTimeTicks: '123456',
  });
  assert.equal(
    discoverLifecycleCanaryChildIdentityFromProc({
      supervisorPid: 5151,
      childrenContents: '5252\n',
      childStatContents: stat,
    }),
    '5252:5252:5252:123456',
  );
  assert.throws(
    () =>
      discoverLifecycleCanaryChildIdentityFromProc({
        supervisorPid: 5151,
        childrenContents: '5252 5253\n',
        childStatContents: stat,
      }),
    /invalid canary supervisor children/u,
  );
});

test('tracks a canary group after its leader exits and rejects leader PID reuse', () => {
  const identity = '5252:5252:5252:123456';
  const leader =
    '5252 (leader) S 5151 5252 5252 0 -1 4194304 1 2 3 4 5 6 7 8 9 10 11 12 123456 13 14';
  const grandchild =
    '5253 (grandchild) S 1 5252 5252 0 -1 4194304 1 2 3 4 5 6 7 8 9 10 11 12 123457 13 14';
  const reusedLeader =
    '5252 (reused) S 1 5252 5252 0 -1 4194304 1 2 3 4 5 6 7 8 9 10 11 12 999999 13 14';

  assert.equal(lifecycleCanaryProcessGroupStateFromProc(identity, [leader, grandchild]), 'active');
  assert.equal(lifecycleCanaryProcessGroupStateFromProc(identity, [grandchild]), 'active');
  assert.equal(lifecycleCanaryProcessGroupStateFromProc(identity, []), 'empty');
  assert.equal(lifecycleCanaryProcessGroupStateFromProc(identity, [reusedLeader]), 'reused');
});

test('rejects symlink and hard-link receipt substitution', () => {
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  const symlinkFixture = fixture();
  const target = join(symlinkFixture.receiptDirectory, 'target.json');
  writeFileSync(target, PREPARE_RECEIPT, { mode: 0o600 });
  symlinkSync(target, join(symlinkFixture.receiptDirectory, 'linked.json'));
  assert.throws(() =>
    claimLifecycleCanaryPrepareReceipt({
      receiptPath: join(symlinkFixture.receiptDirectory, 'linked.json'),
      supervisorDirectory: symlinkFixture.supervisorDirectory,
      expectedReceiptOwnerUid: uid,
      expectedSupervisorOwnerUid: uid,
      expectedSupervisorOwnerGid: gid,
    }),
  );

  const hardLinkFixture = fixture();
  linkSync(hardLinkFixture.receiptPath, join(hardLinkFixture.receiptDirectory, 'second.json'));
  assert.throws(() =>
    claimLifecycleCanaryPrepareReceipt({
      receiptPath: hardLinkFixture.receiptPath,
      supervisorDirectory: hardLinkFixture.supervisorDirectory,
      expectedReceiptOwnerUid: uid,
      expectedSupervisorOwnerUid: uid,
      expectedSupervisorOwnerGid: gid,
    }),
  );
});
