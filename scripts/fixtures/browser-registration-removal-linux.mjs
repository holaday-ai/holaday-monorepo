// Disposable, private-PID Linux QA. No production access or credentials.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseEnv, promisify } from 'node:util';
import { backupAndRestoreCheck } from '/source/browser-first-cutover-backup.mjs';
import { connectFirstCutoverGatewaySession } from '/source/browser-first-cutover-gateway-session.mjs';
import {
  createFirstCutoverHostAdapter,
  createFirstCutoverRetirementObserver,
  exportFirstCutoverSourceBackup,
  readFirstCutoverBackupPlan,
  readFirstCutoverSourceSnapshot,
  readReviewedFirstCutoverLegacySource,
  recordFirstCutoverFailure,
} from '/source/browser-first-cutover-host.mjs';
import {
  classifyFirstCutoverHostPair,
  firstCutoverSourceBindings,
} from '/source/browser-first-cutover-inventory.mjs';
import { connectFirstCutoverRecoverySession } from '/source/browser-first-cutover-recovery-session.mjs';
import {
  prepareLocalFirstCutoverGateway,
  registrationConfigDigest,
  retireLocalFirstCutoverGateways,
  retireLocalFirstCutoverProducers,
} from '/source/browser-first-cutover-registrations.mjs';
import { createLegacyRuntimeEffects } from '/source/browser-first-cutover-runtime.mjs';
import { createFirstCutoverExecutionSite } from '/source/browser-first-cutover-site.mjs';
import { performFirstCutover } from '/source/browser-first-cutover-transition.mjs';
import { candidatePreparationSystem } from '/source/browser-maintenance-host.mjs';
import { acquireReleaseJournal } from '/source/browser-maintenance-journal.mjs';
import { buildMaintenanceMigrationManifest } from '/source/browser-maintenance-manifest.mjs';
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
const recoveryLink = process.argv[2] === '--execution-site-recovery';
const recoveryDrift = process.env.CUTOVER_QA_RECOVERY_DRIFT === '1';
assert.ok(!recoveryDrift || recoveryLink);
const recoveryScope = recoveryLink ? JSON.parse(process.env.CUTOVER_QA_RECOVERY_SCOPE) : undefined;
const sourceQa = process.env.CUTOVER_QA_SOURCE
  ? JSON.parse(process.env.CUTOVER_QA_SOURCE)
  : undefined;
const fullHost = process.env.CUTOVER_QA_HOST === '1';
assert.ok(
  !fullHost || process.argv[2] === '--execution-site-lost-effect' || (recoveryLink && sourceQa),
);
if (fullHost && sourceQa) {
  assert.equal(process.env.CUTOVER_QA_HOST_FAULT, 'before-migration');
  assert.equal(sourceQa.omitReceipt, false);
}
const hostConfig = fullHost
  ? sourceQa
    ? Buffer.from(sourceQa.config)
    : Buffer.from(
        [
          'MODEL_RUNTIME_POLICY=qwen_only',
          'QWEN_CORE_ENABLED_LANES=browser',
          'DASHSCOPE_INTL_API_KEY=synthetic-qa-not-a-provider-key',
          'DASHSCOPE_INTL_ANTHROPIC_BASE_URL=http://127.0.0.1:1',
          'DASHSCOPE_INTL_RESPONSES_BASE_URL=http://127.0.0.1:1',
          'QWEN_CORE_ROLLOUT_MODE=off',
          'TEAM_TASK_LIFECYCLE_ENABLED=false',
          'ACCOUNT_CLOSURE_WORKER_ENABLED=false',
          '',
        ].join('\n'),
      )
  : undefined;
let hostCandidate;
if (fullHost) {
  assert.equal(
    (await exec('git', ['-C', '/opt/holaday-monorepo', 'remote', 'get-url', 'origin'])).trim(),
    '/qa-origin.git',
  );
  hostCandidate = (await exec('git', ['--git-dir=/qa-origin.git', 'rev-parse', 'HEAD'])).trim();
  assert.match(hostCandidate, /^[a-f0-9]{40}$/);
  if (sourceQa) assert.equal(hostCandidate, recoveryScope.binding.candidate);
  else
    await fs.writeFile('/var/lib/holaday-deploy/maintenance-target.env', hostConfig, {
      flag: 'wx',
      mode: 0o600,
    });
}
assert.ok(!sourceQa || (recoveryLink && !recoveryDrift));
let sourceIo;
if (sourceQa) {
  assert.equal(sha(sourceQa.config), recoveryScope.binding.configDigest);
  await fs.mkdir(sourceQa.sourceOptions.directory, { recursive: true, mode: 0o700 });
  await fs.chmod(sourceQa.sourceOptions.directory, 0o700);
  await fs.writeFile(sourceQa.sourceOptions.facility.recipientFile, sourceQa.recipient, {
    mode: 0o600,
    flag: 'wx',
  });
  await fs.copyFile('/qa-source/mysqldump', sourceQa.backupSource.executable);
  await fs.chmod(sourceQa.backupSource.executable, 0o755);
  assert.equal(
    sha(await fs.readFile(sourceQa.backupSource.executable)),
    sourceQa.backupSource.executableDigest,
  );
  await fs.copyFile('/qa-source/mysql2.cjs', '/tmp/qa-mysql2.cjs');
  const mysql = createRequire(import.meta.url)('/tmp/qa-mysql2.cjs');
  await fs.writeFile('/var/lib/holaday-deploy/maintenance-target.env', sourceQa.config, {
    mode: 0o600,
    flag: 'wx',
  });
  sourceIo = {
    parseConfig: (bytes) => parseEnv(bytes.toString()),
    connectWorkDatabase: (uri) =>
      mysql.createConnection({
        uri,
        connectTimeout: 5000,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        jsonStrings: true,
        timezone: 'Z',
      }),
  };
}
if (recoveryLink) {
  // stdout is exclusively the original recovery protocol, never QA narration.
  console.log = (...values) => console.error(...values);
}
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
        '--execution-site-recovery',
      ].includes(process.argv[2])),
);
const lostAck = process.argv[2] === '--gateways-lost-ack';
const siteMode = process.argv[2]?.startsWith('--execution-site');
const siteLostAck = process.argv[2] === '--execution-site-lost-ack';
const lostEffect = [
  '--execution-site-lost-effect',
  '--execution-site-known-effect',
  '--execution-site-recovery',
].includes(process.argv[2]);
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
const readinessInventory = {
  configurationDigests: [
    hostConfig ? sha(hostConfig) : sourceQa ? recoveryScope.binding.configDigest : 'c'.repeat(64),
  ],
  merchants: [],
  targets: [],
};
if (recoveryLink)
  readinessInventory.backupPlan = {
    sourceIdentity: recoveryScope.sourceIdentity,
    isolatedTarget: recoveryScope.isolatedTarget,
  };
if (sourceQa) readinessInventory.backupSource = sourceQa.backupSource;
const binding = {
  attempt:
    recoveryScope?.binding.attempt ??
    (fullHost ? randomUUID() : '22222222-2222-4222-8222-222222222222'),
  inventoryDigest: siteMode ? sha(JSON.stringify(readinessInventory)) : 'a'.repeat(64),
};
let journal;
let gateway;
let receiver;
let receiverCompletion;
let client;
let executionSite;
let siteContext;
let hostAdapter;
let hostResult;
let hostMigrationFaults = 0;
let recoveryScopeChecks = 0;
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
  const maintenanceEndsAtMs =
    recoveryScope?.maintenanceEndsAtMs ?? Date.now() + (fullHost ? 600000 : 60000);
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
  const hostApproval = fullHost
    ? {
        kind: 'first-cutover',
        ...binding,
        candidate: hostCandidate,
        configDigest: sha(hostConfig),
        migrationDigest: buildMaintenanceMigrationManifest('/opt/holaday-monorepo').sha256,
        legacyDigest: proof.legacyDigest,
        branch: 'codex/browser-release-candidate-20260925',
        ...interruptionMetadata,
      }
    : undefined;
  if (fullHost) {
    await fs.writeFile(`${directory}/first-cutover-approved.json`, JSON.stringify(hostApproval), {
      flag: 'wx',
      mode: 0o600,
    });
    // Only synthetic QA installation. Keep private children protected while
    // allowing the actual uid998 readiness reader to traverse the ancestor.
    await fs.chown('/var/lib/holaday-deploy', 0, 998);
    await fs.chmod('/var/lib/holaday-deploy', 0o710);
    await fs.mkdir('/var/lib/holaday-deploy/evidence', { mode: 0o750 });
    await fs.chown('/var/lib/holaday-deploy/evidence', 0, 998);
  } else
    journal = await acquireReleaseJournal(directory, {
      ...binding,
      kind: 'first-cutover',
      candidate: 'b'.repeat(40),
      configDigest: sourceQa ? recoveryScope.binding.configDigest : 'c'.repeat(64),
      migrationDigest: sourceQa ? recoveryScope.binding.migrationDigest : sha('[]'),
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
  if (!fullHost) await journal.bindManifest(sourceQa?.migrationManifest ?? []);
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
    const setupSite = async (hostContext) => {
      if (hostContext) {
        assert.equal(journal, undefined, 'host must be the sole journal creator');
        journal = hostContext.journal;
        siteContext = hostContext;
        assert.deepEqual(await journal.assertOwnership(), hostContext.binding);
      }
      if (sessionMode) {
        const fullBinding = await journal.assertOwnership();
        if (recoveryLink) assert.deepEqual(fullBinding, recoveryScope.binding);
        const approval = hostContext?.approval ?? {
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
        if (!fullHost)
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
                  if (sessionLostAck && event.phase === 'registration-deleted')
                    receiver.stdin.end();
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
          siteContext = hostContext ?? {
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
                ...(recoveryLink ? { backupRecoveryDigest: recoveryScope.scopeDigest } : {}),
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
                  remove: [
                    { name: 'holaday-orchestrator', entryDigest: sha('synthetic producer') },
                  ],
                })),
              },
            }),
            { mode: 0o600 },
          );
          executionSite = createFirstCutoverExecutionSite(
            { attempt: binding.attempt },
            {
              readCoordinatorIdentity: async () => ({ binding: fullBinding }),
              ...(sourceQa
                ? {
                    readBackupPlan: (ctx, inventory) =>
                      readFirstCutoverBackupPlan(ctx, inventory, sourceIo),
                    exportSourceBackup: (ctx, inventory, deps) =>
                      exportFirstCutoverSourceBackup(ctx, inventory, { ...sourceIo, ...deps }),
                    readSourceSnapshot: (ctx, inventory, deps) =>
                      readFirstCutoverSourceSnapshot(ctx, inventory, { ...sourceIo, ...deps }),
                  }
                : {}),
              // Persisted-work/other-host facts remain explicitly synthetic.
              // sourceQa adds a real backup database, not production work coverage.
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
                ...(sourceQa
                  ? {}
                  : {
                      readBackupPlan: async () => {
                        throw Error('not exercised');
                      },
                    }),
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
                if (fullHost) {
                  for (const name of Object.keys(observer)) {
                    if (typeof observer[name] !== 'function') continue;
                    const original = observer[name];
                    observer[name] = async (...args) => {
                      try {
                        return await original(...args);
                      } catch (error) {
                        console.error('QA_OBSERVER_FAILED', name, error.message);
                        throw error;
                      }
                    };
                  }
                }
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
    };
    if (fullHost) {
      const forward = (group, names) =>
        Object.fromEntries(
          names.map((name) => [
            name,
            async (...args) => {
              assert.ok(executionSite, 'site must be attached by the original host');
              try {
                return await executionSite[group][name](...args);
              } catch (error) {
                console.error('QA_SITE_FAILED', group, name, error.message);
                throw error;
              }
            },
          ]),
        );
      const system = candidatePreparationSystem();
      hostAdapter = createFirstCutoverHostAdapter(
        { attempt: binding.attempt },
        {
          lifecycle: {
            ...forward('lifecycle', [
              'detach',
              'fenceOrders',
              'settleLegacy',
              'stopProducers',
              'fenceAll',
              'stopLegacy',
              'assertStopped',
              'verifyFence',
              'restoreIngress',
              'resumeWorker',
              'reconcile',
              'holdMaintenance',
              'readBackupPlan',
              'readLegacyDisposition',
              'acceptLegacyInterruption',
            ]),
            attach: setupSite,
          },
          backup: forward('backup', [
            'readDatabaseIdentity',
            'inspectBackupFacility',
            'exportDatabase',
            'hashArtifact',
            'restoreIsolated',
            'compareInventoryAndData',
            'runApprovedMigrations',
            'verifySchema',
            'readSourceDigest',
            'finishRecovery',
          ]),
          evidence: {
            ...forward('evidence', [
              'readHostInventory',
              'readDatabaseScope',
              'queryOrders',
              'readRehearsalArtifacts',
              'readFenceState',
            ]),
            // The optional backup database does not prove application work or
            // payment coverage. Keep those scopes explicitly synthetic.
            readDatabaseScope: async () => ({
              observedAtMs: Date.now(),
              orders: [],
              unsettled: [],
            }),
            queryOrders: async (database) => {
              assert.deepEqual(database.orders, []);
              assert.deepEqual(database.unsettled, []);
              return [];
            },
          },
          inspectLegacySource: async () => ({
            sourceCandidate: (
              await exec('git', ['-C', '/opt/holaday-monorepo', 'rev-parse', 'HEAD'])
            ).trim(),
            legacyDigest: proof.legacyDigest,
            observedAtMs: Date.now(),
          }),
          exec: async (command, args, options) => {
            console.log('QA_HOST_COMMAND', command, JSON.stringify(args));
            if (sourceQa && command === 'pnpm' && args.includes('db:migrate:numbered')) {
              const durable = JSON.parse(await fs.readFile(journal.path, 'utf8'));
              assert.equal(durable.phase, 'migration_started');
              assert.ok(
                durable.backupReceipt,
                'original host must persist the real recovery receipt before migration',
              );
              assert.equal(durable.bootstrapSeed, undefined);
              // This is the explicit first host fault case, not a successful
              // candidate release. No source SQL is executed or retried here.
              hostMigrationFaults++;
              throw new Error('QA_INJECTED_MIGRATION_FAILURE');
            }
            return system.exec(command, args, options);
          },
        },
      );
    } else await setupSite();
    if (siteMode) {
      if (lostEffect) {
        // Exercise the real transition/site/journal through retirement and,
        // when sourceQa is supplied, the real backup/restore segment. The still
        // unconnected candidate tail MUST fail, not fabricate a full cutover.
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
            if (sourceQa) {
              const plan = await executionSite.lifecycle.readBackupPlan(siteContext);
              const receipt = await backupAndRestoreCheck(
                {
                  ...plan,
                  binding: siteContext.binding,
                  maintenanceEndsAtMs: siteContext.approval.maintenanceEndsAtMs,
                },
                {
                  ...executionSite.backup,
                  now: Date.now,
                  assertOwnership: () => journal.assertOwnership(),
                  assertWritersStopped: () => executionSite.lifecycle.assertStopped(siteContext),
                  sealReceipt: sourceQa.omitReceipt
                    ? (r) => r
                    : (r) => journal.bindBackupReceipt(r),
                },
              );
              try {
                assert.deepEqual(
                  JSON.parse(await fs.readFile(journal.path, 'utf8')).backupReceipt,
                  receipt,
                  'verified recovery must be durably bound to the same stopped attempt',
                );
              } catch {
                console.error('QA_DURABLE_RECEIPT_MISSING');
                throw new Error('QA_DURABLE_RECEIPT_MISSING');
              }
              await executionSite.backup.finishRecovery(siteContext);
              return receipt;
            }
            if (recoveryLink) {
              // Real stopped Linux attempt owns this Mac session. This is only
              // attach/target inspection: NO source export, restore or receipt.
              const recovery = await connectFirstCutoverRecoverySession(recoveryScope, {
                input: process.stdin,
                output: process.stdout,
                assertScope: () => {
                  // Introduce identifiable work after attach has begun, not a
                  // fabricated remote failure. The actual site must refuse it.
                  if (recoveryDrift && ++recoveryScopeChecks >= 3) knownEffectVisible = true;
                  return executionSite.recovery.assertScope(recoveryScope);
                },
              });
              assert.deepEqual(await recovery.inspect(), recoveryScope.isolatedTarget);
              await recovery.close();
              const durable = JSON.parse(await fs.readFile(journal.path, 'utf8'));
              assert.equal(durable.backupReceipt, undefined);
            }
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
          candidate: fullHost ? hostCandidate : siteContext.binding.candidate,
          adapter: hostAdapter ?? adapter,
          window: hostApproval ?? siteContext.approval,
        });
        hostResult = result;
        if (fullHost && sourceQa)
          assert.equal(
            hostMigrationFaults,
            1,
            'fault must occur exactly once after real durable recovery',
          );
        if (fullHost) console.log('QA_HOST_OUTCOME', JSON.stringify(result));
        if (process.env.CUTOVER_QA_HOST === '1') {
          // The old fixture's precreated bbbb journal cannot satisfy this: the
          // original host must stage the actual Git candidate before stopping.
          const actualCandidate = (
            await exec('git', ['--git-dir=/qa-origin.git', 'rev-parse', 'HEAD'])
          ).trim();
          assert.equal(siteContext.binding.candidate, actualCandidate, 'QA_ORIGINAL_HOST_REQUIRED');
          assert.equal(
            (await exec('git', ['-C', siteContext.root, 'rev-parse', 'HEAD'])).trim(),
            actualCandidate,
          );
          await fs.access(`${siteContext.root}/apps/orchestrator/dist/index.js`);
          const published = JSON.parse(
            await fs.readFile(`/var/lib/holaday-deploy/evidence/${binding.attempt}.json`, 'utf8'),
          );
          assert.equal(published.attempt, binding.attempt);
          assert.equal(published.candidate, actualCandidate);
          assert.equal(published.stage, 'prepare');
        }
        assert.equal(result.ok, false);
        assert.equal(result.action, 'hold_maintenance');
        assert.equal(
          result.phase,
          knownEffect
            ? 'legacy_interruption_accepted'
            : sourceQa
              ? 'migration_started'
              : 'backup_verified',
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
          assert.equal(
            result.code,
            recoveryDrift
              ? 'CUTOVER_RECOVERY_SESSION_UNPROVEN'
              : sourceQa
                ? fullHost
                  ? 'MAINTENANCE_RELEASE_FAILED'
                  : 'CUTOVER_QA_UNEXPECTED_TAIL'
                : fullHost
                  ? 'CUTOVER_SITE_UNPROVEN'
                  : 'CUTOVER_QA_RESTORE_NOT_CONFIGURED',
          );
          assert.equal(effects.interruptionObservation.riskDigest, effects.riskDigest);
          assert.equal(effects.legacyInterruption.scope, 'legacy-non-payment-memory');
          assert.equal(effects.legacyInterruption.noAutomaticReplay, true);
          if (recoveryDrift) {
            assert.ok(recoveryScopeChecks >= 3);
            assert.equal(knownEffectVisible, true);
            assert.ok(
              Date.now() < recoveryScope.maintenanceEndsAtMs,
              'reject work drift before deadline, not because of timeout',
            );
            assert.equal(
              JSON.parse(await fs.readFile(journal.path, 'utf8')).backupReceipt,
              undefined,
            );
            await assert.rejects(executionSite.lifecycle.assertStopped(siteContext), /UNPROVEN/);
          } else if (fullHost) {
            // Unlike the old adapter's artificial backup throw, the real site
            // latches its failed backup boundary. It must not issue new proofs.
            if (sourceQa)
              assert.deepEqual(
                (await executionSite.lifecycle.assertStopped(siteContext)).survivors,
                [],
              );
            else
              await assert.rejects(
                executionSite.lifecycle.assertStopped(siteContext),
                /CUTOVER_SITE_UNPROVEN/,
              );
            const durable = JSON.parse(await fs.readFile(journal.path, 'utf8'));
            assert.equal(Boolean(durable.backupReceipt), Boolean(sourceQa));
            assert.equal(durable.bootstrapSeed, undefined);
            assert.equal(effects.unmanagedEvents.at(-1).phase, 'unmanaged-stopped');
            await assert.rejects(fetch('http://127.0.0.1:4011'));
          } else if (!sourceQa)
            assert.deepEqual(
              (await executionSite.lifecycle.assertStopped(siteContext)).survivors,
              [],
            );
          await assert.rejects(fetch(`http://127.0.0.1:${mainPort}`));
        }
        assert.equal((await rows()).find((r) => r.name === 'qa-unrelated').pid, unrelated.pid);
        if (fullHost) await hostAdapter.finish(result);
        else await executionSite.lifecycle.detach(siteContext);
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
            scope: sourceQa ? 'retirement-backup-and-tail-refusal' : 'retirement-and-failure-only',
            knownEffect,
            phase: result.phase,
            effectCount,
            riskDigest: effects.riskDigest,
            releaseReady: false,
            ...(fullHost ? { originalHost: true, nativeCandidatePreparation: true } : {}),
            ...(recoveryLink
              ? { recoveryLinked: !recoveryDrift, recoveryRejected: recoveryDrift }
              : {}),
            ...(sourceQa
              ? {
                  backupReceipt: Boolean(
                    JSON.parse(await fs.readFile(journal.path, 'utf8')).backupReceipt,
                  ),
                }
              : {}),
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
  if (hostAdapter) {
    try {
      await hostAdapter.finish(hostResult ?? { ok: false });
    } catch (error) {
      console.error('QA_HOST_FINISH_FAILED', error.message);
      process.exitCode = 1;
    }
  }
  receiver?.stdin.end();
  if (receiverCompletion) await receiverCompletion;
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) gateway.kill('SIGTERM');
  await pm2('kill');
  await journal?.close();
  if (effectServer)
    await new Promise((resolve, reject) =>
      effectServer.close((error) => (error ? reject(error) : resolve())),
    );
  // The failed wire has ended stdout. Stop this fixture's inherited stdin
  // reader after journal/remote cleanup so the parent gets EOF promptly.
  if (recoveryLink) process.stdin.pause();
}
