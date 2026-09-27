// Disposable, private-PID Linux QA. No production access or credentials.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  createFirstCutoverRetirementObserver,
  readReviewedFirstCutoverLegacySource,
} from '/source/browser-first-cutover-host.mjs';
import { firstCutoverSourceBindings } from '/source/browser-first-cutover-inventory.mjs';
import {
  prepareLocalFirstCutoverGateway,
  registrationConfigDigest,
  retireLocalFirstCutoverGateways,
  retireLocalFirstCutoverProducers,
} from '/source/browser-first-cutover-registrations.mjs';
import { createLegacyRuntimeEffects } from '/source/browser-first-cutover-runtime.mjs';
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
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 && ['--gateways', '--gateways-lost-ack'].includes(process.argv[2])),
);
const lostAck = process.argv[2] === '--gateways-lost-ack';
const gateways = process.argv.length === 3;
const mainPort = gateways ? 4010 : 4001;
const mainName = gateways ? 'holaday-cn-payment' : 'holaday-account-closure-worker';
const cwd = gateways
  ? '/opt/holaday-cn-payment/releases/123456789abc-20260927070000/apps/cn-payment'
  : '/opt/holaday-monorepo/apps/orchestrator';
const directory = '/var/lib/holaday-deploy/maintenance';
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
await fs.mkdir(cwd, { recursive: true });
await fs.writeFile(
  `${cwd}/registry-worker.cjs`,
  `require('http').createServer((q,r)=>r.end('qa')).listen(${mainPort});process.on('SIGINT',()=>{});\n`,
);
await fs.writeFile('/tmp/registry-idle.cjs', 'setInterval(()=>{},1000);\n');
const binding = {
  attempt: '22222222-2222-4222-8222-222222222222',
  inventoryDigest: 'a'.repeat(64),
};
let journal;
let gateway;
try {
  await pm2(
    'start',
    `${cwd}/registry-worker.cjs`,
    '--name',
    mainName,
    '--cwd',
    cwd,
    '--interpreter',
    gateways ? '/usr/bin/node' : '/opt/node22/bin/node',
    '--uid',
    gateways ? '0' : '998',
    '--gid',
    gateways ? '0' : '998',
    '--max-memory-restart',
    '512M',
    '--kill-timeout',
    '200',
  );
  if (!gateways) {
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
  }
  await pm2('start', '/tmp/registry-idle.cjs', '--name', 'qa-unrelated');
  await pm2('save');
  await pm2('save');
  for (let n = 0; ; n++) {
    try {
      assert.equal((await fetch(`http://127.0.0.1:${mainPort}`)).status, 200);
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
  const names = gateways ? [mainName] : [mainName, 'holaday-files-cron'];
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
          role: gateways ? 'gateway' : 'worker',
          managerIdentity: Object.fromEntries(
            Object.entries(m).filter(([k]) => !['status', 'rootPid'].includes(k)),
          ),
        });
      } catch (e) {
        if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e;
      }
    }
    const sockets = await exec('ss', ['-H', '-ltnp', `sport = :${mainPort}`]);
    return {
      inventoryDigest: binding.inventoryDigest,
      host: hostname(),
      bootId,
      observedAtMs: Date.now(),
      processes,
      managers,
      ports: gateways ? [4010, 4011] : [4001, 4002],
      listeners: [...sockets.matchAll(/pid=(\d+)/g)].map((m) => ({
        port: mainPort,
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
  const gatewayCwd = '/opt/holaday-cn-payment/releases/123456789abc-20260927080000/apps/cn-payment';
  await fs.mkdir(gatewayCwd, { recursive: true });
  await fs.writeFile(
    `${gatewayCwd}/qa-gateway.cjs`,
    "require('http').createServer((q,r)=>r.end('qa gateway')).listen(4011);\n",
    { flag: 'wx' },
  );
  gateway = spawn('/usr/bin/node', [`${gatewayCwd}/qa-gateway.cjs`], {
    cwd: gatewayCwd,
    stdio: 'ignore',
  });
  for (let n = 0; ; n++) {
    try {
      assert.equal((await fetch('http://127.0.0.1:4011')).status, 200);
      break;
    } catch (e) {
      if (n > 50) throw e;
      await sleep(100);
    }
  }
  // Exercise the production progress observer around the REAL registration
  // executor. Only the second host and non-PM2 launcher inventory are synthetic;
  // local proc identities, PM2 rows, listeners, saved files and journal are real.
  const raw = ({ host, bootId, ...p }) => p;
  const savedFile = async (path) => {
    const metadata = (s) =>
      Object.fromEntries(
        ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].map((k) => [
          k,
          s[k],
        ]),
      );
    const content = await fs.readFile(path, 'utf8');
    return {
      path,
      present: true,
      resolved: await fs.realpath(path),
      content,
      digest: sha(content),
      link: metadata(await fs.lstat(path)),
      stat: metadata(await fs.stat(path)),
    };
  };
  let second;
  const readPair = async () => {
    const scope = await readInventory();
    const daemon = raw(await proc(daemonPid));
    const observer = raw(await proc(process.pid));
    const processes = [daemon, observer];
    const managers = [];
    for (const row of await rows()) {
      if (row.pid > 1) processes.push(raw(await proc(row.pid)));
      managers.push({
        pmId: row.pm_id,
        name: row.name,
        pid: row.pid,
        status: row.pm2_env.status,
        watch: row.pm2_env.watch,
        configDigest: registrationConfigDigest(row.pm2_env),
        killTimeoutMs: row.pm2_env.kill_timeout ?? 1600,
        cronRestart: row.pm2_env.cron_restart ?? false,
        maxMemoryRestart: row.pm2_env.max_memory_restart ?? 0,
      });
    }
    const snapshot = {
      observedAtMs: Date.now(),
      hostname: hostname(),
      bootId: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
      processes,
      observer,
      managers,
      pm2Runtime: {
        pid: daemonPid,
        version: '6.0.14',
        killSignal: 'SIGINT',
        killTimeoutMs: 1600,
        sourceDigest: sha(await fs.readFile('/usr/lib/node_modules/pm2/package.json')),
      },
      startup: {
        files: await Promise.all(files.map((f) => savedFile(f.path))),
        directories: [],
        pm2Unit: 'fixture launcher',
      },
      nginxFiles: [],
      systemd: '',
      unitFiles: '',
      timers: '',
      cron: '',
      rootCrontabPresent: false,
      listeners: await exec('ss', ['-H', '-ltnp', `sport = :${mainPort}`]),
    };
    assert.equal(scope.processes.length, processes.filter((p) => p.cwd === cwd).length);
    if (!second) {
      second = structuredClone(snapshot);
      second.processes = second.processes.filter((p) =>
        [daemonPid, process.pid, unrelated.pid].includes(p.pid),
      );
      second.managers = second.managers.filter((m) => m.name === 'qa-unrelated');
      second.startup.files = [];
      second.listeners = '';
    }
    second.observedAtMs = snapshot.observedAtMs;
    second.processes = second.processes.filter((p) => p.pid !== gateway.pid);
    second.listeners = '';
    const gatewayHost = gateways ? snapshot : second;
    if (gateway.exitCode === null && gateway.signalCode === null)
      gatewayHost.processes.push(raw(await proc(gateway.pid)));
    gatewayHost.listeners += await exec('ss', ['-H', '-ltnp', 'sport = :4011']);
    return {
      sourceDigest: sha('physical-pm2-fixture'),
      sourceCandidate: 'c'.repeat(40),
      observedAtMs: snapshot.observedAtMs,
      hosts: [
        {
          host: 'aliyun',
          sourceCandidate: null,
          snapshot: gateways ? snapshot : structuredClone(second),
        },
        {
          host: 'vultr',
          sourceCandidate: 'c'.repeat(40),
          snapshot: gateways ? structuredClone(second) : snapshot,
        },
      ],
    };
  };
  const baseline = await readPair();
  const reviews = Object.fromEntries(
    baseline.hosts.map(({ host, snapshot }) => [
      host,
      {
        bootId: snapshot.bootId,
        ports: host === 'vultr' ? [4001, 4002] : [4010, 4011],
        review: {
          sources: firstCutoverSourceBindings(snapshot).map((s) => ({
            ...s,
            reason: 'explicit test fixture sources',
          })),
          registrations: snapshot.managers.map((m) => ({
            pmId: m.pmId,
            configDigest: m.configDigest,
            disposition: names.includes(m.name) ? 'retire' : 'preserve',
            reason: 'explicit test fixture manager',
          })),
          processes: snapshot.processes
            .filter((p) => ![daemonPid, process.pid].includes(p.pid))
            .map((p) => ({
              pid: p.pid,
              identityDigest: sha(JSON.stringify(p)),
              disposition: [cwd, gatewayCwd].includes(p.cwd) ? 'retire' : 'preserve',
              ...(p.cwd === cwd
                ? { role: gateways ? 'gateway' : 'worker' }
                : p.cwd === gatewayCwd
                  ? { role: 'gateway' }
                  : {}),
              reason: 'explicit test fixture process',
            })),
        },
      },
    ]),
  );
  const proof = await readReviewedFirstCutoverLegacySource(
    { reviews, inventoryDigest: binding.inventoryDigest },
    { readPair },
  );
  journal = await acquireReleaseJournal(directory, {
    ...binding,
    kind: 'first-cutover',
    candidate: 'b'.repeat(40),
    configDigest: 'c'.repeat(64),
    migrationDigest: sha('[]'),
    legacyDigest: proof.legacyDigest,
  });
  const observer = await createFirstCutoverRetirementObserver(
    { reviews, binding: await journal.assertOwnership(), legacyDigest: proof.legacyDigest },
    { journal, readPair },
  );
  await journal.bindManifest([]);
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await journal.persist(phase, { candidate: 'b'.repeat(40) });
  if (gateways) {
    const input = { files, binding, maintenanceEndsAtMs: Date.now() + 60000 };
    const io = {
      now: Date.now,
      sleep,
      journal,
      observer,
      // Business facts are explicitly synthetic; proc/files/PM2/journal/pidfd are real.
      verifyFence: async () => ({
        inventoryDigest: binding.inventoryDigest,
        stage:
          (await journal.readFirstCutoverEffects()).phase === 'producers_stopped'
            ? 'orders'
            : 'all-writers',
        observedAtMs: Date.now(),
        unsettledWork: 0,
        externalWork: 0,
        activeRequests: 0,
        unknownWriters: 0,
        producersRunning: 0,
      }),
    };
    const prepared = await prepareLocalFirstCutoverGateway(input, io);
    assert.equal(prepared.phase, 'startup_prepared');
    assert.equal((await fetch('http://127.0.0.1:4010')).status, 200);
    assert.equal((await fetch('http://127.0.0.1:4011')).status, 200);
    assert.equal((await journal.readFirstCutoverEffects()).registrationEvents.length, 0);
    await assert.rejects(retireLocalFirstCutoverGateways(input, io));
    await journal.persist('all_fenced', { candidate: 'b'.repeat(40) });
    await journal.persist('stopped', { candidate: 'b'.repeat(40) });
    if (lostAck) {
      let deletions = 0;
      const system = {
        exec: async (file, argv) => {
          const result = await exec(file, argv);
          if (argv[1] === 'delete') {
            deletions++;
            throw new Error('QA lost acknowledgement after real PM2 delete');
          }
          return result;
        },
      };
      await assert.rejects(
        retireLocalFirstCutoverGateways(input, io, system),
        /CUTOVER_REGISTRATION_UNCERTAIN/,
      );
      await assert.rejects(fetch('http://127.0.0.1:4010'));
      assert.equal((await fetch('http://127.0.0.1:4011')).status, 200);
      const effects = await journal.readFirstCutoverEffects();
      assert.equal(effects.registrationEvents.at(-1).phase, 'registration-delete-intent');
      assert.equal(effects.unmanagedEvents.length, 0);
      await assert.rejects(retireLocalFirstCutoverGateways(input, io, system));
      assert.equal(deletions, 1);
      assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
      console.log(
        'PASS physical gateway lost ACK: actual managed stop, intent retained, unmanaged gateway untouched, repeat refused',
      );
    } else {
      const stopped = await retireLocalFirstCutoverGateways(input, io);
      assert.equal(stopped.host, 'aliyun');
      assert.equal(stopped.phase, 'stopped');
      await assert.rejects(fetch('http://127.0.0.1:4010'));
      await assert.rejects(fetch('http://127.0.0.1:4011'));
      assert.equal(gateway.signalCode, 'SIGTERM');
      const effects = await journal.readFirstCutoverEffects();
      assert.equal(effects.registrationEvents.length, 4);
      assert.ok(effects.registrationEvents.every((e) => e.host === 'aliyun'));
      assert.equal(effects.unmanagedEvents.length, 2);
      assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
      await assert.rejects(retireLocalFirstCutoverGateways(input, io));
      console.log(
        'PASS physical gateway composition: prepare keeps both live; stopped retires managed and pinned unmanaged gateway once; unrelated PID preserved',
      );
    }
  } else {
    const readProgress = async () => (await observer.readRegistrationProgress('vultr')).inventory;
    const result = await retireLocalFirstCutoverProducers(
      { files, binding, maintenanceEndsAtMs: Date.now() + 60000 },
      {
        now: Date.now,
        sleep,
        journal,
        observer,
        verifyFence: async () => {
          const s = await readProgress();
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
    assert.equal(result.phase, 'producers_stopped');
    assert.equal(result.removed.length, 2);
    assert.deepEqual((await observer.read()).unknownLaunchers, []);
    assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
    await assert.rejects(fetch('http://127.0.0.1:4001'));
    const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
    assert.equal(record.registrationEvents.length, 6);
    await journal.persist('all_fenced', { candidate: 'b'.repeat(40) });
    await journal.persist('stopped', { candidate: 'b'.repeat(40) });
    const verifyGatewayFence = async () => ({
      inventoryDigest: binding.inventoryDigest,
      stage: 'all-writers',
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    });
    const gatewayEffects = createLegacyRuntimeEffects({
      now: Date.now,
      assertJournalOwnership: () => journal.assertOwnership(),
      verifyFence: verifyGatewayFence,
      readInventory: async () => (await observer.readUnmanagedProgress('aliyun')).inventory,
    });
    const stopped = await observer.retireUnmanaged(
      { maintenanceEndsAtMs: Date.now() + 30000 },
      {
        sleep,
        verifyFence: verifyGatewayFence,
        signalPinned: gatewayEffects.signalPinned,
      },
    );
    assert.equal(stopped.host, hostname());
    assert.equal(gateway.signalCode, 'SIGTERM');
    assert.equal((await journal.readFirstCutoverEffects()).unmanagedEvents.length, 2);
    assert.deepEqual((await observer.read()).unknownLaunchers, []);
    await assert.rejects(fetch('http://127.0.0.1:4011'));
    console.log(
      'PASS physical unmanaged gateway retirement: kernel hostname, pinned SIGTERM, owned intent/completion and fresh joint observation',
    );
    console.log(
      'PASS physical protected registration removal: memory-enabled UID998 worker exited, stopped cron removed, unrelated PID unchanged, private backup and six real journal events',
    );
  }
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
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) gateway.kill('SIGTERM');
  await pm2('kill');
  await journal?.close();
}
