import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  applyCutoverFence,
  restoreCutoverIngress,
  verifyCutoverFence,
} from './browser-first-cutover-fence.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const original = `server {
 listen 127.0.0.1:8080;
 server_name fixture.local;
 location /api/ { proxy_pass http://127.0.0.1:4001; }
 location = /payment/notify { proxy_pass http://127.0.0.1:4010; }
 location = /health { return 200; }
}\n`;
const digest = 'a'.repeat(64);
function fixture() {
  let bytes = original;
  let receipt;
  let backup;
  const events = [];
  const input = { inventoryDigest: digest, stage: 'orders' };
  const file = {
    path: '/etc/nginx/conf.d/holaday.conf',
    digest: hash(original),
    locations: [
      {
        serverName: 'fixture.local',
        listen: '127.0.0.1:8080',
        selector: '/api/',
        kind: 'business',
      },
      {
        serverName: 'fixture.local',
        listen: '127.0.0.1:8080',
        selector: '= /payment/notify',
        kind: 'callback',
      },
      {
        serverName: 'fixture.local',
        listen: '127.0.0.1:8080',
        selector: '= /health',
        kind: 'health',
      },
    ],
  };
  const io = {
    now: () => 1000,
    assertJournalOwnership: async () => ({
      inventoryDigest: digest,
      attempt: '11111111-1111-4111-8111-111111111111',
    }),
    readApprovedIngress: async () => ({
      inventoryDigest: digest,
      unknownIngress: [],
      files: [structuredClone(file)],
    }),
    readConfig: async (p) => {
      assert.equal(p, file.path);
      return bytes;
    },
    readFenceReceipt: async () => receipt,
    backupOriginal: async (_f, b) => {
      events.push('backup');
      backup = b;
      return hash(b);
    },
    readBackup: async () => backup,
    replaceConfig: async (p, expected, b) => {
      assert.equal(p, file.path);
      assert.equal(hash(bytes), expected);
      events.push('replace');
      bytes = b;
    },
    testNginx: async () => {
      events.push('test');
    },
    reloadNginx: async () => {
      events.push('reload');
    },
    persistFenceReceipt: async (r) => {
      events.push(`receipt:${r.phase}`);
      receipt = structuredClone(r);
    },
    probeIngress: async () => ({
      observedAtMs: 1000,
      inventoryDigest: digest,
      probes: [
        {
          path: file.path,
          selector: '/api/',
          serverName: 'fixture.local',
          listen: '127.0.0.1:8080',
          status: 503,
          noStore: true,
        },
        {
          path: file.path,
          selector: '= /payment/notify',
          serverName: 'fixture.local',
          listen: '127.0.0.1:8080',
          status: receipt?.stage === 'all-writers' ? 503 : 400,
          noStore: true,
        },
      ],
      existingSockets: 0,
      internalWriters: 0,
      producersRunning: 0,
    }),
    verifyOpenedIdentity: async (id) => ({ identity: id, mode: 'serving' }),
  };
  return {
    io,
    input,
    events,
    file,
    bytes: () => bytes,
    setBytes: (b) => {
      bytes = b;
    },
  };
}

test('orders fencing backs up before replacement and preserves callbacks until all-writers', async () => {
  const f = fixture();
  await applyCutoverFence(f.input, f.io);
  assert(f.bytes().indexOf('return 503') > f.bytes().indexOf('location /api/'));
  assert(!f.bytes().slice(f.bytes().indexOf('location = /payment/notify')).includes('return 503'));
  assert(f.events.indexOf('backup') < f.events.indexOf('replace'));
  assert(f.events.indexOf('test') < f.events.indexOf('reload'));
  assert(f.events.indexOf('receipt:installing') < f.events.indexOf('replace'));
  await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  assert(f.bytes().slice(f.bytes().indexOf('location = /payment/notify')).includes('return 503'));
  const result = await verifyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  assert.equal(result.stage, 'all-writers');
});

test('unmapped or conflicting route and unsupported nginx rewrites refuse before changes', async () => {
  for (const change of [
    (f) => {
      f.file.locations.pop();
    },
    (f) => {
      f.file.locations[0].kind = 'health';
    },
    (f) => {
      const b = original.replace(
        'server_name fixture.local;',
        'server_name fixture.local; error_page 503 =200 /health;',
      );
      f.file.digest = hash(b);
      f.setBytes(b);
    },
    (f) => {
      const read = f.io.readApprovedIngress;
      f.io.readApprovedIngress = async () => ({ ...(await read()), unknownIngress: ['other'] });
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
    assert.deepEqual(f.events, []);
  }
});

test('nginx validation failure never reloads or marks active', async () => {
  const f = fixture();
  f.io.testNginx = async () => {
    throw new Error('invalid config');
  };
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
  assert(!f.events.includes('reload'));
  assert(!f.events.includes('receipt:active'));
});

test('config replaced after nginx validation is not reloaded', async () => {
  const f = fixture();
  f.io.testNginx = async () => {
    f.setBytes(original);
  };
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
  assert.equal(f.events.includes('reload'), false);
});

test('HTTP 503 does not prove existing WebSocket, direct writers or producers stopped', async () => {
  for (const key of ['existingSockets', 'internalWriters', 'producersRunning']) {
    const f = fixture();
    await applyCutoverFence(f.input, f.io);
    await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
    const probe = f.io.probeIngress;
    f.io.probeIngress = async () => ({ ...(await probe()), [key]: 1 });
    await assert.rejects(
      verifyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io),
      /CUTOVER_FENCE_/,
    );
  }
});

test('missing or successful invalid-signature probe cannot prove callback fencing', async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    await applyCutoverFence(f.input, f.io);
    await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
    const probe = f.io.probeIngress;
    f.io.probeIngress = async () => {
      const r = await probe();
      if (missing) r.probes.pop();
      else r.probes[1].status = 200;
      return r;
    };
    await assert.rejects(
      verifyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io),
      /CUTOVER_FENCE_/,
    );
  }
});

test('drifted original is not overwritten and drifted generated config is not restored', async () => {
  const f = fixture();
  f.setBytes(`${original}# another owner\n`);
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
  assert.deepEqual(f.events, []);
  f.setBytes(original);
  await applyCutoverFence(f.input, f.io);
  await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  f.setBytes(`${f.bytes()}# another owner\n`);
  const before = f.bytes();
  await assert.rejects(
    restoreCutoverIngress(
      { inventoryDigest: digest, identity: { candidate: 'c'.repeat(40), bootId: 'd'.repeat(32) } },
      f.io,
    ),
    /CUTOVER_FENCE_/,
  );
  assert.equal(f.bytes(), before);
});

test('restoration requires same open identity, restores exact original and revalidates before reload', async () => {
  const f = fixture();
  await applyCutoverFence(f.input, f.io);
  await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  const identity = { candidate: 'c'.repeat(40), bootId: 'd'.repeat(32) };
  const verify = f.io.verifyOpenedIdentity;
  f.io.verifyOpenedIdentity = async () => ({
    identity: { ...identity, bootId: 'f'.repeat(32) },
    mode: 'serving',
  });
  await assert.rejects(
    restoreCutoverIngress({ inventoryDigest: digest, identity }, f.io),
    /CUTOVER_FENCE_/,
  );
  f.io.verifyOpenedIdentity = verify;
  await restoreCutoverIngress({ inventoryDigest: digest, identity }, f.io);
  assert.equal(f.bytes(), original);
  assert.deepEqual(f.events.slice(-4), ['replace', 'test', 'reload', 'receipt:restored']);
});
