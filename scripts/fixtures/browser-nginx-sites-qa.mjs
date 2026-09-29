// Disposable private-PID/network QA only. Extracted from browser-site-fence-linux.
// The caller owns the real application, journal, window and writer observations.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import https from 'node:https';
import { promisify } from 'node:util';
import { describeCutoverSite } from '/source/browser-first-cutover-fence.mjs';
import { createFirstCutoverIngressPair } from '/source/browser-first-cutover-ingress-session.mjs';

export async function createQaNginxSites({ fencedCallbackPort } = {}) {
  assert.ok(fencedCallbackPort === undefined || fencedCallbackPort === 4010);
  await fs.access('/.dockerenv');
  assert.equal(process.getuid(), 0);
  const exec = (file, args) => promisify(execFile)(file, args, { encoding: 'utf8' });
  const hash = (b) => createHash('sha256').update(b).digest('hex');
  const root = await fs.mkdtemp('/tmp/holaday-site-fence-');
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
        // The joined fixture has one real retired gateway callback simulator,
        // not an old origin application. Rebind ONLY generated maintenance
        // configs; restored original configs MUST reach the real new :4001.
        if (fencedCallbackPort && site.profile === 'vultr-20260926' && source !== site.original)
          source = source.replaceAll(
            'http://127.0.0.1:4001',
            `http://127.0.0.1:${fencedCallbackPort}`,
          );
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
  function request(
    site,
    uri,
    { method = 'GET', body = '', host, ipv6 = false, headers = {} } = {},
  ) {
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

  let child;
  let completion;
  let started = false;
  let pair;
  const remoteSiteDigest = hash('qa-network-site');
  return {
    root,
    sites,
    render,
    request,
    prelude,
    approval: (inventoryDigest) =>
      JSON.parse(
        JSON.stringify({ inventoryDigest, unknownIngress: [], remoteSiteDigest, files: sites }),
      ),
    async start() {
      assert.equal(started, false);
      await render();
      await exec('nginx', ['-c', `${root}/nginx.conf`]);
      started = true;
    },
    async snapshot(host) {
      return Promise.all(
        sites
          .filter((s) => (s.profile === 'vultr-20260926') === (host === 'vultr'))
          .map(async (s) => {
            const stat = await fs.stat(s.enabledPath);
            let resolved = await fs.realpath(s.enabledPath);
            if (resolved.startsWith(`${root}/aliyun-generated/`))
              resolved = `/etc/nginx/holaday-maintenance/${resolved.slice(`${root}/aliyun-generated/`.length)}`;
            return {
              path: s.enabledPath,
              resolved,
              digest: hash(await fs.readFile(s.enabledPath)),
              uid: stat.uid,
              gid: stat.gid,
              mode: stat.mode & 0o777,
            };
          }),
      );
    },
    executionIdentities() {
      return pair ? pair.readExecutionIdentities() : [];
    },
    async connect(input, deps) {
      assert.equal(pair, undefined);
      const { binding, maintenanceEndsAtMs } = input;
      const site = {
        binding,
        maintenanceEndsAtMs,
        siteDigest: remoteSiteDigest,
        ingress: {
          inventoryDigest: binding.inventoryDigest,
          unknownIngress: [],
          files: sites.filter((s) => s.profile !== 'vultr-20260926'),
        },
      };
      await fs.mkdir(`${root}/aliyun-maintenance`, { mode: 0o700 });
      await fs.writeFile(
        `${root}/session.json`,
        JSON.stringify({ site, root, prelude, sites, loseEdgeAck: false, fencedCallbackPort }),
        { mode: 0o600 },
      );
      const ca = await fs.readFile(`${root}/cert.pem`);
      pair = await createFirstCutoverIngressPair(input, {
        ...deps,
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
              assert.equal(options.rejectUnauthorized, true);
              return https.request({ ...options, port: 4443, ca }, callback);
            },
          },
        },
        remote: {
          open: async (file, args, options) => {
            assert.equal(file, '/usr/bin/ssh');
            assert.equal(args.at(-1), `holaday-cutover-v1 ingress ${binding.attempt}`);
            assert.equal(options.shell, false);
            child = spawn(
              '/usr/bin/node',
              ['/source/fixtures/browser-ingress-session-child.mjs', `${root}/session.json`],
              { stdio: ['pipe', 'pipe', 'inherit'] },
            );
            completion = new Promise((resolve) => child.once('close', (code) => resolve({ code })));
            return { input: child.stdout, output: child.stdin, completion };
          },
        },
      });
      return pair;
    },
    async assertRestored(identity) {
      const receipts = await pair.readFenceReceipts();
      assert.equal(receipts.length, 2);
      for (const r of receipts) {
        assert.equal(r.receipt.phase, 'restored');
        assert.deepEqual(r.receipt.identity, identity);
      }
      for (const s of sites) {
        assert.equal(await fs.readFile(s.enabledPath, 'utf8'), s.original);
        assert.equal(await fs.realpath(s.enabledPath), s.sourcePath);
        const stat = await fs.stat(s.sourcePath);
        assert.equal(stat.uid, s.sourceUid);
        assert.equal(stat.gid, s.sourceGid);
        assert.equal(stat.mode & 0o777, s.sourceMode);
        for (const l of s.links) assert.equal(await fs.readlink(l.path), l.target);
      }
      // Real candidate via origin AND China edge. Unknown read-only route, no task.
      for (const s of sites.filter((s) => s.profile !== 'aliyun-pay-20260926')) {
        const response = await request(s, '/api/qa-admission-probe');
        assert.equal(response.status, 404);
      }
    },
    async close() {
      child?.stdin.end();
      if (completion) await completion;
      if (started) await exec('nginx', ['-s', 'quit', '-c', `${root}/nginx.conf`]);
    },
  };
}
