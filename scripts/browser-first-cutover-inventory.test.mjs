import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as firstHost from './browser-first-cutover-host.mjs';
import * as inventory from './browser-first-cutover-inventory.mjs';
import {
  captureLegacyRegistrations,
  captureLegacyRuntime,
} from './browser-first-cutover-runtime.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = 'a'.repeat(64);
function fixture(host = 'vultr') {
  const gateway = host === 'aliyun';
  const cwd = gateway
    ? '/opt/holaday-cn-payment/releases/123456789abc-20260927080000/apps/cn-payment'
    : '/opt/holaday-monorepo/apps/orchestrator';
  const proc = (pid, ppid, path, uids = [0, 0, 0, 0]) => ({
    pid,
    ppid,
    start: String(pid * 100),
    uids,
    exe: gateway ? '/usr/bin/node' : '/opt/node22/bin/node',
    cwd: path,
    argvDigest: hash(pid),
    cgroup: '0::/user.slice',
  });
  const snapshot = {
    observedAtMs: 1000,
    bootId: '11111111-1111-4111-8111-111111111111',
    processes: [
      proc(10, 1, '/root'),
      proc(20, 10, cwd, gateway ? [0, 0, 0, 0] : [998, 998, 998, 998]),
      proc(30, 10, '/root'),
      proc(31, 30, '/root'),
      proc(99, 1, '/root'),
    ],
    managers: [
      {
        pmId: 1,
        name: gateway ? 'holaday-cn-payment' : 'holaday-orchestrator',
        pid: 20,
        status: 'online',
        watch: false,
        configDigest: hash('main'),
      },
      {
        pmId: 2,
        name: 'holaday-chromium-headed',
        pid: 30,
        status: 'online',
        watch: false,
        configDigest: hash('browser'),
      },
      ...(!gateway
        ? [
            {
              pmId: 3,
              name: 'holaday-files-cron',
              pid: 0,
              status: 'stopped',
              watch: false,
              cronRestart: '0 * * * *',
              configDigest: hash('cron'),
            },
          ]
        : []),
    ],
    pm2Runtime: {
      pid: 10,
      version: '6.0.14',
      killSignal: 'SIGINT',
      killTimeoutMs: 1600,
      sourceDigest: hash('pm2 runtime'),
    },
    startup: {
      files: [
        {
          path: '/root/.pm2/dump.pm2',
          present: true,
          digest: createHash('sha256').update('private-environment-never-return').digest('hex'),
          content: 'private-environment-never-return',
        },
      ],
      directories: [],
      pm2Unit: 'ActiveState=active',
    },
    nginxFiles: [],
    systemd: 'pm2-root.service loaded active running PM2\n',
    unitFiles: 'pm2-root.service enabled\n',
    timers: 'n/a n/a n/a n/a system.timer system.service\n',
    cron: '',
    rootCrontabPresent: false,
    listeners: `LISTEN 0 511 0.0.0.0:${gateway ? 4010 : 4001} 0.0.0.0:* users:(("node",pid=20,fd=1))\n`,
  };
  snapshot.observer = structuredClone(snapshot.processes.at(-1));
  const review = {
    processes: snapshot.processes
      .filter((p) => ![10, 99].includes(p.pid))
      .map((p) => ({
        pid: p.pid,
        identityDigest: hash(p),
        disposition: p.pid === 20 ? 'retire' : 'preserve',
        role: p.pid === 20 ? (gateway ? 'gateway' : 'main') : undefined,
        reason: 'reviewed exact process',
      })),
    registrations: snapshot.managers.map((m) => ({
      pmId: m.pmId,
      configDigest: m.configDigest,
      disposition: m.pmId === 2 ? 'preserve' : 'retire',
      reason: 'reviewed exact registration',
    })),
    sources: [],
  };
  return {
    snapshot,
    review,
    host,
    ports: gateway ? [4010, 4011] : [4001, 4002],
    inventoryDigest: digest,
  };
}
function reviewed(f) {
  f.review.sources = inventory
    .firstCutoverSourceBindings(f.snapshot)
    .map((s) => ({ ...s, reason: 'explicit source review' }));
  return f;
}

function pairFixture() {
  const fixtures = ['aliyun', 'vultr'].map((name) => reviewed(fixture(name)));
  return {
    inventoryDigest: digest,
    pair: {
      observedAtMs: 1000,
      sourceDigest: 'b'.repeat(64),
      sourceCandidate: 'c'.repeat(40),
      hosts: fixtures.map((f) => ({
        host: f.host,
        sourceCandidate: f.host === 'vultr' ? 'c'.repeat(40) : null,
        snapshot: f.snapshot,
      })),
    },
    reviews: Object.fromEntries(
      fixtures.map((f) => [
        f.host,
        {
          bootId: f.snapshot.bootId,
          ports: f.ports,
          review: f.review,
        },
      ]),
    ),
  };
}

async function readLegacy(f, now = 1000) {
  assert.equal(typeof firstHost.readReviewedFirstCutoverLegacySource, 'function');
  return firstHost.readReviewedFirstCutoverLegacySource(
    { inventoryDigest: f.inventoryDigest, reviews: f.reviews },
    { readPair: async () => structuredClone(f.pair), now: () => now },
  );
}

async function retirementFixture(t, setup = () => {}, beforeBaseline = () => {}) {
  const f = pairFixture();
  setup(f);
  const proof = await readLegacy(f);
  const manifest = {
    replaysNumberedSql: true,
    runnerSha256: '1'.repeat(64),
    migrations: [{ name: '0042_core.sql', sha256: '2'.repeat(64) }],
  };
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), 'holaday-retirement-observer-')),
  );
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const journal = await acquireReleaseJournal(directory, {
    kind: 'first-cutover',
    candidate: 'd'.repeat(40),
    configDigest: 'e'.repeat(64),
    migrationDigest: hash(manifest),
    inventoryDigest: f.inventoryDigest,
    legacyDigest: proof.legacyDigest,
  });
  t.after(() => journal.close());
  const binding = await journal.assertOwnership();
  beforeBaseline(f, binding);
  assert.equal(typeof firstHost.createFirstCutoverRetirementObserver, 'function');
  const observer = await firstHost.createFirstCutoverRetirementObserver(
    {
      reviews: f.reviews,
      binding,
      legacyDigest: proof.legacyDigest,
    },
    {
      journal,
      readPair: async () => {
        await f.onRead?.();
        return structuredClone(f.pair);
      },
      readFenceReceipts: async () => structuredClone(f.fences ?? []),
      readExecutionIdentities: async () => structuredClone(f.execution ?? []),
      readCandidateRuntime: async (identity) => {
        await f.onCandidateRead?.();
        assert.deepEqual(identity, f.candidate?.identity);
        return structuredClone(f.candidate);
      },
      now: () => f.now ?? 1000,
    },
  );
  await journal.bindManifest(manifest);
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await journal.persist(phase, { candidate: binding.candidate });
  const remove = async (host = 'vultr', finish = true) => {
    const h = f.pair.hosts.find((h) => h.host === host);
    const m = h.snapshot.managers.find((m) => m.pmId === 1);
    const base = { attempt: binding.attempt, inventoryDigest: binding.inventoryDigest, host };
    const row = { pmId: m.pmId, name: m.name, configDigest: m.configDigest };
    await journal.recordRegistrationEvent({ ...base, phase: 'registration-backup-intent' });
    await journal.recordRegistrationEvent({
      ...base,
      phase: 'registration-backed-up',
      backupDigest: 'f'.repeat(64),
      registrations: [row],
    });
    await journal.recordRegistrationEvent({ ...base, ...row, phase: 'registration-delete-intent' });
    h.snapshot.managers = h.snapshot.managers.filter((m) => m.pmId !== 1);
    h.snapshot.processes = h.snapshot.processes.filter((p) => p.pid !== 20);
    h.snapshot.listeners = '';
    if (finish)
      await journal.recordRegistrationEvent({ ...base, ...row, phase: 'registration-deleted' });
    return { h, base, row };
  };
  return { f, journal, binding, observer, remove };
}

function addReceiver(f, binding) {
  const snapshot = f.pair.hosts.find((h) => h.host === 'aliyun').snapshot;
  const process = {
    pid: 910,
    ppid: 900,
    start: '100',
    uids: [0, 0, 0, 0],
    exe: '/usr/bin/node',
    cwd: '/',
    argvDigest: '8'.repeat(64),
    cgroup: '0::/qa\n',
  };
  snapshot.processes.push(process);
  f.execution = [
    {
      host: 'aliyun',
      binding,
      siteDigest: '9'.repeat(64),
      role: 'gateway',
      bootId: snapshot.bootId,
      process: structuredClone(process),
    },
  ];
  return { snapshot, process, receipt: f.execution[0] };
}

function addTransport(f, binding) {
  const snapshot = f.pair.hosts.find((h) => h.host === 'vultr').snapshot;
  const process = {
    pid: 920,
    ppid: 900,
    start: '100',
    uids: [0, 0, 0, 0],
    exe: '/usr/bin/ssh',
    cwd: '/',
    argvDigest: '7'.repeat(64),
    cgroup: '0::/qa\n',
  };
  snapshot.processes.push(process);
  const receipt = {
    host: 'vultr',
    binding,
    siteDigest: '9'.repeat(64),
    role: 'gateway-ssh',
    bootId: snapshot.bootId,
    process: structuredClone(process),
  };
  f.execution = [...(f.execution ?? []), receipt];
  return { snapshot, process, receipt };
}

function addCoordinator(f, binding) {
  const row = addTransport(f, binding);
  row.process.exe = '/opt/node22/bin/node';
  row.receipt.process.exe = row.process.exe;
  row.receipt.role = 'coordinator';
  row.receipt.toolDigest = '6'.repeat(64);
  row.receipt.siteDigest = undefined;
  return row;
}

test('owned coordinator is observed before and after retirement without changing legacy approval', async (t) => {
  const { f, observer, remove } = await retirementFixture(t, undefined, addCoordinator);
  const reviews = structuredClone(f.reviews);
  await remove();
  const actual = await observer.read();
  assert.deepEqual(actual.unknownLaunchers, []);
  assert.deepEqual(
    actual.hosts.find((h) => h.host === 'vultr').executionProcesses.map((p) => p.pid),
    [920],
  );
  assert.deepEqual(f.reviews, reviews);
});

for (const fault of ['source', 'host', 'exe', 'child', 'listener', 'binding']) {
  test(`coordinator classification refuses ${fault}`, async (t) => {
    const { f, binding, observer } = await retirementFixture(t);
    const { snapshot, process, receipt } = addCoordinator(f, structuredClone(binding));
    if (fault === 'source') receipt.toolDigest = undefined;
    if (fault === 'host') receipt.host = 'aliyun';
    if (fault === 'exe') {
      process.exe = '/usr/bin/node';
      receipt.process.exe = process.exe;
    }
    if (fault === 'binding') receipt.binding.candidate = 'f'.repeat(40);
    if (fault === 'child') snapshot.processes.push({ ...process, pid: 921, ppid: 920 });
    if (fault === 'listener')
      snapshot.listeners += 'LISTEN 0 511 0.0.0.0:9999 0.0.0.0:* users:(("node",pid=920,fd=1))\n';
    await assert.rejects(observer.read(), /UNPROVEN/);
  });
}

test('owned persistent SSH is attributed on Vultr before baseline and throughout retirement', async (t) => {
  const { f, observer, remove } = await retirementFixture(t, undefined, addTransport);
  await remove();
  const actual = await observer.read();
  assert.deepEqual(actual.unknownLaunchers, []);
  assert.deepEqual(
    actual.hosts.find((h) => h.host === 'vultr').executionProcesses.map((p) => p.pid),
    [920],
  );
  assert.equal(
    f.reviews.vultr.review.processes.some((p) => p.pid === 920),
    false,
  );
});

for (const fault of ['host', 'exe', 'child', 'listener', 'missing', 'parent', 'binding']) {
  test(`persistent SSH classification refuses ${fault} changes`, async (t) => {
    const { f, binding, observer } = await retirementFixture(t);
    const { snapshot, process, receipt } = addTransport(f, structuredClone(binding));
    if (fault === 'host') receipt.host = 'aliyun';
    if (fault === 'exe') {
      process.exe = '/usr/bin/node';
      receipt.process.exe = process.exe;
    }
    if (fault === 'parent') process.ppid++;
    if (fault === 'binding') receipt.binding.candidate = 'f'.repeat(40);
    if (fault === 'child') snapshot.processes.push({ ...process, pid: 921, ppid: 920 });
    if (fault === 'missing') snapshot.processes = snapshot.processes.filter((p) => p.pid !== 920);
    if (fault === 'listener')
      snapshot.listeners += 'LISTEN 0 511 0.0.0.0:9999 0.0.0.0:* users:(("ssh",pid=920,fd=1))\n';
    await assert.rejects(observer.read(), /UNPROVEN/);
  });
}

test('already attached receiver does not invalidate the original approved legacy digest at observer construction', async (t) => {
  const { f, observer, journal } = await retirementFixture(t, undefined, addReceiver);
  const before = await journal.readFirstCutoverEffects();
  const actual = await observer.read();
  assert.deepEqual(actual.unknownLaunchers, []);
  assert.equal(actual.hosts.find((h) => h.host === 'aliyun').executionProcesses[0].pid, 910);
  assert.equal(
    f.reviews.aliyun.review.processes.some((p) => p.pid === 910),
    false,
  );
  assert.deepEqual(await journal.readFirstCutoverEffects(), before);
});

for (const fault of ['attempt', 'candidate', 'drift', 'unowned']) {
  test(`observer baseline refuses ${fault} execution evidence before starting retirement`, async (t) => {
    await assert.rejects(
      retirementFixture(t, undefined, (f, binding) => {
        const { receipt } = addReceiver(f, structuredClone(binding));
        if (fault === 'attempt') receipt.binding.attempt = '22222222-2222-4222-8222-222222222222';
        if (fault === 'candidate') receipt.binding.candidate = 'f'.repeat(40);
        if (fault === 'unowned') f.execution = [];
        if (fault === 'drift')
          f.onRead = () => {
            f.execution = [];
          };
      }),
      /CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN/,
    );
  });
}

test('owned gateway receiver remains visible without changing original legacy reviews or journal binding', async (t) => {
  const { f, binding, observer, journal } = await retirementFixture(t);
  const before = await journal.readFirstCutoverEffects();
  const reviews = structuredClone(f.reviews);
  const { snapshot, process } = addReceiver(f, binding);
  const actual = await observer.read();
  assert.deepEqual(actual.unknownLaunchers, []);
  assert.deepEqual(actual.hosts.find((h) => h.host === 'aliyun').executionProcesses, [process]);
  assert.ok(snapshot.processes.some((p) => p.pid === 910));
  assert.deepEqual(f.reviews, reviews);
  assert.deepEqual(await journal.readFirstCutoverEffects(), before);
  assert.ok(
    !actual.hosts.find((h) => h.host === 'aliyun').preservedProcesses.some((p) => p.pid === 910),
  );
  f.execution = [];
  await assert.rejects(observer.read(), /CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN/);
});

for (const mutation of [
  'boot',
  'attempt',
  'candidate',
  'identity',
  'child',
  'listener',
  'manager',
  'missing',
  'drift',
])
  test(`owned execution receipt rejects ${mutation} without hiding a writer`, async (t) => {
    const { f, binding, observer } = await retirementFixture(t);
    const { snapshot, process, receipt } = addReceiver(f, binding);
    if (mutation === 'boot') receipt.bootId = '22222222-2222-4222-8222-222222222222';
    if (mutation === 'attempt') receipt.binding.attempt = '22222222-2222-4222-8222-222222222222';
    if (mutation === 'candidate') receipt.binding.candidate = 'f'.repeat(40);
    if (mutation === 'identity') process.start = '101';
    if (mutation === 'child') snapshot.processes.push({ ...process, pid: 911, ppid: 910 });
    if (mutation === 'listener')
      snapshot.listeners += 'LISTEN 0 511 0.0.0.0:9999 0.0.0.0:* users:(("node",pid=910,fd=1))\n';
    if (mutation === 'manager') {
      process.ppid = 10;
      receipt.process.ppid = 10;
    }
    if (mutation === 'missing')
      snapshot.processes = snapshot.processes.filter((p) => p.pid !== 910);
    if (mutation === 'drift')
      f.onRead = () => {
        f.execution = [];
      };
    await assert.rejects(observer.read(), /CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN/);
  });

test('original reviewed process cannot be reclassified as a newly owned executor', async (t) => {
  let receipt;
  const { f, binding, observer } = await retirementFixture(t, (f) => {
    const row = addReceiver(f, {});
    receipt = row.receipt;
    f.execution = [];
    f.reviews.aliyun.review.processes.push({
      pid: 910,
      identityDigest: hash(row.process),
      disposition: 'preserve',
      reason: 'original reviewed process',
    });
  });
  f.execution = [{ ...receipt, binding }];
  await assert.rejects(observer.read(), /CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN/);
});

test('retirement observation consumes the real journal and fresh paired state, not pre-retirement reviews', async (t) => {
  const { observer, remove } = await retirementFixture(t);
  await remove('vultr');
  const actual = await observer.read();
  assert.deepEqual(actual.unknownLaunchers, []);
  const v = actual.hosts.find((h) => h.host === 'vultr');
  assert.deepEqual(v.registered.processes, []);
  assert.equal(v.registered.managers.length, 1); // The stopped hourly cron remains registered.
  assert.equal(v.preservedProcesses.length, 2);
  assert.ok(!JSON.stringify(actual).includes('private-environment-never-return'));
});

async function candidateFixture(t, setup = () => {}) {
  const r = await retirementFixture(t, setup);
  await r.remove();
  for (const phase of ['all_fenced', 'stopped', 'backup_verified'])
    await r.journal.persist(phase, { candidate: r.binding.candidate });
  await r.journal.bindBackupReceipt({
    ...r.binding,
    backupDigest: '1'.repeat(64),
    databaseIdentityDigest: '2'.repeat(64),
    isolatedTargetDigest: '3'.repeat(64),
    encryptionProfileDigest: '4'.repeat(64),
    comparisonDigest: '5'.repeat(64),
    schemaDigest: '6'.repeat(64),
    businessDigest: '7'.repeat(64),
    restoredAtMs: 1000,
  });
  await r.journal.persist('migration_started', { candidate: r.binding.candidate });
  await r.journal.bindBootstrapSeed('8'.repeat(32));
  await r.journal.persist('candidate_started', { candidate: r.binding.candidate });
  const s = r.f.pair.hosts[1].snapshot;
  const p = {
    pid: 80,
    ppid: 10,
    start: '8000',
    uids: [998, 998, 998, 998],
    exe: '/opt/node22/bin/node',
    cwd: `/opt/holaday-releases/${r.binding.candidate}/apps/orchestrator`,
    argvDigest: hash('candidate'),
    cgroup: '0::/user.slice',
  };
  s.processes.push(p);
  s.managers.push({
    pmId: 4,
    name: 'holaday-orchestrator',
    pid: 80,
    status: 'online',
    watch: false,
    configDigest: hash('candidate configuration'),
  });
  s.listeners =
    'LISTEN 0 128 127.0.0.1:4001 0.0.0.0:* users:(("node",pid=80,fd=5))\nLISTEN 0 128 127.0.0.1:4002 0.0.0.0:* users:(("node",pid=80,fd=6))';
  const identity = { candidate: r.binding.candidate, bootId: '9'.repeat(32) };
  r.f.candidate = {
    identity,
    mode: 'closed',
    idle: true,
    needsReconciliation: false,
    runtime: {
      identity,
      root: `/opt/holaday-releases/${identity.candidate}`,
      main: { pid: 80, start: '8000', uid: 998, cwd: p.cwd, command: 'main', autorestart: false },
      worker: null,
    },
  };
  return { ...r, identity, snapshot: s };
}

test('candidate observation joins the live controlled runtime without hiding old writers', async (t) => {
  const r = await candidateFixture(t);
  assert.equal(typeof r.observer.readWithCandidate, 'function');
  await assert.rejects(r.observer.read(), /UNPROVEN/);
  const observed = await r.observer.readWithCandidate(r.identity);
  assert.deepEqual(observed.candidate, r.f.candidate);
  assert.deepEqual(observed.unknownLaunchers, []);
  assert.equal(observed.hosts[1].registered.managers.length, 1, 'old stopped cron remains visible');
});

test('candidate observation rejects foreign, changing, orphaned and physically mismatched new runtime', async (t) => {
  for (const mode of [
    'foreign',
    'changed',
    'orphan',
    'pid',
    'uid',
    'port',
    'manager',
    'bootstrap',
    'verified-identity',
  ])
    await t.test(mode, async (t) => {
      const r = await candidateFixture(t);
      assert.equal(typeof r.observer.readWithCandidate, 'function');
      if (mode === 'foreign') r.identity = { ...r.identity, candidate: 'a'.repeat(40) };
      if (mode === 'changed') {
        let calls = 0;
        r.f.onCandidateRead = () => {
          if (calls++) r.f.candidate.runtime.main.start = '9999';
        };
      }
      if (mode === 'orphan') r.snapshot.processes.push({ ...r.snapshot.processes.at(-1), pid: 81 });
      if (mode === 'pid') r.snapshot.processes.at(-1).start = '9000';
      if (mode === 'uid') r.snapshot.processes.at(-1).uids = [0, 0, 0, 0];
      if (mode === 'port') r.snapshot.listeners = r.snapshot.listeners.replace('4002', '4003');
      if (mode === 'manager') r.snapshot.managers.at(-1).pid = 81;
      if (mode === 'bootstrap') {
        r.identity.bootId = '8'.repeat(32);
        r.f.candidate.identity = r.identity;
        r.f.candidate.runtime.identity = r.identity;
      }
      if (mode === 'verified-identity') {
        await r.journal.persist('verified', {
          candidate: r.binding.candidate,
          identity: r.identity,
        });
        r.identity = { ...r.identity, bootId: 'a'.repeat(32) };
        r.f.candidate.identity = r.identity;
        r.f.candidate.runtime.identity = r.identity;
      }
      await assert.rejects(r.observer.readWithCandidate(r.identity), /UNPROVEN/);
    });
});

test('restored ingress requires original bytes, actual serving identity and the same completed owned fence receipt', async (t) => {
  for (const mode of ['success', 'closed', 'other-boot', 'partial', 'wrong-bytes', 'changed-owner'])
    await t.test(mode, async (t) => {
      const r = await candidateFixture(t, ingressFixture);
      const originals = structuredClone(r.f.pair.hosts.map((h) => h.snapshot.nginxFiles));
      installFence(r);
      await r.journal.persist('verified', { candidate: r.binding.candidate, identity: r.identity });
      r.f.candidate.mode = mode === 'closed' ? 'closed' : 'serving';
      r.f.candidate.idle = mode === 'closed';
      r.f.candidate.needsReconciliation = mode !== 'closed';
      for (const [i, f] of r.f.fences.entries()) {
        f.receipt.stage = 'all-writers';
        f.receipt.phase = mode === 'partial' ? 'restoring' : 'restored';
        f.receipt.identity =
          mode === 'other-boot' ? { ...r.identity, bootId: 'a'.repeat(32) } : r.identity;
        r.f.pair.hosts[i].snapshot.nginxFiles = originals[i];
      }
      if (mode === 'wrong-bytes') {
        originals[0][0].content = 'changed';
        originals[0][0].digest = createHash('sha256').update('changed').digest('hex');
      }
      if (mode === 'changed-owner') originals[0][0].uid = 0;
      if (mode === 'success')
        assert.deepEqual((await r.observer.readWithCandidate(r.identity)).unknownLaunchers, []);
      else await assert.rejects(r.observer.readWithCandidate(r.identity), /UNPROVEN/);
    });
});

test('runtime targets carry the observed kernel hostname, not the SSH routing alias', async (t) => {
  const r = await retirementFixture(t, (f) => {
    withUnmanagedGateway(f);
    f.pair.hosts[0].snapshot.hostname = 'iZbp1ActualNodeZ';
  });
  const h = (await r.observer.read()).hosts.find((h) => h.host === 'aliyun');
  assert.equal(h.unmanaged.host, 'iZbp1ActualNodeZ');
  assert.equal(h.unmanaged.processes[0].host, 'iZbp1ActualNodeZ');
  r.f.pair.hosts[0].snapshot.hostname = 'other-machine';
  await assert.rejects(r.observer.read(), /UNPROVEN/);
});

function withUnmanagedGateway(f) {
  const s = f.pair.hosts.find((h) => h.host === 'aliyun').snapshot;
  const p = {
    ...structuredClone(s.processes.find((p) => p.pid === 20)),
    pid: 71,
    ppid: 1,
    start: '7100',
  };
  s.processes.push(p);
  f.reviews.aliyun.review.processes.push({
    pid: p.pid,
    identityDigest: hash(p),
    disposition: 'retire',
    role: 'gateway',
    reason: 'reviewed unmanaged gateway',
  });
}

test('observed unmanaged retirement composes capture, intent, pinned signal, double observation and completion', async (t) => {
  for (const mode of ['success', 'attached-baseline', 'signal-error', 'busy'])
    await t.test(mode, async (t) => {
      const r = await retirementFixture(
        t,
        withUnmanagedGateway,
        mode === 'attached-baseline' ? addReceiver : undefined,
      );
      await r.journal.persist('all_fenced', { candidate: r.binding.candidate });
      await r.journal.persist('stopped', { candidate: r.binding.candidate });
      const s = r.f.pair.hosts.find((h) => h.host === 'aliyun').snapshot;
      let signals = 0;
      let waits = 0;
      const io = {
        verifyFence: async () => ({
          inventoryDigest: r.binding.inventoryDigest,
          stage: 'all-writers',
          unsettledWork: mode === 'busy' ? 1 : 0,
          externalWork: 0,
          producersRunning: 0,
        }),
        sleep: async () => {
          waits++;
        },
        signalPinned: async (p) => {
          signals++;
          assert.equal(p.pid, 71);
          assert.deepEqual(
            (await r.journal.readFirstCutoverEffects()).unmanagedEvents.map((e) => e.phase),
            ['unmanaged-stop-intent'],
          );
          if (mode === 'signal-error') throw new Error('CUTOVER_STOP_UNCERTAIN');
          s.processes = s.processes.filter((row) => row.pid !== p.pid);
        },
      };
      assert.equal(typeof r.observer.retireUnmanaged, 'function');
      if (mode === 'success' || mode === 'attached-baseline') {
        const result = await r.observer.retireUnmanaged({ maintenanceEndsAtMs: 5000 }, io);
        assert.equal(result.phase, 'stopped');
        assert.equal(signals, 1);
        assert.ok(waits >= 1);
        assert.equal((await r.journal.readFirstCutoverEffects()).unmanagedEvents.length, 2);
        assert.deepEqual((await r.observer.read()).unknownLaunchers, []);
      } else {
        await assert.rejects(r.observer.retireUnmanaged({ maintenanceEndsAtMs: 5000 }, io));
        assert.equal(signals, mode === 'busy' ? 0 : 1);
        assert.equal((await r.journal.readFirstCutoverEffects()).unmanagedEvents.length, 1);
        await assert.rejects(r.observer.read(), /UNPROVEN/);
      }
      await assert.rejects(
        r.observer.retireUnmanaged({ maintenanceEndsAtMs: 5000 }, io),
        /UNPROVEN/,
      );
    });
});

test('unmanaged stop progress observes disappearance but strict reads require durable completion', async (t) => {
  const r = await retirementFixture(t, withUnmanagedGateway);
  await r.journal.persist('all_fenced', { candidate: r.binding.candidate });
  await r.journal.persist('stopped', { candidate: r.binding.candidate });
  const s = r.f.pair.hosts.find((h) => h.host === 'aliyun').snapshot;
  const p = s.processes.find((p) => p.pid === 71);
  const base = {
    attempt: r.binding.attempt,
    inventoryDigest: r.binding.inventoryDigest,
    host: 'aliyun',
    targets: [{ pid: 71, identityDigest: hash(p) }],
  };
  assert.equal(typeof r.journal.recordUnmanagedEvent, 'function');
  assert.equal(typeof r.observer.readUnmanagedProgress, 'function');
  await r.journal.recordUnmanagedEvent({ ...base, phase: 'unmanaged-stop-intent' });
  assert.equal((await r.observer.readUnmanagedProgress('aliyun')).inventory.processes.length, 1);
  s.processes = s.processes.filter((p) => p.pid !== 71);
  assert.deepEqual((await r.observer.readUnmanagedProgress('aliyun')).inventory.processes, []);
  await assert.rejects(r.observer.read(), /UNPROVEN/);
  await r.journal.recordUnmanagedEvent({ ...base, phase: 'unmanaged-stopped' });
  assert.deepEqual((await r.observer.read()).unknownLaunchers, []);
  s.processes.push(p);
  await assert.rejects(r.observer.read(), /UNPROVEN/);
});

test('unmanaged progress rejects disappearance without intent, PID reuse, wrong scope and wrong host', async (t) => {
  for (const mode of ['no-intent', 'reused-pid', 'wrong-scope', 'wrong-host'])
    await t.test(mode, async (t) => {
      const r = await retirementFixture(t, withUnmanagedGateway);
      await r.journal.persist('all_fenced', { candidate: r.binding.candidate });
      await r.journal.persist('stopped', { candidate: r.binding.candidate });
      const s = r.f.pair.hosts.find((h) => h.host === 'aliyun').snapshot;
      const p = s.processes.find((p) => p.pid === 71);
      const targets = [
        { pid: 71, identityDigest: mode === 'wrong-scope' ? 'f'.repeat(64) : hash(p) },
      ];
      if (mode !== 'no-intent')
        await r.journal.recordUnmanagedEvent({
          attempt: r.binding.attempt,
          inventoryDigest: r.binding.inventoryDigest,
          host: 'aliyun',
          targets,
          phase: 'unmanaged-stop-intent',
        });
      if (mode === 'reused-pid') p.start = '99999';
      else s.processes = s.processes.filter((p) => p.pid !== 71);
      await assert.rejects(
        r.observer.readUnmanagedProgress(mode === 'wrong-host' ? 'vultr' : 'aliyun'),
        /UNPROVEN/,
      );
    });
});

test('gateway progress follows the real stopped-intent lifecycle, not the previous fencing phase', async (t) => {
  const r = await retirementFixture(t);
  await r.journal.persist('all_fenced', { candidate: r.binding.candidate });
  await r.journal.persist('stopped', { candidate: r.binding.candidate });
  const { base, row } = await r.remove('aliyun', false);
  const progress = await r.observer.readRegistrationProgress('aliyun');
  assert.deepEqual(progress.inventory.processes, []);
  assert.deepEqual(progress.inventory.managers, []);
  await assert.rejects(r.observer.read(), /UNPROVEN/);
  await r.journal.recordRegistrationEvent({ ...base, ...row, phase: 'registration-deleted' });
  assert.deepEqual((await r.observer.read()).unknownLaunchers, []);
});

test('a delete intent alone cannot explain a missing registration or process', async (t) => {
  const { observer, remove } = await retirementFixture(t);
  await remove('vultr', false);
  await assert.rejects(observer.read(), /UNPROVEN/);
});

test('fence progress derives the in-flight host from the owned journal without issuing completion proof', async (t) => {
  for (const host of ['vultr', 'aliyun'])
    await t.test(host, async (t) => {
      const r = await retirementFixture(t);
      if (host === 'aliyun') {
        await r.journal.persist('all_fenced', { candidate: r.binding.candidate });
        await r.journal.persist('stopped', { candidate: r.binding.candidate });
      }
      await r.remove(host, false);
      const value = await r.observer.readFenceProgress();
      assert.equal(value.purpose, 'fence-progress');
      assert.equal(value.pair.hosts.length, 2);
      assert.deepEqual(value.pair.hosts.find((h) => h.host === host).registered.processes, []);
      await assert.rejects(r.observer.read(), /UNPROVEN/);
      r.f.pair.hosts.find((h) => h.host === host).snapshot.cron = 'unreviewed writer';
      await assert.rejects(r.observer.readFenceProgress(), /UNPROVEN/);
    });
});

test('fence progress observes pending unmanaged retirement but cannot erase its unfinished intent', async (t) => {
  const r = await retirementFixture(t, withUnmanagedGateway);
  await r.journal.persist('all_fenced', { candidate: r.binding.candidate });
  await r.journal.persist('stopped', { candidate: r.binding.candidate });
  const s = r.f.pair.hosts.find((h) => h.host === 'aliyun').snapshot;
  const p = s.processes.find((p) => p.pid === 71);
  await r.journal.recordUnmanagedEvent({
    attempt: r.binding.attempt,
    inventoryDigest: r.binding.inventoryDigest,
    host: 'aliyun',
    targets: [{ pid: 71, identityDigest: hash(p) }],
    phase: 'unmanaged-stop-intent',
  });
  assert.equal(
    (await r.observer.readFenceProgress()).pair.hosts.find((h) => h.host === 'aliyun').unmanaged
      .processes.length,
    1,
  );
  s.processes = s.processes.filter((p) => p.pid !== 71);
  s.listeners = '';
  assert.deepEqual(
    (await r.observer.readFenceProgress()).pair.hosts.find((h) => h.host === 'aliyun').unmanaged
      .processes,
    [],
  );
  await assert.rejects(r.observer.read(), /UNPROVEN/);
});

test('registration progress can observe physical deletion before its completion event without issuing completion proof', async (t) => {
  const r = await retirementFixture(t);
  const { base, row } = await r.remove('vultr', false);
  assert.equal(typeof r.observer.readRegistrationProgress, 'function');
  const progress = await r.observer.readRegistrationProgress('vultr');
  assert.equal(progress.purpose, 'registration-progress');
  assert.equal(progress.host, 'vultr');
  assert.deepEqual(progress.inventory.processes, []);
  assert.equal(progress.inventory.managers.length, 1);
  await assert.rejects(r.observer.read(), /UNPROVEN/);
  await r.journal.recordRegistrationEvent({ ...base, ...row, phase: 'registration-deleted' });
  assert.deepEqual((await r.observer.read()).unknownLaunchers, []);
});

test('registration progress cannot explain changes without that host intent, or surviving old processes', async (t) => {
  for (const fault of ['other-host', 'survivor', 'no-intent']) {
    await t.test(fault, async (t) => {
      const r = await retirementFixture(t);
      const original = structuredClone(r.f.pair.hosts[1].snapshot.processes[1]);
      assert.equal(typeof r.observer.readRegistrationProgress, 'function');
      if (fault === 'no-intent') {
        r.f.pair.hosts[1].snapshot.managers = r.f.pair.hosts[1].snapshot.managers.filter(
          (m) => m.pmId !== 1,
        );
        r.f.pair.hosts[1].snapshot.processes = r.f.pair.hosts[1].snapshot.processes.filter(
          (p) => p.pid !== 20,
        );
        r.f.pair.hosts[1].snapshot.listeners = '';
      } else await r.remove('vultr', false);
      if (fault === 'survivor') r.f.pair.hosts[1].snapshot.processes.push(original);
      await assert.rejects(
        r.observer.readRegistrationProgress(fault === 'other-host' ? 'aliyun' : 'vultr'),
        /UNPROVEN/,
      );
    });
  }
});

test('registration progress allows backup intent and pending registrations while returning actual remaining targets', async (t) => {
  const r = await retirementFixture(t);
  assert.equal(typeof r.observer.readRegistrationProgress, 'function');
  const base = {
    attempt: r.binding.attempt,
    inventoryDigest: r.binding.inventoryDigest,
    host: 'vultr',
  };
  await r.journal.recordRegistrationEvent({ ...base, phase: 'registration-backup-intent' });
  const progress = await r.observer.readRegistrationProgress('vultr');
  assert.equal(progress.inventory.processes.length, 1);
  assert.equal(progress.inventory.managers.length, 2);
  await assert.rejects(r.observer.read(), /UNPROVEN/);
});

test('retirement observation never approves respawn, preserved-service loss or changed source bytes', async (t) => {
  for (const kind of ['respawn', 'preserved', 'source', 'daemon', 'other-host', 'stale']) {
    await t.test(kind, async (t) => {
      const { f, observer, remove } = await retirementFixture(t);
      const old = structuredClone(f.pair.hosts.find((h) => h.host === 'vultr').snapshot);
      const { h } = await remove();
      if (kind === 'respawn') h.snapshot.processes.push({ ...old.processes[1], pid: 21 });
      if (kind === 'preserved')
        h.snapshot.processes = h.snapshot.processes.filter((p) => p.pid !== 31);
      if (kind === 'source') h.snapshot.startup.pm2Unit += '\nRestart=always';
      if (kind === 'daemon') h.snapshot.processes[0].start = '99999';
      if (kind === 'other-host')
        f.pair.hosts[0].snapshot.processes = f.pair.hosts[0].snapshot.processes.filter(
          (p) => p.pid !== 20,
        );
      if (kind === 'stale') h.snapshot.observedAtMs = 1001;
      await assert.rejects(observer.read(), /UNPROVEN/);
    });
  }
});

test('retirement observation refuses changed journal bytes and does not silently refresh its baseline', async (t) => {
  const { observer, journal, remove } = await retirementFixture(t);
  await remove();
  const bytes = await fs.readFile(journal.path, 'utf8');
  await fs.writeFile(journal.path, bytes.replace('registration-deleted', 'registration-invented'));
  await assert.rejects(observer.read(), /UNPROVEN/);
});

function startupFixture(f) {
  for (const h of f.pair.hosts) {
    const file = h.snapshot.startup.files[0];
    const stat = {
      dev: 1,
      ino: 100,
      uid: 0,
      gid: 0,
      mode: 0o100600,
      nlink: 1,
      size: Buffer.byteLength(file.content),
      mtimeMs: 10,
      ctimeMs: 10,
    };
    Object.assign(file, { resolved: file.path, stat, link: structuredClone(stat) });
    h.snapshot.startup.files.push({ path: '/root/.pm2/dump.pm2.bak', present: false });
    f.reviews[h.host].review.sources = inventory
      .firstCutoverSourceBindings(h.snapshot)
      .map((s) => ({ ...s, reason: 'reviewed original startup bytes and metadata' }));
  }
}

async function changeStartup(r, finish = true) {
  const h = r.f.pair.hosts.find((h) => h.host === 'vultr');
  const file = h.snapshot.startup.files[0];
  const base = {
    attempt: r.binding.attempt,
    inventoryDigest: r.binding.inventoryDigest,
    host: 'vultr',
  };
  const change = {
    path: file.path,
    beforeDigest: file.digest,
    afterDigest: createHash('sha256').update('[]\n').digest('hex'),
  };
  await r.journal.recordStartupEvent({ ...base, phase: 'startup-backup-intent' });
  await r.journal.recordStartupEvent({
    ...base,
    phase: 'startup-backed-up',
    files: [change, { path: '/root/.pm2/dump.pm2.bak', beforeDigest: null, afterDigest: null }],
  });
  await r.journal.recordStartupEvent({ ...base, ...change, phase: 'startup-file-intent' });
  file.content = '[]\n';
  file.digest = change.afterDigest;
  file.stat = { ...file.stat, ino: 101, size: 3, mtimeMs: 20, ctimeMs: 20 };
  file.link = structuredClone(file.stat);
  if (finish)
    await r.journal.recordStartupEvent({ ...base, ...change, phase: 'startup-file-written' });
  return file;
}

test('completed saved-startup writes explain exact new bytes and safe atomic replacement metadata', async (t) => {
  const r = await retirementFixture(t, startupFixture);
  await changeStartup(r);
  await r.remove();
  const result = await r.observer.read();
  assert.deepEqual(result.unknownLaunchers, []);
  const h = r.f.pair.hosts.find((h) => h.host === 'vultr');
  assert.deepEqual(
    result.hosts.find((h) => h.host === 'vultr').sources,
    inventory.firstCutoverSourceBindings(h.snapshot),
  );
});

test('saved-startup reconciliation rejects intent-only writes, links, unsafe metadata and unexpected bytes', async (t) => {
  for (const kind of [
    'intent',
    'content',
    'mode',
    'owner',
    'link',
    'backup-appeared',
    'other-file',
  ]) {
    await t.test(kind, async (t) => {
      const r = await retirementFixture(t, startupFixture);
      const file = await changeStartup(r, kind !== 'intent');
      const h = r.f.pair.hosts.find((h) => h.host === 'vultr');
      if (kind === 'content') {
        file.content = '[{}]\n';
        file.digest = createHash('sha256').update(file.content).digest('hex');
      }
      if (kind === 'mode') file.stat.mode = file.link.mode = 0o100666;
      if (kind === 'owner') file.stat.uid = file.link.uid = 501;
      if (kind === 'link') file.resolved = '/tmp/elsewhere';
      if (kind === 'backup-appeared')
        h.snapshot.startup.files[1] = { ...file, path: '/root/.pm2/dump.pm2.bak' };
      if (kind === 'other-file')
        h.snapshot.startup.files.push({ path: '/etc/new-startup', present: false });
      await assert.rejects(r.observer.read(), /UNPROVEN/);
    });
  }
});

test('a concurrent journal advance cannot be joined to an older paired observation', async (t) => {
  const r = await retirementFixture(t);
  r.f.onRead = () => r.journal.persist('all_fenced', { candidate: r.binding.candidate });
  await assert.rejects(r.observer.read(), /UNPROVEN/);
});

test('a same-phase backup receipt write invalidates the concurrent observation', async (t) => {
  const r = await retirementFixture(t);
  for (const phase of ['all_fenced', 'stopped', 'backup_verified'])
    await r.journal.persist(phase, { candidate: r.binding.candidate });
  r.f.onRead = () =>
    r.journal.bindBackupReceipt({
      ...r.binding,
      backupDigest: '1'.repeat(64),
      databaseIdentityDigest: '2'.repeat(64),
      isolatedTargetDigest: '3'.repeat(64),
      encryptionProfileDigest: '4'.repeat(64),
      comparisonDigest: '5'.repeat(64),
      schemaDigest: '6'.repeat(64),
      businessDigest: '7'.repeat(64),
      restoredAtMs: 1000,
    });
  await assert.rejects(r.observer.read(), /UNPROVEN/);
});

test('baseline capture refuses a concurrent fence receipt installation', async (t) => {
  await assert.rejects(
    retirementFixture(t, (f) => {
      f.onRead = () => {
        f.fences = [{ host: 'vultr', receipt: { phase: 'installing' } }];
      };
    }),
    /UNPROVEN/,
  );
});

function ingressFixture(f) {
  for (const h of f.pair.hosts) {
    const names =
      h.host === 'vultr' ? ['holaday'] : ['hd-app.orangebench.tech', 'hd-pay.orangebench.tech'];
    h.snapshot.nginxFiles = names.map((name) => ({
      path: `/etc/nginx/sites-enabled/${name}`,
      resolved: `/etc/nginx/sites-available/${name}`,
      uid: 501,
      gid: 501,
      mode: 0o644,
      content: `original ${name}`,
      digest: createHash('sha256').update(`original ${name}`).digest('hex'),
    }));
    f.reviews[h.host].review.sources = inventory
      .firstCutoverSourceBindings(h.snapshot)
      .map((s) => ({ ...s, reason: 'reviewed original nginx include' }));
  }
}
function installFence(r) {
  r.f.fences = r.f.pair.hosts.map((h) => ({
    host: h.host,
    receipt: {
      schemaVersion: 1,
      attempt: r.binding.attempt,
      inventoryDigest: r.binding.inventoryDigest,
      stage: 'orders',
      phase: 'active',
      files: h.snapshot.nginxFiles.map((file) => {
        const name = file.path.split('/').at(-1);
        const originalDigest = file.digest;
        file.content = `maintenance ${name}`;
        file.digest = createHash('sha256').update(file.content).digest('hex');
        file.resolved = `/etc/nginx/holaday-maintenance/${r.binding.attempt}/${name}-${file.digest}.conf`;
        file.uid = file.gid = 0;
        file.mode = 0o600;
        return {
          path: `/etc/nginx/sites-available/${name}`,
          originalDigest,
          backupDigest: originalDigest,
          generatedDigest: file.digest,
        };
      }),
    },
  }));
}

test('owned active fence receipts explain only the exact generated nginx include targets', async (t) => {
  const r = await retirementFixture(t, (f) => {
    startupFixture(f);
    ingressFixture(f);
  });
  installFence(r);
  await changeStartup(r);
  await r.remove();
  const result = await r.observer.read();
  assert.deepEqual(result.unknownLaunchers, []);
  for (const h of result.hosts)
    assert.deepEqual(
      h.sources,
      inventory.firstCutoverSourceBindings(r.f.pair.hosts.find((p) => p.host === h.host).snapshot),
    );
});

test('fence source observations reject foreign, partial and substituted configurations', async (t) => {
  for (const kind of [
    'attempt',
    'inventory',
    'intent',
    'target',
    'bytes',
    'owner',
    'backup',
    'host',
    'missing',
    'extra',
  ]) {
    await t.test(kind, async (t) => {
      const r = await retirementFixture(t, ingressFixture);
      installFence(r);
      const row = r.f.fences[1];
      const file = r.f.pair.hosts[1].snapshot.nginxFiles[0];
      if (kind === 'attempt') row.receipt.attempt = '22222222-2222-4222-8222-222222222222';
      if (kind === 'inventory') row.receipt.inventoryDigest = 'f'.repeat(64);
      if (kind === 'intent') row.receipt.phase = 'installing';
      if (kind === 'target') file.resolved = '/tmp/arbitrary.conf';
      if (kind === 'bytes') {
        file.content = 'wrong';
        file.digest = createHash('sha256').update('wrong').digest('hex');
      }
      if (kind === 'owner') file.uid = 501;
      if (kind === 'backup') row.receipt.files[0].backupDigest = 'f'.repeat(64);
      if (kind === 'host') row.host = 'aliyun';
      if (kind === 'missing') r.f.fences.pop();
      if (kind === 'extra')
        r.f.pair.hosts[1].snapshot.nginxFiles.push({ ...file, path: '/etc/nginx/new.conf' });
      await assert.rejects(r.observer.read(), /UNPROVEN/);
    });
  }
});

test('legacy source identity binds real reviewed scope without exposing host secrets', async () => {
  const f = pairFixture();
  const actual = await readLegacy(f);
  assert.deepEqual(Object.keys(actual).sort(), ['legacyDigest', 'observedAtMs', 'sourceCandidate']);
  assert.equal(actual.sourceCandidate, 'c'.repeat(40));
  assert.equal(actual.observedAtMs, 1000);
  assert.match(actual.legacyDigest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(actual).includes('private-environment-never-return'));
  f.pair.observedAtMs = 1050;
  for (const h of f.pair.hosts) {
    h.snapshot.observedAtMs = 1050;
    h.snapshot.observer.pid = 101;
    h.snapshot.observer.start = '10100';
    h.snapshot.processes[h.snapshot.processes.length - 1] = structuredClone(h.snapshot.observer);
    h.snapshot.processes.reverse();
    h.snapshot.managers.reverse();
  }
  f.pair.hosts.reverse();
  const fresh = await readLegacy(f, 1050);
  assert.equal(
    fresh.legacyDigest,
    actual.legacyDigest,
    'refresh and collector PID must not rebind legacy ownership',
  );
  assert.equal(fresh.observedAtMs, 1050);
});

for (const [name, change] of [
  [
    'unknown launcher',
    (f) => {
      f.reviews.aliyun.review.sources.pop();
    },
  ],
  [
    'old host observation',
    (f) => {
      f.pair.hosts[0].snapshot.observedAtMs = 0;
    },
  ],
  [
    'missing source commit',
    (f) => {
      f.pair.sourceCandidate = undefined;
    },
  ],
  [
    'inconsistent source commit',
    (f) => {
      f.pair.sourceCandidate = 'f'.repeat(40);
    },
  ],
])
  test(`legacy preparation refuses ${name} without producing a source proof`, async () => {
    const f = pairFixture();
    change(f);
    await assert.rejects(readLegacy(f), /CUTOVER_LEGACY_SOURCE_UNPROVEN/);
  });

test('changing a genuinely reviewed source commit changes the legacy binding', async () => {
  const f = pairFixture();
  const before = await readLegacy(f);
  f.pair.sourceCandidate = 'f'.repeat(40);
  f.pair.hosts.find((h) => h.host === 'vultr').sourceCandidate = f.pair.sourceCandidate;
  assert.notEqual((await readLegacy(f)).legacyDigest, before.legacyDigest);
});

test('same PID with reviewed new start time changes legacy binding', async () => {
  const f = pairFixture();
  const before = await readLegacy(f);
  const process = f.pair.hosts[0].snapshot.processes.find((p) => p.pid === 20);
  process.start = '9000';
  f.reviews.aliyun.review.processes.find((p) => p.pid === 20).identityDigest = hash(process);
  assert.notEqual((await readLegacy(f)).legacyDigest, before.legacyDigest);
});

test('two-host classification preserves each host and keeps unresolved sources visible', () => {
  assert.equal(typeof inventory.classifyFirstCutoverHostPair, 'function');
  const f = pairFixture();
  const result = inventory.classifyFirstCutoverHostPair(f, { now: () => 1000 });
  assert.equal(result.observedAtMs, 1000);
  assert.deepEqual(result.unknownLaunchers, []);
  assert.deepEqual(
    result.hosts.map((h) => [h.host, h.registered.processes[0].role]),
    [
      ['aliyun', 'gateway'],
      ['vultr', 'main'],
    ],
  );
  assert.equal(result.hosts[0].preservedProcesses.length, 2);
  assert.equal(result.hosts[1].preservedProcesses.length, 2);
  assert.ok(!JSON.stringify(result).includes('private-environment-never-return'));
  f.reviews.aliyun.review.sources.pop();
  const unknown = inventory.classifyFirstCutoverHostPair(f, { now: () => 1000 });
  assert.equal(unknown.unknownLaunchers.length, 1);
  assert.equal(unknown.unknownLaunchers[0].host, 'aliyun');
  assert.equal(unknown.unknownLaunchers[0].kind, 'source');
});

for (const [name, change] of [
  [
    'one host missing',
    (f) => {
      f.pair.hosts.pop();
    },
  ],
  [
    'duplicate host',
    (f) => {
      f.pair.hosts[1] = f.pair.hosts[0];
    },
  ],
  [
    'extra host',
    (f) => {
      f.pair.hosts.push(f.pair.hosts[0]);
    },
  ],
  [
    'wrong boot binding',
    (f) => {
      f.reviews.vultr.bootId = '22222222-2222-4222-8222-222222222222';
    },
  ],
  [
    'missing review',
    (f) => {
      f.reviews = { vultr: f.reviews.vultr };
    },
  ],
  [
    'extra review',
    (f) => {
      f.reviews.unrelated = f.reviews.aliyun;
    },
  ],
  [
    'concealed stale host',
    (f) => {
      f.pair.hosts[0].snapshot.observedAtMs = -61000;
    },
  ],
  [
    'invented observation time',
    (f) => {
      f.pair.observedAtMs = 1001;
    },
  ],
  [
    'unbound observer source',
    (f) => {
      f.pair.sourceDigest = undefined;
    },
  ],
]) {
  test(`two-host classification refuses ${name}`, () => {
    assert.equal(typeof inventory.classifyFirstCutoverHostPair, 'function');
    const f = pairFixture();
    change(f);
    assert.throws(
      () => inventory.classifyFirstCutoverHostPair(f, { now: () => 1000 }),
      /CUTOVER_INVENTORY_UNPROVEN/,
    );
  });
}

test('reversing transport order does not exchange host reviews', () => {
  assert.equal(typeof inventory.classifyFirstCutoverHostPair, 'function');
  const f = pairFixture();
  f.pair.hosts.reverse();
  const result = inventory.classifyFirstCutoverHostPair(f, { now: () => 1000 });
  assert.deepEqual(
    result.hosts.map((h) => h.host),
    ['aliyun', 'vultr'],
  );
});
const classify = (f) => inventory.classifyFirstCutoverHost(f, { now: () => 1000 });

test('registered main and stopped cron feed the existing retirement capture; browser tree remains preserved', async () => {
  assert.equal(typeof inventory.classifyFirstCutoverHost, 'function');
  const result = classify(reviewed(fixture()));
  assert.deepEqual(
    result.registered.processes.map((p) => p.pid),
    [20],
  );
  assert.deepEqual(
    result.registered.managers.map((m) => m.rootPid),
    [20, 0],
  );
  assert.deepEqual(
    result.preservedProcesses.map((p) => p.pid),
    [30, 31],
  );
  assert.deepEqual(result.unknownLaunchers, []);
  const c = await captureLegacyRegistrations(
    {
      inventory: result.registered,
      approvedTargets: result.registered.processes,
      approvedRegistrations: result.registered.managers,
    },
    { now: () => 1000 },
  );
  assert.deepEqual(
    c.managers.map((m) => m.name),
    ['holaday-orchestrator', 'holaday-files-cron'],
  );
  assert.equal(JSON.stringify(result).includes('private-environment-never-return'), false);
});
test('managed gateway descendants and unmanaged 4011 stay in distinct complete scopes', async () => {
  const f = fixture('aliyun');
  const parent = f.snapshot.processes.find((p) => p.pid === 20);
  f.snapshot.processes.push({ ...parent, pid: 21, ppid: 20, start: '2100' });
  f.snapshot.processes.push({ ...parent, pid: 40, ppid: 1, start: '4000' });
  for (const pid of [21, 40]) {
    const p = f.snapshot.processes.find((p) => p.pid === pid);
    f.review.processes.push({
      pid,
      identityDigest: hash(p),
      disposition: 'retire',
      role: 'gateway',
      reason: 'observed exact tree',
    });
  }
  f.snapshot.listeners += 'LISTEN 0 511 *:4011 *:* users:(("node",pid=40,fd=2))\n';
  const r = classify(reviewed(f));
  assert.deepEqual(
    r.registered.processes.map((p) => p.pid),
    [20, 21],
  );
  assert.deepEqual(
    r.unmanaged.processes.map((p) => p.pid),
    [40],
  );
  const c = await captureLegacyRuntime(
    { inventory: r.unmanaged, approvedTargets: r.unmanaged.processes },
    { now: () => 1000 },
  );
  assert.equal(c.targets[0].managerIdentity.kind, 'unmanaged');
  await captureLegacyRegistrations(
    {
      inventory: r.registered,
      approvedTargets: r.registered.processes,
      approvedRegistrations: r.registered.managers,
    },
    { now: () => 1000 },
  );
});
for (const change of [
  'new-process',
  'process-drift',
  'registration-drift',
  'new-source',
  'unreviewed-source',
  'unknown-listener',
  'browser-retirement',
  'main-preserved',
  'stopped-cron-omitted',
]) {
  test(`${change} retains an explicit unresolved record and blocks retirement`, async () => {
    const f = reviewed(fixture());
    if (change === 'new-process')
      f.snapshot.processes.push({ ...f.snapshot.processes[1], pid: 22 });
    if (change === 'process-drift') f.snapshot.processes[1].argvDigest = 'b'.repeat(64);
    if (change === 'registration-drift') f.snapshot.managers[0].configDigest = 'c'.repeat(64);
    if (change === 'new-source')
      f.snapshot.startup.files.push({
        path: '/etc/cron.d/extra',
        present: true,
        digest: createHash('sha256').update('new command').digest('hex'),
        content: 'new command',
      });
    if (change === 'unreviewed-source') f.review.sources.pop();
    if (change === 'unknown-listener')
      f.snapshot.listeners = 'LISTEN 0 511 *:4001 *:* users:(("node",pid=999,fd=1))\n';
    if (change === 'browser-retirement') f.review.registrations[1].disposition = 'retire';
    if (change === 'main-preserved') f.review.registrations[0].disposition = 'preserve';
    if (change === 'stopped-cron-omitted') f.review.registrations.pop();
    const r = classify(f);
    assert.ok(r.unknownLaunchers.length > 0);
    await assert.rejects(
      captureLegacyRegistrations(
        {
          inventory: r.registered,
          approvedTargets: r.registered.processes,
          approvedRegistrations: r.registered.managers,
        },
        { now: () => 1000 },
      ),
      /CUTOVER_RUNTIME_UNPROVEN/,
    );
  });
}
for (const change of [
  'stale',
  'boot',
  'duplicate-pid',
  'duplicate-manager',
  'observer-spoof',
  'daemon-missing',
]) {
  test(`invalid ${change} input cannot produce an executable inventory`, () => {
    const f = reviewed(fixture());
    if (change === 'stale') f.snapshot.observedAtMs = -60000;
    if (change === 'boot') f.snapshot.bootId = 'invalid';
    if (change === 'duplicate-pid') f.snapshot.processes.push(f.snapshot.processes[0]);
    if (change === 'duplicate-manager') f.snapshot.managers.push(f.snapshot.managers[0]);
    if (change === 'observer-spoof') f.snapshot.observer.start = 'different';
    if (change === 'daemon-missing')
      f.snapshot.processes = f.snapshot.processes.filter((p) => p.pid !== 10);
    assert.throws(() => classify(f), /CUTOVER_INVENTORY_UNPROVEN/);
  });
}
test('timer relative-time display is not launcher identity; a different timer is', () => {
  const f = reviewed(fixture());
  f.snapshot.timers =
    'Mon 2026-09-28 00:00:00 UTC 10h left Sun 2026-09-27 00:00:00 UTC 14h ago system.timer system.service\n';
  assert.deepEqual(classify(f).unknownLaunchers, []);
  f.snapshot.timers += 'n/a n/a n/a n/a other.timer other.service\n';
  assert.ok(classify(f).unknownLaunchers.length > 0);
});
test('a target listener on an unapproved port is not filtered out of the complete scope', () => {
  const f = reviewed(fixture());
  f.snapshot.listeners += 'LISTEN 0 511 *:7777 *:* users:(("node",pid=20,fd=4))\n';
  assert.ok(classify(f).unknownLaunchers.some((row) => row.kind === 'unapproved-port'));
});
test('a missing preserved online root cannot be mistaken for an intact browser', () => {
  const f = reviewed(fixture());
  f.snapshot.processes = f.snapshot.processes.filter((p) => p.pid !== 30);
  f.review.processes = f.review.processes.filter((p) => p.pid !== 30);
  assert.ok(classify(f).unknownLaunchers.some((row) => row.kind === 'manager-root'));
});
test('Aliyun scope must cover both the current and legacy public payment ports', () => {
  const f = reviewed(fixture('aliyun'));
  f.ports = [4010];
  assert.throws(() => classify(f), /CUTOVER_INVENTORY_UNPROVEN/);
});
test('Vultr scope cannot omit the independently listening browser websocket on 4002', () => {
  const f = reviewed(fixture());
  f.ports = [4001];
  assert.throws(() => classify(f), /CUTOVER_INVENTORY_UNPROVEN/);
});
