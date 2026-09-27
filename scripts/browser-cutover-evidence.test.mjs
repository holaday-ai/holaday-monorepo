import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectCutoverEvidence,
  publishCutoverEvidence,
  readCutoverDatabaseScope,
  readCutoverHostSnapshot,
  readCutoverNginxSnapshot,
  readCutoverRehearsalArtifacts,
  readCutoverStartupSnapshot,
} from './browser-cutover-evidence.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const merchant = '9'.repeat(64);
function fixture() {
  const inventory = {
    hosts: ['vultr', 'aliyun'],
    configurationDigests: ['a'.repeat(64), 'b'.repeat(64)],
    merchants: [
      {
        provider: 'wechat',
        environment: 'production',
        merchantDigest: merchant,
        codeDigest: '5'.repeat(64),
      },
    ],
    targets: [{ host: 'aliyun', pid: 400, start: '1000', role: 'gateway', ports: [4010, 4011] }],
    ingress: [{ host: 'aliyun', configDigest: 'c'.repeat(64) }],
  };
  const binding = {
    attempt: '11111111-1111-4111-8111-111111111111',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: hash(inventory),
  };
  const order = {
    provider: 'wechat',
    environment: 'production',
    merchantDigest: merchant,
    orderRef: '1'.repeat(64),
    fieldsDigest: '2'.repeat(64),
  };
  const host = {
    inventory,
    observedAtMs: 99_000,
    unknownWriters: [],
    externalWork: [],
    producersRunning: [],
  };
  const scope = { observedAtMs: 99_000, orders: [order], unsettled: [] };
  const observations = [
    { ...order, observedAtMs: 99_000, rawDigest: '3'.repeat(64), state: 'settled' },
  ];
  const rehearsal = {
    observedAtMs: 1,
    candidate: binding.candidate,
    configDigest: binding.configDigest,
    inventoryDigest: binding.inventoryDigest,
    recovery: 'query-and-existing-settlement-proven',
    recoveryUntilMs: 250_000,
    artifacts: [
      {
        provider: 'wechat',
        environment: 'production',
        merchantDigest: merchant,
        codeDigest: '5'.repeat(64),
        transcriptDigest: '6'.repeat(64),
        queryDigest: '7'.repeat(64),
        settlementDigest: '8'.repeat(64),
      },
    ],
  };
  const fence = {
    inventoryDigest: binding.inventoryDigest,
    stage: 'orders',
    observedAtMs: 99_000,
    uncovered: [],
    liveLegacy: [],
    regeneratedLegacy: [],
  };
  const published = [];
  return {
    binding,
    host,
    scope,
    observations,
    rehearsal,
    fence,
    published,
    input: {
      binding,
      stage: 'prepare',
      window: { maintenanceEndsAtMs: 150_000, reconcileByMs: 200_000, operatorRef: 'operator' },
    },
    io: {
      now: () => 100_000,
      readHostInventory: async () => host,
      readDatabaseScope: async () => scope,
      queryOrders: async () => observations,
      readRehearsalArtifacts: async () => rehearsal,
      readFenceState: async () => fence,
      assertJournalOwnership: async () => ({ ...binding }),
      publishPrivate: async (value) => {
        published.push(value);
      },
    },
  };
}
test('collects twice, binds all sources, and only publishes redacted facts', async () => {
  const f = fixture();
  let reads = 0;
  f.io.readDatabaseScope = async () => {
    reads++;
    return structuredClone(f.scope);
  };
  const result = await collectCutoverEvidence(f.input, f.io);
  assert.equal(reads, 2);
  assert.equal(result.payments.unresolved, 0);
  assert.equal(result.sources.length, 4);
  assert.equal(result.payments.scopeDigest, result.payments.queriedScopeDigest);
  assert.equal(f.published.length, 1);
  assert.equal(JSON.stringify(result).includes('vultr'), false);
  assert.equal(JSON.stringify(result).includes('4011'), false);
});
test('scope changing during provider requests cannot publish a partial success', async () => {
  const f = fixture();
  f.io.queryOrders = async () => {
    f.scope.orders[0].fieldsDigest = '0'.repeat(64);
    return f.observations;
  };
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_PAYMENT_SCOPE_CHANGED/);
  assert.deepEqual(f.published, []);
});
function preparingWithProducer() {
  const f = fixture();
  const producer = { host: 'vultr', pid: 501, start: '2000', role: 'main', ports: [4001, 4002] };
  f.host.inventory.targets.push(producer);
  f.binding.inventoryDigest = hash(f.host.inventory);
  f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
  f.fence.inventoryDigest = f.binding.inventoryDigest;
  f.host.producersRunning = [structuredClone(producer)];
  f.fence.stage = 'observed';
  return f;
}
test('prepare inventories approved running producers without pretending ingress is already closed', async () => {
  const f = preparingWithProducer();
  const result = await collectCutoverEvidence(f.input, f.io);
  assert.equal(result.host.phase, 'prepared');
  assert.equal(result.identity, undefined);
  assert.equal(f.published[0].raw.fence.stage, 'observed');
  assert.equal(f.published[0].raw.host.producersRunning.length, 1);
});
test('prepare rejects unclassified, changed, duplicate or malformed producers', async () => {
  for (const kind of ['unapproved', 'start', 'role', 'duplicate', 'missing', 'zero-pid']) {
    const f = preparingWithProducer();
    if (kind === 'unapproved') f.host.producersRunning[0].host = 'other-host';
    if (kind === 'start') f.host.producersRunning[0].start = '2001';
    if (kind === 'role') f.host.producersRunning[0] = structuredClone(f.host.inventory.targets[0]);
    if (kind === 'duplicate') f.host.producersRunning.push(f.host.producersRunning[0]);
    if (kind === 'missing') f.host.producersRunning = undefined;
    if (kind === 'zero-pid') {
      f.host.producersRunning[0].pid = 0;
      f.host.inventory.targets[1].pid = 0;
      f.binding.inventoryDigest = hash(f.host.inventory);
      f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
      f.fence.inventoryDigest = f.binding.inventoryDigest;
    }
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/, kind);
    assert.deepEqual(f.published, [], kind);
  }
});
test('prepare observations never satisfy preopen while legacy producers remain', async () => {
  const f = preparingWithProducer();
  await collectCutoverEvidence(f.input, f.io);
  f.published.length = 0;
  f.input.stage = 'preopen';
  f.input.identity = { candidate: f.binding.candidate, bootId: 'a'.repeat(32) };
  f.fence.stage = 'all-writers';
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
  assert.deepEqual(f.published, []);
});
for (const kind of [
  'missing',
  'duplicate',
  'different-merchant',
  'unknown',
  'paid-unsettled',
  'old-query',
  'future-query',
]) {
  test(`rejects ${kind} provider observation`, async () => {
    const f = fixture();
    if (kind === 'missing') f.observations.length = 0;
    if (kind === 'duplicate') f.observations.push(f.observations[0]);
    if (kind === 'different-merchant') f.observations[0].merchantDigest = '0'.repeat(64);
    if (['unknown', 'paid-unsettled'].includes(kind)) f.observations[0].state = kind;
    if (kind === 'old-query') f.observations[0].observedAtMs = 39_999;
    if (kind === 'future-query') f.observations[0].observedAtMs = 100_001;
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
    assert.deepEqual(f.published, []);
  });
}
for (const kind of [
  '4011',
  'producer',
  'external-work',
  'db-work',
  'old-host',
  'rehearsal',
  'window',
  'fence',
  'journal',
  'inventory',
]) {
  test(`rejects ${kind} gaps without success publication`, async () => {
    const f = fixture();
    if (kind === '4011') f.host.unknownWriters.push({ port: 4011 });
    if (kind === 'producer') f.host.producersRunning.push('worker');
    if (kind === 'external-work') f.host.externalWork.push('unknown-browser-action');
    if (kind === 'db-work') f.scope.unsettled.push('running');
    if (kind === 'old-host') f.host.observedAtMs = 39_999;
    if (kind === 'rehearsal') f.rehearsal.artifacts = [];
    if (kind === 'window') f.input.window.reconcileByMs = 260_000;
    if (kind === 'fence') f.fence.uncovered.push('internal-route');
    if (kind === 'journal')
      f.io.assertJournalOwnership = async () => ({ ...f.binding, attempt: 'different' });
    if (kind === 'inventory') f.host.inventory.configurationDigests.push('0'.repeat(64));
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
    assert.deepEqual(f.published, []);
  });
}
test('preopen requires fenced stopped legacy identities and the new boot identity', async () => {
  const f = fixture();
  f.input.stage = 'preopen';
  f.input.identity = { candidate: f.binding.candidate, bootId: 'a'.repeat(32) };
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
  f.fence.stage = 'all-writers';
  f.fence.liveLegacy.push('old');
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
  f.fence.liveLegacy = [];
  const result = await collectCutoverEvidence(f.input, f.io);
  assert.equal(result.host.phase, 'fenced-stopped');
  assert.deepEqual(result.identity, f.input.identity);
});
test('historical payment rehearsal for different gateway code cannot authorize new code', async () => {
  const f = fixture();
  f.rehearsal.artifacts[0].codeDigest = '0'.repeat(64);
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
});
test('read-only database reader covers both order tables and fails rather than truncates', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT') && sql.includes('LIMIT'))
        return [[{ id: 1, external_id: 'PRIVATE', provider: 'wechat', status: 'pending' }], []];
      return [[], []];
    },
  };
  await assert.rejects(
    readCutoverDatabaseScope(db, { windowStartMs: 50_000, now: () => 100_000 }),
    /MAINTENANCE_PAYMENT_SCOPE_UNPROVEN/,
  );
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(calls[1].sql, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(
    calls.some((r) => /^(UPDATE|DELETE|INSERT|REPLACE)/.test(r.sql)),
    false,
  );
});
function databaseFixture(overrides = {}) {
  const calls = [];
  const rows = {
    payments: [
      {
        id: 1,
        external_id: 'PRIVATE',
        provider: 'wechat',
        provider_order_id: 'ORDER',
        provider_capture_id: null,
        amount_cents: 1234,
        currency: 'CNY',
        status: 'pending',
        metadata: null,
      },
    ],
    partner_recharge_orders: [],
  };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    const table = Object.keys(rows).find((name) => sql.includes(`FROM ${name} `));
    if (table && sql.includes('COUNT'))
      return [[{ total: overrides.count ?? rows[table].length }], []];
    if (table) return [overrides.page ?? rows[table], []];
    return [[], []];
  };
  const options = {
    now: () => 100_000,
    windowStartMs: 50_000,
    resolveMerchant: () => ({ environment: 'production', merchantDigest: merchant }),
  };
  return { db: { query }, calls, options, rows };
}
test('reads ordinary and partner orders with full counts in one read-only snapshot', async () => {
  const f = databaseFixture();
  const result = await readCutoverDatabaseScope(f.db, f.options);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].provider_order_id, 'ORDER');
  assert.equal(result.orders[0].orderRef, hash([merchant, 'ORDER']));
  assert.equal(f.calls.filter((c) => c.sql.includes('COUNT')).length, 2);
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
});
for (const kind of ['missing-page', 'overflow', 'duplicate']) {
  test(`database ${kind} cannot be silently accepted`, async () => {
    const f = databaseFixture(
      kind === 'missing-page' ? { page: [] } : kind === 'overflow' ? { count: 10_000 } : {},
    );
    if (kind === 'duplicate') f.rows.payments.push(f.rows.payments[0]);
    await assert.rejects(
      readCutoverDatabaseScope(f.db, f.options),
      /MAINTENANCE_PAYMENT_SCOPE_UNPROVEN/,
    );
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  });
}
function hostFixture() {
  const calls = [];
  const args = '/opt/node22/bin/node\0/opt/holaday-cn-payment/src/index.ts\0';
  const files = new Map([
    ['/proc/sys/kernel/random/boot_id', '11111111-1111-4111-8111-111111111111'],
    ['/proc/401/cmdline', args],
    ['/proc/401/status', 'Uid:\t998\t998\t998\t998\nPPid:\t10\n'],
    ['/proc/401/stat', `401 (node worker) S ${Array(18).fill('1').join(' ')} 12345 0`],
    ['/proc/401/cgroup', '0::/system.slice/holaday.service'],
  ]);
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    pm2RuntimeSnapshot: async () => ({
      pid: 10,
      version: '6.0.14',
      killSignal: 'SIGINT',
      killTimeoutMs: 1600,
      sourceDigest: 'a'.repeat(64),
    }),
    startupSnapshot: async () => ({
      observedAtMs: 100_000,
      files: [],
      directories: [],
      pm2Unit: {},
    }),
    nginxSnapshot: async () => ({
      observedAtMs: 100_000,
      dump: 'observed configuration',
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          resolved: '/etc/nginx/nginx.conf',
          uid: 0,
          gid: 0,
          mode: 0o644,
          digest: 'e'.repeat(64),
          content: 'observed configuration',
        },
      ],
    }),
    readdir: async () => ['401', 'self'],
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('unknown path');
      return files.get(path);
    },
    readlink: async (path) =>
      path.endsWith('/exe') ? '/opt/node22/bin/node' : '/opt/holaday-cn-payment',
    exec: async (command, args) => {
      calls.push([command, ...args]);
      if (command === 'pm2')
        return JSON.stringify([
          {
            pid: 401,
            name: 'gateway',
            pm_id: 2,
            pm2_env: {
              pm_cwd: '/opt/holaday-cn-payment',
              autorestart: true,
              status: 'online',
              PRIVATE_KEY: 'secret',
            },
          },
        ]);
      if (command === 'ss')
        return 'LISTEN 0 511 0.0.0.0:4011 0.0.0.0:* users:(("node",pid=401,fd=1))\n';
      return 'observed configuration';
    },
  };
  return { io, calls, files };
}
test('PM2 runtime observes actual daemon settings and audited defaults without exposing environment', async () => {
  const module = await import('./browser-cutover-evidence.mjs');
  assert.equal(typeof module.readCutoverPM2RuntimeSnapshot, 'function');
  const files = new Map([
    ['/root/.pm2/pm2.pid', '50\n'],
    ['/usr/lib/node_modules/pm2/package.json', '{"version":"6.0.14"}'],
    [
      '/usr/lib/node_modules/pm2/constants.js',
      "  KILL_TIMEOUT            : process.env.PM2_KILL_TIMEOUT || 1600,\n  KILL_SIGNAL             : process.env.PM2_KILL_SIGNAL || 'SIGINT',\n",
    ],
    ['/proc/50/environ', 'PRIVATE_KEY=never-return\0PM2_KILL_TIMEOUT=2200\0'],
    ['/proc/50/cmdline', 'PM2 v6.0.14: God Daemon (/root/.pm2)\0'],
  ]);
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    readFile: async (path) => {
      assert.ok(files.has(path));
      return files.get(path);
    },
  };
  const result = await module.readCutoverPM2RuntimeSnapshot(io);
  assert.equal(result.killTimeoutMs, 2200);
  assert.equal(result.killSignal, 'SIGINT');
  assert.equal(result.pid, 50);
  assert.equal(result.version, '6.0.14');
  assert.equal(JSON.stringify(result).includes('never-return'), false);
  files.set('/proc/50/environ', 'PRIVATE_KEY=never-return\0');
  assert.equal((await module.readCutoverPM2RuntimeSnapshot(io)).killTimeoutMs, 1600);
  files.set('/proc/50/environ', 'PM2_KILL_SIGNAL=SIGTERM\0');
  assert.equal((await module.readCutoverPM2RuntimeSnapshot(io)).killSignal, 'SIGTERM');
  files.set('/proc/50/cmdline', 'PM2 v6.0.13: God Daemon (/root/.pm2)\0');
  await assert.rejects(
    module.readCutoverPM2RuntimeSnapshot(io),
    /MAINTENANCE_PM2_OBSERVATION_UNPROVEN/,
  );
  files.set('/proc/50/cmdline', 'PM2 v6.0.14: God Daemon (/root/.pm2)\0');
  files.set('/usr/lib/node_modules/pm2/constants.js', 'other defaults');
  await assert.rejects(
    module.readCutoverPM2RuntimeSnapshot(io),
    /MAINTENANCE_PM2_OBSERVATION_UNPROVEN/,
  );
});
test('host snapshot includes independently observed PM2 defaults', async () => {
  const f = hostFixture();
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.pm2Runtime?.killTimeoutMs, 1600);
});
function hostTreeFixture() {
  const f = hostFixture();
  const links = new Map();
  const pids = ['401'];
  const add = (pid, ppid, exe, argv) => {
    pids.push(String(pid));
    f.files.set(`/proc/${pid}/cmdline`, `${argv}\0`);
    f.files.set(`/proc/${pid}/status`, `Uid:\t0\t0\t0\t0\nPPid:\t${ppid}\n`);
    f.files.set(
      `/proc/${pid}/stat`,
      `${pid} (child) S ${Array(18).fill('1').join(' ')} ${pid}00 0`,
    );
    f.files.set(`/proc/${pid}/cgroup`, '0::/system.slice/service');
    links.set(`/proc/${pid}/exe`, exe);
    links.set(`/proc/${pid}/cwd`, '/srv/gateway');
  };
  // Grandchild sorts before parent: closure must not depend on /proc ordering.
  add(20, 30, '/usr/bin/esbuild', 'esbuild --service');
  add(30, 401, '/usr/bin/dash', 'sh -c runner');
  add(50, 1, '/usr/bin/dash', 'sh unrelated-job');
  add(51, 50, '/usr/bin/sleep', 'sleep 300');
  const readlink = f.io.readlink;
  f.io.readlink = async (path) => links.get(path) ?? readlink(path);
  f.io.readdir = async () => [...pids, 'self'];
  return { ...f, add, links };
}
test('host facts retain non-Node descendants transitively without annexing unrelated trees', async () => {
  const f = hostTreeFixture();
  const result = await readCutoverHostSnapshot(f.io);
  assert.deepEqual(
    result.processes.map((p) => p.pid).sort((a, b) => a - b),
    [20, 30, 401],
  );
  assert.equal(result.processes.find((p) => p.pid === 20).ppid, 30);
  assert.equal(result.processes.find((p) => p.pid === 30).exe, '/usr/bin/dash');
  assert.equal(JSON.stringify(result).includes('sh -c runner'), false);
});
test('host facts recognize Node by executable even when its process title was replaced', async () => {
  const f = hostTreeFixture();
  f.add(60, 1, '/usr/bin/node', 'renamed-worker');
  const result = await readCutoverHostSnapshot(f.io);
  assert.ok(result.processes.some((p) => p.pid === 60));
});
for (const change of ['spawn', 'reparent', 'replace', 'cgroup']) {
  test(`host observation rejects descendant ${change} during startup and ingress observation`, async () => {
    const f = hostTreeFixture();
    const exec = f.io.exec;
    f.io.exec = async (...args) => {
      const result = await exec(...args);
      if (args[0] === 'crontab') {
        if (change === 'spawn') f.add(21, 20, '/usr/bin/sleep', 'sleep 600');
        if (change === 'reparent') f.files.set('/proc/30/status', 'Uid:\t0\t0\t0\t0\nPPid:\t1\n');
        if (change === 'replace')
          f.files.set('/proc/20/stat', `20 (child) S ${Array(18).fill('1').join(' ')} 90000 0`);
        if (change === 'cgroup') f.files.set('/proc/20/cgroup', '0::/other.scope');
      }
      return result;
    };
    await assert.rejects(
      readCutoverHostSnapshot(f.io),
      /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
    );
  });
}
test('host facts include unmanaged 4011, full proc identity and startup sources', async () => {
  const f = hostFixture();
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.processes[0].pid, 401);
  assert.deepEqual(result.processes[0].uids, [998, 998, 998, 998]);
  assert.equal(result.processes[0].start, '12345');
  assert.equal(result.listeners.includes(':4011'), true);
  assert.equal(result.managers[0].autorestart, true);
  assert.equal(result.nginxFiles[0].path, '/etc/nginx/nginx.conf');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(
    f.calls.some((call) => call[0] === 'systemctl'),
    true,
  );
  assert.equal(
    f.calls.some((call) => call[0] === 'crontab'),
    true,
  );
});
test('host observations bind private PM2 configuration without returning its values', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  f.io.exec = async (command, args) => {
    const raw = await exec(command, args);
    if (command !== 'pm2') return raw;
    const rows = JSON.parse(raw);
    rows[0].pm2_env.kill_timeout = 660000;
    return JSON.stringify(rows);
  };
  const result = await readCutoverHostSnapshot(f.io);
  const { registrationConfigDigest } = await import('./browser-first-cutover-registrations.mjs');
  assert.equal(
    result.managers[0].configDigest,
    registrationConfigDigest({
      pm_cwd: '/opt/holaday-cn-payment',
      autorestart: true,
      status: 'online',
      PRIVATE_KEY: 'secret',
      kill_timeout: 660000,
    }),
  );
  assert.equal(result.managers[0].killTimeoutMs, 660000);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
for (const change of ['pid', 'new-registration', 'environment', 'kill-timeout', 'schedule']) {
  test(`host snapshot rejects PM2 ${change} drift during the same observation`, async () => {
    const f = hostFixture();
    const exec = f.io.exec;
    let reads = 0;
    f.io.exec = async (command, args) => {
      const raw = await exec(command, args);
      if (command !== 'pm2') return raw;
      const rows = JSON.parse(raw);
      if (++reads > 1) {
        if (change === 'pid') rows[0].pid = 402;
        if (change === 'new-registration') rows.push({ ...rows[0], pm_id: 3 });
        if (change === 'environment') rows[0].pm2_env.PRIVATE_KEY = 'rotated-private-value';
        if (change === 'kill-timeout') rows[0].pm2_env.kill_timeout = 1;
        if (change === 'schedule') rows[0].pm2_env.cron_restart = '* * * * *';
      }
      return JSON.stringify(rows);
    };
    await assert.rejects(readCutoverHostSnapshot(f.io), /MAINTENANCE_HOST_OBSERVATION_UNPROVEN/);
  });
}
test('PM2 heap metrics may vary without losing the configuration binding', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  let reads = 0;
  f.io.exec = async (command, args) => {
    const raw = await exec(command, args);
    if (command !== 'pm2') return raw;
    const rows = JSON.parse(raw);
    rows[0].pm2_env.axm_monitor = { heap: ++reads };
    return JSON.stringify(rows);
  };
  const result = await readCutoverHostSnapshot(f.io);
  assert.match(result.managers[0].configDigest, /^[a-f0-9]{64}$/);
  assert.equal(reads, 2);
});
function absentRootCrontab(overrides = {}) {
  return Object.assign(new Error('crontab failed'), {
    code: 1,
    stdout: '',
    stderr: 'no crontab for root\n',
    killed: false,
    signal: null,
    ...overrides,
  });
}
test('host snapshot records confirmed root crontab absence without losing other facts', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  f.io.exec = async (command, args) => {
    if (command === 'crontab') throw absentRootCrontab();
    return exec(command, args);
  };
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.cron, '');
  assert.equal(result.rootCrontabPresent, false);
  assert.equal(result.processes[0].pid, 401);
  assert.equal(result.listeners.includes(':4011'), true);
});
test('empty installed root crontab is distinct from an absent root crontab', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  f.io.exec = async (command, args) => (command === 'crontab' ? '' : exec(command, args));
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.cron, '');
  assert.equal(result.rootCrontabPresent, true);
});
for (const overrides of [
  { code: 2 },
  { code: 'ENOENT' },
  { stderr: 'permission denied\n' },
  { stderr: 'no crontab for root\npermission denied\n' },
  { stderr: 'no crontab for another-user\n' },
  { stdout: '* * * * * /srv/worker\n' },
  { killed: true },
  { signal: 'SIGTERM' },
]) {
  test(`crontab error is not absence: ${JSON.stringify(overrides)}`, async () => {
    const f = hostFixture();
    const exec = f.io.exec;
    f.io.exec = async (command, args) => {
      if (command === 'crontab') throw absentRootCrontab(overrides);
      return exec(command, args);
    };
    await assert.rejects(
      readCutoverHostSnapshot(f.io),
      /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
    );
  });
}
for (const first of ['absent', 'present', 'content']) {
  test(`root crontab changing from ${first} during collection rejects`, async () => {
    const f = hostFixture();
    const exec = f.io.exec;
    let reads = 0;
    f.io.exec = async (command, args) => {
      if (command !== 'crontab') return exec(command, args);
      reads++;
      if ((first === 'absent' && reads === 1) || (first === 'present' && reads > 1))
        throw absentRootCrontab();
      return first === 'content' ? `* * * * * /srv/worker-${reads}\n` : '';
    };
    await assert.rejects(
      readCutoverHostSnapshot(f.io),
      /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
    );
  });
}
test('host observation failure is not an empty inventory and never touches PM2 state', async () => {
  const f = hostFixture();
  f.io.readFile = async () => {
    throw new Error('permission denied PRIVATE');
  };
  await assert.rejects(
    readCutoverHostSnapshot(f.io),
    /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
  );
  assert.equal(
    f.calls.some((call) => call.some((x) => ['stop', 'restart', 'delete', 'save'].includes(x))),
    false,
  );
});
test('normal proc accounting changes do not masquerade as process identity changes', async () => {
  const f = hostFixture();
  const read = f.io.readFile;
  let count = 0;
  f.io.readFile = async (path) =>
    `${await read(path)}${path.endsWith('/status') ? `voluntary_ctxt_switches:\t${count++}\n` : ''}`;
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.processes.length, 1);
});
async function startupFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-startup-observation-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = (p) => root + p;
  const write = async (p, value) => {
    await fs.mkdir(join(path(p), '..'), { recursive: true });
    await fs.writeFile(path(p), value, { mode: 0o600 });
  };
  await write(
    '/root/.pm2/dump.pm2',
    '[{"name":"holaday-orchestrator","env":{"TEST_SECRET":"private"}}]\n',
  );
  await write('/root/.pm2/dump.pm2.bak', '[{"name":"backup-only"}]\n');
  await write('/etc/crontab', '* * * * * root /srv/system-job\n');
  await write('/etc/cron.d/holaday', '* * * * * root /srv/holaday-job\n');
  await write('/var/spool/cron/crontabs/app', '* * * * * /srv/user-job\n');
  await write(
    '/lib/systemd/system/pm2-root.service',
    '[Service]\nExecStart=/usr/bin/pm2 resurrect\n',
  );
  await write(
    '/etc/systemd/system/pm2-root.service.d/override.conf',
    '[Service]\nRestart=always\n',
  );
  await fs.mkdir(path('/etc/systemd/system/multi-user.target.wants'), { recursive: true });
  await fs.symlink(
    path('/lib/systemd/system/pm2-root.service'),
    path('/etc/systemd/system/multi-user.target.wants/pm2-root.service'),
  );
  const properties =
    'Id=pm2-root.service\nLoadState=loaded\nActiveState=inactive\nSubState=dead\nUnitFileState=enabled\nFragmentPath=/lib/systemd/system/pm2-root.service\nDropInPaths=/etc/systemd/system/pm2-root.service.d/override.conf\nExecStart={ path=/usr/bin/pm2 ; argv[]=/usr/bin/pm2 resurrect ; }\nRestart=always\n';
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    lstat: (p) => fs.lstat(path(p)),
    realpath: async (p) => (await fs.realpath(path(p))).slice(root.length),
    open: (p, ...args) => fs.open(path(p), ...args),
    readdir: (p) => fs.readdir(path(p)),
    exec: async (command, args) => {
      assert.equal(command, 'systemctl');
      assert.equal(args[0], 'show');
      assert.equal(args[1], 'pm2-root.service');
      return properties;
    },
  };
  return { io, path, write, properties };
}
test('startup snapshot retains independent PM2 backups, system and user cron, effective unit sources', async (t) => {
  const f = await startupFixture(t);
  const result = await readCutoverStartupSnapshot(f.io);
  const file = (p) => result.files.find((row) => row.path === p);
  assert.equal(
    file('/root/.pm2/dump.pm2').content,
    '[{"name":"holaday-orchestrator","env":{"TEST_SECRET":"private"}}]\n',
  );
  assert.equal(file('/root/.pm2/dump.pm2.bak').content, '[{"name":"backup-only"}]\n');
  assert.equal(file('/etc/rc.local').present, false);
  assert.equal(file('/etc/crontab').content, '* * * * * root /srv/system-job\n');
  assert.equal(file('/var/spool/cron/crontabs/app').content, '* * * * * /srv/user-job\n');
  assert.equal(
    file('/etc/systemd/system/multi-user.target.wants/pm2-root.service').resolved,
    '/lib/systemd/system/pm2-root.service',
  );
  assert.equal(
    file('/lib/systemd/system/pm2-root.service').content,
    '[Service]\nExecStart=/usr/bin/pm2 resurrect\n',
  );
  assert.equal(
    file('/etc/systemd/system/pm2-root.service.d/override.conf').content,
    '[Service]\nRestart=always\n',
  );
  assert.equal(result.pm2Unit, f.properties);
  assert.equal(result.observedAtMs, 100_000);
});
test('startup snapshot includes the observed application, cleanup and browser launcher files', async (t) => {
  const f = await startupFixture(t);
  const launchers = [
    '/var/lib/holaday-deploy/start-orchestrator-production.sh',
    '/var/lib/holaday-deploy/start-account-closure-worker-production.sh',
    '/opt/holaday-monorepo/start-files-cron.sh',
    '/opt/holaday-headed/start.sh',
    '/opt/holaday-vnc/start.sh',
  ];
  for (const path of launchers) await f.write(path, `#!/bin/sh\n# observed ${path}\n`);
  const result = await readCutoverStartupSnapshot(f.io);
  for (const path of launchers) {
    assert.equal(
      result.files.find((file) => file.path === path)?.content,
      `#!/bin/sh\n# observed ${path}\n`,
    );
  }
});
for (const fault of [
  'content',
  'new-file',
  'new-optional',
  'unit-drift',
  'permission',
  'oversized',
  'invalid-utf8',
  'dangling-link',
  'directory-cycle',
  'stale',
]) {
  test(`startup observation refuses ${fault} instead of publishing incomplete sources`, async (t) => {
    const f = await startupFixture(t);
    if (fault === 'permission') {
      const lstat = f.io.lstat;
      f.io.lstat = async (p) => {
        if (p === '/etc/cron.d')
          throw Object.assign(new Error('private failure'), { code: 'EACCES' });
        return lstat(p);
      };
    }
    if (fault === 'oversized') await f.write('/etc/cron.d/huge', Buffer.alloc(8 * 1024 * 1024 + 1));
    if (fault === 'invalid-utf8') await f.write('/etc/cron.d/broken', Buffer.from([0xff]));
    if (fault === 'dangling-link') await fs.symlink(f.path('/missing'), f.path('/etc/cron.d/link'));
    if (fault === 'directory-cycle')
      await fs.symlink(f.path('/etc/cron.d'), f.path('/etc/cron.d/loop'));
    let shows = 0;
    const exec = f.io.exec;
    f.io.exec = async (...args) => {
      const value = await exec(...args);
      if (++shows === 2) {
        if (fault === 'content') await f.write('/root/.pm2/dump.pm2.bak', '[{"name":"changed"}]');
        if (fault === 'new-file')
          await f.write('/etc/cron.d/new-job', '* * * * * root /srv/new-job\n');
        if (fault === 'new-optional') await f.write('/etc/rc.local', '#!/bin/sh\n/srv/launcher\n');
        if (fault === 'unit-drift') return value.replace('Restart=always', 'Restart=no');
        if (fault === 'stale') f.io.now = () => 160_001;
      }
      return value;
    };
    await assert.rejects(
      readCutoverStartupSnapshot(f.io),
      /^Error: MAINTENANCE_STARTUP_OBSERVATION_UNPROVEN$/,
    );
  });
}
test('host observation includes startup facts and refuses a failed startup read', async () => {
  const f = hostFixture();
  const startup = { observedAtMs: 100_000, files: [{ path: '/etc/rc.local', present: false }] };
  f.io.startupSnapshot = async () => startup;
  assert.deepEqual((await readCutoverHostSnapshot(f.io)).startup, startup);
  f.io.startupSnapshot = async () => {
    throw new Error('read failed');
  };
  await assert.rejects(
    readCutoverHostSnapshot(f.io),
    /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
  );
});

async function nginxFixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), 'holaday-nginx-observation-')),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const main = join(directory, 'nginx.conf');
  const enabled = join(directory, 'enabled.conf');
  const release = join(directory, 'release.conf');
  const mainBytes = `events {}\nhttp { include ${enabled}; }\n`;
  const releaseBytes =
    'server { listen 80; listen [::]:80; server_name fixture.local;\n' +
    ' location / { try_files $uri /index.html; }\n}\n';
  await fs.writeFile(main, mainBytes, { mode: 0o644 });
  await fs.writeFile(release, releaseBytes, { mode: 0o644 });
  await fs.symlink(release, enabled);
  const dump =
    `# configuration file ${main}:\n${mainBytes}\n` +
    `# configuration file ${enabled}:\n${releaseBytes}\n`;
  const calls = [];
  const io = {
    ...fs,
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    exec: async (command, args) => {
      assert.equal(command, 'nginx');
      assert.deepEqual(args, ['-T']);
      calls.push(command);
      return dump;
    },
  };
  return { io, directory, main, enabled, release, mainBytes, releaseBytes, dump, calls };
}

test('nginx observation retains full original bytes, linked release ownership and source digests', async (t) => {
  const f = await nginxFixture(t);
  const result = await readCutoverNginxSnapshot(f.io);
  assert.equal(result.dump, f.dump);
  assert.equal(result.files.length, 2);
  assert.equal(result.files[1].path, f.enabled);
  assert.equal(result.files[1].resolved, f.release);
  assert.equal(result.files[1].uid, process.getuid());
  assert.equal(result.files[1].content, f.releaseBytes);
  assert.equal(result.files[1].digest, createHash('sha256').update(f.releaseBytes).digest('hex'));
  assert.equal(result.files[1].mode, 0o644);
  assert.equal(result.observedAtMs, 100_000);
  assert.equal(f.calls.length, 2);
});

test('nginx source bytes must agree with the tested dump, not only its path', async (t) => {
  const f = await nginxFixture(t);
  await fs.writeFile(f.release, f.releaseBytes.replace('80', '81'));
  await assert.rejects(
    readCutoverNginxSnapshot(f.io),
    /^Error: MAINTENANCE_NGINX_OBSERVATION_UNPROVEN$/,
  );
});

test('nginx config changes and symlink retargeting during observation reject', async (t) => {
  for (const mode of ['dump', 'source', 'link']) {
    const f = await nginxFixture(t);
    const exec = f.io.exec;
    f.io.exec = async (...args) => {
      const dump = await exec(...args);
      if (f.calls.length === 2) {
        if (mode === 'dump') return `${dump}\n`;
        if (mode === 'source') await fs.writeFile(f.release, f.releaseBytes.replace('80', '81'));
        if (mode === 'link') {
          const other = join(f.directory, 'other.conf');
          await fs.writeFile(other, f.releaseBytes);
          await fs.unlink(f.enabled);
          await fs.symlink(other, f.enabled);
        }
      }
      return dump;
    };
    await assert.rejects(
      readCutoverNginxSnapshot(f.io),
      /MAINTENANCE_NGINX_OBSERVATION_UNPROVEN/,
      mode,
    );
  }
});

test('nginx malformed, duplicate, oversized and failed observations never become an empty inventory', async (t) => {
  for (const mode of [
    'empty',
    'duplicate',
    'relative',
    'trailing',
    'oversized',
    'failed',
    'non-root',
    'clock',
  ]) {
    const f = await nginxFixture(t);
    if (mode === 'empty') f.io.exec = async () => '';
    if (mode === 'duplicate') f.io.exec = async () => f.dump + f.dump;
    if (mode === 'relative') f.io.exec = async () => f.dump.replace(f.main, 'relative.conf');
    if (mode === 'trailing') f.io.exec = async () => `${f.dump}unaccounted source`;
    if (mode === 'oversized') f.io.exec = async () => 'x'.repeat(8 * 1024 * 1024 + 1);
    if (mode === 'failed')
      f.io.exec = async () => {
        throw new Error('PRIVATE_CONFIG');
      };
    if (mode === 'non-root') f.io.uid = 501;
    if (mode === 'clock') {
      let n = 0;
      f.io.now = () => (n++ ? 99_999 : 100_000);
    }
    await assert.rejects(
      readCutoverNginxSnapshot(f.io),
      /^Error: MAINTENANCE_NGINX_OBSERVATION_UNPROVEN$/,
      mode,
    );
  }
});

async function publisherFixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-cutover-publish-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(join(directory, 'evidence'), { mode: 0o750 });
  await fs.mkdir(join(directory, 'evidence-private'), { mode: 0o700 });
  const prefix = '/var/lib/holaday-deploy';
  const mapped = (path) => (path.startsWith(prefix) ? directory + path.slice(prefix.length) : path);
  const stat = (s) =>
    new Proxy(s, {
      get(target, key) {
        if (key === 'uid') return 0;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const events = [];
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    lstat: async (path) => stat(await fs.lstat(mapped(path))),
    realpath: async (path) => (await fs.realpath(mapped(path))).replace(directory, prefix),
    open: async (path, flags, mode) => {
      const handle = await fs.open(mapped(path), flags, mode);
      return {
        stat: async () => stat(await handle.stat()),
        writeFile: (bytes) => handle.writeFile(bytes),
        readFile: () => handle.readFile(),
        sync: async () => {
          events.push(['sync', path]);
          await handle.sync();
        },
        chown: async (uid, gid) => {
          assert.equal(uid, 0);
          assert.equal(gid, process.getgid());
        },
        chmod: (mode) => handle.chmod(mode),
        close: () => handle.close(),
      };
    },
    rename: async (from, to) => {
      events.push(['rename', to]);
      await fs.rename(mapped(from), mapped(to));
    },
  };
  const f = fixture();
  const report = await collectCutoverEvidence(f.input, f.io);
  const evidence = f.published[0];
  const options = {
    applicationGid: process.getgid(),
    assertJournalOwnership: async () => f.binding,
  };
  return { directory, io, events, report, evidence, options };
}
test('publishes protected raw evidence before a group-readable report and bound active index', async (t) => {
  const f = await publisherFixture(t);
  await publishCutoverEvidence(f.evidence, f.options, f.io);
  const reportPath = join(f.directory, 'evidence', `${f.report.attempt}.json`);
  const indexPath = join(f.directory, 'evidence', 'active.json');
  const rawFiles = await fs.readdir(join(f.directory, 'evidence-private'));
  assert.equal(rawFiles.length, 1);
  assert.equal(
    (await fs.stat(join(f.directory, 'evidence-private', rawFiles[0]))).mode & 0o777,
    0o600,
  );
  assert.equal((await fs.stat(reportPath)).mode & 0o777, 0o640);
  assert.equal((await fs.stat(indexPath)).mode & 0o777, 0o640);
  const bytes = await fs.readFile(reportPath);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(index.reportDigest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(
    f.events.filter((e) => e[0] === 'rename').at(-1)[1],
    '/var/lib/holaday-deploy/evidence/active.json',
  );
  assert.equal(f.events.at(-1)[0], 'sync');
});
test('replaced or writable publication directories cannot publish an index', async (t) => {
  const f = await publisherFixture(t);
  await fs.chmod(join(f.directory, 'evidence'), 0o770);
  await assert.rejects(
    publishCutoverEvidence(f.evidence, f.options, f.io),
    /MAINTENANCE_EVIDENCE_PUBLICATION_UNPROVEN/,
  );
  assert.deepEqual(await fs.readdir(join(f.directory, 'evidence')), []);
});
test('journal loss during publication never replaces active.json', async (t) => {
  const f = await publisherFixture(t);
  let calls = 0;
  f.options.assertJournalOwnership = async () => {
    if (++calls > 1) throw new Error('lost journal');
    return { ...fixture().binding };
  };
  await assert.rejects(
    publishCutoverEvidence(f.evidence, f.options, f.io),
    /MAINTENANCE_EVIDENCE_PUBLICATION_UNPROVEN/,
  );
  assert.equal((await fs.readdir(join(f.directory, 'evidence'))).includes('active.json'), false);
});
test('historical rehearsal must reference protected raw artifacts with matching code and content', async (t) => {
  const f = await publisherFixture(t);
  const base = fixture();
  const rehearsal = structuredClone(base.rehearsal);
  const content = Buffer.from(JSON.stringify({ source: 'test-only-fixture', events: [] }));
  const rawDigest = createHash('sha256').update(content).digest('hex');
  rehearsal.artifacts[0].transcriptDigest = rawDigest;
  rehearsal.artifacts[0].queryDigest = rawDigest;
  rehearsal.artifacts[0].settlementDigest = rawDigest;
  const root = join(f.directory, 'evidence-private');
  await fs.writeFile(join(root, `${rawDigest}.json`), content, { mode: 0o600 });
  await fs.writeFile(
    join(root, `rehearsal-${base.binding.configDigest}.json`),
    JSON.stringify({ schemaVersion: 1, ...rehearsal }),
    { mode: 0o600 },
  );
  const input = { binding: base.binding, merchants: base.host.inventory.merchants };
  const result = await readCutoverRehearsalArtifacts(input, f.io);
  assert.equal(result.artifacts[0].transcriptDigest, rawDigest);
  await fs.writeFile(join(root, `${rawDigest}.json`), '{}');
  await assert.rejects(
    readCutoverRehearsalArtifacts(input, f.io),
    /MAINTENANCE_REHEARSAL_UNPROVEN/,
  );
});
