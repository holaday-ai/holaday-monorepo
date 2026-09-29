// Run only in disposable --network none Linux QA with NET_ADMIN/SYS_PTRACE in
// its own PID/network namespaces. No host PID namespace or credentials.
// Real nginx/TLS/proxying against recorded configs; mock application backends.
// This proves forwarding/fencing, NOT provider verification or host-wide isolation.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { promisify } from 'node:util';
import { probeCutoverIngress } from '/source/browser-first-cutover-fence.mjs';
import { createFirstCutoverIngressLifecycle } from '/source/browser-first-cutover-host.mjs';
import {
  connectFirstCutoverIngressSession,
  createFirstCutoverIngressPair,
} from '/source/browser-first-cutover-ingress-session.mjs';
import { readCutoverNginxRuntime } from '/source/browser-first-cutover-nginx.mjs';
import { acquireReleaseJournal } from '/source/browser-maintenance-journal.mjs';
import { createQaNginxSites } from '/source/fixtures/browser-nginx-sites-qa.mjs';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
await fs.copyFile('/opt/node22/bin/node', '/usr/bin/node');
assert(
  process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--lose-edge-ack'),
);
const loseEdgeAck = process.argv[2] === '--lose-edge-ack';
const exec = (file, args) => promisify(execFile)(file, args, { encoding: 'utf8' });
const hash = (b) => createHash('sha256').update(b).digest('hex');
const { root, sites, render, request, prelude } = await createQaNginxSites();
const records = [];
const backends = [];
let heldBackend;
let heldClient;
for (const port of [4001, 4002, 4010, 6080]) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    records.push({
      port,
      uri: req.url,
      body: Buffer.concat(chunks).toString(),
      headers: req.headers,
    });
    if (port === 4001 && req.url === '/qa-held') {
      heldBackend = res;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('initial\n');
      return;
    }
    res.statusCode = /\/(?:notify|webhook|confirm)(?:\?|$)/.test(req.url) ? 401 : 200;
    res.end('qa-backend');
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  backends.push(server);
}
const inventoryDigest = 'a'.repeat(64);
const maintenanceEndsAtMs = Date.now() + 120000;
const manifest = { synthetic: 'network-ingress-lifecycle-only' };
await fs.mkdir('/var/lib/holaday-deploy/maintenance', { recursive: true, mode: 0o700 });
const journal = await acquireReleaseJournal('/var/lib/holaday-deploy/maintenance', {
  kind: 'first-cutover',
  candidate: 'b'.repeat(40),
  configDigest: 'c'.repeat(64),
  migrationDigest: hash(JSON.stringify(manifest)),
  legacyDigest: 'e'.repeat(64),
  inventoryDigest,
  attempt: '11111111-1111-4111-8111-111111111111',
});
await journal.bindManifest(manifest);
const binding = await journal.assertOwnership();
const io = {
  now: Date.now,
  journal,
  readApprovedIngress: async () => ({ inventoryDigest, unknownIngress: [], files: sites }),
  // Business quiescence remains an explicit synthetic boundary of this fixture.
  observeWriters: async () => ({
    inventoryDigest,
    observedAtMs: Date.now(),
    existingSockets: 0,
    internalWriters: 0,
    producersRunning: 0,
  }),
  verifyOpenedIdentity: async (identity) => ({
    identity,
    mode: 'serving',
    idle: false,
    needsReconciliation: true,
  }),
};
for (const [name, operation] of Object.entries(io)) {
  if (name === 'now' || typeof operation !== 'function') continue;
  io[name] = async (...args) => {
    try {
      const value = await operation(...args);
      return value;
    } catch (error) {
      console.error(`fixture IO ${name}:`, error.message);
      throw error;
    }
  };
}
const site = {
  binding,
  maintenanceEndsAtMs,
  siteDigest: hash('qa-network-site'),
  ingress: {
    inventoryDigest,
    unknownIngress: [],
    files: sites.filter((s) => s.profile !== 'vultr-20260926'),
  },
};
await fs.mkdir(`${root}/aliyun-maintenance`, { mode: 0o700 });
await fs.writeFile(
  `${root}/session.json`,
  JSON.stringify({ site, root, prelude, sites, loseEdgeAck }),
  {
    mode: 0o600,
  },
);
const ca = await fs.readFile(`${root}/cert.pem`);
const ingress = await createFirstCutoverIngressPair(
  { binding, maintenanceEndsAtMs },
  {
    journal,
    createLocal: async (...args) => {
      try {
        return await createFirstCutoverIngressLifecycle(...args);
      } catch (error) {
        console.error('QA local construction:', error.message);
        throw error;
      }
    },
    connectRemote: async (...args) => {
      try {
        return await connectFirstCutoverIngressSession(...args);
      } catch (error) {
        console.error('QA remote construction:', error.message);
        throw error;
      }
    },
    observeWriters: io.observeWriters,
    verifyOpenedIdentity: io.verifyOpenedIdentity,
    // Production approvals are decoded JSON. Exclude fs.Stats prototypes from
    // fixture-only source metadata instead of pretending they are file content.
    readApprovedPair: async () =>
      JSON.parse(
        JSON.stringify({ ...(await io.readApprovedIngress()), remoteSiteDigest: site.siteDigest }),
      ),
    local: {
      nginx: {
        exec: async (file, args, options) => {
          assert.equal(file, '/usr/sbin/nginx');
          if (args[0] === '-t') await render();
          return (
            await promisify(execFile)(file, [...args, '-c', `${root}/nginx.conf`], {
              ...options,
              encoding: 'utf8',
            })
          ).stdout;
        },
      },
      ingressProbe: {
        request: (options, callback) => {
          assert.equal(options.servername, 'holaday.ai');
          return https.request({ ...options, port: 4443, ca }, callback);
        },
      },
    },
    remote: {
      open: async (file, args, options) => {
        assert.equal(file, '/usr/bin/ssh');
        assert.equal(args.at(-1), `holaday-cutover-v1 ingress ${binding.attempt}`);
        assert.equal(options.shell, false);
        const child = spawn(
          '/usr/bin/node',
          ['/source/fixtures/browser-ingress-session-child.mjs', `${root}/session.json`],
          { stdio: ['pipe', 'pipe', 'inherit'] },
        );
        const completion = new Promise((resolve) =>
          child.once('close', (code) => resolve({ code })),
        );
        return { input: child.stdout, output: child.stdin, completion };
      },
    },
  },
);
await journal.persist('prepared', { candidate: binding.candidate });
try {
  await render();
  await exec('nginx', ['-c', `${root}/nginx.conf`]);
  const heldText = [];
  heldClient = await new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:4999/qa-held', (response) => {
      response.on('data', (bytes) => heldText.push(bytes.toString()));
      response.once('data', () => resolve(response));
    });
    req.on('error', reject);
  });
  const originalWorkers = (await readCutoverNginxRuntime()).workers.map(
    (p) => `${p.pid}:${p.start}`,
  );
  for (const stage of ['orders', 'all-writers']) {
    if (stage === 'orders') {
      await journal.persist('orders_fenced', { candidate: binding.candidate });
      if (loseEdgeAck) {
        await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
        throw new Error('QA_EXPECTED_ACK_LOSS');
      }
      await ingress.fenceOrders();
      const before = await ingress.readFenceReceipts();
      assert.equal((await ingress.verifyOrders()).stage, 'orders');
      assert.deepEqual(await ingress.readFenceReceipts(), before);
    } else {
      // Journal steps below model business/producer completion only. The nginx,
      // file and network effects are actual; no DB or provider is represented.
      for (const phase of ['legacy_settled', 'producers_stopped'])
        await journal.persist(phase, { candidate: binding.candidate });
      assert.equal((await ingress.verifyOrders()).stage, 'orders');
      await journal.persist('all_fenced', { candidate: binding.candidate });
      await ingress.fenceAll();
      assert.equal((await ingress.verifyFence()).existingSockets, 0);
    }
    if (stage === 'orders') {
      // Trusted fixture CA above is explicit; untrusted TLS must never become
      // a successful maintenance observation or fall back to HTTP.
      const errors = [];
      await assert.rejects(
        probeCutoverIngress(await io.readApprovedIngress(), stage, {
          observeWriters: io.observeWriters,
          request: (options, callback) => {
            const site = sites.find((s) => s.locations[0].serverName === options.servername);
            const req = https.request({ ...options, port: site.port, ca: [] }, callback);
            req.on('error', (error) => errors.push(error.code));
            return req;
          },
        }),
        /CUTOVER_INGRESS_PROBE_UNPROVEN/,
      );
      assert.equal(errors.length, 37);
      assert.ok(errors.every((code) => code === 'DEPTH_ZERO_SELF_SIGNED_CERT'));
      console.log('TLS: untrusted certificates rejected for all 37 route/listener probes');
    }
    const receipts = await ingress.readFenceReceipts();
    assert.equal(receipts.length, 2);
    assert.deepEqual(
      receipts.map((r) => [r.host, r.receipt.files.length]),
      [
        ['vultr', 1],
        ['aliyun', 2],
      ],
    );
    for (const { receipt: persisted } of receipts) {
      assert.equal(persisted.stage, stage);
      assert.equal(persisted.phase, 'active');
      assert.equal(persisted.attempt, (await journal.assertOwnership()).attempt);
    }
    for (const site of sites) {
      const stat = await fs.lstat(site.sourcePath);
      assert.equal(stat.ino, site.sourceStat.ino);
      assert.equal(stat.uid, site.sourceUid);
      assert.equal(hash(await fs.readFile(site.sourcePath)), site.digest);
      assert(
        (await fs.readlink(site.enabledPath)).startsWith(
          site.profile === 'vultr-20260926'
            ? '/etc/nginx/holaday-maintenance/'
            : `${root}/aliyun-generated/`,
        ),
      );
    }
    for (const site of sites) {
      for (const route of site.locations.filter((r) => r.kind === 'health')) {
        assert.equal((await request(site, route.selector.slice(2))).status, 200);
      }
      if (!site.profile.startsWith('aliyun-pay')) {
        assert.equal((await request(site, '/')).body, 'qa-static');
        assert.equal((await request(site, '/assets/app.js')).body, 'qa-asset');
        assert.equal(
          (await request(site, '/api/internal/auth/sms-login', { method: 'POST' })).status,
          503,
        );
      }
      for (const route of site.locations.filter((r) => r.kind === 'callback')) {
        const uri = `${route.selector.slice(2)}?signature=invalid%20fixture`;
        const body = '{ "opaque": "中文\\n", "n": 1 }\r\n';
        const before = records.length;
        const result = await request(site, uri, {
          method: 'POST',
          body,
          headers: { 'x-cutover-fixture': 'raw-byte-test', 'content-type': 'application/json' },
        });
        assert.equal(result.status, stage === 'orders' ? 401 : 503);
        if (stage === 'orders') {
          assert.equal(records.length, before + 1);
          assert.equal(records.at(-1).body, body);
          assert.equal(records.at(-1).uri, uri.replace(/^\/api\//, '/'));
          assert.equal(records.at(-1).headers['x-cutover-fixture'], 'raw-byte-test');
        } else assert.equal(records.length, before);
        assert.equal(
          (await request(site, `${route.selector.slice(2)}/extra`, { method: 'POST' })).status,
          503,
        );
      }
    }
    assert.equal(
      (await request(sites[0], '/api/tasks', { host: 'hd-app.orangebench.tech' })).status,
      503,
    );
    assert.equal((await request(sites[0], '/api/tasks', { host: 'unknown.fixture' })).status, 503);
    assert.equal((await request(sites[0], '/', { host: 'www.holaday.ai' })).status, 301);
    assert.equal(
      (await request(sites[0], '/ws', { headers: { upgrade: 'websocket', connection: 'Upgrade' } }))
        .status,
      503,
    );
    console.log(
      `${stage}: real nginx IPv4/IPv6, chained TLS, body/URI, static, default-host and WS probes passed`,
    );
  }
  await journal.persist('stopped', { candidate: binding.candidate });
  await journal.persist('backup_verified', { candidate: binding.candidate });
  await journal.bindBackupReceipt({
    ...binding,
    restoredAtMs: Date.now(),
    backupDigest: '1'.repeat(64),
    databaseIdentityDigest: '2'.repeat(64),
    isolatedTargetDigest: '3'.repeat(64),
    encryptionProfileDigest: '4'.repeat(64),
    comparisonDigest: '5'.repeat(64),
    schemaDigest: '6'.repeat(64),
    businessDigest: '7'.repeat(64),
  });
  await journal.persist('migration_started', { candidate: binding.candidate });
  await journal.bindBootstrapSeed('8'.repeat(32));
  await journal.persist('candidate_started', { candidate: binding.candidate });
  const identity = { candidate: binding.candidate, bootId: 'c'.repeat(32) };
  await journal.persist('verified', { candidate: binding.candidate, identity });
  await ingress.restoreIngress(identity);
  assert((await ingress.readFenceReceipts()).every((r) => r.receipt.phase === 'restored'));
  await ingress.close();
  console.log(
    'pair: local origin and separate edge receiver used one live journal, separate receipts, both fences and restoration',
  );
  const runtime = await readCutoverNginxRuntime();
  assert.ok(
    runtime.workers.some((p) => originalWorkers.includes(`${p.pid}:${p.start}`) && p.shuttingDown),
  );
  assert.equal(heldClient.destroyed, false);
  const delivered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('unrelated stream lost after reload')), 3000);
    heldClient.once('data', (bytes) => {
      clearTimeout(timer);
      resolve(bytes.toString());
    });
  });
  heldBackend.write('still-connected\n');
  assert.equal(await delivered, 'still-connected\n');
  assert.equal(heldText.join(''), 'initial\nstill-connected\n');
  console.log(
    'unrelated stream: original draining worker and connection survive both fences and restore',
  );
  for (const site of sites) {
    assert.equal(await fs.readFile(site.path, 'utf8'), site.original);
    assert.equal(await fs.readlink(site.enabledPath), site.links[0].target);
    assert.equal((await fs.lstat(site.sourcePath)).uid, site.sourceUid);
    assert.equal((await fs.lstat(site.sourcePath)).ino, site.sourceStat.ino);
    const pay = site.profile.startsWith('aliyun-pay');
    assert.equal((await request(site, pay ? '/payment/create' : '/api/tasks')).status, 200);
    assert.equal(
      (
        await request(site, pay ? '/payment/wechat/notify' : '/api/internal/payment/confirm', {
          method: 'POST',
        })
      ).status,
      401,
    );
  }
  console.log(
    'restore: original link chains/UID501 inode preserved, protected backups and real reopened upstreams passed',
  );
} catch (error) {
  if (error.message !== 'QA_EXPECTED_ACK_LOSS' || !loseEdgeAck) {
    console.error(await fs.readFile(`${root}/error.log`, 'utf8').catch(() => 'no nginx log'));
    throw error;
  }
  const before = await readCutoverNginxRuntime();
  await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  await assert.rejects(ingress.fenceAll(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  const after = await readCutoverNginxRuntime();
  assert.deepEqual(after, before); // no second reload after uncertain outcome
  assert.equal((await journal.readFirstCutoverEffects()).phase, 'orders_fenced');
  for (const directory of ['/var/lib/holaday-deploy/maintenance', `${root}/aliyun-maintenance`]) {
    const receipt = JSON.parse(
      await fs.readFile(`${directory}/${binding.attempt}.ingress.json`, 'utf8'),
    );
    assert.equal(receipt.phase, 'active');
    assert.equal(receipt.stage, 'orders');
  }
  for (const site of sites) {
    assert.equal(
      (
        await request(
          site,
          site.profile.startsWith('aliyun-pay') ? '/payment/create' : '/api/tasks',
          { method: 'POST', body: '{}' },
        )
      ).status,
      503,
    );
    assert.equal(hash(await fs.readFile(site.sourcePath)), site.digest);
    assert.notEqual(await fs.readlink(site.enabledPath), site.links[0].target);
  }
  assert.equal(heldClient.destroyed, false);
  console.log(
    'lost ACK: actual edge receiver exited after reload; both physical fences/receipts remain, no replay/reload/restore, same retained journal',
  );
} finally {
  heldClient?.destroy();
  heldBackend?.end();
  await journal.close(); // Keep journal/receipt evidence; container removal owns cleanup.
  await exec('nginx', ['-s', 'quit', '-c', `${root}/nginx.conf`]).catch(() => {});
  for (const server of backends) {
    server.closeAllConnections();
    server.close();
  }
}
