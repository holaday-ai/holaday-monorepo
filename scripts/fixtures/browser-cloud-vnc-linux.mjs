// Reviewed legacy VNC lifecycle under the ORIGINAL PM2 stop mechanism.
// Only run in the existing disposable Linux image with a private PID namespace.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  cutoverCloudStopConfigDigest,
  cutoverRegistrationConfigDigest,
} from '../browser-cutover-evidence.mjs';
import {
  createFirstCutoverRetirementObserver,
  readReviewedFirstCutoverLegacySource,
} from '../browser-first-cutover-host.mjs';
import { firstCutoverSourceBindings } from '../browser-first-cutover-inventory.mjs';
import {
  firstCutoverCloudBrowserRecoveryLaunch,
  firstCutoverCloudVncRecoveryMaterial,
  readFirstCutoverCloudManagers,
  restoreFirstCutoverCloudVnc,
} from '../browser-first-cutover-runtime.mjs';
import { acquireReleaseJournal } from '../browser-maintenance-journal.mjs';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
const exec = promisify(execFile);
// PM2 TreeKill silently falls back to killing only the root when ps is absent.
// Fail BEFORE starting any fixture process if real procps tools are unavailable.
for (const tool of ['/usr/bin/ps', '/usr/bin/pkill']) {
  const { stdout } = await exec(tool, ['--version']);
  assert.match(stdout, /procps/, `${tool} must be the real procps executable`);
}
// Recovery uses real PM2/procfs and forked Python server substitutes, NOT real
// x11vnc/websockify, business/fence/display proof, or a full recovery ACK.
const controllerRecovery = process.argv[2] === '--controller-recovery';
const controller = process.argv[2] === '--controller' || controllerRecovery;
assert.ok(process.argv.length === 2 || (controller && process.argv.length === 3));
const pm2Home = controller ? '/root/.pm2' : '/tmp/vnc-pm2';
if (controller) {
  // Only the fresh private-PID container launched for this fixture. Never
  // attach to an existing PM2 home: exclusive mkdir rejects files/symlinks too.
  assert.equal(process.ppid, 1);
  assert.equal((await fs.readFile('/proc/1/comm', 'utf8')).trim(), 'sh');
  assert.equal(
    await fs.lstat('/var/run/docker.sock').then(
      () => true,
      (e) => {
        if (e.code === 'ENOENT') return false;
        throw e;
      },
    ),
    false,
  );
  await fs.mkdir(pm2Home, { mode: 0o700 });
}
const pm2 = async (...args) =>
  (
    await exec('/opt/node22/bin/node', ['/opt/node22/lib/node_modules/pm2/bin/pm2', ...args], {
      env: { PATH: '/opt/node22/bin:/usr/bin:/bin', HOME: '/root', PM2_HOME: pm2Home },
      maxBuffer: 1024 * 1024,
    })
  ).stdout;
const log = '/tmp/vnc-qa-starts';
const wrapper = controllerRecovery ? '/opt/holaday-vnc/start.sh' : '/tmp/legacy-vnc.sh';
let workerIntervalMs;
let compareVncRecoveryConfig;
let assertPackagePremise;
if (controllerRecovery) {
  ({ compareCutoverCloudVncRecoveryConfig: compareVncRecoveryConfig } = await import(
    '../browser-cutover-evidence.mjs'
  ));
  assert.equal(typeof compareVncRecoveryConfig, 'function', 'VNC comparator must be integrated');
  const require = createRequire(import.meta.url);
  assert.equal(require('/opt/node22/lib/node_modules/pm2/package.json').version, '6.0.14');
  assert.equal(process.env.PM2_WORKER_INTERVAL, undefined);
  const pm2Constants = require('/opt/node22/lib/node_modules/pm2/constants.js');
  const utility = require('/opt/node22/lib/node_modules/pm2/lib/Utility.js');
  workerIntervalMs = pm2Constants.WORKER_INTERVAL;
  assertPackagePremise = () => {
    // Actual cached source/package lookup, not proof of the production host.
    assert.equal(pm2Constants.ENABLE_GIT_PARSING, false);
    assert.equal(utility.findPackageVersion(wrapper), 'N/A');
  };
  assert.equal(workerIntervalMs, 30000);
  await fs.mkdir('/opt/holaday-vnc', { mode: 0o700 });
}
// Real forked request handler, not just a direct-child sleep stub. It ignores
// the graceful signal to exercise PM2's approved bounded tree escalation.
const stub = `#!/usr/local/bin/python3
import os, signal, sys, time
signal.signal(signal.SIGINT, signal.SIG_IGN)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
with open('${log}', 'a') as stream:
 stream.write(__file__ + ' ' + str(os.getpid()) + '\\n')
if __file__.endswith('websockify'):
 child=os.fork()
 if child == 0:
  with open('${log}', 'a') as stream: stream.write('handler ' + str(os.getpid()) + '\\n')
while True: time.sleep(1)
`;
for (const file of ['/usr/bin/x11vnc', '/usr/bin/websockify'])
  await fs.writeFile(file, stub, { flag: 'wx', mode: 0o755 });
// Control-flow equivalent of the authorized, reviewed production wrapper.
await fs.writeFile(
  wrapper,
  `#!/bin/bash
set -u
cleanup() { pkill -P $$ 2>/dev/null || true; }
trap cleanup EXIT TERM INT
(
 while true; do
  x11vnc -display :98 -forever -nopw -shared -noxdamage -listen 127.0.0.1 -rfbport 5901
  sleep 2
 done
) &
sleep 2
while true; do
 websockify --heartbeat 30 --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5901
 sleep 2
done
`,
  { flag: 'wx', mode: 0o700 },
);
if (controllerRecovery) assertPackagePremise();
await fs.mkdir('/var/lib/holaday-headed-brave/Default/Sessions', { recursive: true });
await fs.writeFile('/var/lib/holaday-headed-brave/Default/Sessions/qa-sentinel', 'synthetic-keep');
await pm2('start', '/bin/sleep', '--name', 'unrelated', '--interpreter', 'none', '--', '300');
await pm2(
  'start',
  wrapper,
  '--name',
  'holaday-vnc',
  '--interpreter',
  'bash',
  '--kill-timeout',
  '1600',
);
const rows = () => pm2('jlist').then(JSON.parse);
const start = Date.now();
let starts;
do {
  starts = (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  if (starts.length >= 3) break;
  await sleep(30);
} while (Date.now() - start < 8000);
assert.equal(starts.length, 3, 'both servers plus forked request handler');
const before = await rows();
const target = before.find((r) => r.name === 'holaday-vnc');
const unrelated = before.find((r) => r.name === 'unrelated');
assert.equal(target.pm2_env.autorestart, true);
assert.equal(target.pm2_env.kill_timeout, 1600);
assert.equal(target.pm2_env.treekill, true);
const stopStart = Date.now();
if (controller) {
  // Other-host/source/work facts are synthetic. PM2, local process identities,
  // original owned journal, controller and its default executor are real.
  await pm2(
    'start',
    '/bin/sleep',
    '--name',
    'holaday-chromium-headed',
    '--interpreter',
    'none',
    '--',
    '300',
  );
  const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const daemonPid = Number((await fs.readFile(`${pm2Home}/pm2.pid`, 'utf8')).trim());
  const bootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const identity = async (pid) => {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (fields[0] === 'Z') return null;
      const status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
      return {
        pid,
        ppid: Number(fields[1]),
        start: fields[19],
        uids: /^Uid:\s+(.*)$/m.exec(status)[1].trim().split(/\s+/).map(Number),
        exe: await fs.readlink(`/proc/${pid}/exe`),
        cwd: await fs.readlink(`/proc/${pid}/cwd`),
        argvDigest: createHash('sha256')
          .update(await fs.readFile(`/proc/${pid}/cmdline`))
          .digest('hex'),
        cgroup: await fs.readFile(`/proc/${pid}/cgroup`, 'utf8'),
      };
    } catch (e) {
      if (['ENOENT', 'ESRCH'].includes(e.code)) return null;
      throw e;
    }
  };
  const pinned = new Set();
  const snapshot = async () => {
    const managers = (await rows()).map((r) => ({
      pmId: r.pm_id,
      name: r.name,
      pid: r.pid,
      status: r.pm2_env.status,
      watch: r.pm2_env.watch,
      configDigest: cutoverRegistrationConfigDigest(r.pm2_env),
      ...(['holaday-vnc', 'holaday-chromium-headed'].includes(r.name)
        ? {
            stopConfigDigest: cutoverCloudStopConfigDigest(r.pm2_env),
            restartCount: r.pm2_env.restart_time,
          }
        : {}),
    }));
    const all = [];
    for (const name of await fs.readdir('/proc'))
      if (/^\d+$/.test(name)) {
        const p = await identity(Number(name));
        if (p) all.push(p);
      }
    const selected = new Set(managers.filter((m) => m.pid > 1).map((m) => m.pid));
    for (let i = 0; i < all.length; i++)
      for (const p of all) if (selected.has(p.ppid)) selected.add(p.pid);
    for (const pid of selected) pinned.add(pid);
    return {
      hostname: 'qa-vultr',
      observedAtMs: Date.now(),
      bootId,
      processes: all.filter((p) => pinned.has(p.pid) || [daemonPid, process.pid].includes(p.pid)),
      observer: await identity(process.pid),
      managers,
      pm2Runtime: {
        pid: daemonPid,
        version: '6.0.14',
        killSignal: 'SIGINT',
        killTimeoutMs: 1600,
        sourceDigest: sha('qa-pm2'),
      },
      startup: { files: [], directories: [], pm2Unit: '' },
      nginxFiles: [],
      systemd: '',
      unitFiles: '',
      timers: '',
      cron: '',
      rootCrontabPresent: false,
      listeners: '',
    };
  };
  const original = await snapshot();
  const remote = { ...structuredClone(original), hostname: 'qa-aliyun' };
  const pair = async () => {
    const local = await snapshot();
    const other = { ...remote, observedAtMs: local.observedAtMs };
    return {
      sourceCandidate: 'c'.repeat(40),
      sourceDigest: 'b'.repeat(64),
      observedAtMs: local.observedAtMs,
      hosts: [
        { host: 'aliyun', sourceCandidate: null, snapshot: other },
        { host: 'vultr', sourceCandidate: 'c'.repeat(40), snapshot: local },
      ],
    };
  };
  const reviews = Object.fromEntries(
    [
      ['aliyun', remote],
      ['vultr', original],
    ].map(([host, s]) => [
      host,
      {
        bootId,
        ports: host === 'vultr' ? [4001, 4002] : [4010, 4011],
        review: {
          processes: s.processes
            .filter((p) => ![daemonPid, process.pid].includes(p.pid))
            .map((p) => ({
              pid: p.pid,
              identityDigest: sha(p),
              disposition: 'preserve',
              reason: 'isolated fixture process',
            })),
          registrations: s.managers.map((m) => ({
            pmId: m.pmId,
            configDigest: m.configDigest,
            disposition: 'preserve',
            reason: 'isolated fixture registration',
          })),
          sources: firstCutoverSourceBindings(s).map((r) => ({
            ...r,
            reason: 'synthetic source metadata',
          })),
        },
      },
    ]),
  );
  const inventoryDigest = 'a'.repeat(64);
  const proof = await readReviewedFirstCutoverLegacySource(
    { reviews, inventoryDigest },
    { readPair: pair, now: Date.now },
  );
  const manifest = { replaysNumberedSql: true, runnerSha256: '1'.repeat(64), migrations: [] };
  const directory = await fs.mkdtemp('/tmp/cloud-controller-journal-');
  const journal = await acquireReleaseJournal(directory, {
    kind: 'first-cutover',
    candidate: 'd'.repeat(40),
    configDigest: 'e'.repeat(64),
    migrationDigest: sha(manifest),
    inventoryDigest,
    legacyDigest: proof.legacyDigest,
  });
  try {
    const binding = await journal.assertOwnership();
    const scope = ['holaday-vnc', 'holaday-chromium-headed'].map((name) => {
      const manager = original.managers.find((m) => m.name === name);
      const ids = new Set([manager.pid]);
      for (let i = 0; i < original.processes.length; i++)
        for (const p of original.processes) if (ids.has(p.ppid)) ids.add(p.pid);
      return {
        name,
        pmId: manager.pmId,
        recoveryDigest: controllerRecovery
          ? sha(
              name === 'holaday-vnc'
                ? firstCutoverCloudVncRecoveryMaterial({ attempt: binding.attempt })
                : firstCutoverCloudBrowserRecoveryLaunch({ attempt: binding.attempt }),
            )
          : '7'.repeat(64),
        scopeDigest: sha({
          host: 'vultr',
          hostname: original.hostname,
          bootId,
          pm2Runtime: original.pm2Runtime,
          daemon: original.processes.find((p) => p.pid === daemonPid),
          manager,
          processes: original.processes.filter((p) => ids.has(p.pid)).sort((a, b) => a.pid - b.pid),
        }),
      };
    });
    await journal.bindManifest(manifest);
    await journal.bindExecutionSite('6'.repeat(64), scope);
    const observer = await createFirstCutoverRetirementObserver(
      { reviews, binding, legacyDigest: proof.legacyDigest },
      { journal, readPair: pair, now: Date.now },
    );
    for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
      await journal.persist(phase, { candidate: binding.candidate });
    const configBefore = await rows();
    await observer
      .stopCloudServices(
        { maintenanceEndsAtMs: Date.now() + 30000 },
        {
          verifyFence: async () => ({
            inventoryDigest,
            stage: 'orders',
            observedAtMs: Date.now(),
            unsettledWork: 0,
            externalWork: 0,
            activeRequests: 0,
            unknownWriters: 0,
          }),
        },
      )
      .catch(async (error) => {
        for (const row of await rows()) {
          const previous = configBefore.find((r) => r.pm_id === row.pm_id)?.pm2_env;
          console.error(
            JSON.stringify({
              qaManager: row.name,
              changedKeys: previous
                ? [...new Set([...Object.keys(previous), ...Object.keys(row.pm2_env)])].filter(
                    (key) => JSON.stringify(previous[key]) !== JSON.stringify(row.pm2_env[key]),
                  )
                : ['new'],
            }),
          );
        }
        throw error;
      });
    assert.deepEqual(
      (await observer.read()).cloudMaintenance.map((r) => r.status),
      ['stopped', 'stopped'],
    );
    assert.equal((await journal.readFirstCutoverEffects()).cloudMaintenanceEvents.length, 4);
    console.log(
      'CLOUD_CONTROLLER_PHYSICAL_PASS: original controller/journal, default numeric PM2 effects, live procfs exit proof',
    );
    if (controllerRecovery) {
      // Run EVERY original stop/tree/handler/profile assertion before recovery,
      // while retaining this same owned journal until the new observation ends.
      await assertOriginalStop();
      const stoppedRecord = await journal.readFirstCutoverEffects();
      const stoppedManagers = await readFirstCutoverCloudManagers();
      const stoppedVnc = stoppedManagers[0];
      assert.equal(stoppedVnc.pm_id, target.pm_id);
      assert.equal(stoppedVnc.pid, 0);
      assert.equal(stoppedVnc.pm2_env.status, 'stopped');
      assert.equal(stoppedVnc.pm2_env.pm_exec_path, wrapper);
      assert.equal(stoppedVnc.pm2_env.restart_time, target.pm2_env.restart_time);
      const oldIds = new Set(
        original.managers
          .filter((m) => ['holaday-vnc', 'holaday-chromium-headed'].includes(m.name))
          .map((m) => m.pid),
      );
      for (let i = 0; i < original.processes.length; i++)
        for (const p of original.processes) if (oldIds.has(p.ppid)) oldIds.add(p.pid);
      const retired = original.processes.filter((p) => oldIds.has(p.pid));
      const unrelatedIdentity = original.processes.find((p) => p.pid === unrelated.pid);
      assert.ok(unrelatedIdentity);
      const wrapperBytes = await fs.readFile(wrapper, 'utf8');
      const checkPreserved = async () => {
        assertPackagePremise();
        for (const p of retired)
          assert.notEqual(
            (await identity(p.pid))?.start,
            p.start,
            'old wrapper/children/handler gone',
          );
        assert.deepEqual(await identity(unrelated.pid), unrelatedIdentity);
        assert.equal(await fs.readFile(wrapper, 'utf8'), wrapperBytes);
        assert.equal(
          await fs.readFile('/var/lib/holaday-headed-brave/Default/Sessions/qa-sentinel', 'utf8'),
          'synthetic-keep',
        );
        assert.equal((await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), bootId);
        assert.deepEqual(
          await identity(daemonPid),
          original.processes.find((p) => p.pid === daemonPid),
        );
      };
      // Explicit synthetic prerequisites ONLY: no database/candidate operation,
      // no actual headed recovery. The real headed sleep remains stopped.
      for (const phase of ['all_fenced', 'stopped', 'backup_verified'])
        await journal.persist(phase, { candidate: binding.candidate });
      await journal.bindBackupReceipt({
        ...binding,
        backupDigest: '1'.repeat(64),
        databaseIdentityDigest: '2'.repeat(64),
        isolatedTargetDigest: '3'.repeat(64),
        encryptionProfileDigest: '4'.repeat(64),
        comparisonDigest: '5'.repeat(64),
        schemaDigest: '6'.repeat(64),
        businessDigest: '7'.repeat(64),
        restoredAtMs: Date.now(),
      });
      await journal.persist('migration_started', { candidate: binding.candidate });
      await journal.bindBootstrapSeed('5'.repeat(32));
      const candidateIdentity = { candidate: binding.candidate, bootId: '6'.repeat(32) };
      for (const phase of ['candidate_started', 'verified'])
        await journal.persist(phase, { candidate: binding.candidate, identity: candidateIdentity });
      for (const phase of ['cloud-restore-intent', 'cloud-restored'])
        await journal.recordCloudMaintenanceEvent({
          ...scope[1],
          attempt: binding.attempt,
          inventoryDigest,
          host: 'vultr',
          phase,
        });
      console.log(
        'VNC_RECOVERY_SYNTHETIC_PREREQUISITES: headed events5/6, backup/candidate, business/fences, display and other-host/source facts are synthetic; Python substitutes are not actual x11vnc/websockify.',
      );
      const input = {
        attempt: binding.attempt,
        pmId: stoppedVnc.pm_id,
        stoppedConfigDigest: cutoverRegistrationConfigDigest(stoppedVnc.pm2_env),
        maintenanceEndsAtMs: Date.now() + 60000,
      };
      const restoreStartedAtMs = Date.now();
      await restoreFirstCutoverCloudVnc(input, {
        journal,
        assertRecoveryScope: async (actual) => {
          assert.deepEqual(actual, input);
          assert.ok(Date.now() < input.maintenanceEndsAtMs);
          assert.deepEqual(await journal.assertOwnership(), binding);
          const record = await journal.readFirstCutoverEffects();
          assert.equal(record.phase, 'verified');
          assert.ok([6, 7].includes(record.cloudMaintenanceEvents.length));
          await checkPreserved();
          const current = await readFirstCutoverCloudManagers();
          for (const [i, row] of current.entries()) {
            assert.equal(row.pid, 0);
            assert.equal(row.pm_id, stoppedManagers[i].pm_id);
            assert.equal(
              cutoverRegistrationConfigDigest(row.pm2_env),
              cutoverRegistrationConfigDigest(stoppedManagers[i].pm2_env),
            );
          }
          assert.deepEqual(await journal.readFirstCutoverEffects(), record);
          assert.ok(Date.now() < input.maintenanceEndsAtMs);
        },
      });
      const intent = await journal.readFirstCutoverEffects();
      assert.equal(intent.phase, 'verified');
      assert.deepEqual(intent.cloudMaintenanceScope, stoppedRecord.cloudMaintenanceScope);
      assert.equal(intent.cloudMaintenanceEvents.length, 7);
      assert.equal(intent.cloudMaintenanceEvents[6].name, 'holaday-vnc');
      assert.equal(intent.cloudMaintenanceEvents[6].phase, 'cloud-restore-intent');
      // Wait only for this one replacement lifetime's three logged substitutes.
      const readyBy = Date.now() + 8000;
      let replacementLines;
      do {
        replacementLines = (await fs.readFile(log, 'utf8')).trim().split('\n');
        if (replacementLines.length >= 6) break;
        await sleep(30);
      } while (Date.now() < readyBy);
      assert.equal(replacementLines.length, 6);
      assert.deepEqual(replacementLines.slice(0, 3), starts);
      const logged = replacementLines.slice(3).map((line) => {
        const [role, pid] = line.split(' ');
        return { role, pid: Number(pid) };
      });
      assert.deepEqual(logged.map((p) => p.role).sort(), [
        '/usr/bin/websockify',
        '/usr/bin/x11vnc',
        'handler',
      ]);
      const observeRecovered = async () => {
        await checkPreserved();
        const [row, headed] = await readFirstCutoverCloudManagers();
        assert.equal(row.pm_id, stoppedVnc.pm_id);
        assert.ok(row.pid > 1 && !oldIds.has(row.pid));
        assert.equal(row.pm2_env.status, 'online');
        assert.equal(row.pm2_env.restart_time, stoppedVnc.pm2_env.restart_time);
        assert.deepEqual(row.pm2_env.env, stoppedVnc.pm2_env.env);
        assert.equal(Object.hasOwn(row.pm2_env, 'max_memory_restart'), false);
        assert.equal(Object.hasOwn(row.pm2_env.env, 'max_memory_restart'), false);
        assert.equal(headed.pid, 0, 'headed prior recovery is synthetic, not a physical claim');
        assert.equal(
          cutoverRegistrationConfigDigest(headed.pm2_env),
          cutoverRegistrationConfigDigest(stoppedManagers[1].pm2_env),
        );
        const configProof = compareVncRecoveryConfig({
          attempt: binding.attempt,
          pmId: row.pm_id,
          pm2Version: '6.0.14',
          stoppedConfig: stoppedVnc.pm2_env,
          recoveredConfig: row.pm2_env,
          launch: firstCutoverCloudVncRecoveryMaterial({ attempt: binding.attempt }),
          expectedLaunchDigest: stoppedRecord.cloudMaintenanceScope[0].recoveryDigest,
          restoreStartedAtMs,
          observedAtMs: Date.now(),
        });
        assert.equal(configProof.stoppedConfigDigest, input.stoppedConfigDigest);
        assert.equal(configProof.restartCount, stoppedVnc.pm2_env.restart_time);
        const all = [];
        for (const name of await fs.readdir('/proc')) {
          if (!/^\d+$/.test(name)) continue;
          const p = await identity(Number(name));
          if (p) all.push(p);
        }
        const ids = new Set([row.pid]);
        for (let i = 0; i < all.length; i++)
          for (const p of all) if (ids.has(p.ppid)) ids.add(p.pid);
        const tree = all.filter((p) => ids.has(p.pid)).sort((a, b) => a.pid - b.pid);
        assert.equal(
          tree.length,
          5,
          'root wrapper, supervision subshell, two substitute servers, forked handler',
        );
        const root = tree.find((p) => p.pid === row.pid);
        assert.equal(root.ppid, daemonPid);
        assert.match(root.exe, /\/bash$/);
        assert.ok(
          (await fs.readFile(`/proc/${root.pid}/cmdline`, 'utf8')).split('\0').includes(wrapper),
        );
        const server = (role) =>
          tree.find((p) => p.pid === logged.find((r) => r.role === role)?.pid);
        const x11 = server('/usr/bin/x11vnc');
        const web = server('/usr/bin/websockify');
        const handler = server('handler');
        assert.ok(x11 && web && handler);
        const loop = tree.find((p) => p.pid === x11.ppid);
        assert.ok(loop && loop.pid !== root.pid);
        assert.equal(loop.exe, root.exe);
        assert.equal(loop.ppid, root.pid);
        assert.equal(web.ppid, root.pid);
        assert.equal(handler.ppid, web.pid);
        assert.equal(x11.exe, web.exe);
        assert.equal(handler.exe, web.exe);
        for (const p of tree) {
          assert.ok(!oldIds.has(p.pid));
          assert.deepEqual(p.uids, [0, 0, 0, 0]);
          assert.deepEqual(await identity(p.pid), p);
        }
        const repeated = (await readFirstCutoverCloudManagers())[0];
        assert.equal(repeated.pid, row.pid);
        assert.equal(
          cutoverRegistrationConfigDigest(repeated.pm2_env),
          configProof.recoveredConfigDigest,
        );
        assert.equal(
          (await fs.readFile(log, 'utf8')).trim().split('\n').length,
          6,
          'no extra substitute lifetime',
        );
        assert.deepEqual(await journal.assertOwnership(), binding);
        assert.deepEqual(await journal.readFirstCutoverEffects(), intent);
        assert.ok(Date.now() < input.maintenanceEndsAtMs);
        return { pid: row.pid, tree, configProof };
      };
      const recovered = await observeRecovered();
      const waitMs = workerIntervalMs + 5000;
      assert.ok(
        waitMs <= 45000 && input.maintenanceEndsAtMs - Date.now() > waitMs + 5000,
        'VNC_WORKER_STABILITY_WINDOW_TOO_SHORT',
      );
      const began = performance.now();
      await sleep(waitMs);
      assert.deepEqual(await observeRecovered(), recovered);
      const elapsedMs = performance.now() - began;
      assert.ok(
        elapsedMs > workerIntervalMs && elapsedMs <= 45000,
        'VNC_WORKER_STABILITY_INTERVAL_OUT_OF_BOUNDS',
      );
      console.log(
        JSON.stringify({
          marker: 'VNC_CONTROLLER_RECOVERY_COMPONENT_PASS',
          workerIntervalMs,
          elapsedMs,
          sameRegistrationHistoryConfigAndTree: true,
          journalEvents: 7,
          vncRecoveryAck: false,
          opened: false,
          servers: 'Python control-flow substitutes; not actual x11vnc/websockify',
          synthetic: [
            'headed recovery5/6',
            'backup/candidate',
            'business/fence/display',
            'other-host/source',
          ],
        }),
      );
    }
  } finally {
    await journal.close();
  }
} else await pm2('stop', String(target.pm_id));
if (!controllerRecovery) await assertOriginalStop();
async function assertOriginalStop() {
  assert.ok(Date.now() - stopStart < 10000, 'bounded single stop');
  await sleep(2300);
  const after = await rows();
  const stopped = after.find((r) => r.pm_id === target.pm_id);
  assert.equal(stopped.pm2_env.status, 'stopped');
  assert.equal(stopped.pid, 0);
  assert.equal(stopped.pm2_env.restart_time, target.pm2_env.restart_time);
  assert.equal(after.find((r) => r.pm_id === unrelated.pm_id).pid, unrelated.pid);
  process.kill(unrelated.pid, 0);
  const final = (await fs.readFile(log, 'utf8')).trim().split('\n');
  assert.equal(final.length, 3, 'neither loop resurrects a server after stop');
  const observed = [];
  for (const line of starts) {
    const pid = Number(line.split(' ')[1]);
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    const fields = stat ? stat.slice(stat.lastIndexOf(')') + 2).split(' ') : [];
    observed.push({
      role: line.split(' ')[0],
      pid,
      state: fields[0] ?? 'gone',
      ppid: Number(fields[1] ?? 0),
    });
  }
  console.log(JSON.stringify({ mode: process.argv[2] ?? 'original', observed }));
  assert.ok(
    observed.every((p) => p.state === 'gone' || p.state === 'Z'),
    'no living server or forked handler survives',
  );
  assert.equal(
    await fs.readFile('/var/lib/holaday-headed-brave/Default/Sessions/qa-sentinel', 'utf8'),
    'synthetic-keep',
  );
  console.log(
    'VNC_PM2_TREE_PASS: one numeric-id stop, bounded escalation, forked handler gone, no restart, unrelated/profile preserved',
  );
}
