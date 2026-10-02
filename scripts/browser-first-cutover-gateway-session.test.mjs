import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ingressDiagnosticStage } from './browser-first-cutover-ingress-diagnostics.mjs';
const api = await import('./browser-first-cutover-gateway-session.mjs').catch(() => ({}));
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};
const execution = {
  role: 'gateway',
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
test('protected gateway scope pins startup paths, file mode and independent attempt approval', async (t) => {
  assert.equal(typeof api.readFirstCutoverGatewaySite, 'function');
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-gateway-scope-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = '/var/lib/holaday-deploy/maintenance';
  const path = `${folder}/first-cutover-gateway-approved.json`;
  await fs.mkdir(root + folder, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 30000;
  const value = {
    schemaVersion: 1,
    host: 'aliyun',
    binding,
    maintenanceEndsAtMs: deadline,
    startupFiles: [
      {
        path: '/root/.pm2/dump.pm2',
        digest: '1'.repeat(64),
        remove: [{ name: 'holaday-cn-payment', entryDigest: '2'.repeat(64) }],
      },
      { path: '/root/.pm2/dump.pm2.bak', digest: null, remove: [] },
    ],
  };
  const save = () => fs.writeFile(root + path, JSON.stringify(value), { mode: 0o600 });
  await save();
  const io = {
    now: Date.now,
    platform: 'linux',
    uid: 0,
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
  const read = () => api.readFirstCutoverGatewaySite({ attempt: binding.attempt }, io);
  assert.deepEqual((await read()).startupFiles, value.startupFiles);
  const approved = { ...binding };
  value.binding = approved;
  value.payments = { inventory: { merchants: [] }, profiles: [] };
  approved.inventoryDigest = createHash('sha256')
    .update(JSON.stringify(value.payments.inventory))
    .digest('hex');
  io.readApproval = async () => ({ ...approved, maintenanceEndsAtMs: deadline });
  await save();
  assert.deepEqual((await read()).payments, value.payments);
  value.payments.inventory.merchants.push({ provider: 'unexpected' });
  await save();
  await assert.rejects(read());
  value.payments = undefined;
  value.binding = binding;
  io.readApproval = async () => ({ ...binding, maintenanceEndsAtMs: deadline });
  value.startupFiles[0].remove[0].name = 'unrelated';
  await save();
  await assert.rejects(read());
  value.startupFiles[0].remove[0].name = 'holaday-cn-payment';
  await save();
  io.readApproval = async () => ({
    ...binding,
    candidate: '0'.repeat(40),
    maintenanceEndsAtMs: deadline,
  });
  await assert.rejects(read());
  io.readApproval = async () => ({ ...binding, maintenanceEndsAtMs: deadline });
  await fs.chmod(root + path, 0o644);
  await assert.rejects(read());
});
async function pair(t, mode = '', timing = {}) {
  const now = timing.now ?? Date.now;
  assert.equal(typeof api.connectFirstCutoverGatewaySession, 'function');
  assert.equal(typeof api.serveFirstCutoverGatewaySession, 'function');
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  t.after(() => {
    upstream.destroy();
    downstream.destroy();
  });
  const input = {
    binding,
    maintenanceEndsAtMs: now() + 30000,
    siteDigest: 'e'.repeat(64),
    ...(timing.reconcileByMs !== undefined ? { reconcileByMs: timing.reconcileByMs } : {}),
  };
  const site = { ...input, startupFiles: [] };
  let siteChanged = false;
  let identityReads = 0;
  let phase = 'producers_stopped';
  const events = [];
  const actions = [];
  const target = { pid: 123, role: 'gateway' };
  const identity = { candidate: binding.candidate, bootId: '2'.repeat(32) };
  const record = () => ({
    ...binding,
    phase,
    ...(phase === 'reconciled' ? { identity, bootstrapSeed: '1'.repeat(32) } : {}),
  });
  const serving = api
    .serveFirstCutoverGatewaySession(
      { attempt: binding.attempt },
      {
        now,
        input: upstream,
        output: downstream,
        readIdentity: async () => {
          const value = structuredClone(execution);
          if (mode === 'bad-identity') value.process.uids = [998, 998, 998, 998];
          if (mode === 'identity-drift' && ++identityReads > 2) value.process.start = '101';
          return value;
        },
        readSite: async () => {
          if (mode === 'reject-site') throw new Error('private scope');
          return siteChanged ? { ...site, siteDigest: 'f'.repeat(64) } : site;
        },
        query: async (actualSite, request, io) => {
          assert.deepEqual(actualSite, site);
          assert.deepEqual(await io.assertScope(), site);
          assert.equal((await io.journal.readFirstCutoverEffects()).phase, phase);
          assert.deepEqual(await io.journal.assertOwnership(), binding);
          actions.push('query');
          if (mode === 'query-failure') throw new Error('private provider failure');
          if (mode === 'query-writer') await io.journal.recordStartupEvent({});
          return request.orders.map((order) => ({
            provider: order.provider,
            environment: order.environment,
            orderRef: order.orderRef,
            merchantDigest: order.merchantDigest,
            observedAtMs: Date.now(),
            rawDigest: '1'.repeat(64),
            state: 'closed',
            ...(mode === 'query-leak' ? { secret: 'PRIVATE' } : {}),
          }));
        },
        // Transport tests replace only host-local effects. The physical fixture
        // runs these same dispatch paths against real PM2/proc/pidfd and journal.
        prepare: async (args, io) => {
          assert.deepEqual(args.files, []);
          assert.equal((await io.journal.readFirstCutoverEffects()).phase, 'producers_stopped');
          await io.journal.recordStartupEvent({
            ...binding,
            host: 'aliyun',
            phase: 'startup-backup-intent',
          });
          await io.journal.assertOwnership();
          actions.push('prepare');
          return {
            attempt: binding.attempt,
            inventoryDigest: binding.inventoryDigest,
            host: 'aliyun',
            phase: 'startup_prepared',
            files:
              mode === 'empty-files'
                ? []
                : [
                    {
                      path: '/root/.pm2/dump.pm2',
                      beforeDigest: '1'.repeat(64),
                      afterDigest: '2'.repeat(64),
                    },
                    { path: '/root/.pm2/dump.pm2.bak', beforeDigest: null, afterDigest: null },
                  ],
          };
        },
        retire: async (_args, io) => {
          await io.observer.read();
          await io.journal.recordRegistrationEvent({
            ...binding,
            host: 'aliyun',
            phase: 'registration-delete-intent',
          });
          actions.push('delete');
          if (mode === 'lost-ack') {
            downstream.destroy();
            throw new Error('private details');
          }
          await io.observer.retireUnmanaged(
            { maintenanceEndsAtMs: input.maintenanceEndsAtMs },
            {
              signalPinned: async (p) => {
                assert.deepEqual(p, target);
                await io.journal.assertOwnership();
                await io.observer.readUnmanagedProgress('aliyun');
                await io.verifyFence();
                if (mode === 'nested-write')
                  await io.journal.recordStartupEvent({
                    ...binding,
                    host: 'aliyun',
                    phase: 'startup-backup-intent',
                  });
                actions.push('signal');
              },
            },
          );
          if (mode === 'bare-result') return true;
          return {
            attempt: binding.attempt,
            inventoryDigest: binding.inventoryDigest,
            host: 'aliyun',
            phase: 'stopped',
            observedAtMs: Date.now(),
            survivors: [],
            listeners: [],
            unknownLaunchers: [],
          };
        },
      },
    )
    .then(
      () => ({ code: 0 }),
      () => ({ code: 1 }),
    );
  const io = {
    platform: 'linux',
    uid: 0,
    journal: {
      assertOwnership: async () => binding,
      readFirstCutoverEffects: async () => record(),
      recordStartupEvent: async (e) => {
        events.push(e);
        if (mode === 'scope-drift') siteChanged = true;
      },
      recordRegistrationEvent: async (e) => events.push(e),
    },
    observer: {
      read: async () => ({ inventoryDigest: binding.inventoryDigest }),
      readRegistrationProgress: async (host) => ({
        host,
        purpose: 'registration-progress',
        inventory: {},
      }),
      readUnmanagedProgress: async (host) => ({
        host,
        purpose: 'unmanaged-progress',
        inventory: {},
      }),
      retireUnmanaged: async (args, ops) => {
        assert.deepEqual(args, { maintenanceEndsAtMs: input.maintenanceEndsAtMs });
        assert.equal(phase, 'stopped');
        await ops.signalPinned(target);
        return { phase: 'stopped' };
      },
    },
    verifyFence: async () => ({ inventoryDigest: binding.inventoryDigest, stage: 'all-writers' }),
    open: async (file, argv, options) => {
      assert.equal(file, '/usr/bin/ssh');
      assert.equal(argv.at(-2), 'root@47.99.169.186');
      assert.equal(argv.at(-1), `holaday-cutover-v1 gateway ${binding.attempt}`);
      assert.ok(argv.includes('StrictHostKeyChecking=yes'));
      assert.ok(argv.includes('IdentityAgent=none'));
      assert.equal(options.shell, false);
      return { input: downstream, output: upstream, completion: serving };
    },
  };
  return {
    input,
    identity,
    io,
    actions,
    events,
    serving,
    upstream,
    downstream,
    phase: (p) => {
      phase = p;
    },
    connect: () => api.connectFirstCutoverGatewaySession(input, io),
  };
}

test('gateway queries share original ownership without exposing remote write callbacks', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  const request = {
    stage: 'prepare',
    observedAtMs: Date.now(),
    orders: [
      {
        provider: 'wechat',
        environment: 'production',
        orderRef: '2'.repeat(64),
        merchantDigest: '3'.repeat(64),
      },
    ],
  };
  assert.equal(typeof client.queryOrders, 'function');
  const result = await client.queryOrders(request);
  assert.equal(result[0].state, 'closed');
  assert.equal(result[0].orderRef, request.orders[0].orderRef);
  await client.queryOrders({
    ...request,
    stage: 'preopen',
    identity: { candidate: binding.candidate, bootId: '4'.repeat(32) },
  });
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.actions, ['query', 'query']);
  await client.close();
  assert.equal((await f.serving).code, 0);
});
for (const fault of ['query-failure', 'query-writer', 'query-leak']) {
  test(`gateway ${fault} aborts and never retries the provider operation`, async (t) => {
    const f = await pair(t, fault);
    const client = await f.connect();
    assert.equal(typeof client.queryOrders, 'function');
    const request = {
      stage: 'prepare',
      observedAtMs: Date.now(),
      orders: [
        {
          provider: 'wechat',
          environment: 'production',
          orderRef: '2'.repeat(64),
          merchantDigest: '3'.repeat(64),
        },
      ],
    };
    await assert.rejects(client.queryOrders(request), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
    await assert.rejects(client.queryOrders(request), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.actions, ['query']);
  });
}

test('gateway transport identity is bound to its owned child and refuses after detach', async (t) => {
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
    role: 'gateway-ssh',
    binding,
    siteDigest: 'e'.repeat(64),
    ...actual,
  });
  await client.close();
  await assert.rejects(client.readTransportIdentity(), /UNPROVEN/);
});

test('lost SSH identity closes the gateway wire without retirement effects', async (t) => {
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
  assert.equal(f.upstream.writableEnded, true);
  await assert.rejects(client.prepare(), /UNPROVEN/);
  assert.deepEqual(f.actions, []);
});

test('live gateway exposes its exact independently captured receiver identity, not a mutable receipt', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  const proof = client.readExecutionIdentity();
  assert.deepEqual(proof, { host: 'aliyun', binding, siteDigest: 'e'.repeat(64), ...execution });
  proof.process.pid = 123;
  assert.equal(client.readExecutionIdentity().process.pid, 910);
  await client.close();
  assert.throws(() => client.readExecutionIdentity(), /UNPROVEN/);
});

test('non-root receiver identity and later kernel identity drift cannot precede a gateway effect', async (t) => {
  const bad = await pair(t, 'bad-identity');
  await assert.rejects(bad.connect(), /UNPROVEN/);
  assert.deepEqual(bad.actions, []);
  const drift = await pair(t, 'identity-drift');
  const client = await drift.connect();
  await assert.rejects(client.prepare(), /UNPROVEN/);
  assert.deepEqual(drift.actions, []);
  assert.throws(() => client.readExecutionIdentity(), /UNPROVEN/);
});
test('gateway session retains original journal writes and original observer orchestration through nested pinned effects', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  assert.equal((await client.prepare()).phase, 'startup_prepared');
  f.phase('stopped');
  assert.equal((await client.retire()).phase, 'stopped');
  await client.close();
  assert.deepEqual(f.actions, ['prepare', 'delete', 'signal']);
  assert.deepEqual(
    f.events.map((e) => e.phase),
    ['startup-backup-intent', 'registration-delete-intent'],
  );
  assert.deepEqual(await f.serving, { code: 0 });
});
for (const mode of ['lost-ack', 'bare-result'])
  test(`gateway ${mode} fails closed without a second effect`, async (t) => {
    const f = await pair(t, mode);
    const client = await f.connect();
    f.phase('stopped');
    await assert.rejects(client.retire(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
    await assert.rejects(client.retire(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
    assert.equal(f.actions.filter((a) => a === 'delete').length, 1);
    assert.deepEqual(await f.serving, { code: 1 });
  });
test('gateway receiver rejects missing private approval and closes without waiting for a deadline', async (t) => {
  const f = await pair(t, 'reject-site');
  await assert.rejects(f.connect(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
  assert.deepEqual(f.actions, []);
});
test('gateway session rejects reused effects and arbitrary operations', async (t) => {
  const f = await pair(t);
  const client = await f.connect();
  await client.prepare();
  await assert.rejects(client.prepare(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
  f.upstream.write(
    `${JSON.stringify({ protocol: 1, type: 'operation', seq: 3, name: 'exec', value: 'rm' })}\n`,
  );
  assert.deepEqual(await f.serving, { code: 1 });
  assert.deepEqual(f.actions, ['prepare']);
});
test('gateway mismatched site binding prevents startup mutation', async (t) => {
  const f = await pair(t);
  f.input.siteDigest = '0'.repeat(64);
  await assert.rejects(f.connect(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
  assert.deepEqual(f.actions, []);
});
test('empty startup receipt cannot be mistaken for reviewed file preparation', async (t) => {
  const f = await pair(t, 'empty-files');
  const client = await f.connect();
  await assert.rejects(client.prepare(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
  assert.deepEqual(await f.serving, { code: 1 });
});
test('nested signal request cannot write startup journal entries', async (t) => {
  const f = await pair(t, 'nested-write');
  const client = await f.connect();
  f.phase('stopped');
  await assert.rejects(client.retire(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
  assert.deepEqual(
    f.events.map((e) => e.phase),
    ['registration-delete-intent'],
  );
  assert.equal(f.actions.includes('signal'), false);
});
test('changed receiver approval is checked again before the next owned effect', async (t) => {
  const f = await pair(t, 'scope-drift');
  const client = await f.connect();
  await assert.rejects(client.prepare(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
  assert.deepEqual(f.actions, []);
});

for (const fault of [
  'none',
  'phase',
  'candidate',
  'deadline',
  'query-ack',
  'detach-ack',
  'late-effect',
]) {
  test(`same gateway postopen ${fault} uses original deadline and never replays`, async (t) => {
    const initial = Date.now();
    let time = initial;
    const f = await pair(t, '', { now: () => time, reconcileByMs: initial + 90000 });
    const client = await f.connect();
    f.phase(fault === 'phase' ? 'verified' : 'reconciled');
    time = initial + 31000;
    const request = {
      stage: 'postopen',
      observedAtMs: time,
      identity: structuredClone(f.identity),
      orders: [],
    };
    if (fault === 'candidate') request.identity.bootId = '3'.repeat(32);
    if (fault === 'deadline') time = initial + 90000;
    if (fault === 'query-ack') {
      const write = f.downstream.write.bind(f.downstream);
      f.downstream.write = (chunk, ...args) => {
        const frame = JSON.parse(chunk.toString());
        if (frame.type === 'result' && frame.seq === 2) {
          f.downstream.destroy();
          return false;
        }
        return write(chunk, ...args);
      };
    }
    if (fault === 'late-effect') {
      await assert.rejects(client.prepare(), /UNPROVEN/);
      assert.equal(f.actions.length, 0);
      return;
    }
    if (['phase', 'candidate', 'deadline', 'query-ack'].includes(fault)) {
      await assert.rejects(client.queryOrders(request), /UNPROVEN/);
      await assert.rejects(client.queryOrders(request), /UNPROVEN/);
      assert(f.actions.filter((a) => a === 'query').length <= 1);
      return;
    }
    assert.deepEqual(await client.queryOrders(request), []);
    if (fault === 'detach-ack') {
      const write = f.downstream.write.bind(f.downstream);
      f.downstream.write = (chunk, ...args) => {
        const frame = JSON.parse(chunk.toString());
        if (frame.type === 'result' && frame.seq === 3) {
          f.downstream.destroy();
          return false;
        }
        return write(chunk, ...args);
      };
      await assert.rejects(client.close(), /UNPROVEN/);
      await assert.rejects(client.close(), /UNPROVEN/);
    } else await client.close();
    assert.deepEqual(f.actions, ['query']);
  });
}

test('gateway connection preserves owner and open refusal stages without secret text', async (t) => {
  for (const stage of ['GATEWAY_OWNER', 'GATEWAY_OPEN']) {
    const f = await pair(t);
    if (stage === 'GATEWAY_OWNER')
      f.io.journal.assertOwnership = async () => {
        throw Error('PRIVATE_SECRET');
      };
    else
      f.io.open = async () => {
        throw Error('PRIVATE_SECRET');
      };
    await assert.rejects(f.connect(), (error) => {
      assert.equal(error.message, 'CUTOVER_GATEWAY_SESSION_UNPROVEN');
      assert.equal(ingressDiagnosticStage(error), stage);
      assert.equal(JSON.stringify(error.cause).includes('PRIVATE_SECRET'), false);
      return true;
    });
    assert.deepEqual(f.events, []);
  }
});
