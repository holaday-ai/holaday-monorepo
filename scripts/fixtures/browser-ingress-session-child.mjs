// Isolated network fixture child only, never a production entry or uploaded code.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import https from 'node:https';
import { promisify } from 'node:util';
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
try {
  await serveFirstCutoverIngressSession(
    { attempt: site.binding.attempt },
    {
      readSite: async () => {
        assert.equal(await fs.readFile(path, 'utf8'), raw);
        return structuredClone(site);
      },
      lifecycleIO: {
        nginx: {
          exec: async (file, args, options) => {
            assert.equal(file, '/usr/sbin/nginx');
            if (args[0] === '-t') {
              const source = await Promise.all(
                sites.map(async (s) => {
                  let bytes = await fs.readFile(s.enabledPath, 'utf8');
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
} catch {
  process.stderr.write('QA_INGRESS_SESSION_FAILED\n');
  process.exitCode = 1;
}
