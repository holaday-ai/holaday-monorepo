import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as inventory from './browser-first-cutover-inventory.mjs';
import {
  captureLegacyRegistrations,
  captureLegacyRuntime,
} from './browser-first-cutover-runtime.mjs';

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
