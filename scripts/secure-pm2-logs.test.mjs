import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const helper = resolve(scriptDir, 'secure-pm2-logs.mjs');

test('secures the actual numbered PM2 worker logs instead of assuming generic names', () => {
  const pm2Home = mkdtempSync(resolve(tmpdir(), 'holaday-pm2-home-'));
  const logsDir = resolve(pm2Home, 'logs');
  mkdirSync(logsDir);
  const files = [
    resolve(logsDir, 'holaday-orchestrator-out.log'),
    resolve(logsDir, 'holaday-orchestrator-error.log'),
    resolve(logsDir, 'holaday-account-closure-worker-out-171.log'),
    resolve(logsDir, 'holaday-account-closure-worker-error-171.log'),
  ];
  for (const path of files) {
    writeFileSync(path, '');
    chmodSync(path, 0o644);
  }
  const pm2Rows = [
    {
      name: 'holaday-orchestrator',
      pid: 101,
      pm2_env: {
        status: 'online',
        pm_out_log_path: files[0],
        pm_err_log_path: files[1],
      },
    },
    {
      name: 'holaday-account-closure-worker',
      pid: 102,
      pm2_env: {
        status: 'online',
        pm_out_log_path: files[2],
        pm_err_log_path: files[3],
      },
    },
  ];

  const result = spawnSync(
    process.execPath,
    [helper, 'holaday-orchestrator', 'holaday-account-closure-worker'],
    { input: JSON.stringify(pm2Rows), encoding: 'utf8', env: { ...process.env, PM2_HOME: pm2Home } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'PM2_LOG_PERMISSIONS apps=2 mode=0600\n');
  for (const path of files) assert.equal(statSync(path).mode & 0o777, 0o600);
});
