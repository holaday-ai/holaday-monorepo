import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

// SYNTHETIC protected material: no production disk or package proof.
function syntheticCloudSources(scope) {
  const metadataPath = '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info';
  const paths = [
    '/usr/bin/unshare',
    '/bin/sh',
    '/usr/bin/mount',
    '/usr/bin/setpriv',
    '/usr/bin/python3',
    '/usr/bin/Xvfb',
    '/opt/brave.com/brave/brave',
    '/opt/brave.com/brave/chrome_crashpad_handler',
    '/opt/holaday-vnc/start.sh',
    '/usr/bin/bash',
    '/usr/bin/x11vnc',
    '/usr/bin/websockify',
    '/usr/bin/pkill',
    '/usr/bin/sleep',
    '/usr/bin/date',
    '/usr/lib/python3.10/site.py',
    '/usr/lib/python3.10/importlib/metadata/__init__.py',
    '/usr/lib/node_modules/pm2/package.json',
    '/usr/lib/node_modules/pm2/lib/God.js',
    '/usr/lib/node_modules/pm2/lib/God/ForkMode.js',
    '/usr/lib/node_modules/pm2/lib/Utility.js',
    '/usr/lib/node_modules/pm2/lib/God/ActionMethods.js',
    ...[
      '__init__.py',
      'websockifyserver.py',
      'websocketproxy.py',
      'websocket.py',
      'websocketserver.py',
      'auth_plugins.py',
      'token_plugins.py',
    ].map((name) => `/usr/lib/python3/dist-packages/websockify/${name}`),
    ...['entry_points.txt', 'PKG-INFO', 'top_level.txt'].map((name) => `${metadataPath}/${name}`),
  ].sort();
  return {
    host: 'vultr',
    hostname: 'qa-vultr',
    bootId: '11111111-1111-4111-8111-111111111111',
    files: paths.map((path) => ({
      path,
      resolvedPath: path,
      uid: 0,
      gid: 0,
      mode: 0o755,
      size: 1,
      digest: '1'.repeat(64),
    })),
    roles: scope.map(({ name, pmId }) => ({ name, pmId, selectionDigest: '2'.repeat(64) })),
    pythonEntry: {
      metadataPath,
      name: 'websockify',
      version: '0.10.0',
      group: 'console_scripts',
      entry: 'websockify',
      target: 'websockify.websocketproxy:websockify_init',
    },
  };
}

const descriptorFixtures = JSON.parse(
  await fs.readFile(
    new URL('./fixtures/browser-first-cutover-ingress-descriptors.json', import.meta.url),
  ),
);
const descriptor = (path, profile) =>
  structuredClone(descriptorFixtures.find((f) => f.path === path && f.profile === profile));

const session = await import('./browser-first-cutover-ingress-session.mjs').catch(() => ({}));
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};
const deadline = Date.now() + 120000;
const siteDigest = 'e'.repeat(64);
const input = { binding, maintenanceEndsAtMs: deadline, siteDigest };
const execution = {
  role: 'ingress',
  bootId: '11111111-1111-4111-8111-111111111111',
  process: {
    pid: 910,
    ppid: 900,
    start: '100',
    uids: [0, 0, 0, 0],
    cwd: '/',
    exe: '/usr/bin/node',
    argvDigest: '8'.repeat(64),
    cgroup: '0::/qa\n',
  },
};

async function pair(t, change = {}) {
  assert.equal(typeof session.serveFirstCutoverIngressSession, 'function');
  assert.equal(typeof session.connectFirstCutoverIngressSession, 'function');
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  t.after(() => {
    toServer.destroy();
    toClient.destroy();
  });
  let phase = 'preflight';
  const calls = [];
  const counts = {
    inventoryDigest: binding.inventoryDigest,
    observedAtMs: Date.now(),
    existingSockets: 0,
    internalWriters: 0,
    producersRunning: 0,
  };
  const record = () => ({ ...binding, phase, recordDigest: '1'.repeat(64) });
  const serverIO = {
    input: toServer,
    output: toClient,
    readIdentity: async () => structuredClone(execution),
    readSite: async () => {
      if (change.rejectSite) throw new Error('private site data');
      return {
        ...input,
        ingress: { inventoryDigest: binding.inventoryDigest, unknownIngress: [], files: [] },
      };
    },
    // The real lifecycle is exercised in browser-site-fence-linux. These narrow
    // effects check transport dispatch and live fact requests, not nginx itself.
    createLifecycle: async (_args, io) => {
      await io.journal.assertOwnership();
      return {
        fenceOrders: async () => {
          assert.equal((await io.journal.readFirstCutoverEffects()).phase, 'orders_fenced');
          calls.push('orders');
          if (change.loseAck) {
            toClient.destroy();
            throw new Error('private payload');
          }
          if (change.badResult) return true;
          return { ...(await io.observeWriters()), stage: 'orders' };
        },
        fenceAll: async () => {
          calls.push('all');
          return { ...counts, stage: 'all-writers' };
        },
        verifyFence: async () => {
          if (change.probeDiagnostic) {
            const { ingressDiagnosticError } = await import(
              './browser-first-cutover-ingress-diagnostics.mjs'
            );
            throw ingressDiagnosticError(
              'CUTOVER_INGRESS_LIFECYCLE_UNPROVEN',
              'PROBE_TIMEOUT',
              new Error('private raw'),
            );
          }
          return { ...counts, stage: 'all-writers' };
        },
        verifyOrders: async () => {
          calls.push('verify-orders');
          return { ...(await io.observeWriters()), stage: 'orders' };
        },
        restoreIngress: async (identity) => {
          await io.verifyOpenedIdentity(identity);
          calls.push('restore');
        },
        readFenceReceipt: async () => undefined,
      };
    },
  };
  const serving = session
    .serveFirstCutoverIngressSession({ attempt: binding.attempt }, serverIO)
    .then(
      () => ({ code: 0 }),
      (error) => ({
        code: 1,
        ...(change.probeDiagnostic ? { stage: error.cause?.ingressStage } : {}),
      }),
    );
  const io = {
    platform: 'linux',
    uid: 0,
    journal: {
      assertOwnership: async () => ({ ...binding }),
      readFirstCutoverEffects: async () => record(),
    },
    observeWriters: async () => ({ ...counts, observedAtMs: Date.now() }),
    verifyOpenedIdentity: async (identity) => ({
      identity,
      mode: 'serving',
      idle: false,
      needsReconciliation: true,
    }),
    open: async (file, args, options) => {
      assert.equal(file, '/usr/bin/ssh');
      assert.equal(args.at(-2), 'root@47.99.169.186');
      assert.equal(args.at(-1), `holaday-cutover-v1 ingress ${binding.attempt}`);
      assert(args.includes('StrictHostKeyChecking=yes'));
      assert(args.includes('BatchMode=yes'));
      assert(args.includes('IdentityAgent=none'));
      assert(args.includes('GlobalKnownHostsFile=/dev/null'));
      assert.equal(options.shell, false);
      return { input: toClient, output: toServer, completion: serving };
    },
  };
  return {
    calls,
    io,
    serving,
    toServer,
    toClient,
    serverIO,
    setPhase: (value) => {
      phase = value;
    },
    connect: (overrides = {}) =>
      session.connectFirstCutoverIngressSession({ ...input, ...overrides }, io),
  };
}

test('orders verification crosses the fixed session repeatedly without replaying its fence', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  f.setPhase('orders_fenced');
  await client.fenceOrders();
  assert.equal(typeof client.verifyOrders, 'function');
  f.setPhase('producers_stopped');
  assert.equal((await client.verifyOrders()).stage, 'orders');
  assert.equal((await client.verifyOrders()).stage, 'orders');
  assert.deepEqual(f.calls, ['orders', 'verify-orders', 'verify-orders']);
  await client.close();
});

test('ingress receiver identity stays independently bound to the live session', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  assert.deepEqual(client.readExecutionIdentity(), {
    host: 'aliyun',
    binding,
    siteDigest,
    ...execution,
  });
  await client.close();
  assert.throws(() => client.readExecutionIdentity(), /UNPROVEN/);
});

test('ingress transport identity is bound to its owned child and refuses after detach', async (t) => {
  const f = await pair(t);
  const open = f.io.open;
  const actual = {
    bootId: execution.bootId,
    process: { ...execution.process, pid: 920, exe: '/usr/bin/ssh' },
  };
  f.io.open = async (...args) => ({
    ...(await open(...args)),
    readIdentity: async () => structuredClone(actual),
  });
  const client = await f.connect();
  assert.equal(typeof client.readTransportIdentity, 'function');
  assert.deepEqual(await client.readTransportIdentity(), {
    host: 'vultr',
    role: 'ingress-ssh',
    binding,
    siteDigest,
    ...actual,
  });
  await client.close();
  await assert.rejects(client.readTransportIdentity(), /UNPROVEN/);
});

test('lost SSH identity closes the ingress wire without retrying an operation', async (t) => {
  const f = await pair(t);
  const open = f.io.open;
  f.io.open = async (...args) => ({
    ...(await open(...args)),
    readIdentity: async () => {
      throw Error('gone');
    },
  });
  const client = await f.connect();
  await assert.rejects(client.readTransportIdentity(), /UNPROVEN/);
  assert.equal(f.toServer.writableEnded, true);
  await assert.rejects(client.fenceOrders(), /UNPROVEN/);
  assert.deepEqual(f.calls, []);
});

test('fixed SSH session fetches live journal facts and dispatches only the ingress lifecycle', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  f.setPhase('orders_fenced');
  assert.equal((await client.fenceOrders()).stage, 'orders');
  assert.equal(await client.readFenceReceipt(), undefined);
  assert.equal((await client.fenceAll()).stage, 'all-writers');
  await client.close();
  assert.deepEqual(f.calls, ['orders', 'all']);
  assert.deepEqual(await f.serving, { code: 0 });
});

test('mismatching protected site digest cannot authorize any remote mutation', async (t) => {
  const f = await pair(t);
  await assert.rejects(
    f.connect({ siteDigest: '0'.repeat(64) }),
    /CUTOVER_INGRESS_SESSION_UNPROVEN/,
  );
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.serving, { code: 1 });
});

test('lost acknowledgement poisons the client and never resends the effect', async (t) => {
  const f = await pair(t, { loseAck: true });
  const client = await f.connect();
  f.setPhase('orders_fenced');
  await assert.rejects(client.fenceOrders(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  await assert.rejects(client.fenceOrders(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  assert.deepEqual(f.calls, ['orders']);
  assert.deepEqual(await f.serving, { code: 1 });
});

test('an uploaded binding cannot replace the coordinator live journal ownership', async (t) => {
  const f = await pair(t);
  f.io.journal.assertOwnership = async () => ({ ...binding, candidate: '0'.repeat(40) });
  await assert.rejects(f.connect(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  assert.deepEqual(f.calls, []);
});

test('arbitrary action and replayed sequence are rejected, never forwarded to lifecycle methods', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  f.toServer.write(
    `${JSON.stringify({ protocol: 1, seq: 1, type: 'operation', name: 'exec', value: '/bin/sh' })}\n`,
  );
  assert.deepEqual(await f.serving, { code: 1 });
  await assert.rejects(client.fenceAll(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  assert.deepEqual(f.calls, []);
});

test('client refuses expired windows before connecting', async () => {
  assert.equal(typeof session.connectFirstCutoverIngressSession, 'function');
  let opened = false;
  await assert.rejects(
    session.connectFirstCutoverIngressSession(
      { ...input, maintenanceEndsAtMs: Date.now() - 1 },
      {
        platform: 'linux',
        uid: 0,
        open: async () => {
          opened = true;
        },
        journal: {
          assertOwnership: async () => binding,
          readFirstCutoverEffects: async () => ({}),
        },
        observeWriters: async () => ({}),
        verifyOpenedIdentity: async () => ({}),
      },
    ),
    /CUTOVER_INGRESS_SESSION_UNPROVEN/,
  );
  assert.equal(opened, false);
});

test('receiver approval uses an actual protected file bound to the first-cutover approval', async (t) => {
  assert.equal(typeof session.readFirstCutoverIngressSite, 'function');
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'ingress-site-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = '/var/lib/holaday-deploy/maintenance';
  const path = `${folder}/first-cutover-ingress-approved.json`;
  await fs.mkdir(root + folder, { recursive: true, mode: 0o700 });
  const record = {
    schemaVersion: 1,
    host: 'aliyun',
    binding,
    maintenanceEndsAtMs: deadline,
    ingress: {
      inventoryDigest: binding.inventoryDigest,
      unknownIngress: [],
      files: [
        descriptor('/etc/nginx/sites-available/hd-app.orangebench.tech', 'aliyun-app-20260926'),
        descriptor('/etc/nginx/sites-available/hd-pay.orangebench.tech', 'aliyun-pay-20260926'),
      ],
    },
  };
  const bytes = JSON.stringify(record);
  await fs.writeFile(root + path, bytes, { mode: 0o600 });
  const io = {
    platform: 'linux',
    uid: 0,
    now: Date.now,
    readApproval: async () => ({ ...binding, maintenanceEndsAtMs: deadline }),
    fs: {
      lstat: async (p) => Object.assign(await fs.lstat(root + p), { uid: 0 }),
      realpath: async (p) => (await fs.realpath(root + p)).slice(root.length),
      open: async (p, flags) => {
        const h = await fs.open(root + p, flags);
        const stat = h.stat.bind(h);
        h.stat = async () => Object.assign(await stat(), { uid: 0 });
        return h;
      },
    },
  };
  const observed = await session.readFirstCutoverIngressSite({ attempt: binding.attempt }, io);
  assert.equal(observed.siteDigest, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(observed.binding, binding);
  io.readApproval = async () => ({
    ...binding,
    candidate: '0'.repeat(40),
    maintenanceEndsAtMs: deadline,
  });
  await assert.rejects(
    session.readFirstCutoverIngressSite({ attempt: binding.attempt }, io),
    /CUTOVER_INGRESS_SESSION_UNPROVEN/,
  );
  io.readApproval = async () => ({ ...binding, maintenanceEndsAtMs: deadline });
  await fs.chmod(root + path, 0o644);
  await assert.rejects(
    session.readFirstCutoverIngressSite({ attempt: binding.attempt }, io),
    /CUTOVER_INGRESS_SESSION_UNPROVEN/,
  );
});

test('a bare success flag is not accepted as remote fence evidence', async (t) => {
  const f = await pair(t, { badResult: true });
  const client = await f.connect();
  f.setPhase('orders_fenced');
  await assert.rejects(client.fenceOrders(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  assert.deepEqual(f.calls, ['orders']);
});

test('coordinator site scope reads the fixed protected file and binds both hosts to the original approval', async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'execution-site-scope-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = '/var/lib/holaday-deploy/maintenance';
  const path = `${folder}/first-cutover-execution-approved.json`;
  await fs.mkdir(root + folder, { recursive: true, mode: 0o700 });
  const approval = { ...binding, maintenanceEndsAtMs: deadline, legacyDigest: '9'.repeat(64) };
  const value = {
    schemaVersion: 1,
    host: 'vultr',
    binding,
    maintenanceEndsAtMs: deadline,
    site: {
      legacyDigest: approval.legacyDigest,
      reviews: { vultr: {}, aliyun: {} },
      gatewaySiteDigest: 'f'.repeat(64),
      ingress: {
        inventoryDigest: binding.inventoryDigest,
        unknownIngress: [],
        remoteSiteDigest: 'e'.repeat(64),
        files: [
          descriptor('/etc/nginx/sites-available/holaday', 'vultr-20260926'),
          descriptor('/etc/nginx/sites-available/hd-app.orangebench.tech', 'aliyun-app-20260926'),
          descriptor('/etc/nginx/sites-available/hd-pay.orangebench.tech', 'aliyun-pay-20260926'),
        ],
      },
      producerStartupFiles: ['dump.pm2', 'dump.pm2.bak'].map((name) => ({
        path: `/root/.pm2/${name}`,
        digest: '1'.repeat(64),
        remove: [{ name: 'holaday-orchestrator', entryDigest: '2'.repeat(64) }],
      })),
    },
  };
  const write = () => fs.writeFile(root + path, JSON.stringify(value), { mode: 0o600 });
  await write();
  const io = {
    platform: 'linux',
    uid: 0,
    now: Date.now,
    readApproval: async () => structuredClone(approval),
    fs: {
      lstat: async (p) => Object.assign(await fs.lstat(root + p), { uid: 0 }),
      realpath: async (p) => (await fs.realpath(root + p)).slice(root.length),
      open: async (p, flags) => {
        const h = await fs.open(root + p, flags);
        const stat = h.stat.bind(h);
        h.stat = async () => Object.assign(await stat(), { uid: 0 });
        return h;
      },
    },
  };
  assert.deepEqual(
    await session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io),
    { ...value.site, binding, maintenanceEndsAtMs: deadline },
  );
  value.site.cloudBrowserRecoveryDigest = '6'.repeat(64);
  value.site.cloudMaintenanceScope = [
    { name: 'holaday-vnc', pmId: 7, scopeDigest: '7'.repeat(64), recoveryDigest: '8'.repeat(64) },
    {
      name: 'holaday-chromium-headed',
      pmId: 8,
      scopeDigest: '9'.repeat(64),
      recoveryDigest: '6'.repeat(64),
    },
  ];
  value.site.cloudRecoverySources = syntheticCloudSources(value.site.cloudMaintenanceScope);
  const sourceMaterial = structuredClone(value.site.cloudRecoverySources);
  for (const fault of ['missing', 'orphan', 'unknown', 'role']) {
    value.site.cloudRecoverySources = structuredClone(sourceMaterial);
    const cloud = value.site.cloudMaintenanceScope;
    if (fault === 'missing') Reflect.deleteProperty(value.site, 'cloudRecoverySources');
    if (fault === 'orphan') Reflect.deleteProperty(value.site, 'cloudMaintenanceScope');
    if (fault === 'unknown') value.site.cloudRecoverySources.approved = true;
    if (fault === 'role') value.site.cloudRecoverySources.roles.pop();
    await write();
    await assert.rejects(
      session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io),
      /UNPROVEN/,
    );
    value.site.cloudMaintenanceScope = cloud;
  }
  value.site.cloudRecoverySources = sourceMaterial;
  await write();
  assert.equal(
    (await session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io))
      .cloudBrowserRecoveryDigest,
    '6'.repeat(64),
  );
  assert.deepEqual(
    (await session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io))
      .cloudMaintenanceScope,
    value.site.cloudMaintenanceScope,
  );
  const approvedCloud = structuredClone(value.site.cloudMaintenanceScope);
  for (const invalid of [
    [],
    [...approvedCloud].reverse(),
    [approvedCloud[0], { ...approvedCloud[1], pmId: 7 }],
    [{ ...approvedCloud[0], name: 'unrelated' }, approvedCloud[1]],
    [approvedCloud[0], { ...approvedCloud[1], recoveryDigest: '0'.repeat(64) }],
    [{ ...approvedCloud[0], command: '/bin/sh' }, approvedCloud[1]],
  ]) {
    value.site.cloudMaintenanceScope = invalid;
    await write();
    await assert.rejects(
      session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io),
      /UNPROVEN/,
    );
  }
  value.site.cloudMaintenanceScope = approvedCloud;
  value.site.cloudBrowserRecoveryDigest = { command: '/bin/sh' };
  await write();
  await assert.rejects(
    session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io),
    /UNPROVEN/,
  );
  value.site.cloudBrowserRecoveryDigest = '6'.repeat(64);
  value.site.inventory = { configurationDigests: ['a'.repeat(64)], merchants: [], targets: [] };
  const inventoryDigest = createHash('sha256')
    .update(JSON.stringify(value.site.inventory))
    .digest('hex');
  value.binding = { ...binding, inventoryDigest };
  approval.inventoryDigest = inventoryDigest;
  value.site.ingress.inventoryDigest = inventoryDigest;
  await write();
  assert.deepEqual(
    (await session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io)).inventory,
    value.site.inventory,
  );
  // Recovery metadata includes binding.inventoryDigest. Its own digest must
  // therefore be bound OUTSIDE inventory, avoiding an impossible hash cycle.
  value.site.backupRecoveryDigest = '8'.repeat(64);
  await write();
  const recoveryScope = await session.readFirstCutoverExecutionSiteScope(
    { attempt: binding.attempt },
    io,
  );
  assert.equal(recoveryScope.backupRecoveryDigest, '8'.repeat(64));
  assert.equal(recoveryScope.binding.inventoryDigest, inventoryDigest);
  for (const mutate of [
    (v) => {
      v.site.backupRecoveryDigest = 'bad';
    },
    (v) => {
      v.site.inventory.targets.push({ forged: true });
    },
    (v) => {
      v.host = 'aliyun';
    },
    (v) => {
      v.site.legacyDigest = '0'.repeat(64);
    },
    (v) => v.site.ingress.files.pop(),
    (v) => {
      v.site.ingress.remoteSiteDigest = 'bad';
    },
    (v) => {
      v.site.producerStartupFiles[0].remove[0].name = 'unrelated';
    },
    (v) => {
      v.site.producerStartupFiles[0].path = '/tmp/unapproved';
    },
    (v) => {
      v.site.extra = true;
    },
  ]) {
    const clean = structuredClone(value);
    mutate(value);
    await write();
    await assert.rejects(
      session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io),
      /UNPROVEN/,
    );
    Object.assign(value, clean);
  }
  await write();
  await fs.chmod(root + path, 0o644);
  await assert.rejects(
    session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io),
    /UNPROVEN/,
  );
});

test('successful mutation cannot be sent again by the same client', async (t) => {
  const f = await pair(t);
  let sent = 0;
  f.toServer.on('data', (bytes) => {
    if (bytes.toString().includes('"name":"fenceOrders"')) sent++;
  });
  const client = await f.connect();
  f.setPhase('orders_fenced');
  await client.fenceOrders();
  await assert.rejects(client.fenceOrders(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  assert.equal(sent, 1);
  await client.close();
});

test('receiver rejection before attach closes the stream instead of leaving the caller waiting', async (t) => {
  const f = await pair(t, { rejectSite: true });
  let timer;
  try {
    await assert.rejects(
      Promise.race([
        f.connect(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('receiver did not close')), 100);
        }),
      ]),
      /CUTOVER_INGRESS_SESSION_UNPROVEN/,
    );
  } finally {
    clearTimeout(timer);
  }
});

test('blocked transport write is bounded by the original deadline without killing a process', async (t) => {
  const incoming = new PassThrough();
  const outgoing = new Writable({ write() {} });
  t.after(() => {
    incoming.destroy();
    outgoing.destroy();
  });
  let timer;
  const pending = session.connectFirstCutoverIngressSession(
    { ...input, maintenanceEndsAtMs: Date.now() + 40 },
    {
      platform: 'linux',
      uid: 0,
      journal: { assertOwnership: async () => binding, readFirstCutoverEffects: async () => ({}) },
      observeWriters: async () => ({}),
      verifyOpenedIdentity: async () => ({}),
      open: async () => ({
        input: incoming,
        output: outgoing,
        completion: Promise.resolve({ code: 0 }),
      }),
    },
  );
  try {
    await assert.rejects(
      Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('write never timed out')), 200);
        }),
      ]),
      /CUTOVER_INGRESS_SESSION_UNPROVEN/,
    );
  } finally {
    clearTimeout(timer);
  }
});

test('oversized unframed input aborts the session before any mutation', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  f.toServer.write(Buffer.alloc(256 * 1024 + 1, 97));
  assert.deepEqual(await f.serving, { code: 1 });
  await assert.rejects(client.fenceOrders(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  assert.deepEqual(f.calls, []);
});

test('replayed sequence with an otherwise permitted mutation is rejected', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  f.setPhase('orders_fenced');
  f.toServer.write(
    `${JSON.stringify({ protocol: 1, seq: 1, type: 'operation', name: 'fenceOrders', value: null })}\n`,
  );
  assert.deepEqual(await f.serving, { code: 1 });
  await assert.rejects(client.fenceOrders(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  assert.deepEqual(f.calls, []);
});

test('receiver exposes only the fixed inner probe stage and keeps its public refusal code', async (t) => {
  const { ingressDiagnosticStage } = await import(
    './browser-first-cutover-ingress-diagnostics.mjs'
  );
  const f = await pair(t, { probeDiagnostic: true });
  const client = await f.connect();
  f.setPhase('all_fenced');
  await assert.rejects(client.verifyFence(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
  const outcome = await f.serving;
  assert.equal(outcome.code, 1);
  assert.equal(outcome.stage, 'PROBE_TIMEOUT');
});

test('source diagnostics bind actual site reader IO, approval and clock refusals without raw metadata', async (t) => {
  const { ingressDiagnosticStage, ingressDiagnosticError } = await import(
    './browser-first-cutover-ingress-diagnostics.mjs'
  );
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'execution-site-scope-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = '/var/lib/holaday-deploy/maintenance';
  const path = `${folder}/first-cutover-execution-approved.json`;
  await fs.mkdir(root + folder, { recursive: true, mode: 0o700 });
  const approval = { ...binding, maintenanceEndsAtMs: deadline, legacyDigest: '9'.repeat(64) };
  const value = {
    schemaVersion: 1,
    host: 'vultr',
    binding,
    maintenanceEndsAtMs: deadline,
    site: {
      legacyDigest: approval.legacyDigest,
      reviews: { vultr: {}, aliyun: {} },
      gatewaySiteDigest: 'f'.repeat(64),
      ingress: {
        inventoryDigest: binding.inventoryDigest,
        unknownIngress: [],
        remoteSiteDigest: 'e'.repeat(64),
        files: [
          descriptor('/etc/nginx/sites-available/holaday', 'vultr-20260926'),
          descriptor('/etc/nginx/sites-available/hd-app.orangebench.tech', 'aliyun-app-20260926'),
          descriptor('/etc/nginx/sites-available/hd-pay.orangebench.tech', 'aliyun-pay-20260926'),
        ],
      },
      producerStartupFiles: ['dump.pm2', 'dump.pm2.bak'].map((name) => ({
        path: `/root/.pm2/${name}`,
        digest: '1'.repeat(64),
        remove: [{ name: 'holaday-orchestrator', entryDigest: '2'.repeat(64) }],
      })),
    },
  };
  const write = () => fs.writeFile(root + path, JSON.stringify(value), { mode: 0o600 });
  await write();
  const io = {
    platform: 'linux',
    uid: 0,
    now: Date.now,
    readApproval: async () => structuredClone(approval),
    fs: {
      lstat: async (p) => Object.assign(await fs.lstat(root + p), { uid: 0 }),
      realpath: async (p) => (await fs.realpath(root + p)).slice(root.length),
      open: async (p, flags) => {
        const h = await fs.open(root + p, flags);
        const stat = h.stat.bind(h);
        h.stat = async () => Object.assign(await stat(), { uid: 0 });
        return h;
      },
    },
  };

  const original = { ...io, fs: { ...io.fs } };
  for (const mode of [
    'folder',
    'file',
    'read',
    'json',
    'shape',
    'approval-before',
    'approval-after',
    'clock',
    'validate',
  ]) {
    await write();
    await fs.chmod(root + folder, 0o700);
    await fs.chmod(root + path, 0o600);
    Object.assign(io, original, { fs: { ...original.fs } });
    if (mode === 'folder') await fs.chmod(root + folder, 0o755);
    if (mode === 'file') await fs.chmod(root + path, 0o644);
    if (mode === 'json') await fs.writeFile(root + path, '{');
    if (mode === 'shape')
      await fs.writeFile(root + path, JSON.stringify({ ...value, extra: true }));
    if (mode === 'read') {
      const open = io.fs.open;
      io.fs.open = async (...args) => {
        const h = await open(...args);
        h.readFile = async () => {
          throw Error('PRIVATE_PAYLOAD');
        };
        return h;
      };
    }
    if (mode === 'approval-before')
      io.readApproval = async () => {
        throw ingressDiagnosticError('CUTOVER_APPROVAL_UNPROVEN', 'APPROVAL_DEADLINE');
      };
    if (mode === 'approval-after') {
      let reads = 0;
      io.readApproval = async () => ({
        ...approval,
        ...(++reads === 2 ? { candidate: '0'.repeat(40) } : {}),
      });
    }
    if (mode === 'clock') {
      let reads = 0;
      io.now = () => (++reads === 1 ? 1000 : 999);
    }
    if (mode === 'validate') io.now = () => deadline + 1;
    await assert.rejects(
      session.readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, io),
      (error) => {
        assert.equal(error.message, 'CUTOVER_INGRESS_SESSION_UNPROVEN');
        assert.equal(
          ingressDiagnosticStage(error),
          {
            folder: 'SITE_FOLDER',
            file: 'SITE_FILE',
            read: 'SITE_CONTENT',
            json: 'SITE_JSON',
            shape: 'SITE_SHAPE',
            'approval-before': 'APPROVAL_DEADLINE',
            'approval-after': 'SITE_APPROVAL_AFTER',
            clock: 'SITE_CLOCK',
            validate: 'SITE_VALIDATE',
          }[mode],
        );
        assert.ok(!JSON.stringify(error.cause).includes('PRIVATE'));
        return true;
      },
    );
  }
});
