// Disposable, private-PID Linux QA. No production access or credentials.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  registrationConfigDigest,
  removeLegacyRegistrations,
} from '/source/browser-first-cutover-registrations.mjs';
import { captureLegacyRegistrations } from '/source/browser-first-cutover-runtime.mjs';
import { removeSavedStartupEntries } from '/source/browser-first-cutover-startup.mjs';
import { acquireReleaseJournal } from '/source/browser-maintenance-journal.mjs';
await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
await fs.copyFile('/opt/node22/bin/node', '/usr/bin/node');
await fs.mkdir('/usr/lib/node_modules', { recursive: true });
await fs.symlink('/opt/node22/lib/node_modules/pm2', '/usr/lib/node_modules/pm2');
const exec = async (file, argv) =>
  (await promisify(execFile)(file, argv, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })).stdout;
const pm2 = (...args) => exec('/usr/bin/node', ['/usr/lib/node_modules/pm2/bin/pm2', ...args]);
const rows = async () => JSON.parse(await pm2('jlist'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const cwd = '/opt/holaday-monorepo/apps/orchestrator';
const directory = '/var/lib/holaday-deploy/maintenance';
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
await fs.writeFile(
  `${cwd}/registry-worker.cjs`,
  "require('http').createServer((q,r)=>r.end('qa')).listen(4001);process.on('SIGINT',()=>{});\n",
);
await fs.writeFile('/tmp/registry-idle.cjs', 'setInterval(()=>{},1000);\n');
const binding = {
  attempt: '22222222-2222-4222-8222-222222222222',
  inventoryDigest: 'a'.repeat(64),
};
const journal = await acquireReleaseJournal(directory, {
  ...binding,
  kind: 'first-cutover',
  candidate: 'b'.repeat(40),
  configDigest: 'c'.repeat(64),
  migrationDigest: sha('[]'),
  legacyDigest: 'd'.repeat(64),
});
await journal.bindManifest([]);
for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
  await journal.persist(phase, { candidate: 'b'.repeat(40) });
const assertOwnership = async () => {
  const b = await journal.assertOwnership();
  return { attempt: b.attempt, inventoryDigest: b.inventoryDigest };
};
try {
  await pm2(
    'start',
    `${cwd}/registry-worker.cjs`,
    '--name',
    'holaday-account-closure-worker',
    '--cwd',
    cwd,
    '--interpreter',
    '/opt/node22/bin/node',
    '--uid',
    '998',
    '--gid',
    '998',
    '--max-memory-restart',
    '512M',
    '--kill-timeout',
    '200',
  );
  await pm2(
    'start',
    '/tmp/registry-idle.cjs',
    '--name',
    'holaday-files-cron',
    '--cron-restart',
    '0 * * * *',
    '--no-autorestart',
  );
  await pm2('stop', 'holaday-files-cron');
  await pm2('start', '/tmp/registry-idle.cjs', '--name', 'qa-unrelated');
  await pm2('save');
  await pm2('save');
  for (let n = 0; ; n++) {
    try {
      assert.equal((await fetch('http://127.0.0.1:4001')).status, 200);
      break;
    } catch (e) {
      if (n > 50) throw e;
      await sleep(100);
    }
  }
  const bootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8'))
    .trim()
    .replaceAll('-', '');
  const proc = async (pid) => {
    const base = `/proc/${pid}`;
    const stat = (await fs.readFile(`${base}/stat`, 'utf8')).split(') ').at(-1).trim().split(/\s+/);
    return {
      host: hostname(),
      bootId,
      pid,
      ppid: Number(stat[1]),
      start: stat[19],
      uids: /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m
        .exec(await fs.readFile(`${base}/status`, 'utf8'))
        .slice(1)
        .map(Number),
      exe: await fs.readlink(`${base}/exe`),
      cwd: await fs.readlink(`${base}/cwd`),
      argvDigest: sha(await fs.readFile(`${base}/cmdline`)),
    };
  };
  const daemonPid = Number((await fs.readFile('/root/.pm2/pm2.pid', 'utf8')).trim());
  const initial = await rows();
  const unrelated = initial.find((r) => r.name === 'qa-unrelated');
  const names = ['holaday-account-closure-worker', 'holaday-files-cron'];
  const readInventory = async () => {
    const daemon = await proc(daemonPid);
    const current = (await rows()).filter((r) => names.includes(r.name));
    const managers = current.map((r) => ({
      kind: 'pm2',
      pid: daemon.pid,
      start: daemon.start,
      exe: daemon.exe,
      argvDigest: daemon.argvDigest,
      pm2Home: '/root/.pm2',
      version: '6.0.14',
      pmId: r.pm_id,
      name: r.name,
      configDigest: registrationConfigDigest(r.pm2_env),
      killTimeoutMs: r.pm2_env.kill_timeout ?? 1600,
      killSignal: 'SIGINT',
      watch: r.pm2_env.watch,
      cron: r.pm2_env.cron_restart ?? false,
      memoryRestart: r.pm2_env.max_memory_restart ?? 0,
      status: r.pm2_env.status,
      rootPid: r.pid,
    }));
    const processes = [];
    for (const id of await fs.readdir('/proc')) {
      if (!/^\d+$/.test(id)) continue;
      try {
        if ((await fs.readlink(`/proc/${id}/cwd`)) !== cwd) continue;
        const p = await proc(Number(id));
        const m = managers.find((m) => m.rootPid === p.pid);
        // Fixture is one Node process; any extra same-cwd process is unknown.
        if (!m) throw new Error('unexpected physical fixture process');
        processes.push({
          ...p,
          role: 'worker',
          managerIdentity: Object.fromEntries(
            Object.entries(m).filter(([k]) => !['status', 'rootPid'].includes(k)),
          ),
        });
      } catch (e) {
        if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e;
      }
    }
    const sockets = await exec('ss', ['-H', '-ltnp', 'sport = :4001']);
    return {
      inventoryDigest: binding.inventoryDigest,
      host: hostname(),
      bootId,
      observedAtMs: Date.now(),
      processes,
      managers,
      ports: [4001, 4002],
      listeners: [...sockets.matchAll(/pid=(\d+)/g)].map((m) => ({
        port: 4001,
        pid: Number(m[1]),
      })),
      unknownLaunchers: [],
    };
  };
  const files = [];
  for (const suffix of ['dump.pm2', 'dump.pm2.bak']) {
    const path = `/root/.pm2/${suffix}`;
    const saved = JSON.parse(await fs.readFile(path, 'utf8'));
    const raw = saved.map((r) => JSON.stringify(r));
    const text = `[${raw.join(',')}]\n`;
    await fs.writeFile(path, text);
    files.push({
      path,
      digest: sha(text),
      remove: saved.flatMap((r, i) =>
        names.includes(r.name) ? [{ name: r.name, entryDigest: sha(raw[i]) }] : [],
      ),
    });
  }
  await removeSavedStartupEntries(
    { binding, files, maintenanceEndsAtMs: Date.now() + 60000 },
    { now: Date.now, assertOwnership, persist: (e) => journal.recordStartupEvent(e) },
  );
  const inventory = await readInventory();
  const captured = await captureLegacyRegistrations(
    { inventory, approvedTargets: inventory.processes, approvedRegistrations: inventory.managers },
    { now: Date.now },
  );
  const result = await removeLegacyRegistrations(
    { captured, binding, maintenanceEndsAtMs: Date.now() + 60000 },
    {
      now: Date.now,
      sleep,
      assertOwnership,
      readInventory,
      persist: (e) => journal.recordRegistrationEvent(e),
      verifyFence: async () => {
        const s = await readInventory();
        return {
          inventoryDigest: binding.inventoryDigest,
          stage: 'orders',
          observedAtMs: Date.now(),
          unsettledWork: 0,
          externalWork: 0,
          activeRequests: 0,
          unknownWriters: 0,
          producersRunning: s.processes.length,
          runningProducers: s.processes,
        };
      },
    },
  );
  assert.equal(result.removed.length, 2);
  assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
  await assert.rejects(fetch('http://127.0.0.1:4001'));
  const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(record.registrationEvents.length, 6);
  await journal.persist('all_fenced', { candidate: 'b'.repeat(40) });
  console.log(
    'PASS physical protected registration removal: memory-enabled UID998 worker exited, stopped cron removed, unrelated PID unchanged, private backup and six real journal events',
  );
  await pm2('kill');
  await pm2('resurrect');
  assert.deepEqual(
    (await rows()).map((r) => r.name),
    ['qa-unrelated'],
  );
  console.log(
    'PASS independent saved-entry removal: daemon restart restores only unrelated fixture',
  );
} finally {
  await pm2('kill');
  await journal.close();
}
