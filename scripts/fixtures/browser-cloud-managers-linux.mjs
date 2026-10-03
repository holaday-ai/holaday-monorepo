// Disposable Linux-only native RPC check. Never point this at a live PM2 home.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { readFirstCutoverCloudManagers } from '../browser-first-cutover-runtime.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0);
assert.equal(process.env.HOLADAY_DISPOSABLE_QA, '1');
const home = await fs.mkdtemp('/tmp/holaday-managers-');
const exec = promisify(execFile);
const pm2 = (...args) =>
  exec(process.execPath, ['/usr/lib/node_modules/pm2/bin/pm2', ...args], {
    env: { PATH: '/opt/node22/bin:/usr/bin:/bin', HOME: '/root', PM2_HOME: home },
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
try {
  const app = `${home}/idle.cjs`;
  await fs.writeFile(app, 'setInterval(() => {}, 1000);\n');
  for (const name of ['holaday-vnc', 'holaday-chromium-headed'])
    await pm2('start', app, '--name', name, '--no-autorestart');
  const before = JSON.parse((await pm2('jlist')).stdout);
  const result = await readFirstCutoverCloudManagers({ rpcSocket: `${home}/rpc.sock` });
  assert.deepEqual(
    result.map((x) => x.name),
    ['holaday-vnc', 'holaday-chromium-headed'],
  );
  for (const row of result) {
    const actual = before.find((x) => x.name === row.name);
    assert.equal(row.pm_id, actual.pm_id);
    assert.equal(row.pid, actual.pid);
    assert.equal(row.pm2_env.restart_time, actual.pm2_env.restart_time);
  }
  const again = await readFirstCutoverCloudManagers({ rpcSocket: `${home}/rpc.sock` });
  assert.deepEqual(
    again.map((x) => [x.pm_id, x.pid]),
    result.map((x) => [x.pm_id, x.pid]),
  );
  for (const row of again)
    assert.equal(
      row.pm2_env.restart_time,
      result.find((x) => x.name === row.name).pm2_env.restart_time,
    );
  const missing = await fs.mkdtemp('/tmp/holaday-managers-missing-');
  await assert.rejects(
    readFirstCutoverCloudManagers({ rpcSocket: `${missing}/rpc.sock` }),
    /^Error: CUTOVER_CLOUD_MANAGERS_UNPROVEN$/,
  );
  assert.deepEqual(await fs.readdir(missing), []);
  await fs.rm(missing, { recursive: true });
  console.log(
    JSON.stringify({
      status: 'passed',
      nativeRpc: true,
      managers: result.length,
      noRestart: true,
      missingSocketNoDaemon: true,
    }),
  );
} finally {
  await pm2('kill').catch(() => {});
  await fs.rm(home, { recursive: true, force: true });
}
