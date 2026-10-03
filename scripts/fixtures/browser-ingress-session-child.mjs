import { ingressDiagnosticStage } from '/source/browser-first-cutover-ingress-diagnostics.mjs';
// Isolated network fixture child only, never a production entry or uploaded code.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import https from 'node:https';
import { promisify } from 'node:util';
import { createFirstCutoverIngressLifecycle } from '/source/browser-first-cutover-host.mjs';
import { serveFirstCutoverIngressSession } from '/source/browser-first-cutover-ingress-session.mjs';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
assert.match(process.argv[2], /^\/tmp\/holaday-site-fence-[a-zA-Z0-9]+\/session\.json$/);
const path = process.argv[2];
const raw = await fs.readFile(path, 'utf8');
const fixture = JSON.parse(raw);
const { site, root, prelude, sites } = fixture;
assert.equal(path, `${root}/session.json`);
const ca = await fs.readFile(`${root}/cert.pem`);
// The fixture shares one network namespace/nginx, but each logical host has an
// independent private receipt/backup/generated-file root. Never map production.
const mappings = [
  ['/var/lib/holaday-deploy/maintenance', `${root}/aliyun-maintenance`],
  ['/etc/nginx/holaday-maintenance', `${root}/aliyun-generated`],
];
const map = (p) => {
  const match = mappings.find(([from]) => p === from || p.startsWith(`${from}/`));
  return match ? match[1] + p.slice(match[0].length) : p;
};
const unmap = (p) => {
  const match = mappings.find(([, to]) => p === to || p.startsWith(`${to}/`));
  return match ? match[0] + p.slice(match[1].length) : p;
};
const disk = {
  ...fs,
  lstat: (p) => fs.lstat(map(p)),
  realpath: async (p) => unmap(await fs.realpath(map(p))),
  open: (p, ...args) => fs.open(map(p), ...args),
  mkdir: (p, options) => fs.mkdir(map(p), options),
  readlink: async (p) => unmap(await fs.readlink(map(p))),
  symlink: (a, b) => fs.symlink(map(a), map(b)),
  rename: (a, b) => fs.rename(map(a), map(b)),
};
// QA-only boundary diagnostics: no protocol payloads, site bytes or credentials.
let previousClock = -1;
const observedNow = () => {
  const now = Date.now();
  if (now < previousClock) console.error('QA_INGRESS_CLOCK_REGRESSED', previousClock - now);
  if (now >= site.maintenanceEndsAtMs)
    console.error('QA_INGRESS_DEADLINE_REACHED', now - site.maintenanceEndsAtMs);
  previousClock = now;
  return now;
};
try {
  await serveFirstCutoverIngressSession(
    { attempt: site.binding.attempt },
    {
      now: observedNow,
      // This mapped-network fixture is a custom entry, not the production fixed
      // SSH entry. Report its REAL kernel identity; default source/argv checking
      // is separately exercised by the real-sshd fixture without this override.
      readIdentity: async ({ role, attempt }) => {
        assert.equal(role, 'ingress');
        assert.equal(attempt, site.binding.attempt);
        const proc = `/proc/${process.pid}`;
        const fields = (await fs.readFile(`${proc}/stat`, 'utf8'))
          .split(') ')
          .at(-1)
          .trim()
          .split(/\s+/);
        return {
          role,
          bootId: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
          process: {
            pid: process.pid,
            ppid: Number(fields[1]),
            start: fields[19],
            uids: /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m
              .exec(await fs.readFile(`${proc}/status`, 'utf8'))
              .slice(1)
              .map(Number),
            cwd: await fs.readlink(`${proc}/cwd`),
            exe: await fs.readlink(`${proc}/exe`),
            argvDigest: createHash('sha256')
              .update(await fs.readFile(`${proc}/cmdline`))
              .digest('hex'),
            cgroup: await fs.readFile(`${proc}/cgroup`, 'utf8'),
          },
        };
      },
      createLifecycle: async (...args) => {
        const lifecycle = await createFirstCutoverIngressLifecycle(...args);
        for (const [name, operation] of Object.entries(lifecycle)) {
          if (typeof operation !== 'function') continue;
          lifecycle[name] = async (...values) => {
            try {
              return await operation(...values);
            } catch (error) {
              console.error('QA_INGRESS_LIFECYCLE_FAILED', name, error.message);
              throw error;
            }
          };
        }
        if (!fixture.loseEdgeAck) return lifecycle;
        return {
          ...lifecycle,
          fenceOrders: async () => {
            await lifecycle.fenceOrders();
            // Real effect completed; terminate only this disposable test receiver
            // before its response. Production has no failure-injection option.
            process.exit(71);
          },
        };
      },
      readSite: async () => {
        assert.equal(await fs.readFile(path, 'utf8'), raw);
        return structuredClone(site);
      },
      lifecycleIO: {
        fs: disk,
        nginx: {
          exec: async (file, args, options) => {
            assert.equal(file, '/usr/sbin/nginx');
            if (args[0] === '-t') {
              const source = await Promise.all(
                sites.map(async (s) => {
                  let bytes = await fs.readFile(s.enabledPath, 'utf8');
                  if (fixture.fencedCallbackPort !== undefined) {
                    assert.equal(fixture.fencedCallbackPort, 4010);
                    if (s.profile === 'vultr-20260926' && bytes !== s.original)
                      bytes = bytes.replaceAll('http://127.0.0.1:4001', 'http://127.0.0.1:4010');
                  }
                  bytes = bytes
                    .replaceAll('listen 443 ', `listen ${s.port} `)
                    .replaceAll('listen [::]:443 ', `listen [::]:${s.port} `);
                  if (s.profile.startsWith('aliyun-app'))
                    bytes = bytes.replaceAll(
                      'proxy_pass https://207.148.70.106;',
                      'proxy_pass https://127.0.0.1:4443;',
                    );
                  return bytes;
                }),
              );
              const unrelated =
                'server { listen 127.0.0.1:4999; location /qa-held { proxy_buffering off; proxy_pass http://127.0.0.1:4001; } }';
              await fs.writeFile(
                `${root}/nginx.conf`,
                `${prelude}${source.join('\n')}\n${unrelated}\n}\n`,
              );
            }
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
            const current = sites.find((s) => s.locations[0].serverName === options.servername);
            assert(current);
            assert.equal(options.rejectUnauthorized, true);
            return https.request({ ...options, port: current.port, ca }, callback);
          },
        },
      },
    },
  );
} catch (error) {
  console.error(
    'QA_INGRESS_REJECTION',
    JSON.stringify({
      component: 'receiver',
      stage: ingressDiagnosticStage(error) ?? 'RECEIVER_ENTRY',
    }),
  );
  process.stderr.write('QA_INGRESS_SESSION_FAILED\n');
  process.exitCode = 1;
}
