import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
const api = await import('./browser-first-cutover-gateway-session.mjs').catch(() => ({}));
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
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
async function pair(t, mode = '') {
  assert.equal(typeof api.connectFirstCutoverGatewaySession, 'function');
  assert.equal(typeof api.serveFirstCutoverGatewaySession, 'function');
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  t.after(() => {
    upstream.destroy();
    downstream.destroy();
  });
  const input = { binding, maintenanceEndsAtMs: Date.now() + 30000, siteDigest: 'e'.repeat(64) };
  const site = { ...input, startupFiles: [] };
  let siteChanged = false;
  let phase = 'producers_stopped';
  const events = [];
  const actions = [];
  const target = { pid: 123, role: 'gateway' };
  const record = () => ({ ...binding, phase });
  const serving = api
    .serveFirstCutoverGatewaySession(
      { attempt: binding.attempt },
      {
        input: upstream,
        output: downstream,
        readSite: async () => {
          if (mode === 'reject-site') throw new Error('private scope');
          return siteChanged ? { ...site, siteDigest: 'f'.repeat(64) } : site;
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
