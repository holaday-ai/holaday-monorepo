// Disposable, private-PID Linux QA. No production access or credentials.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { connectFirstCutoverGatewaySession } from '/source/browser-first-cutover-gateway-session.mjs';
import {
  createFirstCutoverRetirementObserver,
  readReviewedFirstCutoverLegacySource,
  recordFirstCutoverFailure,
} from '/source/browser-first-cutover-host.mjs';
import {
  classifyFirstCutoverHostPair,
  firstCutoverSourceBindings,
} from '/source/browser-first-cutover-inventory.mjs';
import {
  prepareLocalFirstCutoverGateway,
  registrationConfigDigest,
  retireLocalFirstCutoverGateways,
  retireLocalFirstCutoverProducers,
} from '/source/browser-first-cutover-registrations.mjs';
import { createLegacyRuntimeEffects } from '/source/browser-first-cutover-runtime.mjs';
import { createFirstCutoverExecutionSite } from '/source/browser-first-cutover-site.mjs';
import { performFirstCutover } from '/source/browser-first-cutover-transition.mjs';
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
    (process.argv.length === 3 &&
      [
        '--gateways',
        '--gateways-lost-ack',
        '--gateway-session',
        '--gateway-session-baseline',
        '--gateway-session-lost-ack',
        '--gateway-session-observed-executor',
        '--execution-site',
        '--execution-site-interruption',
        '--execution-site-lost-ack',
        '--execution-site-lost-effect',
        '--execution-site-known-effect',
      ].includes(process.argv[2])),
);
const lostAck = process.argv[2] === '--gateways-lost-ack';
const siteMode = process.argv[2]?.startsWith('--execution-site');
const siteLostAck = process.argv[2] === '--execution-site-lost-ack';
const lostEffect = ['--execution-site-lost-effect', '--execution-site-known-effect'].includes(
  process.argv[2],
);
const knownEffect = process.argv[2] === '--execution-site-known-effect';
const interruption = lostEffect || process.argv[2] === '--execution-site-interruption';
const sessionMode = siteMode || process.argv[2]?.startsWith('--gateway-session');
const sessionLostAck = process.argv[2] === '--gateway-session-lost-ack';
const observeExecutor = process.argv[2] === '--gateway-session-observed-executor';
const attachedBaseline = siteMode || process.argv[2] === '--gateway-session-baseline';
const gateways = process.argv.length === 3;
const mainPort = gateways ? 4010 : 4001;
const mainName = gateways ? 'holaday-cn-payment' : 'holaday-account-closure-worker';
const cwd = gateways
  ? '/opt/holaday-cn-payment/releases/123456789abc-20260927070000/apps/cn-payment'
  : '/opt/holaday-monorepo/apps/orchestrator';
const directory = '/var/lib/holaday-deploy/maintenance';
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
await fs.mkdir(cwd, { recursive: true });
let effectCount = 0;
let knownEffectVisible = false;
let effectServer;
let effectUrl;
if (lostEffect) {
  // Independent non-payment test oracle, never passed to production observers.
  // Complete the effect then destroy the response. Every legacy restart would
  // repeat the effect: there is intentionally no persistent deduplication key.
  effectServer = createServer((request) => {
    request.resume();
    request.on('end', () => {
      effectCount++;
      request.socket.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    effectServer.once('error', reject);
    effectServer.listen(0, '127.0.0.1', resolve);
  });
  effectUrl = `http://127.0.0.1:${effectServer.address().port}/non-payment-effect`;
}
await fs.writeFile(
  `${cwd}/registry-worker.cjs`,
  lostEffect
    ? `const http=require('http');const request=http.request(${JSON.stringify(effectUrl)},{method:'POST'},()=>process.exit(2));request.once('error',()=>{http.createServer((q,r)=>r.end('qa')).listen(${mainPort});});request.end('synthetic');process.on('SIGINT',()=>{});\n`
    : `require('http').createServer((q,r)=>r.end('qa')).listen(${mainPort});process.on('SIGINT',()=>{});\n`,
);
await fs.writeFile('/tmp/registry-idle.cjs', 'setInterval(()=>{},1000);\n');
// Approved metadata is synthetic; process and protected-file observations below
// remain real. No production merchant or recovery transcript is used here.
const readinessInventory = { configurationDigests: ['c'.repeat(64)], merchants: [], targets: [] };
const binding = {
  attempt: '22222222-2222-4222-8222-222222222222',
  inventoryDigest: siteMode ? sha(JSON.stringify(readinessInventory)) : 'a'.repeat(64),
};
let journal;
let gateway;
let receiver;
let receiverCompletion;
let client;
let executionSite;
let siteContext;
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
      assert.equal(
        (await fetch(`http://127.0.0.1:${mainPort}`, { headers: { connection: 'close' } })).status,
        200,
      );
      break;
    } catch (e) {
      if (n > 50) throw e;
      await sleep(100);
    }
  }
  const bootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8'))
    .trim()
    .replaceAll('-', '');
  if (lostEffect) assert.equal(effectCount, 1, 'legacy acted once and the HTTP response was lost');
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
      cgroup: await fs.readFile(`${base}/cgroup`, 'utf8'),
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
      assert.equal(
        (await fetch('http://127.0.0.1:4011', { headers: { connection: 'close' } })).status,
        200,
      );
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
    const tcpBefore = await exec('ss', ['-H', '-antp']);
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
      tcp: { before: tcpBefore, after: await exec('ss', ['-H', '-antp']) },
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
    // Both logical hosts here share this isolated QA network namespace.
    // Classifier selects only each host's separately approved service ports.
    second.tcp = structuredClone(snapshot.tcp);
    second.processes = second.processes.filter((p) => p.pid !== gateway.pid);
    second.listeners = '';
    const gatewayHost = gateways ? snapshot : second;
    if (sessionMode && receiver && receiver.exitCode === null && receiver.signalCode === null)
      gatewayHost.processes.push(raw(await proc(receiver.pid)));
    if (gateway.exitCode === null && gateway.signalCode === null)
      gatewayHost.processes.push(raw(await proc(gateway.pid)));
    gatewayHost.listeners += await exec('ss', ['-H', '-ltnp', 'sport = :4011']);
    return {
      sourceDigest: sha('physical-pm2-fixture'),
      sourceCandidate: interruption ? '107857fe70503e30691073f267d87275596edb20' : 'c'.repeat(40),
      observedAtMs: snapshot.observedAtMs,
      hosts: [
        {
          host: 'aliyun',
          sourceCandidate: null,
          snapshot: gateways ? snapshot : structuredClone(second),
        },
        {
          host: 'vultr',
          sourceCandidate: interruption
            ? '107857fe70503e30691073f267d87275596edb20'
            : 'c'.repeat(40),
          snapshot: {
            ...(gateways ? structuredClone(second) : snapshot),
            // Synthetic source proof: this fixture verifies physical retirement,
            // not the legacy source files (tested independently with real I/O).
            ...(interruption
              ? {
                  legacyCapability: {
                    schemaVersion: 1,
                    sourceCandidate: '107857fe70503e30691073f267d87275596edb20',
                    observedAtMs: snapshot.observedAtMs,
                    capabilityDigest:
                      '8eae2e6ebcaab8d92eb5694bb6f8f89923a23005888342309278fcc35ac35a72',
                  },
                }
              : {}),
          },
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
  assert.deepEqual(
    classifyFirstCutoverHostPair({
      pair: await readPair(),
      reviews,
      inventoryDigest: binding.inventoryDigest,
    }).unknownLaunchers,
    [],
  );
  const proof = await readReviewedFirstCutoverLegacySource(
    { reviews, inventoryDigest: binding.inventoryDigest },
    { readPair },
  );
  const maintenanceEndsAtMs = Date.now() + 60000;
  const interruptionMetadata = interruption
    ? {
        schemaVersion: 2,
        maintenanceEndsAtMs,
        reconcileByMs: maintenanceEndsAtMs + 60000,
        operatorRef: 'qa-only',
        legacyInterruption: {
          mode: 'controlled-interruption',
          scope: 'legacy-non-payment-memory',
          approvalRef: 'legacy-interruption-20260928',
          capabilityDigest: '8eae2e6ebcaab8d92eb5694bb6f8f89923a23005888342309278fcc35ac35a72',
          observeUntilMs: maintenanceEndsAtMs,
          noAutomaticReplay: true,
        },
      }
    : {};
  journal = await acquireReleaseJournal(directory, {
    ...binding,
    kind: 'first-cutover',
    candidate: 'b'.repeat(40),
    configDigest: 'c'.repeat(64),
    migrationDigest: sha('[]'),
    legacyDigest: proof.legacyDigest,
    ...interruptionMetadata,
  });
  const createObserver = async () =>
    createFirstCutoverRetirementObserver(
      { reviews, binding: await journal.assertOwnership(), legacyDigest: proof.legacyDigest },
      {
        journal,
        readPair,
        readExecutionIdentities: async () =>
          client && !observeExecutor ? [client.readExecutionIdentity()] : [],
      },
    );
  let observer = attachedBaseline ? undefined : await createObserver();
  await journal.bindManifest([]);
  const advanceToPrepare = async () => {
    for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
      await journal.persist(phase, { candidate: 'b'.repeat(40) });
  };
  if (!attachedBaseline) await advanceToPrepare();
  if (gateways) {
    const input = { files, binding, maintenanceEndsAtMs };
    const io = {
      now: Date.now,
      sleep,
      journal,
      observer: {
        read: (...args) => observer.read(...args),
        readRegistrationProgress: (...args) => observer.readRegistrationProgress(...args),
        readUnmanagedProgress: (...args) => observer.readUnmanagedProgress(...args),
        retireUnmanaged: (...args) => observer.retireUnmanaged(...args),
      },
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
    if (sessionMode) {
      const fullBinding = await journal.assertOwnership();
      const approval = {
        schemaVersion: 1,
        kind: 'first-cutover',
        ...fullBinding,
        legacyDigest: proof.legacyDigest,
        branch: 'codex/qa-gateway-session',
        maintenanceEndsAtMs: input.maintenanceEndsAtMs,
        reconcileByMs: input.maintenanceEndsAtMs + 60000,
        operatorRef: 'qa-only',
        ...interruptionMetadata,
      };
      await fs.writeFile(`${directory}/first-cutover-approved.json`, JSON.stringify(approval), {
        mode: 0o600,
      });
      const siteBytes = JSON.stringify({
        schemaVersion: 1,
        host: 'aliyun',
        binding: fullBinding,
        maintenanceEndsAtMs: input.maintenanceEndsAtMs,
        startupFiles: files,
      });
      await fs.writeFile(`${directory}/first-cutover-gateway-approved.json`, siteBytes, {
        mode: 0o600,
      });
      receiver = spawn(
        '/usr/bin/node',
        ['/source/browser-first-cutover-gateway-session.mjs', binding.attempt],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      receiver.stderr.resume();
      receiverCompletion = new Promise((resolve) =>
        receiver.once('close', (code) => resolve({ code })),
      );
      const originalRecord = journal.recordRegistrationEvent.bind(journal);
      const connect = () =>
        connectFirstCutoverGatewaySession(
          {
            binding: fullBinding,
            maintenanceEndsAtMs: input.maintenanceEndsAtMs,
            siteDigest: sha(siteBytes),
          },
          {
            ...io,
            journal: {
              ...journal,
              recordRegistrationEvent: async (event) => {
                await originalRecord(event);
                if (sessionLostAck && event.phase === 'registration-deleted') receiver.stdin.end();
              },
            },
            open: async () => ({
              input: receiver.stdout,
              output: receiver.stdin,
              completion: receiverCompletion,
            }),
          },
        );
      if (siteMode) {
        siteContext = {
          approval,
          binding: fullBinding,
          journal,
          root: `/opt/holaday-releases/${fullBinding.candidate}`,
        };
        // One physical Aliyun host + receiver. Other host, ingress and business
        // counts are explicitly synthetic, NOT full two-host cutover evidence.
        const fence = (stage) => ({
          inventoryDigest: binding.inventoryDigest,
          stage,
          observedAtMs: Date.now(),
          existingSockets: 0,
          internalWriters: 0,
          producersRunning: 0,
        });
        await fs.writeFile(
          `${directory}/first-cutover-execution-approved.json`,
          JSON.stringify({
            schemaVersion: 1,
            host: 'vultr',
            binding: fullBinding,
            maintenanceEndsAtMs: input.maintenanceEndsAtMs,
            site: {
              legacyDigest: proof.legacyDigest,
              inventory: readinessInventory,
              reviews,
              gatewaySiteDigest: sha(siteBytes),
              ingress: {
                inventoryDigest: binding.inventoryDigest,
                unknownIngress: [],
                remoteSiteDigest: sha('synthetic ingress'),
                files: [
                  ['holaday', 'vultr-20260926'],
                  ['hd-app.orangebench.tech', 'aliyun-app-20260926'],
                  ['hd-pay.orangebench.tech', 'aliyun-pay-20260926'],
                ].map(([name, profile]) => ({
                  path: `/etc/nginx/sites-available/${name}`,
                  profile,
                })),
              },
              producerStartupFiles: ['dump.pm2', 'dump.pm2.bak'].map((name) => ({
                path: `/root/.pm2/${name}`,
                digest: sha('synthetic other host'),
                remove: [{ name: 'holaday-orchestrator', entryDigest: sha('synthetic producer') }],
              })),
            },
          }),
          { mode: 0o600 },
        );
        executionSite = createFirstCutoverExecutionSite(
          { attempt: binding.attempt },
          {
            readCoordinatorIdentity: async () => ({ binding: fullBinding }),
            // This process-retirement fixture has no business database. SQL
            // semantics are exercised by the separate real MySQL fixture.
            readPersistedWork: async () => ({
              observedAtMs: Date.now(),
              unsettled: [],
              ...(interruption
                ? { pendingReplay: 0, replaySourcesDigest: sha('synthetic QA persisted source') }
                : {}),
            }),
            readPair,
            facts: {
              observeWriters: async () => fence('orders'),
              observeWork: async () => ({
                inventoryDigest: binding.inventoryDigest,
                observedAtMs: Date.now(),
                unsettledWork: 0,
                externalWork: 0,
                activeRequests: 0,
                unknownWriters: 0,
                ...(interruption
                  ? {
                      schemaVersion: 2,
                      activeRequests: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
                      externalWork: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
                      knownExternalWork: knownEffectVisible
                        ? [{ privateEvidenceRef: sha('known QA action'), outcome: 'unknown' }]
                        : [],
                      capabilityDigest: interruptionMetadata.legacyInterruption.capabilityDigest,
                      replaySourcesDigest: sha('synthetic QA replay source'),
                      pendingReplay: 0,
                    }
                  : {}),
              }),
              settleLegacy: async () => {},
              verifyOpenedIdentity: async () => {
                throw Error('not exercised');
              },
              resumeWorker: async () => {
                throw Error('not exercised');
              },
              reconcile: async () => {
                throw Error('not exercised');
              },
              holdMaintenance: lostEffect ? recordFirstCutoverFailure : async () => {},
              readBackupPlan: async () => {
                throw Error('not exercised');
              },
            },
            createIngress: async () => ({
              verifyOrders: async () => fence('orders'),
              verifyFence: async () => fence('all-writers'),
              fenceOrders: async () => {},
              fenceAll: async () => {},
              readFenceReceipts: async () => [],
              close: async () => {},
            }),
            connectGateway: async (args, deps) => {
              client = await connectFirstCutoverGatewaySession(args, {
                ...deps,
                ...(siteLostAck
                  ? {
                      journal: {
                        ...deps.journal,
                        recordRegistrationEvent: async (event) => {
                          await deps.journal.recordRegistrationEvent(event);
                          if (event.phase === 'registration-deleted') receiver.stdin.end();
                        },
                      },
                    }
                  : {}),
                open: async () => ({
                  input: receiver.stdout,
                  output: receiver.stdin,
                  completion: receiverCompletion,
                }),
              });
              return client;
            },
            createObserver: async (args, deps) => {
              observer = await createFirstCutoverRetirementObserver(args, {
                ...deps,
                readExecutionIdentities: async () => [client.readExecutionIdentity()],
              });
              return observer;
            },
            retireProducers: async () => {
              assert.equal(
                (await observer.read()).hosts.find((h) => h.host === 'vultr').registered.processes
                  .length,
                0,
              );
            },
          },
        );
        await executionSite.lifecycle.attach(siteContext);
        if (interruption) {
          const socket = createConnection({ host: '127.0.0.1', port: 4011 });
          try {
            await new Promise((resolve, reject) => {
              socket.once('connect', resolve);
              socket.once('error', reject);
            });
            const connected = await observer.read();
            assert.equal(
              connected.hosts.find((h) => h.host === 'aliyun').tcpObservation.existingSockets,
              1,
            );
            assert.equal(
              connected.hosts.find((h) => h.host === 'vultr').tcpObservation.existingSockets,
              0,
            );
          } finally {
            const closed = new Promise((resolve) => socket.once('close', resolve));
            socket.destroy();
            await closed;
          }
          console.log(
            'PASS real ss observation sees retained service connection independently of synthetic writer counts',
          );
        }
        const readinessScope = {
          binding: fullBinding,
          stage: 'prepare',
          window: {
            maintenanceEndsAtMs: approval.maintenanceEndsAtMs,
            reconcileByMs: approval.reconcileByMs,
            operatorRef: approval.operatorRef,
          },
        };
        const actualInventory = await executionSite.evidence.readHostInventory(readinessScope);
        assert.deepEqual(actualInventory.inventory, readinessInventory);
        assert.deepEqual(actualInventory.producersRunning, []); // This fixture has only gateways.
        if (interruption) {
          assert.equal(
            actualInventory.riskDigest,
            (await journal.readFirstCutoverEffects()).riskDigest,
          );
          assert.equal(actualInventory.legacyWork.before.activeRequests.kind, 'unobservable');
          assert.equal(actualInventory.legacyWork.after.externalWork.kind, 'unobservable');
        }
        const evidenceDirectory = '/var/lib/holaday-deploy/evidence-private';
        await fs.mkdir(evidenceDirectory, { mode: 0o700 });
        await fs.writeFile(
          `${evidenceDirectory}/rehearsal-${fullBinding.configDigest}.json`,
          JSON.stringify({
            schemaVersion: 1,
            candidate: fullBinding.candidate,
            configDigest: fullBinding.configDigest,
            inventoryDigest: fullBinding.inventoryDigest,
            observedAtMs: Date.now(),
            recoveryUntilMs: approval.reconcileByMs,
            recovery: 'retry-proven',
            artifacts: [],
          }),
          { mode: 0o600, flag: 'wx' },
        );
        assert.equal(
          (await executionSite.evidence.readRehearsalArtifacts(readinessScope)).recoveryUntilMs,
          approval.reconcileByMs,
        );
        console.log(
          'PASS site readiness readers: default root-protected inventory/rehearsal file readers and actual process observer; synthetic merchant metadata, NOT payment recovery',
        );
      } else client = await connect();
    }
    if (siteMode) {
      if (lostEffect) {
        // Exercise the real transition/site/journal through retirement. The
        // not-yet-integrated restore/start/readiness tail MUST fail, not return
        // a fabricated success. This is deliberately NOT a full cutover pass.
        const forbiddenTail = async () => {
          throw new Error('CUTOVER_QA_UNEXPECTED_TAIL');
        };
        const adapter = Object.fromEntries(
          [
            'settleLegacy',
            'migrate',
            'initializeState',
            'start',
            'verify',
            'beforeOpen',
            'open',
            'status',
            'afterOpen',
            'resumeWorker',
            'reconcile',
            'close',
          ].map((name) => [name, forbiddenTail]),
        );
        Object.assign(adapter, {
          preflight: async (candidate) => assert.equal(candidate, siteContext.binding.candidate),
          stage: async () => assert.deepEqual(await journal.assertOwnership(), siteContext.binding),
          persist: (phase, detail) => {
            if (knownEffect && phase === 'legacy_interruption_accepted') knownEffectVisible = true;
            return journal.persist(phase, detail);
          },
          backupAndRestoreCheck: async () => {
            throw new Error('CUTOVER_QA_RESTORE_NOT_CONFIGURED');
          },
          holdMaintenance: (result) => executionSite.lifecycle.holdMaintenance(siteContext, result),
        });
        for (const method of [
          'readLegacyDisposition',
          'acceptLegacyInterruption',
          'fenceOrders',
          'stopProducers',
          'fenceAll',
          'stopLegacy',
        ])
          adapter[method] = () => executionSite.lifecycle[method](siteContext);
        const result = await performFirstCutover({
          candidate: siteContext.binding.candidate,
          adapter,
          window: siteContext.approval,
        });
        assert.equal(result.ok, false);
        assert.equal(result.action, 'hold_maintenance');
        assert.equal(
          result.phase,
          knownEffect ? 'legacy_interruption_accepted' : 'backup_verified',
        );
        const effects = await journal.readFirstCutoverEffects();
        assert.equal(effects.failureObservation.status.mode, 'not-started');
        assert.equal(effects.failureObservation.status.closeAcknowledged, false);
        if (knownEffect) {
          // The real site intentionally normalizes inner boundary failures.
          assert.equal(result.code, 'CUTOVER_SITE_UNPROVEN');
          assert.equal(effects.interruptionObservation, undefined);
          assert.equal(effects.registrationEvents.length, 0);
          assert.equal(effects.unmanagedEvents.length, 0);
          assert.equal((await fetch(`http://127.0.0.1:${mainPort}`)).status, 200);
        } else {
          assert.equal(result.code, 'CUTOVER_QA_RESTORE_NOT_CONFIGURED');
          assert.equal(effects.interruptionObservation.riskDigest, effects.riskDigest);
          assert.equal(effects.legacyInterruption.scope, 'legacy-non-payment-memory');
          assert.equal(effects.legacyInterruption.noAutomaticReplay, true);
          assert.deepEqual(
            (await executionSite.lifecycle.assertStopped(siteContext)).survivors,
            [],
          );
          await assert.rejects(fetch(`http://127.0.0.1:${mainPort}`));
        }
        assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
        await executionSite.lifecycle.detach(siteContext);
        assert.equal((await receiverCompletion).code, 0);
        if (!knownEffect) {
          await pm2('kill');
          await pm2('resurrect');
          assert.deepEqual(
            (await rows()).map((r) => r.name),
            ['qa-unrelated'],
          );
        }
        assert.equal(effectCount, 1, 'no retry, old startup replay, or business compensation');
        console.log(
          `QA_LOST_EFFECT_RESULT ${JSON.stringify({
            scope: 'retirement-and-failure-only',
            knownEffect,
            phase: result.phase,
            effectCount,
            riskDigest: effects.riskDigest,
            releaseReady: false,
          })}`,
        );
      } else {
        for (const [phase, method] of [
          ['prepared', null],
          ['orders_fenced', 'fenceOrders'],
          interruption
            ? ['legacy_interruption_accepted', 'acceptLegacyInterruption']
            : ['legacy_settled', 'settleLegacy'],
          ['producers_stopped', 'stopProducers'],
          ['all_fenced', 'fenceAll'],
          ['stopped', 'stopLegacy'],
        ]) {
          await journal.persist(phase, { candidate: 'b'.repeat(40) });
          if (siteLostAck && phase === 'stopped') {
            await assert.rejects(executionSite.lifecycle.stopLegacy(siteContext), /UNPROVEN/);
            const count = (await journal.readFirstCutoverEffects()).registrationEvents.length;
            await assert.rejects(executionSite.lifecycle.stopLegacy(siteContext), /UNPROVEN/);
            await assert.rejects(executionSite.lifecycle.assertStopped(siteContext), /UNPROVEN/);
            assert.equal(
              (await journal.readFirstCutoverEffects()).registrationEvents.length,
              count,
            );
            assert.equal((await journal.readFirstCutoverEffects()).unmanagedEvents.length, 0);
            break;
          }
          if (method)
            try {
              await executionSite.lifecycle[method](siteContext);
            } catch (error) {
              const effects = await journal.readFirstCutoverEffects();
              console.error(
                'QA composition failure',
                phase,
                effects.startupEvents.at(-1)?.phase,
                effects.registrationEvents.at(-1)?.phase,
                effects.unmanagedEvents.at(-1)?.phase,
              );
              throw error;
            }
          if (phase === 'producers_stopped') {
            assert.equal(
              (await fetch('http://127.0.0.1:4010', { headers: { connection: 'close' } })).status,
              200,
            );
            assert.equal(
              (await fetch('http://127.0.0.1:4011', { headers: { connection: 'close' } })).status,
              200,
            );
          }
        }
        await assert.rejects(fetch('http://127.0.0.1:4010'));
        assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
        if (siteLostAck) {
          assert.equal((await fetch('http://127.0.0.1:4011')).status, 200);
          await assert.rejects(executionSite.lifecycle.detach(siteContext), /UNPROVEN/);
          assert.equal((await receiverCompletion).code, 1);
          console.log(
            'PASS execution-site lost ACK: physical deletion retained, no replay or unmanaged signal, no false stopped proof; synthetic ingress/business/other-host boundaries',
          );
        } else {
          assert.deepEqual(
            (await executionSite.lifecycle.assertStopped(siteContext)).survivors,
            [],
          );
          if (interruption) {
            const effects = await journal.readFirstCutoverEffects();
            assert.equal(effects.schemaVersion, 2);
            assert.equal(effects.interruptionObservation.riskDigest, effects.riskDigest);
            console.log(
              'PASS controlled interruption: durable owned risk survives physical gateway retirement; business and ingress observations remain synthetic',
            );
          }
          await assert.rejects(fetch('http://127.0.0.1:4011'));
          await executionSite.lifecycle.detach(siteContext);
          assert.equal((await receiverCompletion).code, 0);
          console.log(
            'PASS execution-site composition: actual gateway receiver, owned journal, protected startup, PM2 and pidfd retirement; synthetic ingress/business/other-host boundaries',
          );
        }
      }
    } else {
      if (attachedBaseline) {
        observer = await createObserver();
        assert.equal((await observer.read()).unknownLaunchers.length, 0);
        await advanceToPrepare();
        console.log(
          'PASS physical baseline after receiver attachment, original legacy digest unchanged',
        );
      }
      if (observeExecutor) {
        await assert.rejects(client.prepare(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
        assert.equal((await receiverCompletion).code, 1);
        assert.equal((await journal.readFirstCutoverEffects()).startupEvents.length, 0);
        assert.equal((await fetch('http://127.0.0.1:4010')).status, 200);
        assert.equal((await fetch('http://127.0.0.1:4011')).status, 200);
        for (const file of files) assert.equal(sha(await fs.readFile(file.path)), file.digest);
        console.log(
          'PASS refusal: newly observed unreviewed executor blocks preparation without stopping gateways or changing startup files; full-site executor attribution still required',
        );
      } else {
        const prepared = client
          ? await client.prepare()
          : await prepareLocalFirstCutoverGateway(input, io);
        assert.equal(prepared.phase, 'startup_prepared');
        assert.equal((await fetch('http://127.0.0.1:4010')).status, 200);
        assert.equal((await fetch('http://127.0.0.1:4011')).status, 200);
        assert.equal((await journal.readFirstCutoverEffects()).registrationEvents.length, 0);
        await assert.rejects(retireLocalFirstCutoverGateways(input, io));
        await journal.persist('all_fenced', { candidate: 'b'.repeat(40) });
        await journal.persist('stopped', { candidate: 'b'.repeat(40) });
        if (sessionLostAck) {
          await assert.rejects(client.retire(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
          await assert.rejects(client.retire(), /CUTOVER_GATEWAY_SESSION_UNPROVEN/);
          await assert.rejects(fetch('http://127.0.0.1:4010'));
          assert.equal((await fetch('http://127.0.0.1:4011')).status, 200);
          const effects = await journal.readFirstCutoverEffects();
          assert.equal(effects.registrationEvents.at(-1).phase, 'registration-deleted');
          assert.equal(effects.unmanagedEvents.length, 0);
          assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
          assert.equal((await receiverCompletion).code, 1);
          console.log(
            'PASS physical remote disconnect: actual deletion recorded, no signal or resend, unrelated PID unchanged',
          );
        } else if (lostAck) {
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
          const stopped = client
            ? await client.retire()
            : await retireLocalFirstCutoverGateways(input, io);
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
          if (client) {
            await client.close();
            assert.equal((await receiverCompletion).code, 0);
          }
          console.log(
            'PASS physical gateway composition: prepare keeps both live; stopped retires managed and pinned unmanaged gateway once; unrelated PID preserved',
          );
        }
      }
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
  if (!lostEffect && !observeExecutor) {
    await pm2('kill');
    await pm2('resurrect');
    assert.deepEqual(
      (await rows()).map((r) => r.name),
      ['qa-unrelated'],
    );
    console.log(
      'PASS independent saved-entry removal: daemon restart restores only unrelated fixture',
    );
  }
} finally {
  receiver?.stdin.end();
  if (receiverCompletion) await receiverCompletion;
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) gateway.kill('SIGTERM');
  await pm2('kill');
  await journal?.close();
  if (effectServer)
    await new Promise((resolve, reject) =>
      effectServer.close((error) => (error ? reject(error) : resolve())),
    );
}
