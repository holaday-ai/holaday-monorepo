// Run only in the disposable --network none Linux QA container. No credentials.
// Real nginx/TLS/proxying against recorded configs; mock application backends.
// This proves forwarding/fencing, NOT provider verification or host-wide isolation.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  applyCutoverFence,
  describeCutoverSite,
  restoreCutoverIngress,
} from '/source/browser-first-cutover-fence.mjs';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
const exec = (file, args) => promisify(execFile)(file, args, { encoding: 'utf8' });
const hash = (b) => createHash('sha256').update(b).digest('hex');
const root = await fs.mkdtemp('/tmp/holaday-site-fence-');
const records = [];
const backends = [];
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
  'subjectAltName=DNS:holaday.ai',
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
    await fs.writeFile(path, original);
    return { ...describeCutoverSite(original, profile), path, original, port };
  }),
);
// Each unmodified source must parse on its original ports first. Combined live
// fixture rebinds ONLY listeners and the edge's origin IP to loopback; it retains
// URI rewriting, TLS SNI/verification, headers, locations and exact body bytes.
const prelude = `pid ${root}/nginx.pid; error_log ${root}/error.log; events {}\nhttp { access_log off;\n`;
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
      let source = await fs.readFile(site.path, 'utf8');
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
  await fs.writeFile(`${root}/nginx.conf`, `${prelude}${bytes.join('\n')}\n}\n`);
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
let receipt;
let expectedStage;
const inventoryDigest = 'a'.repeat(64);
const io = {
  now: Date.now,
  assertJournalOwnership: async () => ({
    inventoryDigest,
    attempt: '11111111-1111-4111-8111-111111111111',
  }),
  readApprovedIngress: async () => ({ inventoryDigest, unknownIngress: [], files: sites }),
  readFenceReceipt: async () => receipt,
  persistFenceReceipt: async (r) => {
    receipt = structuredClone(r);
  },
  readConfig: (path) => fs.readFile(path, 'utf8'),
  backupOriginal: async (f, b) => {
    await fs.writeFile(`${root}/${f.originalDigest}.backup`, b, { flag: 'wx', mode: 0o600 });
    return hash(b);
  },
  readBackup: (f) => fs.readFile(`${root}/${f.backupDigest}.backup`, 'utf8'),
  replaceConfig: async (path, expected, bytes) => {
    assert.equal(hash(await fs.readFile(path)), expected);
    await fs.writeFile(path, bytes);
  },
  testNginx: async () => {
    await render();
    await exec('nginx', ['-t', '-c', `${root}/nginx.conf`]);
  },
  reloadNginx: async () => {
    const master = (await fs.readFile(`${root}/nginx.pid`, 'utf8')).trim();
    const oldWorkers = (await fs.readFile(`/proc/${master}/task/${master}/children`, 'utf8'))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    await exec('nginx', ['-s', 'reload', '-c', `${root}/nginx.conf`]);
    // This fixture has no established long-lived sockets. Wait for the previous
    // workers to retire instead of mistaking a few new-worker responses for a
    // completed reload. Production must separately account for existing sockets.
    for (let n = 0; ; n++) {
      const alive = await Promise.all(
        oldWorkers.map((pid) =>
          fs.access(`/proc/${pid}`).then(
            () => true,
            () => false,
          ),
        ),
      );
      if (alive.every((v) => !v)) break;
      if (n >= 100) throw new Error('old fixture nginx workers did not retire');
      await sleep(50);
    }
    // Reload acknowledgment is not worker activation: wait on observed responses.
    for (let n = 0; ; n++) {
      const responses = await Promise.all(
        sites.flatMap((site) => [
          request(site, site.profile.startsWith('aliyun-pay') ? '/payment/create' : '/api/tasks'),
          request(
            site,
            site.profile.startsWith('aliyun-pay')
              ? '/payment/wechat/notify'
              : '/api/internal/payment/confirm',
            { method: 'POST' },
          ),
        ]),
      );
      if (
        responses.every(
          (r, i) =>
            r.status ===
            (i % 2 ? (expectedStage === 'all-writers' ? 503 : 401) : expectedStage ? 503 : 200),
        )
      )
        break;
      if (n >= 50) throw new Error('reload did not activate the expected routes');
      await sleep(50);
    }
  },
  probeIngress: async (approval) => ({
    inventoryDigest,
    observedAtMs: Date.now(),
    // Synthetic non-HTTP facts: never claim this fixture proves real writers stopped.
    existingSockets: 0,
    internalWriters: 0,
    producersRunning: 0,
    probes: await Promise.all(
      approval.files.flatMap((site) =>
        site.locations
          .filter((r) => r.kind !== 'health')
          .map(async (r) => {
            const literal = r.selector.replace(/^(?:=|\^~) /, '');
            const uri =
              r.kind === 'business' && literal !== '/ws' ? `${literal}fixture-write` : literal;
            const response = await request(site, uri, {
              method: 'POST',
              ipv6: r.listen.startsWith('[::]'),
            });
            return {
              ...r,
              path: site.path,
              status: response.status,
              noStore: response.headers['cache-control'] === 'no-store',
            };
          }),
      ),
    ),
  }),
  verifyOpenedIdentity: async (identity) => ({ identity, mode: 'serving' }),
};
for (const [name, operation] of Object.entries(io)) {
  if (name === 'now') continue;
  io[name] = async (...args) => {
    try {
      const value = await operation(...args);
      if (name === 'probeIngress') {
        const failures = value.probes.filter((p) =>
          p.kind === 'business' || expectedStage === 'all-writers'
            ? p.status !== 503 || !p.noStore
            : p.status !== 401,
        );
        if (failures.length) console.error('unexpected HTTP probes:', JSON.stringify(failures));
      }
      return value;
    } catch (error) {
      console.error(`fixture IO ${name}:`, error.message);
      throw error;
    }
  };
}
try {
  await render();
  await exec('nginx', ['-c', `${root}/nginx.conf`]);
  for (const stage of ['orders', 'all-writers']) {
    expectedStage = stage;
    await applyCutoverFence({ inventoryDigest, stage }, io);
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
  expectedStage = undefined;
  await restoreCutoverIngress(
    { inventoryDigest, identity: { candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) } },
    io,
  );
  for (const site of sites) assert.equal(await fs.readFile(site.path, 'utf8'), site.original);
  console.log('restore: exact originals and real reopened upstreams passed');
} catch (error) {
  console.error(await fs.readFile(`${root}/error.log`, 'utf8').catch(() => 'no nginx log'));
  throw error;
} finally {
  await exec('nginx', ['-s', 'quit', '-c', `${root}/nginx.conf`]).catch(() => {});
  for (const server of backends) {
    server.closeAllConnections();
    server.close();
  }
}
