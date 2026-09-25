import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureMaintenanceProcesses } from './browser-maintenance-runtime-system.mjs';
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const root = `/opt/holaday-releases/${identity.candidate}`;
const main = {
  pid: 101,
  start: '1000',
  uid: 998,
  cwd: `${root}/apps/orchestrator`,
  command: 'main',
  autorestart: false,
};
const metadata = {
  name: 'holaday-orchestrator',
  pid: 101,
  pm2_env: {
    status: 'online',
    autorestart: false,
    watch: false,
    max_memory_restart: 0,
    cron_restart: null,
    pm_cwd: main.cwd,
    HOLADAY_ORDINARY_CANDIDATE: identity.candidate,
    HOLADAY_ORDINARY_MAINTENANCE: '1',
  },
};
test('captures only one non-root non-restarting ordinary instance and exact listener owner', async () => {
  const captured = await captureMaintenanceProcesses({
    identity,
    root,
    rows: [metadata],
    processes: [main],
    listeners: { 4001: [101], 4002: [101] },
  });
  assert.deepEqual(captured, { identity, root, main, worker: null });
});
test('rejects root, autorestart, foreign checkout, duplicate process and port owners', async () => {
  for (const patch of [
    { rows: [{ ...metadata, pm2_env: { ...metadata.pm2_env, autorestart: true } }] },
    { rows: [{ ...metadata, pm2_env: { ...metadata.pm2_env, max_memory_restart: 512 } }] },
    {
      rows: [
        {
          ...metadata,
          pm2_env: { ...metadata.pm2_env, HOLADAY_ORDINARY_CANDIDATE: 'c'.repeat(40) },
        },
      ],
    },
    { processes: [{ ...main, uid: 0 }] },
    { processes: [{ ...main, cwd: '/opt/other' }] },
    { processes: [main, { ...main, pid: 103 }] },
    { listeners: { 4001: [101], 4002: [104] } },
  ])
    await assert.rejects(
      captureMaintenanceProcesses({
        identity,
        root,
        rows: [metadata],
        processes: [main],
        listeners: { 4001: [101], 4002: [101] },
        ...patch,
      }),
      /MAINTENANCE_RUNTIME_UNPROVEN/,
    );
});
