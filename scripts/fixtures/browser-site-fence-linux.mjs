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
import { describeCutoverSite, probeCutoverIngress } from '/source/browser-first-cutover-fence.mjs';
import { connectFirstCutoverIngressSession } from '/source/browser-first-cutover-ingress-session.mjs';
import { readCutoverNginxRuntime } from '/source/browser-first-cutover-nginx.mjs';
import { acquireReleaseJournal } from '/source/browser-maintenance-journal.mjs';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
const exec = (file, args) => promisify(execFile)(file, args, { encoding: 'utf8' });
const hash = (b) => createHash('sha256').update(b).digest('hex');
const root = await fs.mkdtemp('/tmp/holaday-site-fence-');
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
const names = ['holaday.ai', 'hd-app.orangebench.tech', 'hd-pay.orangebench.tech'];
await exec('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-days',
  '1',
  '-subj',
  '/CN=holaday.ai',
  '-addext',
  'subjectAltName=DNS:holaday.ai,DNS:hd-app.orangebench.tech,DNS:hd-pay.orangebench.tech',
  '-keyout',
  `${root}/key.pem`,
  '-out',
  `${root}/cert.pem`,
]);
for (const name of names) {
  const directory = `/etc/letsencrypt/live/${name}`;
  await fs.mkdir(directory, { recursive: true });
  await fs.copyFile(`${root}/key.pem`, `${directory}/privkey.pem`);
  await fs.copyFile(`${root}/cert.pem`, `${directory}/fullchain.pem`);
}
await fs.copyFile(`${root}/cert.pem`, '/etc/ssl/certs/ca-certificates.crt');
await fs.writeFile('/etc/letsencrypt/options-ssl-nginx.conf', 'ssl_protocols TLSv1.2 TLSv1.3;\n');
await exec('openssl', [
  'genpkey',
  '-genparam',
  '-algorithm',
  'DH',
  '-pkeyopt',
  'group:ffdhe2048',
  '-out',
  '/etc/letsencrypt/ssl-dhparams.pem',
]);
for (const directory of [
  '/opt/holaday-landing',
  '/opt/holaday-edge/current/apps/holaday-landing',
  '/opt/holaday-monorepo/apps/web-workbench/dist',
  '/opt/holaday-edge/current/apps/web-workbench/dist',
]) {
  await fs.mkdir(`${directory}/assets`, { recursive: true });
  await fs.writeFile(`${directory}/index.html`, 'qa-static');
  await fs.writeFile(`${directory}/assets/app.js`, 'qa-asset');
}
const sites = await Promise.all(
  [
    ['vultr-20260926', 'holaday', 4443],
    ['aliyun-app-20260926', 'hd-app.orangebench.tech', 443],
    ['aliyun-pay-20260926', 'hd-pay.orangebench.tech', 4444],
  ].map(async ([profile, name, port]) => {
    const original = await fs.readFile(`/source/fixtures/cutover-nginx/${name}.conf`, 'utf8');
    const path = `/etc/nginx/sites-available/${name}`;
    const enabledPath = `/etc/nginx/sites-enabled/${name}`;
    const linked = profile === 'aliyun-app-20260926';
    const sourcePath = linked
      ? '/opt/holaday-edge/releases/20260905035410-30748/ops/aliyun-edge/nginx-hd-app.conf'
      : path;
    await fs.mkdir(sourcePath.slice(0, sourcePath.lastIndexOf('/')), { recursive: true });
    await fs.writeFile(sourcePath, original, { mode: 0o644 });
    if (linked) {
      await fs.chown(sourcePath, 501, 50);
      await fs.symlink(sourcePath, path);
    }
    const target = `../sites-available/${name}`;
    await fs.symlink(target, enabledPath);
    return {
      ...describeCutoverSite(original, profile),
      path,
      original,
      port,
      enabledPath,
      sourcePath,
      sourceUid: linked ? 501 : 0,
      sourceGid: linked ? 50 : 0,
      sourceMode: 0o644,
      sourceStat: await fs.lstat(sourcePath),
      links: [{ path: enabledPath, target }, ...(linked ? [{ path, target: sourcePath }] : [])],
    };
  }),
);
// Each unmodified source must parse on its original ports first. Combined live
// fixture rebinds ONLY listeners and the edge's origin IP to loopback; it retains
// URI rewriting, TLS SNI/verification, headers, locations and exact body bytes.
const prelude = `pid /run/nginx.pid; error_log ${root}/error.log; events {}\nhttp { access_log off;\n`;
for (const site of sites) {
  const map = site.profile.startsWith('aliyun-app')
    ? 'map $http_upgrade $connection_upgrade { default upgrade; "" close; }\n'
    : '';
  await fs.writeFile(`${root}/single.conf`, `${prelude}${map}${site.original}\n}\n`);
  await exec('nginx', ['-t', '-c', `${root}/single.conf`]);
}
async function render() {
  const bytes = await Promise.all(
    sites.map(async (site) => {
      let source = await fs.readFile(site.enabledPath, 'utf8');
      source = source
        .replaceAll('listen 443 ', `listen ${site.port} `)
        .replaceAll('listen [::]:443 ', `listen [::]:${site.port} `);
      if (site.profile.startsWith('aliyun-app'))
        source = source.replaceAll(
          'proxy_pass https://207.148.70.106;',
          'proxy_pass https://127.0.0.1:4443;',
        );
      return source;
    }),
  );
  const unrelated =
    'server { listen 127.0.0.1:4999; location /qa-held { proxy_buffering off; proxy_pass http://127.0.0.1:4001; } }';
  await fs.writeFile(`${root}/nginx.conf`, `${prelude}${bytes.join('\n')}\n${unrelated}\n}\n`);
}
function request(site, uri, { method = 'GET', body = '', host, ipv6 = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: ipv6 ? '::1' : '127.0.0.1',
        port: site.port,
        servername: site.locations[0].serverName,
        rejectUnauthorized: false,
        path: uri,
        method,
        agent: false,
        headers: { host: host ?? site.locations[0].serverName, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (b) => chunks.push(b));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('fixture request timeout')));
    req.end(body);
  });
}
const inventoryDigest = 'a'.repeat(64);
const maintenanceEndsAtMs = Date.now() + 60000;
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
  ingress: await io.readApprovedIngress(),
};
await fs.writeFile(`${root}/session.json`, JSON.stringify({ site, root, prelude, sites }), {
  mode: 0o600,
});
const ingress = await connectFirstCutoverIngressSession(
  { binding, maintenanceEndsAtMs, siteDigest: site.siteDigest },
  {
    journal,
    observeWriters: io.observeWriters,
    verifyOpenedIdentity: io.verifyOpenedIdentity,
    open: async (file, args, options) => {
      assert.equal(file, '/usr/bin/ssh');
      assert.equal(args.at(-1), `holaday-cutover-v1 ingress ${binding.attempt}`);
      assert.equal(options.shell, false);
      const child = spawn(
        '/opt/node22/bin/node',
        ['/source/fixtures/browser-ingress-session-child.mjs', `${root}/session.json`],
        { stdio: ['pipe', 'pipe', 'inherit'] },
      );
      const completion = new Promise((resolve) => child.once('close', (code) => resolve({ code })));
      return { input: child.stdout, output: child.stdin, completion };
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
      await ingress.fenceOrders();
    } else {
      // Journal steps below model business/producer completion only. The nginx,
      // file and network effects are actual; no DB or provider is represented.
      for (const phase of ['legacy_settled', 'producers_stopped', 'all_fenced'])
        await journal.persist(phase, { candidate: binding.candidate });
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
    const persisted = JSON.parse(
      await fs.readFile(
        `/var/lib/holaday-deploy/maintenance/${binding.attempt}.ingress.json`,
        'utf8',
      ),
    );
    assert.equal(persisted.stage, stage);
    assert.equal(persisted.phase, 'active');
    assert.equal(persisted.attempt, (await journal.assertOwnership()).attempt);
    for (const site of sites) {
      const stat = await fs.lstat(site.sourcePath);
      assert.equal(stat.ino, site.sourceStat.ino);
      assert.equal(stat.uid, site.sourceUid);
      assert.equal(hash(await fs.readFile(site.sourcePath)), site.digest);
      assert((await fs.readlink(site.enabledPath)).startsWith('/etc/nginx/holaday-maintenance/'));
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
  assert.equal((await ingress.readFenceReceipt()).phase, 'restored');
  await ingress.close();
  console.log(
    'session: separate receiver process used live parent journal across both fences and restoration',
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
  console.error(await fs.readFile(`${root}/error.log`, 'utf8').catch(() => 'no nginx log'));
  throw error;
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
