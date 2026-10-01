// Diagnostic for the approved cloud-browser recovery boundary, NOT a release gate.
// Historical silent/app/global-policy modes retain their failed hypotheses.
// Run only in a disposable network-none Linux container, never with a real profile.
// No argument: silent startup; --app-blank: app window; --policy-probe: global
// policy characterization INSIDE THE CONTAINER ONLY. Never install this policy
// on a shared host. See the 2026-09-30 checkpoint for exact failures and limits.
// Retaining BOTH cookies is an exploratory hypothesis, not an added release
// requirement: the approved maintenance scope already accepts session interruption.
// --scoped-policy tests process-private policy visibility, NOT production recovery.
// This mode needs SYS_ADMIN in the disposable container for unshare/mount only;
// the browser runs with all capability sets cleared and no-new-privileges.
// --scoped-pm2 adds real numeric PM2 stops before and after recovery. Its daemon
// and unrelated app are disposable; production startup scripts are NOT executed.
// --scoped-pm2-vnc additionally measures real VNC recovery against the retained headed proof.
// --scoped-pm2-denied requires a container WITHOUT SYS_ADMIN and checks that
// failed recovery stays failed, with no PM2 restart or direct-browser fallback.
// --scoped-pm2-display-occupied uses a QA-owned foreign :98 after old-group stop;
// recovery must refuse without killing it, retrying or launching Brave.
// --orphan-handoff-failures checks only bounded canary failures/cleanup before
// any browser, policy, profile, display or PM2 setup in the disposable container.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  compareCutoverCloudBrowserRecoveryConfig,
  cutoverRegistrationConfigDigest,
} from '../browser-cutover-evidence.mjs';
import {
  firstCutoverCloudBrowserRecoveryLaunch,
  firstCutoverCloudVncRecoveryMaterial,
  prepareFirstCutoverCloudBrowserPolicy,
  readFirstCutoverCloudBrowserRecovery,
  readFirstCutoverCloudOwnedDisplay,
  readFirstCutoverCloudRecovery,
  readFirstCutoverCloudRecoveryCensus,
  readFirstCutoverCloudRecoveryContext,
  readFirstCutoverCloudRecoveryVacancy,
  restoreFirstCutoverCloudBrowser,
} from '../browser-first-cutover-runtime.mjs';
import { acquireReleaseJournal } from '../browser-maintenance-journal.mjs';
import {
  observeJointVnc,
  prepareJointVnc,
  readJointSources,
} from './browser-cloud-joint-recovery-linux.mjs';
await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 &&
      [
        '--app-blank',
        '--policy-probe',
        '--scoped-policy',
        '--scoped-pm2',
        '--scoped-pm2-vnc',
        '--scoped-pm2-denied',
        '--scoped-pm2-display-occupied',
        '--orphan-handoff-failures',
      ].includes(process.argv[2])),
);
if (process.argv[2] === '--orphan-handoff-failures') {
  for (const [fault, expected] of [
    ['exit-without-pid', /^Error: QA_ORPHAN_NO_PID$/],
    ['timeout-without-pid', /^Error: QA_ORPHAN_HANDOFF_TIMEOUT$/],
    ['timeout-after-pid', /^Error: QA_ORPHAN_HANDOFF_TIMEOUT$/],
  ]) {
    const entries = (await fs.readdir('/proc')).filter((p) => /^[0-9]+$/.test(p));
    const identities = await Promise.all(entries.map((p) => processIdentity(Number(p))));
    const before = new Set(identities.filter(Boolean).map((p) => `${p.pid}:${p.start}`));
    const started = performance.now();
    await assert.rejects(
      withOrphanCanary(() => assert.fail('failed handoff must not reach observation'), fault),
      expected,
    );
    assert.ok(performance.now() - started < 8000, 'startup plus cleanup is bounded');
    for (const entry of (await fs.readdir('/proc')).filter((p) => /^[0-9]+$/.test(p))) {
      const current = await processIdentity(Number(entry));
      assert.ok(
        !current || current.state === 'Z' || before.has(`${current.pid}:${current.start}`),
        'failed handoff leaves no new live parent or orphan in the isolated container',
      );
    }
    console.log(JSON.stringify({ marker: 'ORPHAN_HANDOFF_FAILURE_PASS', fault }));
  }
  process.exit(0);
}
const appBlank = process.argv[2] === '--app-blank';
const policyProbe = process.argv[2] === '--policy-probe';
const deniedRecovery = process.argv[2] === '--scoped-pm2-denied';
const occupiedDisplay = process.argv[2] === '--scoped-pm2-display-occupied';
const jointRecovery = process.argv[2] === '--scoped-pm2-vnc';
const scopedPm2 =
  process.argv[2] === '--scoped-pm2' || jointRecovery || deniedRecovery || occupiedDisplay;
const scopedPolicy = process.argv[2] === '--scoped-policy' || scopedPm2;
if (deniedRecovery) {
  const status = await fs.readFile('/proc/self/status', 'utf8');
  const bounded = /^CapBnd:\s+([0-9a-f]+)$/m.exec(status)?.[1];
  assert.ok(bounded);
  assert.equal(BigInt(`0x${bounded}`) & (1n << 21n), 0n, 'fault fixture lacks SYS_ADMIN');
}
const policyRoot = '/etc/brave/policies/managed';
let originalPolicy;
if (scopedPolicy) {
  // Fresh container ONLY: an unrelated existing policy must remain visible and
  // unchanged outside the recovered browser's future private mount namespace.
  await fs.mkdir(policyRoot, { recursive: true });
  assert.deepEqual(await fs.readdir(policyRoot), []);
  originalPolicy = JSON.stringify({ HomepageLocation: 'about:blank' });
  await fs.writeFile(`${policyRoot}/existing.json`, originalPolicy, { flag: 'wx' });
}
const exe = '/opt/brave.com/brave/brave';
const version = (await promisify(execFile)(exe, ['--version'])).stdout;
assert.match(version, /^Brave Browser 147\.1\.89\.141 /);
console.log(version.trim());
// These fixed product paths exist ONLY inside this fresh disposable container.
// Fail rather than reuse any pre-existing profile.
const profile = '/var/lib/holaday-headed-brave';
await fs.mkdir(profile, { mode: 0o700 });
const attempt = '12345678-1234-4234-8234-123456789abc';
await fs.mkdir(`${profile}/Default/Sessions`, { recursive: true });
await fs.writeFile(`${profile}/Default/Sessions/preserve-sentinel`, 'synthetic-preserve', {
  flag: 'wx',
});
let visits = 0;
const server = createServer((req, res) => {
  if (req.url === '/old-action') visits++;
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Set-Cookie': [
      'qa_login=synthetic; Max-Age=3600; Path=/; HttpOnly',
      'qa_session=synthetic; Path=/; HttpOnly',
    ],
  });
  res.end('<html><title>QA old action</title>synthetic page</html>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/old-action`;
await fs.writeFile(
  `${profile}/Default/Preferences`,
  JSON.stringify({ session: { restore_on_startup: 1 } }),
  { flag: 'wx' },
);
const displayArgs = (number) => [`:${number}`, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'];
// :97 is deliberately outside the approved old/replacement group. Priming's
// separate :98 exits before the old PM2 wrapper creates its OWN :98 child.
const xvfb = spawn('/usr/bin/Xvfb', displayArgs(scopedPolicy ? 97 : 98), {
  stdio: ['ignore', 'ignore', 'pipe'],
});
let primingDisplay;
const displayDiagnostics = new WeakMap();
function observeDisplayDiagnostics(child) {
  const diagnostic = { spawnedAtMs: Date.now(), stderr: '', stderrBytes: 0, spawnError: null };
  displayDiagnostics.set(child, diagnostic);
  child.stderr.on('data', (bytes) => {
    diagnostic.stderrBytes += bytes.length;
    diagnostic.stderr = (diagnostic.stderr + bytes.toString()).slice(-4096);
  });
  child.once('error', (error) => {
    diagnostic.spawnError = error.code ?? 'SPAWN_ERROR';
  });
}
observeDisplayDiagnostics(xvfb);
let independentDisplay;
let oldDisplay;
let recoveredDisplay;
let conflictDisplay;
let conflictDisplayProof;
let browser;
let socket;
let sequence = 0;
const pending = new Map();
let physicalStops = 0;
let recoveryVisits;
const retiredIdentities = [];
const qaCrashpadCleanup = new Map();
const pm2Home = jointRecovery
  ? '/root/.pm2'
  : scopedPm2
    ? await fs.mkdtemp('/tmp/holaday-browser-pm2-')
    : undefined;
if (jointRecovery) await fs.mkdir(pm2Home, { mode: 0o700 });
let jointVnc;
if (scopedPm2) {
  // An absent daemon must stay absent. The default product reader, with only
  // the disposable socket path selected, may not create a PM2 pid/socket/file.
  const empty = await fs.readdir(pm2Home);
  await assert.rejects(
    () =>
      readFirstCutoverCloudBrowserRecovery(
        { attempt, pmId: 0 },
        {
          rpcSocket: `${pm2Home}/rpc.sock`,
        },
      ),
    /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
  );
  assert.deepEqual(await fs.readdir(pm2Home), empty);
}
const pm2 = async (...argv) =>
  (
    await promisify(execFile)(
      '/opt/node22/bin/node',
      ['/opt/node22/lib/node_modules/pm2/bin/pm2', ...argv],
      {
        env: {
          ...(jointRecovery
            ? {
                PATH: '/usr/bin:/bin',
                HOME: '/root',
                NODE_OPTIONS: '--max-old-space-size=192',
                UV_THREADPOOL_SIZE: '1',
              }
            : process.env),
          PM2_HOME: pm2Home,
          ...(jointRecovery && argv.includes('holaday-vnc') ? {} : { DISPLAY: ':98' }),
        },
        maxBuffer: 8 * 1024 * 1024,
      },
    )
  ).stdout;
let managed;
let stoppedManager;
let restoreJournal;
let restoreStartedAtMs;
let beforeRecoveryCensus;
let restoreMaintenanceEndsAtMs;
let workerIntervalMs;
let unrelated;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function restoreSameRegistration(recovery) {
  assert.ok(stoppedManager);
  assert.equal(stoppedManager.pid, 0);
  const candidate = 'a'.repeat(40);
  const manifest = {
    replaysNumberedSql: true,
    runnerSha256: 'b'.repeat(64),
    migrations: [{ name: '0042_qa.sql', sha256: 'c'.repeat(64) }],
  };
  const directory = jointRecovery
    ? '/var/lib/holaday-deploy/maintenance'
    : await fs.mkdtemp('/tmp/holaday-cloud-restore-journal-');
  await fs.chmod(directory, 0o700);
  restoreJournal = await acquireReleaseJournal(directory, {
    kind: 'first-cutover',
    attempt,
    candidate,
    configDigest: 'd'.repeat(64),
    migrationDigest: sha(manifest),
    inventoryDigest: 'e'.repeat(64),
    legacyDigest: 'f'.repeat(64),
  });
  await restoreJournal.bindManifest(manifest);
  // VNC/backup/candidate facts are synthetic in THIS focused physical test.
  // No production assertion, database restore, VNC restoration or release gate.
  const scope = [
    {
      name: 'holaday-vnc',
      pmId: jointVnc?.stopped.pm_id ?? stoppedManager.pm_id + 100,
      scopeDigest: jointVnc ? sha(jointVnc.oldTree) : '1'.repeat(64),
      recoveryDigest: jointVnc
        ? sha(firstCutoverCloudVncRecoveryMaterial({ attempt }))
        : '2'.repeat(64),
    },
    {
      name: stoppedManager.name,
      pmId: stoppedManager.pm_id,
      scopeDigest: sha(retiredIdentities),
      recoveryDigest: sha(recovery),
    },
  ];
  await restoreJournal.bindExecutionSite('3'.repeat(64), scope);
  if (jointRecovery) {
    const policy = await prepareFirstCutoverCloudBrowserPolicy(
      { attempt, maintenanceEndsAtMs: Date.now() + 15000 },
      { journal: restoreJournal },
    );
    assert.equal(policy.attempt, attempt);
    assert.match(policy.originalDigest, /^[a-f0-9]{64}$/);
    assert.match(policy.privateDigest, /^[a-f0-9]{64}$/);
    console.log(
      JSON.stringify({
        marker: 'CLOUD_PRIVATE_POLICY_PREPARED',
        ownedJournal: true,
        productionPreflight: false,
      }),
    );
  }
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await restoreJournal.persist(phase, { candidate });
  const binding = await restoreJournal.assertOwnership();
  for (const s of scope)
    for (const phase of ['cloud-stop-intent', 'cloud-stopped'])
      await restoreJournal.recordCloudMaintenanceEvent({
        ...s,
        attempt,
        inventoryDigest: binding.inventoryDigest,
        host: 'vultr',
        phase,
      });
  for (const phase of ['all_fenced', 'stopped', 'backup_verified'])
    await restoreJournal.persist(phase, { candidate });
  await restoreJournal.bindBackupReceipt({
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
  await restoreJournal.persist('migration_started', { candidate });
  await restoreJournal.bindBootstrapSeed('5'.repeat(32));
  const identity = { candidate, bootId: '6'.repeat(32) };
  for (const phase of ['candidate_started', 'verified'])
    await restoreJournal.persist(phase, { candidate, identity });
  const input = {
    attempt,
    pmId: stoppedManager.pm_id,
    stoppedConfigDigest: cutoverRegistrationConfigDigest(stoppedManager.pm2_env),
    maintenanceEndsAtMs: Date.now() + (jointRecovery ? 240000 : 60000),
  };
  const io = {
    journal: restoreJournal,
    rpcSocket: `${pm2Home}/rpc.sock`,
    assertRecoveryScope: async (actual) => {
      assert.deepEqual(actual, input);
      assert.ok((await Promise.all(retiredIdentities.map(sameLive))).every((v) => !v));
      assert.equal(await sameLive(unrelated), true);
      await assertIndependentDisplay();
      assert.ok(oldDisplay && !(await sameLive(oldDisplay.identity)), 'old owned display exited');
      if (occupiedDisplay)
        assert.deepEqual(
          await displayProof(98, conflictDisplayProof.identity),
          conflictDisplayProof,
        );
      assert.equal(await fs.readFile(`${policyRoot}/existing.json`, 'utf8'), originalPolicy);
      assert.deepEqual(
        JSON.parse(
          await fs.readFile(
            `/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy/recovery.json`,
            'utf8',
          ),
        ),
        { RestoreOnStartup: 5 },
      );
    },
  };
  restoreMaintenanceEndsAtMs = input.maintenanceEndsAtMs;
  if (jointRecovery) {
    let sources = await readJointSources(attempt);
    const context = await readFirstCutoverCloudRecoveryContext({ sources });
    // Occupancy refusal uses an actual disposable listener, before either
    // recovery intent. Closing this canary never touches an old service.
    const busy = createTcpServer();
    await new Promise((resolve, reject) => {
      busy.once('error', reject);
      busy.listen(9223, '127.0.0.1', resolve);
    });
    try {
      await assert.rejects(
        readFirstCutoverCloudRecoveryVacancy({
          sources,
          maintenanceEndsAtMs: input.maintenanceEndsAtMs,
        }),
        /CUTOVER_CLOUD_VACANCY_UNPROVEN/,
      );
    } finally {
      await new Promise((resolve, reject) =>
        busy.close((error) => (error ? reject(error) : resolve())),
      );
    }
    // The old QA CDP connection can leave a kernel TIME_WAIT row after the
    // process is gone. Keep the product refusal; wait only for that known
    // passive state inside this disposable fixture, before any restore intent.
    const vacancyWaitBegan = Date.now();
    const vacancyWaitUntil = Math.min(vacancyWaitBegan + 75000, input.maintenanceEndsAtMs - 120000);
    let observedTimeWait = false;
    for (;;) {
      const retained = [];
      for (const table of ['tcp', 'tcp6']) {
        const raw = await fs.readFile(`/proc/self/net/${table}`, 'utf8');
        assert.ok(Buffer.byteLength(raw) <= 1048576);
        for (const line of raw.trim().split('\n').slice(1)) {
          const row = line.trim().split(/\s+/);
          const port = Number.parseInt(row[1].split(':').at(-1), 16);
          if ([5901, 6080, 9223].includes(port))
            retained.push({ port, state: row[3], inode: row[9] });
        }
      }
      if (!retained.length) break;
      assert.ok(
        retained.every((row) => row.state === '06' && row.inode === '0'),
        'only kernel TIME_WAIT may be awaited',
      );
      observedTimeWait = true;
      assert.ok(
        Date.now() < vacancyWaitUntil,
        'fixed passive expiry budget; never extend the original window',
      );
      await sleep(500);
    }
    sources = await readJointSources(attempt);
    console.log(
      JSON.stringify({
        marker: 'QA_KERNEL_TIMEWAIT_EXPIRED',
        observedTimeWait,
        elapsedMs: Date.now() - vacancyWaitBegan,
        productionWaitOrPermission: false,
      }),
    );
    const vacancy = await readFirstCutoverCloudRecoveryVacancy({
      sources,
      maintenanceEndsAtMs: input.maintenanceEndsAtMs,
    });
    assert.equal(vacancy.contextDigest, context.daemon.contextDigest);
    assert.equal(vacancy.sourcesDigest, context.sourcesDigest);
    console.log(
      JSON.stringify({
        marker: 'CLOUD_NATIVE_RECOVERY_VACANCY_OBSERVED',
        actualOccupiedTcpRefused: true,
        beforeRecoveryIntent: true,
        productionPreflight: false,
      }),
    );
    assert.equal(context.hostname, sources.hostname);
    assert.equal(context.bootId, sources.bootId);
    assert.equal((await restoreJournal.readFirstCutoverEffects()).cloudMaintenanceEvents.length, 4);
    console.log(
      JSON.stringify({
        marker: 'CLOUD_NATIVE_RECOVERY_CONTEXT_OBSERVED',
        securityLabel: context.daemon.securityLabel,
        beforeRecoveryIntent: true,
        productionPreflight: false,
      }),
    );
  }
  if (!deniedRecovery) {
    // Capture AFTER the original lifetime was proved stopped, before the one
    // product dispatch. Never seed this baseline from the recovered process set.
    beforeRecoveryCensus = await readFirstCutoverCloudRecoveryCensus();
    assert.ok(
      beforeRecoveryCensus.processes.every(
        (p) => !retiredIdentities.some((old) => old.pid === p.pid),
      ),
      'old tree absent from the unfiltered pre-dispatch census',
    );
  }
  restoreStartedAtMs = Date.now();
  await restoreFirstCutoverCloudBrowser(input, io);
  assert.equal((await restoreJournal.readFirstCutoverEffects()).cloudMaintenanceEvents.length, 5);
  await assert.rejects(restoreFirstCutoverCloudBrowser(input, io), /UNPROVEN/);
  await assert.rejects(restoreJournal.persist('opened', { candidate, identity }), /UNPROVEN/);
}
async function processIdentity(pid) {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    return { pid, ppid: Number(fields[1]), state: fields[0], start: fields[19] };
  } catch (error) {
    // procfs may open successfully, then return ESRCH after this exact process exits.
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}
async function sameLive(identity) {
  const current = await processIdentity(identity.pid);
  return current?.start === identity.start && current.state !== 'Z';
}
async function displayProof(number, expected) {
  const identity = await processIdentity(expected.pid);
  assert.ok(identity && identity.start === expected.start && identity.state !== 'Z');
  const path = `/proc/${identity.pid}`;
  assert.equal(await fs.readlink(`${path}/exe`), '/usr/bin/Xvfb');
  assert.equal(
    await fs.readFile(`${path}/cmdline`, 'utf8'),
    ['/usr/bin/Xvfb', ...displayArgs(number), ''].join('\0'),
  );
  const mountNamespace = await fs.readlink(`${path}/ns/mnt`);
  const fdNames = await fs.readdir(`${path}/fd`);
  assert.ok(fdNames.length <= 256);
  const inodes = new Set();
  for (const fd of fdNames) {
    const link = await fs.readlink(`${path}/fd/${fd}`);
    const match = /^socket:\[(\d+)\]$/.exec(link);
    if (match) inodes.add(match[1]);
  }
  const unix = await fs.readFile('/proc/net/unix', 'utf8');
  assert.ok(Buffer.byteLength(unix) <= 1024 * 1024);
  const addresses = [`/tmp/.X11-unix/X${number}`, `@/tmp/.X11-unix/X${number}`];
  const listeners = unix
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => addresses.includes(fields[7]) && fields[3] === '00010000')
    .map((fields) => ({ address: fields[7], inode: fields[6] }))
    .sort((a, b) => a.address.localeCompare(b.address));
  assert.equal(listeners.length, 2, 'both real filesystem/abstract X11 listeners');
  assert.deepEqual(listeners.map((s) => s.address).sort(), [...addresses].sort());
  for (const listener of listeners)
    assert.ok(inodes.has(listener.inode), 'listener inode belongs to this exact Xvfb');
  const after = await processIdentity(identity.pid);
  assert.equal(after?.start, identity.start);
  assert.equal(after?.ppid, identity.ppid);
  assert.notEqual(after?.state, 'Z');
  return {
    identity: { pid: identity.pid, start: identity.start, ppid: identity.ppid },
    mountNamespace,
    listeners,
  };
}
async function waitDisplay(number, child) {
  const startedAtMs = Date.now();
  const started = performance.now();
  let identity;
  let lastUnix = '';
  let polls = 0;
  try {
    identity = await processIdentity(child.pid);
    assert.ok(identity);
    await until(async () => {
      polls++;
      assert.equal(await sameLive(identity), true, 'display cannot exit during readiness');
      const raw = await fs.readFile('/proc/net/unix', 'utf8');
      lastUnix = raw.slice(0, 1024 * 1024);
      return [`/tmp/.X11-unix/X${number}`, `@/tmp/.X11-unix/X${number}`].every((address) =>
        raw.split('\n').some((line) => {
          const fields = line.trim().split(/\s+/);
          return fields[7] === address && fields[3] === '00010000';
        }),
      );
    }, 5000);
    return await displayProof(number, identity);
  } catch (error) {
    // Failure-only public QA metadata. Diagnostic errors cannot turn the
    // original readiness failure into success or a retry.
    const snapshot = await Promise.race([
      Promise.allSettled([
        processIdentity(child.pid),
        fs.readlink(`/proc/${child.pid}/exe`),
        fs.readlink(`/proc/${child.pid}/ns/mnt`),
      ]).then((items) =>
        items.map((item) =>
          item.status === 'fulfilled'
            ? { value: typeof item.value === 'string' ? item.value.slice(0, 512) : item.value }
            : { error: item.reason?.code ?? 'DIAGNOSTIC_READ_FAILED' },
        ),
      ),
      sleep(1000).then(() => ({ error: 'DIAGNOSTIC_TIMEOUT' })),
    ]);
    const rows = lastUnix
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) =>
        [
          '/tmp/.X11-unix/X97',
          '@/tmp/.X11-unix/X97',
          '/tmp/.X11-unix/X98',
          '@/tmp/.X11-unix/X98',
        ].includes(fields[7]),
      );
    console.error(
      JSON.stringify({
        marker: 'QA_DISPLAY_READINESS_FAILURE',
        display: number,
        pid: child.pid ?? null,
        startedAtMs,
        elapsedMs: performance.now() - started,
        polls,
        expectedIdentity: identity ?? null,
        snapshot,
        snapshotOrder: ['identity', 'executable', 'mountNamespace'],
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        failure: String(error.message).slice(0, 200),
        ...displayDiagnostics.get(child),
        unixSampleBytes: Buffer.byteLength(lastUnix),
        relevantRowCount: rows.length,
        relevantRows: rows.slice(0, 32).map((fields) => ({
          flags: fields[3],
          type: fields[4],
          state: fields[5],
          inode: fields[6],
          path: fields[7],
        })),
      }),
    );
    throw error;
  }
}
async function assertIndependentDisplay() {
  assert.equal(xvfb.exitCode, null);
  assert.deepEqual(
    await displayProof(scopedPolicy ? 97 : 98, independentDisplay.identity),
    independentDisplay,
    'independent display retains identity, namespace and both listening sockets',
  );
}
async function retirePrimingDisplay() {
  if (!primingDisplay) return;
  const identity = await processIdentity(primingDisplay.pid);
  assert.ok(identity);
  primingDisplay.kill('SIGTERM');
  await until(async () => !(await sameLive(identity)), 3000);
  primingDisplay = undefined;
}
async function withOrphanCanary(inspect, fault) {
  const source =
    fault === 'exit-without-pid'
      ? ''
      : fault === 'timeout-without-pid'
        ? 'setInterval(()=>{},1000);'
        : `const {spawn}=require("node:child_process");const c=spawn("/usr/bin/sleep",["600"],{detached:true,stdio:"ignore"});console.log(c.pid);c.unref();${fault === 'timeout-after-pid' ? 'setInterval(()=>{},1000);' : ''}`;
  const parent = spawn('/opt/node22/bin/node', ['-e', source], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let closed = false;
  let capture;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      timer = setTimeout(() => reject(Error('QA_ORPHAN_HANDOFF_TIMEOUT')), 3000);
      parent.on('error', reject);
      parent.stdout.on('error', reject);
      parent.stdout.on('data', (bytes) => {
        output += bytes.toString();
        if (output.length > 32 || !/^[0-9]*\n?$/.test(output)) {
          reject(Error('QA_ORPHAN_INVALID_PID'));
        } else if (!capture && output.endsWith('\n')) {
          const pid = Number(output.trim());
          if (!Number.isSafeInteger(pid) || pid <= 1) {
            reject(Error('QA_ORPHAN_INVALID_PID'));
            return;
          }
          // Start retaining PID/start immediately, even if this parent never exits.
          capture = processIdentity(pid);
          capture.catch(reject);
        }
      });
      parent.stdout.once('end', () => {
        if (!capture) reject(Error('QA_ORPHAN_NO_PID'));
      });
      parent.once('close', (code, signal) => {
        closed = true;
        if (code !== 0 || signal) reject(Error('QA_ORPHAN_PARENT_FAILED'));
        else if (!capture) reject(Error('QA_ORPHAN_NO_PID'));
        else capture.then(resolve, reject);
      });
    });
    clearTimeout(timer);
    const orphan = await capture;
    assert.ok(orphan && (await sameLive(orphan)), 'created canary identity retained');
    const current = await processIdentity(orphan.pid);
    assert.equal(current?.start, orphan.start);
    assert.equal(current.ppid, 1, 'canary actually detached to PID1');
    await inspect(current);
  } finally {
    clearTimeout(timer);
    try {
      // This exact ChildProcess is ours, never a discovered/current-PID allowlist.
      if (!closed) parent.kill('SIGKILL');
      await until(() => closed, 2000);
    } finally {
      const orphan = await capture?.catch(() => null);
      if (orphan && (await sameLive(orphan))) process.kill(orphan.pid, 'SIGKILL');
      if (orphan) await until(async () => !(await sameLive(orphan)), 2000);
      parent.stdout.destroy();
    }
  }
}
async function ownedProcesses(root) {
  const observed = [];
  const selected = new Set([root.pid]);
  const executables = new Map();
  const entries = (await fs.readdir('/proc')).filter((n) => /^[0-9]+$/.test(n));
  assert.ok(entries.length <= 4096, 'QA IPC process count bound');
  for (const name of entries) {
    const pid = Number(name);
    let executable;
    try {
      executable = await fs.readlink(`/proc/${pid}/exe`);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
      throw error;
    }
    const identity = await processIdentity(pid);
    if (!identity || identity.state === 'Z') continue;
    observed.push(identity);
    executables.set(pid, executable);
  }
  assert.equal(observed.find((p) => p.pid === root.pid)?.start, root.start);
  // Actual root ancestry, NOT profile argv or a crashpad executable allowlist.
  let changed;
  do {
    changed = false;
    for (const p of observed) {
      if (selected.has(p.ppid) && !selected.has(p.pid)) {
        selected.add(p.pid);
        changed = true;
      }
    }
  } while (changed);
  const rootDescendants = new Set(selected);
  const brave = new Set(
    observed.filter((p) => selected.has(p.pid) && executables.get(p.pid) === exe).map((p) => p.pid),
  );
  if (brave.size) {
    // Executable only selects candidates to inspect. Admission requires the
    // actual initial-client fd -> reciprocal socket -> owned Brave/primary IPC.
    // This private fixture observation is not native product preflight/effects.
    const candidates = observed.filter(
      (p) => executables.get(p.pid) === '/opt/brave.com/brave/chrome_crashpad_handler',
    );
    assert.ok(candidates.length <= 16, 'QA IPC handler count bound');
    const began = performance.now();
    const readSockets = async () => {
      const { stdout } = await promisify(execFile)('/usr/bin/ss', ['-H', '-xap'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      const lines = stdout.split('\n').filter(Boolean);
      assert.ok(lines.length <= 16384, 'QA IPC socket count bound');
      return lines.map((line) => {
        const fields = line.trim().split(/\s+/);
        assert.ok(fields.length >= 8);
        return {
          state: fields[1],
          inode: fields[5],
          peerInode: fields[7],
          owners: [...new Set([...line.matchAll(/\bpid=(\d+)/g)].map((m) => Number(m[1])))].sort(
            (a, b) => a - b,
          ),
        };
      });
    };
    const fdSockets = async (pid) => {
      const names = await fs.readdir(`/proc/${pid}/fd`);
      assert.ok(names.length <= 256, 'QA IPC fd count bound');
      const sockets = [];
      for (const fd of names) {
        const match = /^socket:\[(\d+)\]$/.exec(await fs.readlink(`/proc/${pid}/fd/${fd}`));
        if (match) sockets.push({ fd: Number(fd), inode: match[1] });
      }
      return sockets.sort((a, b) => a.fd - b.fd);
    };
    const first = await readSockets();
    const relevantInodes = new Set();
    const edge = (inode, pid, localGroup) => {
      const local = first.filter((r) => r.inode === inode && r.state === 'ESTAB');
      assert.equal(local.length, 1, 'QA IPC unique connected local inode');
      if (localGroup) {
        // Non-initial inherited sockets may be shared by proved Brave members.
        // Initial-client admission below remains exact single-handler ownership.
        assert.ok(local[0].owners.includes(pid), 'QA IPC local fd includes exact handler');
        assert.ok(
          local[0].owners.every((owner) => localGroup.has(owner)),
          'QA IPC mixed/foreign local owners refused',
        );
      } else assert.deepEqual(local[0].owners, [pid], 'QA IPC initial fd owned by exact handler');
      const peer = first.filter(
        (r) => r.inode === local[0].peerInode && r.peerInode === inode && r.state === 'ESTAB',
      );
      assert.equal(peer.length, 1, 'QA IPC unique reciprocal endpoint');
      assert.ok(peer[0].owners.length > 0, 'QA IPC peer has real owners');
      return peer[0];
    };
    const inspected = [];
    for (const p of candidates) {
      const cmd = await fs.readFile(`/proc/${p.pid}/cmdline`, 'utf8');
      assert.ok(Buffer.byteLength(cmd) <= 262144, 'QA IPC argv bound');
      const flags = cmd.split('\0').filter((arg) => arg.startsWith('--initial-client-fd='));
      assert.equal(flags.length, 1, 'QA IPC exact initial fd flag');
      assert.match(flags[0], /^--initial-client-fd=\d{1,6}$/);
      const initialFd = Number(flags[0].split('=')[1]);
      const sockets = await fdSockets(p.pid);
      const initial = sockets.find((s) => s.fd === initialFd);
      assert.ok(initial, 'QA IPC initial fd is an actual socket');
      inspected.push({
        identity: p,
        initialFd,
        sockets,
        argvDigest: sha(cmd),
        peer: edge(initial.inode, p.pid),
      });
      // Ancestry alone may not bypass peer verification even for a non-orphan.
      selected.delete(p.pid);
    }
    const primary = new Set();
    for (const c of inspected) {
      if (!c.peer.owners.some((pid) => brave.has(pid))) continue;
      assert.ok(
        c.peer.owners.every((pid) => brave.has(pid)),
        'QA IPC mixed/foreign primary peers refused',
      );
      primary.add(c.identity.pid);
    }
    assert.ok(primary.size > 0, 'QA IPC primary must connect to actual Brave descendants');
    const associated = inspected.filter((c) => {
      if (primary.has(c.identity.pid)) return true;
      if (!c.peer.owners.some((pid) => primary.has(pid))) return false;
      assert.equal(c.peer.owners.length, 1, 'QA IPC monitor has one exact primary peer');
      const parent = inspected.find((p) => p.identity.pid === c.peer.owners[0]);
      assert.ok(
        parent.sockets.some((s) => s.fd !== parent.initialFd && s.inode === c.peer.inode),
        'QA IPC secondary initial connects to primary non-initial fd',
      );
      return true;
    });
    for (const c of inspected)
      assert.ok(
        !rootDescendants.has(c.identity.pid) || associated.includes(c),
        'QA IPC must not drop an unproved handler from the actual root tree',
      );
    for (const c of associated) selected.add(c.identity.pid);
    const peerGroup = new Set([...brave, ...associated.map((c) => c.identity.pid)]);
    const stdioGroup = new Set([...rootDescendants, ...associated.map((c) => c.identity.pid)]);
    const rootStdio = new Map();
    let stdioDaemon;
    if (scopedPm2) {
      for (const fd of [0, 1, 2])
        rootStdio.set(fd, await fs.readlink(`/proc/${root.pid}/fd/${fd}`));
    }
    for (const c of associated) {
      for (const socket of c.sockets) {
        // Only exact inherited stdin/stdout/stderr may terminate at our private PM2
        // daemon. It is evidence, never an admitted member or signal target.
        if (
          socket.fd !== c.initialFd &&
          [0, 1, 2].includes(socket.fd) &&
          rootStdio.get(socket.fd) === `socket:[${socket.inode}]`
        ) {
          if (!stdioDaemon) {
            const daemonPid = (await fs.readFile(`${pm2Home}/pm2.pid`, 'utf8')).trim();
            assert.match(daemonPid, /^[1-9]\d*$/);
            assert.equal(Number(daemonPid), root.ppid, 'QA stdio peer is private PM2 parent');
            stdioDaemon = observed.find((p) => p.pid === root.ppid);
            assert.ok(stdioDaemon && !selected.has(stdioDaemon.pid));
            assert.equal(executables.get(stdioDaemon.pid), '/opt/node22/bin/node');
          }
          const peer = edge(socket.inode, c.identity.pid, stdioGroup);
          assert.deepEqual(peer.owners, [stdioDaemon.pid], 'QA stdio only private PM2 peer');
          relevantInodes.add(socket.inode);
          relevantInodes.add(peer.inode);
          continue;
        }
        const local = first.find((r) => r.inode === socket.inode && r.state === 'ESTAB');
        if (local?.owners.some((pid) => !peerGroup.has(pid)))
          console.error(
            JSON.stringify({
              marker: 'QA_IPC_OUTSIDE_LOCAL_OWNER',
              handler: c.identity.pid,
              fd: socket.fd,
              initialFd: c.initialFd,
              inode: socket.inode,
              owners: local.owners.map((pid) => ({
                ...observed.find((p) => p.pid === pid),
                pid,
                exe: executables.get(pid),
                rootDescendant: rootDescendants.has(pid),
                associated: peerGroup.has(pid),
              })),
              root,
              rootStdio: await Promise.all(
                [0, 1, 2].map(async (fd) => ({
                  fd,
                  link: await fs.readlink(`/proc/${root.pid}/fd/${fd}`),
                })),
              ),
              peer: first
                .filter((r) => r.inode === local.peerInode && r.peerInode === local.inode)
                .map((r) => ({
                  ...r,
                  ownerIdentities: r.owners.map((pid) => ({
                    ...observed.find((p) => p.pid === pid),
                    pid,
                    exe: executables.get(pid),
                    isRootParent: pid === root.ppid,
                  })),
                })),
            }),
          );
        const peer = edge(socket.inode, c.identity.pid, peerGroup);
        if (peer.owners.some((pid) => !peerGroup.has(pid)))
          console.error(
            JSON.stringify({
              marker: 'QA_IPC_OUTSIDE_PEER_OWNER',
              handler: c.identity,
              fd: socket.fd,
              initialFd: c.initialFd,
              inode: socket.inode,
              root,
              rootStdio: await Promise.all(
                [0, 1, 2].map(async (fd) => ({
                  fd,
                  link: await fs.readlink(`/proc/${root.pid}/fd/${fd}`),
                })),
              ),
              peer: {
                ...peer,
                ownerIdentities: peer.owners.map((pid) => ({
                  ...observed.find((p) => p.pid === pid),
                  pid,
                  exe: executables.get(pid),
                  isRootParent: pid === root.ppid,
                })),
              },
            }),
          );
        assert.ok(
          peer.owners.every((pid) => peerGroup.has(pid)),
          'QA IPC all matching owners within independently associated group',
        );
        relevantInodes.add(socket.inode);
        relevantInodes.add(peer.inode);
      }
      assert.deepEqual(await fdSockets(c.identity.pid), c.sockets, 'QA IPC fd identities stable');
      assert.equal(sha(await fs.readFile(`/proc/${c.identity.pid}/cmdline`, 'utf8')), c.argvDigest);
    }
    const project = (rows) =>
      rows
        .filter((r) => relevantInodes.has(r.inode) || relevantInodes.has(r.peerInode))
        .sort((a, b) => a.inode.localeCompare(b.inode));
    assert.deepEqual(
      project(await readSockets()),
      project(first),
      'QA IPC reciprocal graph stable',
    );
    if (stdioDaemon) {
      for (const [fd, link] of rootStdio)
        assert.equal(await fs.readlink(`/proc/${root.pid}/fd/${fd}`), link, 'QA root stdio stable');
      assert.equal(
        (await fs.readFile(`${pm2Home}/pm2.pid`, 'utf8')).trim(),
        String(stdioDaemon.pid),
      );
      const after = await processIdentity(stdioDaemon.pid);
      assert.ok(after && after.state !== 'Z');
      assert.equal(after.start, stdioDaemon.start, 'QA private PM2 PID/start stable');
      assert.equal(after.ppid, stdioDaemon.ppid);
      assert.equal(
        await fs.readlink(`/proc/${stdioDaemon.pid}/exe`),
        executables.get(stdioDaemon.pid),
      );
    }
    assert.ok(performance.now() - began < 15000, 'QA IPC observation deadline');
    console.log(
      JSON.stringify({
        marker: 'QA_CRASHPAD_IPC_CAPTURE',
        primaryCount: primary.size,
        associatedCount: associated.length,
        unrelatedCandidateCount: inspected.length - associated.length,
      }),
    );
  }
  for (const p of observed.filter((p) => selected.has(p.pid))) {
    const after = await processIdentity(p.pid);
    assert.equal(after?.start, p.start, 'QA capture PID/start unchanged before stop');
    assert.equal(after?.ppid, p.ppid, 'QA capture ancestry unchanged before stop');
    assert.ok(after && after.state !== 'Z');
    assert.equal(await fs.readlink(`/proc/${p.pid}/exe`), executables.get(p.pid));
  }
  return observed.filter((p) => selected.has(p.pid));
}
const args = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-extensions',
  '--password-store=basic',
  '--hide-crash-restore-bubble',
  '--disable-session-crashed-bubble',
  ...(scopedPolicy ? [] : ['--disable-features=BraveCleanupSessionCookiesOnSessionRestore']),
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=9223',
  `--user-data-dir=${profile}`,
];
async function until(predicate, ms = 15000) {
  const limit = Date.now() + ms;
  do {
    if (await predicate()) return;
    await sleep(80);
  } while (Date.now() < limit);
  throw Error('QA_CONDITION_TIMEOUT');
}
async function launch(extra, privatePolicy, usePm2 = false) {
  // Execute the exact material from the packaged runtime, not a parallel QA
  // shell recipe. The fixture alone provisions synthetic policy/profile files.
  const recovery = privatePolicy ? firstCutoverCloudBrowserRecoveryLaunch({ attempt }) : null;
  if (recovery) {
    assert.equal(recovery.autorestart, false);
    assert.deepEqual(recovery.env, { DISPLAY: ':98' });
    assert.ok(recovery.args.includes(privatePolicy));
  }
  const command = recovery?.command ?? exe;
  const argv = recovery?.args ?? [...args, ...extra];
  if (usePm2) {
    if (recovery) await restoreSameRegistration(recovery);
    else {
      // Synthetic OLD wrapper only; never execute the production wrapper.
      // It retains both Xvfb and Brave as actual children of the PM2 root.
      const wrapper = `${pm2Home}/old-headed.sh`;
      await fs.writeFile(
        wrapper,
        '#!/bin/sh\nset -eu\n/usr/bin/Xvfb :98 -screen 0 1280x800x24 -nolisten tcp &\ndisplay=$!\ni=0\nwhile [ ! -S /tmp/.X11-unix/X98 ]; do kill -0 "$display"; i=$((i+1)); [ "$i" -lt 50 ]; sleep 0.1; done\n/opt/brave.com/brave/brave "$@" &\nwait\n',
        { flag: 'wx', mode: 0o700 },
      );
      await pm2(
        'start',
        '/bin/sh',
        '--name',
        'holaday-chromium-headed',
        '--interpreter',
        'none',
        '--kill-timeout',
        '1600',
        ...(recovery?.autorestart === false ? ['--no-autorestart'] : []),
        '--',
        wrapper,
        ...argv,
      );
    }
    const matches = JSON.parse(await pm2('jlist')).filter(
      (r) => r.name === 'holaday-chromium-headed',
    );
    assert.equal(matches.length, 1);
    if (jointRecovery && matches[0].pm2_env.status !== 'online') {
      const c = matches[0].pm2_env;
      // This entire fixture owns only synthetic data in a disposable container.
      // Capture bounded launch failures before --rm removes their evidence.
      const log = await fs.readFile(c.pm_err_log_path, 'utf8').catch(() => 'unavailable');
      const memory = await fs
        .readFile('/sys/fs/cgroup/memory.events', 'utf8')
        .catch(() => 'unavailable');
      console.error(
        JSON.stringify({
          marker: 'QA_JOINT_HEADED_LAUNCH_FAILED',
          status: c.status,
          exitCode: c.exit_code,
          errorTail: log.slice(-4096),
          memoryEvents: memory,
        }),
      );
    }
    assert.equal(matches[0].pm2_env.status, 'online');
    assert.equal(matches[0].pm2_env.autorestart, !privatePolicy);
    if (recovery) {
      assert.equal(matches[0].pm_id, stoppedManager.pm_id, 'same preserved numeric registration');
      assert.equal(matches[0].pm2_env.restart_time, stoppedManager.pm2_env.restart_time);
      assert.equal(matches[0].pm2_env.pm_cwd, stoppedManager.pm2_env.pm_cwd);
    }
    managed = { pmId: matches[0].pm_id, identity: await processIdentity(matches[0].pid) };
    assert.ok(managed.identity);
    browser = { pid: managed.identity.pid, exitCode: null };
  } else {
    browser = spawn(command, argv, {
      env: { ...process.env, DISPLAY: ':98', ...recovery?.env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  }
  let errors = '';
  browser.stderr?.on('data', (b) => {
    errors = (errors + b.toString()).slice(-8192);
  });
  let endpoint;
  await until(async () => {
    if (browser.exitCode !== null) throw Error(`QA_BROWSER_EXIT_${browser.exitCode}: ${errors}`);
    let v;
    try {
      const r = await fetch('http://127.0.0.1:9223/json/version', {
        signal: AbortSignal.timeout(500),
      });
      v = await r.json();
    } catch {
      return false;
    }
    assert.match(v.Browser, /147\.0\.7727\.102/);
    endpoint = v.webSocketDebuggerUrl;
    return Boolean(endpoint);
  });
  socket = new WebSocket(endpoint);
  await once(socket, 'open');
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(Error(`QA_CDP_${m.error.code}`)) : p.resolve(m.result);
      }
    }
  });
  if (usePm2 && !recovery) {
    const tree = await ownedProcesses(managed.identity);
    const displays = [];
    for (const p of tree)
      if ((await fs.readlink(`/proc/${p.pid}/exe`)) === '/usr/bin/Xvfb') displays.push(p);
    assert.equal(displays.length, 1, 'old PM2 registration really owns its display');
    oldDisplay = await displayProof(98, displays[0]);
    assert.equal(oldDisplay.identity.ppid, managed.identity.pid);
    assert.notEqual(oldDisplay.identity.pid, xvfb.pid, 'not the independent display');
    await assertIndependentDisplay();
  }
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('QA_CDP_TIMEOUT'));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function close() {
  if (managed) {
    if (jointVnc?.stop) {
      const observeOwnedDisplay = async () => {
        const sources = await readJointSources(attempt);
        const proof = await readFirstCutoverCloudOwnedDisplay({
          sources,
          maintenanceEndsAtMs: Date.now() + 15000,
        });
        assert.equal(proof.display.pid, oldDisplay.identity.pid);
        assert.equal(proof.display.ppid, managed.identity.pid);
        assert.ok(proof.members.some((p) => p.pid === oldDisplay.identity.pid));
        console.log(
          JSON.stringify({
            marker: 'CLOUD_OLD_DISPLAY_NATIVE_OWNERSHIP_OBSERVED',
            vncStatus: proof.roots[0].status,
            scopedClientCount: proof.clients.length,
            displayMemberCount: proof.members.length,
            productionStopPermission: false,
          }),
        );
      };
      jointVnc = await jointVnc.stop(observeOwnedDisplay);
      await observeOwnedDisplay();
    }
    // Observe descendants plus real IPC-associated handlers, retaining every
    // PID/start before stop. No profile-argv association or signal-based help.
    const observed = await ownedProcesses(managed.identity);
    assert.ok(observed.length > 1, 'real browser children were observed');
    const ownedDisplay = recoveredDisplay ?? oldDisplay;
    assert.ok(ownedDisplay);
    assert.ok(
      observed.some(
        (p) => p.pid === ownedDisplay.identity.pid && p.start === ownedDisplay.identity.start,
      ),
    );
    const crashpads = [];
    for (const p of observed)
      if (
        (await fs.readlink(`/proc/${p.pid}/exe`)) === '/opt/brave.com/brave/chrome_crashpad_handler'
      )
        crashpads.push(p);
    assert.ok(
      crashpads.length > 0,
      'actual captured crashpad members are covered by old-group exit',
    );
    for (const handler of crashpads)
      qaCrashpadCleanup.set(`${handler.pid}:${handler.start}`, handler);
    assert.equal(await sameLive(managed.identity), true);
    await pm2('stop', String(managed.pmId)); // Exactly one numeric stop, no retry.
    // Observe PM2's actual result without helping it pass. Surviving captured
    // handlers fail this bounded stop; only finally may clean isolated QA PIDs.
    await until(
      async () => (await Promise.all(observed.map(sameLive))).every((live) => !live),
      15000,
    );
    assert.equal(await sameLive(ownedDisplay.identity), false, 'old owned display cannot survive');
    const rows = JSON.parse(await pm2('jlist'));
    const stopped = rows.find((r) => r.pm_id === managed.pmId);
    assert.equal(stopped.pm2_env.status, 'stopped');
    assert.equal(stopped.pid, 0);
    assert.equal(await sameLive(unrelated), true);
    await assertIndependentDisplay();
    retiredIdentities.push(...observed);
    physicalStops++;
    console.log(
      JSON.stringify({
        physicalPm2Stop: physicalStops,
        observedProcesses: observed.length,
        oldProcessesLive: false,
        ownedDisplayExited: true,
        capturedCrashpadsExited: crashpads.length,
        unrelatedAndDisplayPreserved: true,
      }),
    );
    stoppedManager = structuredClone(stopped);
    browser.exitCode = 0;
  } else {
    const done = once(browser, 'exit');
    await cdp('Browser.close');
    await done;
  }
  socket.close();
  await until(async () => {
    try {
      await fetch('http://127.0.0.1:9223/json/version', { signal: AbortSignal.timeout(200) });
      return false;
    } catch {
      return true;
    }
  });
}
try {
  independentDisplay = await waitDisplay(scopedPolicy ? 97 : 98, xvfb);
  if (scopedPolicy) {
    // Concurrent X servers can race the initial /tmp/.X11-unix mkdir, leaving
    // only an abstract listener. Prove :97 ready before starting priming :98.
    primingDisplay = spawn('/usr/bin/Xvfb', displayArgs(98), {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    observeDisplayDiagnostics(primingDisplay);
    await waitDisplay(98, primingDisplay);
  }
  if (scopedPm2) {
    // A real descendant without the profile argument must still be observed.
    // This private canary exits before the actual PM2/browser experiment starts.
    const control = spawn(
      '/opt/node22/bin/node',
      [
        '-e',
        'const {spawn}=require("node:child_process");const c=spawn("/usr/bin/sleep",["600"]);console.log(c.pid);process.on("SIGTERM",()=>c.kill("SIGTERM"));c.on("exit",()=>process.exit(0));',
        profile,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      const [bytes] = await once(control.stdout, 'data');
      const childPid = Number(bytes.toString().trim());
      assert.ok(Number.isSafeInteger(childPid) && childPid > 1);
      const root = await processIdentity(control.pid);
      assert.ok(
        (await ownedProcesses(root)).some((p) => p.pid === childPid),
        'include untagged descendant',
      );
    } finally {
      const done = once(control, 'exit');
      control.kill('SIGTERM');
      await done;
    }
    assert.equal(
      JSON.parse(await fs.readFile('/opt/node22/lib/node_modules/pm2/package.json', 'utf8'))
        .version,
      '6.0.14',
    );
    if (!deniedRecovery) {
      // Read the same cached constant before starting the private daemon. Do
      // not shorten its real interval to make a short probe look sufficient.
      assert.equal(process.env.PM2_WORKER_INTERVAL, undefined, 'no Worker interval override');
      workerIntervalMs = createRequire(import.meta.url)(
        '/opt/node22/lib/node_modules/pm2/constants.js',
      ).WORKER_INTERVAL;
      assert.equal(workerIntervalMs, 30000, 'reviewed cached PM2 Worker interval');
    }
    // Dedicated QA daemon, never the host/shared PM2. Keep an unrelated app
    // alive through each exact browser stop and recovery.
    await pm2(
      'start',
      '/usr/bin/sleep',
      '--name',
      'qa-unrelated',
      '--interpreter',
      'none',
      '--',
      '600',
    );
    const row = JSON.parse(await pm2('jlist')).find((r) => r.name === 'qa-unrelated');
    unrelated = await processIdentity(row.pid);
    assert.ok(unrelated);
    if (jointRecovery) jointVnc = await prepareJointVnc(pm2, { deferStop: true });
  }
  await until(async () =>
    fs.access('/tmp/.X11-unix/X98').then(
      () => true,
      () => false,
    ),
  );
  await launch([url]);
  await until(async () => visits === 1);
  await until(async () =>
    (await cdp('Target.getTargets')).targetInfos.some(
      (t) => t.url === url && t.title === 'QA old action',
    ),
  );
  console.log(
    JSON.stringify({
      stage: 'primed',
      cookies: (await cdp('Storage.getCookies')).cookies.map((c) => ({
        name: c.name,
        session: c.session,
      })),
    }),
  );
  await close();
  console.log(
    (
      await promisify(execFile)('/usr/local/bin/python3', [
        '-c',
        'import pathlib,sqlite3,sys,json; p=pathlib.Path(sys.argv[1]); files=[p/"Default"/"Cookies",p/"Default"/"Network"/"Cookies"]; f=next(f for f in files if f.exists()); c=sqlite3.connect("file:"+str(f)+"?mode=ro",uri=True); print(json.dumps({"afterCloseSyntheticCookieMetadata":c.execute("SELECT name,is_persistent,has_expires FROM cookies").fetchall()}))',
        profile,
      ])
    ).stdout.trim(),
  );
  console.log(
    JSON.stringify({
      savedSessionPreference: JSON.parse(
        await fs.readFile(`${profile}/Default/Preferences`, 'utf8'),
      ).session,
      savedFiles: await fs.readdir(`${profile}/Default/Sessions`),
    }),
  );
  // Positive control: old about:blank launch actually restores the old target.
  // A target can be restored without an observed HTTP request. Prove this
  // control through the real old target, not an assumed network reload.
  const primed = visits;
  if (scopedPm2) await retirePrimingDisplay();
  await launch(['about:blank'], undefined, scopedPm2);
  let restored;
  await until(async () => {
    restored = (await cdp('Target.getTargets')).targetInfos.find(
      (t) => t.type === 'page' && t.url === url,
    );
    return Boolean(restored);
  });
  assert.ok(restored.targetId);
  console.log(
    JSON.stringify({
      stage: 'old-launch',
      cookies: (await cdp('Storage.getCookies')).cookies.map((c) => ({
        name: c.name,
        session: c.session,
      })),
    }),
  );
  console.log(
    JSON.stringify({
      positiveControl: 'OLD_TARGET_RESTORED',
      additionalHttpVisits: visits - primed,
    }),
  );
  await close();
  if (scopedPolicy && !scopedPm2) await retirePrimingDisplay();
  const before = visits;
  recoveryVisits = before;
  if (jointRecovery) await readJointSources(attempt);
  if (policyProbe) {
    // Characterize policy in a disposable container ONLY. This is a global
    // location, not a production-safe per-service solution.
    await fs.mkdir('/etc/brave/policies/managed', { recursive: true });
    await fs.writeFile(
      '/etc/brave/policies/managed/holaday-synthetic.json',
      JSON.stringify({ RestoreOnStartup: 5 }),
      { flag: 'wx' },
    );
  }
  let privatePolicy;
  if (scopedPolicy) {
    privatePolicy = `/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy`;
    if (jointRecovery) {
      // The real journal and product policy preparer create the attempt below.
      await fs.mkdir('/var/lib/holaday-deploy/maintenance', { recursive: true, mode: 0o700 });
    } else {
      await fs.mkdir(`/var/lib/holaday-deploy/maintenance/${attempt}`, {
        recursive: true,
        mode: 0o700,
      });
      await fs.mkdir(privatePolicy, { mode: 0o700 });
      await fs.writeFile(`${privatePolicy}/existing.json`, originalPolicy, { flag: 'wx' });
      await fs.writeFile(
        `${privatePolicy}/recovery.json`,
        JSON.stringify({ RestoreOnStartup: 5 }),
        { flag: 'wx' },
      );
    }
  }
  if (occupiedDisplay) {
    conflictDisplay = spawn('/usr/bin/Xvfb', displayArgs(98), { stdio: 'ignore' });
    conflictDisplayProof = await waitDisplay(98, conflictDisplay);
    assert.notEqual(conflictDisplayProof.identity.pid, oldDisplay.identity.pid);
  }
  await launch(
    appBlank ? ['--app=about:blank'] : ['--no-startup-window'],
    privatePolicy,
    scopedPm2,
  );
  await sleep(2000);
  if (scopedPm2) {
    const observationIo = {
      // Only select the exclusive disposable socket. Actual read-only RPC,
      // process and policy reads use the product observer's Linux defaults.
      rpcSocket: `${pm2Home}/rpc.sock`,
    };
    const observation = await readFirstCutoverCloudBrowserRecovery(
      { attempt, pmId: managed.pmId },
      observationIo,
    );
    assert.equal(observation.pid, browser.pid);
    assert.equal(observation.start, managed.identity.start);
    assert.equal(observation.restartCount, stoppedManager.pm2_env.restart_time);
    assert.equal(observation.purpose, 'cloud-browser-runtime-observation');
    const recoveredManager = JSON.parse(await pm2('jlist')).find((r) => r.pm_id === managed.pmId);
    assert.equal(
      observation.configDigest,
      cutoverRegistrationConfigDigest(recoveredManager.pm2_env),
    );
    assert.equal(recoveredManager.pm2_env.exec_mode, 'fork_mode');
    assert.equal(recoveredManager.pm2_env.cron_restart, '');
    assert.equal(Object.hasOwn(recoveredManager.pm2_env, 'max_memory_restart'), false);
    assert.equal(Object.hasOwn(recoveredManager.pm2_env.env, 'max_memory_restart'), false);
    const recoveryRecord = await restoreJournal.readFirstCutoverEffects();
    const configurationProof = compareCutoverCloudBrowserRecoveryConfig({
      attempt,
      pmId: managed.pmId,
      pm2Version: '6.0.14', // Installed package version was asserted before the experiment.
      stoppedConfig: stoppedManager.pm2_env,
      recoveredConfig: recoveredManager.pm2_env,
      launch: firstCutoverCloudBrowserRecoveryLaunch({ attempt }),
      expectedLaunchDigest: recoveryRecord.cloudMaintenanceScope[1].recoveryDigest,
      restoreStartedAtMs,
      observedAtMs: Date.now(),
    });
    assert.equal(configurationProof.recoveredConfigDigest, observation.configDigest);
    assert.equal(
      configurationProof.stoppedConfigDigest,
      cutoverRegistrationConfigDigest(stoppedManager.pm2_env),
    );
    assert.equal(configurationProof.restartCount, observation.restartCount);
    console.log(
      'CLOUD_STOPPED_TO_RECOVERED_CONFIG_PASS: exact finite PM2 transform; not a full-tree or release proof.',
    );
    if (!deniedRecovery) {
      const nativeInput = {
        attempt,
        name: 'holaday-chromium-headed',
        pmId: managed.pmId,
        beforeCensus: beforeRecoveryCensus,
        restoreStartedAtMs,
      };
      // Only the disposable socket differs from defaults. Census/root/policy
      // observation is actual procfs/RPC, not a injected passing tree or hook.
      const native = await readFirstCutoverCloudRecovery(nativeInput, observationIo);
      assert.equal(native.purpose, 'cloud-recovery-native-observation');
      assert.equal(native.pid, observation.pid);
      assert.equal(native.start, observation.start);
      assert.equal(native.ppid, observation.ppid);
      assert.equal(native.configDigest, configurationProof.recoveredConfigDigest);
      assert.equal(native.restartCount, configurationProof.restartCount);
      assert.equal(native.launchDigest, recoveryRecord.cloudMaintenanceScope[1].recoveryDigest);
      assert.equal(native.beforeCensusDigest, sha(beforeRecoveryCensus));
      assert.match(native.censusDigest, /^[a-f0-9]{64}$/);
      const independentlyObserved = await readFirstCutoverCloudRecoveryCensus();
      assert.equal(native.hostname, independentlyObserved.hostname);
      assert.equal(native.bootId, independentlyObserved.bootId);
      assert.deepEqual(
        native.processes,
        independentlyObserved.processes.filter((p) => p.mountNamespace === native.mountNamespace),
        'all actual private-namespace members, including any reparented helper',
      );
      assert.ok(native.processes.length > 1, 'real replacement descendants observed');
      const newDisplays = native.processes.filter((p) => p.exe === '/usr/bin/Xvfb');
      assert.equal(newDisplays.length, 1, 'exactly one actual replacement Xvfb');
      const newDisplay = newDisplays[0];
      assert.equal(newDisplay.ppid, native.pid, 'display is a child of the same PM2/Brave root');
      assert.equal(newDisplay.mountNamespace, native.mountNamespace);
      assert.equal(
        newDisplay.argvDigest,
        sha(['/usr/bin/Xvfb', ...displayArgs(98), ''].join('\0')),
      );
      assert.deepEqual(newDisplay.uids, [0, 0, 0, 0]);
      assert.equal(newDisplay.noNewPrivs, 1);
      for (const value of Object.values(newDisplay.capabilities)) assert.match(value, /^0+$/);
      assert.ok(!retiredIdentities.some((p) => p.pid === newDisplay.pid));
      assert.equal(await sameLive(oldDisplay.identity), false);
      recoveredDisplay = await displayProof(98, newDisplay);
      assert.equal(native.display.pid, newDisplay.pid);
      assert.equal(native.display.start, newDisplay.start);
      assert.deepEqual(
        [...native.display.listeners].sort((a, b) => a.path.localeCompare(b.path)),
        recoveredDisplay.listeners.map(({ address, inode }) => ({ path: address, inode })),
      );
      assert.notEqual(recoveredDisplay.mountNamespace, independentDisplay.mountNamespace);
      assert.notEqual(recoveredDisplay.identity.pid, independentDisplay.identity.pid);
      await assertIndependentDisplay();
      assert.deepEqual(
        independentlyObserved.processes.filter((p) => p.mountNamespace !== native.mountNamespace),
        beforeRecoveryCensus.processes,
        'complete outside identities unchanged, not a current-PID allowlist',
      );
      // One disposable untagged orphan is outside the private browser namespace.
      // It must remain visible and make the real reader refuse. No browser,
      // shared daemon, profile or policy modification is used for this negative.
      await withOrphanCanary(async (orphan) => {
        const { pid } = orphan;
        const census = await readFirstCutoverCloudRecoveryCensus();
        const actual = census.processes.find((p) => p.pid === pid && p.start === orphan.start);
        assert.ok(actual, 'untagged orphan visible in default all-process census');
        assert.notEqual(actual.mountNamespace, native.mountNamespace);
        assert.equal((await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).includes(profile), false);
        await assert.rejects(
          readFirstCutoverCloudRecovery(nativeInput, observationIo),
          /^Error: CUTOVER_CLOUD_RECOVERY_UNPROVEN$/,
        );
        assert.equal(await sameLive(orphan), true, 'rejection cannot be explained by canary exit');
      });
      const afterOrphan = await readFirstCutoverCloudRecovery(nativeInput, observationIo);
      assert.deepEqual(afterOrphan.processes, native.processes);
      assert.equal(afterOrphan.configDigest, native.configDigest);
      assert.equal(afterOrphan.beforeCensusDigest, native.beforeCensusDigest);
      assert.deepEqual(await restoreJournal.readFirstCutoverEffects(), recoveryRecord);
      console.log(
        JSON.stringify({
          marker: 'CLOUD_NATIVE_RECOVERY_TREE_PASS',
          replacementProcesses: native.processes.length,
          ownedReplacementDisplay: recoveredDisplay.identity,
          reparentedBrowserMembers: native.processes.filter((p) => p.ppid === 1).length,
          untaggedDetachedCanaryRefused: true,
          originalPreDispatchCensusRetained: true,
          recoveryAckOrOpen: false,
        }),
      );
      // The prior 2s probe could finish before the real periodic memory check.
      // ONE success-only observation spans its unchanged interval, with a 5s
      // completion margin. This is not a soak, new experiment, or recovery ACK.
      const waitMs = workerIntervalMs + 5000;
      const stabilityCapMs = 45000;
      assert.ok(Number.isSafeInteger(waitMs) && waitMs > 0 && waitMs <= stabilityCapMs);
      assert.ok(
        restoreMaintenanceEndsAtMs - Date.now() > waitMs + 5000,
        'QA_WORKER_STABILITY_WINDOW_TOO_SHORT: need interval plus observation margin',
      );
      const ownership = await restoreJournal.assertOwnership();
      const stabilityStarted = performance.now();
      await sleep(waitMs);
      const stableObservation = await readFirstCutoverCloudBrowserRecovery(
        { attempt, pmId: managed.pmId },
        observationIo,
      );
      const stableManager = JSON.parse(await pm2('jlist')).find((r) => r.pm_id === managed.pmId);
      assert.ok(stableManager);
      assert.equal(stableManager.pid, recoveredManager.pid);
      assert.equal(stableManager.pm2_env.status, 'online');
      assert.equal(stableManager.pm2_env.restart_time, recoveredManager.pm2_env.restart_time);
      assert.equal(stableManager.pm2_env.pm_uptime, recoveredManager.pm2_env.pm_uptime);
      assert.equal(stableManager.pm2_env.created_at, recoveredManager.pm2_env.created_at);
      assert.equal(Object.hasOwn(stableManager.pm2_env, 'max_memory_restart'), false);
      assert.equal(Object.hasOwn(stableManager.pm2_env.env, 'max_memory_restart'), false);
      assert.equal(stableObservation.pid, observation.pid);
      assert.equal(stableObservation.start, observation.start);
      assert.equal(stableObservation.restartCount, observation.restartCount);
      assert.equal(stableObservation.configDigest, observation.configDigest);
      assert.equal(
        cutoverRegistrationConfigDigest(stableManager.pm2_env),
        observation.configDigest,
      );
      const stableNative = await readFirstCutoverCloudRecovery(nativeInput, observationIo);
      assert.deepEqual(
        stableNative.processes,
        native.processes,
        'same complete display/browser tree across actual Worker interval',
      );
      assert.deepEqual(stableNative.display, native.display);
      assert.deepEqual(await displayProof(98, recoveredDisplay.identity), recoveredDisplay);
      assert.equal(await sameLive(oldDisplay.identity), false);
      await assertIndependentDisplay();
      assert.equal(await sameLive(unrelated), true);
      assert.deepEqual(await restoreJournal.assertOwnership(), ownership);
      assert.deepEqual(await restoreJournal.readFirstCutoverEffects(), recoveryRecord);
      assert.equal(visits, before, 'Worker interval must not replay the old HTTP action');
      const elapsedMs = performance.now() - stabilityStarted;
      assert.ok(
        elapsedMs >= workerIntervalMs && elapsedMs <= stabilityCapMs,
        'QA_WORKER_STABILITY_INTERVAL_OUT_OF_BOUNDS',
      );
      assert.ok(Date.now() < restoreMaintenanceEndsAtMs, 'QA_WORKER_STABILITY_WINDOW_EXPIRED');
      console.log(
        JSON.stringify({
          marker: 'CLOUD_PM2_WORKER_INTERVAL_STABLE',
          workerIntervalMs,
          elapsedMs,
          samePidStartAndRestartCount: true,
          sameOwnedDisplayAndCompleteTree: true,
          memoryOptionAbsent: true,
          journalUnchanged: true,
          recoveryAckOrOpen: false,
        }),
      );
    }
    if (jointRecovery) {
      const headed = await readFirstCutoverCloudRecovery(
        {
          attempt,
          name: 'holaday-chromium-headed',
          pmId: managed.pmId,
          beforeCensus: beforeRecoveryCensus,
          restoreStartedAtMs,
        },
        observationIo,
      );
      await observeJointVnc({
        attempt,
        pm2,
        journal: restoreJournal,
        headed,
        stoppedVnc: jointVnc.stopped,
        maintenanceEndsAtMs: restoreMaintenanceEndsAtMs,
        checkOutside: async () => {
          await assertIndependentDisplay();
          assert.equal(await sameLive(unrelated), true);
          assert.equal(visits, before, 'joint VNC observation must not replay old HTTP action');
        },
      });
    }
    const policyFile = `${privatePolicy}/recovery.json`;
    const originalMode = (await fs.stat(policyFile)).mode & 0o777;
    await fs.chmod(policyFile, 0o666);
    await assert.rejects(
      () => readFirstCutoverCloudBrowserRecovery({ attempt, pmId: managed.pmId }, observationIo),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
    );
    await fs.chmod(policyFile, originalMode);
    assert.equal(
      (await readFirstCutoverCloudBrowserRecovery({ attempt, pmId: managed.pmId }, observationIo))
        .pid,
      browser.pid,
    );
    console.log(
      jointRecovery
        ? 'CLOUD_JOINT_COMPONENT_ONLY: fixture headed ACK follows actual native proof; no full-site acceptance, VNC ACK or candidate open.'
        : 'CLOUD_SAME_ID_RESTORE_PASS: original journal intent, single default RPC, same numeric registration and restart count; independent procfs/private policy observation. No physical-recovery ACK or candidate open.',
    );
  }
  const initial = await cdp('Target.getTargets');
  assert.equal(
    initial.targetInfos.filter((t) => t.type === 'page').length,
    appBlank ? 1 : 0,
    'startup page count',
  );
  assert.ok(
    initial.targetInfos.filter((t) => t.type === 'page').every((t) => t.url === 'about:blank'),
    'startup must not restore old page',
  );
  assert.equal(visits, before, 'no old action on silent startup');
  const cookies = await cdp('Storage.getCookies');
  console.log(
    JSON.stringify({
      stage: 'silent-launch',
      cookies: cookies.cookies.map((c) => ({ name: c.name, session: c.session })),
    }),
  );
  // Observe page restoration independently before asserting cookie retention.
  // Historical modes retain both-cookie assertions. The scoped mode follows
  // the accepted session interruption boundary, without a privacy override.
  // A policy-only result is NOT whole-release acceptance.
  if (policyProbe || scopedPolicy) {
    await cdp('Target.createTarget', { url: 'about:blank' });
    await sleep(1000);
    const pages = (await cdp('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
    console.log(
      JSON.stringify({
        policyProbe: {
          oldTarget: pages.some((t) => t.url === url),
          allBlank: pages.every((t) => t.url === 'about:blank'),
          additionalHttpVisits: visits - before,
        },
      }),
    );
    assert.ok(
      pages.length > 0 && pages.every((t) => t.url === 'about:blank'),
      'policy must not restore old target',
    );
    assert.equal(visits, before, 'policy must not request old action');
  }
  if (scopedPolicy) {
    assert.deepEqual(await fs.readdir(policyRoot), ['existing.json'], 'no host policy installed');
    assert.equal(await fs.readFile(`${policyRoot}/existing.json`, 'utf8'), originalPolicy);
    assert.notEqual(
      await fs.readlink(`/proc/${browser.pid}/ns/mnt`),
      await fs.readlink('/proc/self/ns/mnt'),
      'browser policy must be process-private',
    );
    const status = await fs.readFile(`/proc/${browser.pid}/status`, 'utf8');
    for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'])
      assert.match(status, new RegExp(`^${name}:\\s+0+$`, 'm'), 'browser has no capabilities');
    assert.match(status, /^NoNewPrivs:\s+1$/m);
    const privateRoot = `/proc/${browser.pid}/root${policyRoot}`;
    assert.equal(await fs.readFile(`${privateRoot}/existing.json`, 'utf8'), originalPolicy);
    assert.deepEqual(JSON.parse(await fs.readFile(`${privateRoot}/recovery.json`, 'utf8')), {
      RestoreOnStartup: 5,
    });
    const mount = (await fs.readFile(`/proc/${browser.pid}/mountinfo`, 'utf8'))
      .split('\n')
      .map((line) => line.split(' '))
      .find((fields) => fields[4] === policyRoot);
    assert.ok(mount?.[5].split(',').includes('ro'), 'private policy mount is read-only');
  }
  assert.ok(
    cookies.cookies.some((c) => c.name === 'qa_login' && c.value === 'synthetic'),
    'same profile retained synthetic login',
  );
  if (!scopedPolicy)
    assert.ok(
      cookies.cookies.some((c) => c.name === 'qa_session' && c.value === 'synthetic'),
      'same profile retained synthetic session cookie',
    );
  await cdp('Target.createTarget', { url: 'about:blank' });
  await sleep(1000);
  assert.equal(visits, before, 'explicit blank target must not restore old action');
  assert.ok(
    !(await cdp('Target.getTargets')).targetInfos.some((t) => t.url === url),
    'explicit blank cannot revive hidden old tab',
  );
  const afterBlank = await cdp('Storage.getCookies');
  for (const name of scopedPolicy ? ['qa_login'] : ['qa_login', 'qa_session'])
    assert.ok(
      afterBlank.cookies.some((c) => c.name === name && c.value === 'synthetic'),
      `blank retains ${name}`,
    );
  assert.equal(
    await fs.readFile(`${profile}/Default/Sessions/preserve-sentinel`, 'utf8'),
    'synthetic-preserve',
  );
  await close();
  if (scopedPolicy) {
    assert.deepEqual(await fs.readdir(policyRoot), ['existing.json']);
    assert.equal(await fs.readFile(`${policyRoot}/existing.json`, 'utf8'), originalPolicy);
    assert.equal(
      JSON.parse(await fs.readFile(`${profile}/Default/Preferences`, 'utf8')).session
        .restore_on_startup,
      1,
      'managed policy must not replace the saved user startup preference',
    );
    await assertIndependentDisplay();
  }
  if (scopedPm2) assert.equal(physicalStops, 2, 'both reviewed PM2 lifetimes actually stopped');
  assert.equal(
    deniedRecovery || occupiedDisplay,
    false,
    'a denied recovery cannot report successful recovery',
  );
  console.log(
    scopedPolicy
      ? 'BROWSER_SCOPED_POLICY_PASS: original policy outside namespace unchanged; private read-only policy, browser capabilities zero; same synthetic profile/persistent cookie, old-target positive control, no old URL on blank; session interruption accepted. NOT production or arbitrary background replay proof.'
      : 'BROWSER_RECOVERY_PROBE_PASS: real headed Brave, positive control, same synthetic cookie, no old URL on silent startup or explicit blank; NOT production or arbitrary background replay proof',
  );
} catch (error) {
  if (!(deniedRecovery || occupiedDisplay) || physicalStops !== 1) throw error;
  // Do not accept just any rejection as the injected failure. Check actual
  // PM2 exit metadata and its private stderr, then observe no subsequent start.
  const observeFailure = async () => {
    assert.equal(visits, recoveryVisits, 'failed recovery cannot repeat the old HTTP action');
    assert.ok(
      (await Promise.all(retiredIdentities.map(sameLive))).every((live) => !live),
      'old untagged descendants remain stopped',
    );
    const rows = JSON.parse(await pm2('jlist')).filter((r) => r.name === 'holaday-chromium-headed');
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.pid, 0);
    assert.equal(row.pm_id, stoppedManager.pm_id);
    assert.equal((await restoreJournal.readFirstCutoverEffects()).cloudMaintenanceEvents.length, 5);
    assert.ok(['stopped', 'errored'].includes(row.pm2_env.status));
    assert.equal(row.pm2_env.autorestart, false);
    assert.equal(row.pm2_env.restart_time, stoppedManager.pm2_env.restart_time);
    assert.equal(row.pm2_env.exit_code, 1);
    assert.ok(row.pm2_env.pm_err_log_path.startsWith(`${pm2Home}/logs/`));
    const stderr = await fs.readFile(row.pm2_env.pm_err_log_path, 'utf8');
    if (deniedRecovery)
      assert.equal(
        (stderr.match(/unshare: unshare failed: Operation not permitted/g) ?? []).length,
        1,
        'one failed unshare launch, no replay',
      );
    else {
      // Actual A bootstrap marker: unlike generic PM2 exit1 this establishes
      // entry into its guarded path. The unchanged occupied socket/lock is
      // checked before any Popen/Brave in that fixed product bootstrap.
      assert.equal((stderr.match(/CLOUD_DISPLAY_BOOTSTRAP_UNPROVEN/g) ?? []).length, 1);
      assert.deepEqual(await displayProof(98, conflictDisplayProof.identity), conflictDisplayProof);
      assert.equal(await sameLive(oldDisplay.identity), false);
    }
    for (const name of (await fs.readdir('/proc')).filter((n) => /^[0-9]+$/.test(n))) {
      let argv;
      try {
        argv = await fs.readFile(`/proc/${name}/cmdline`, 'utf8');
      } catch (readError) {
        if (['ENOENT', 'ESRCH'].includes(readError.code)) continue;
        throw readError;
      }
      assert.equal(argv.includes(profile), false, 'no fallback or revived profile process');
    }
    assert.equal(await sameLive(unrelated), true);
    await assertIndependentDisplay();
    await assert.rejects(
      fetch('http://127.0.0.1:9223/json/version', {
        signal: AbortSignal.timeout(500),
      }),
    );
    return [row.pm_id, row.pm2_env.pm_uptime, row.pm2_env.restart_time, stderr];
  };
  const failed = await observeFailure();
  await sleep(2000);
  assert.deepEqual(await observeFailure(), failed);
  assert.deepEqual(await fs.readdir(policyRoot), ['existing.json']);
  assert.equal(await fs.readFile(`${policyRoot}/existing.json`, 'utf8'), originalPolicy);
  assert.equal(
    await fs.readFile(`${profile}/Default/Sessions/preserve-sentinel`, 'utf8'),
    'synthetic-preserve',
  );
  assert.equal(
    JSON.parse(await fs.readFile(`${profile}/Default/Preferences`, 'utf8')).session
      .restore_on_startup,
    1,
  );
  console.log(
    occupiedDisplay
      ? 'BROWSER_DISPLAY_CONFLICT_PROVEN: one fixed same-ID recovery refused occupied :98; foreign display/listener identities unchanged, no retry/Brave/CDP, unrelated :97/app and profile sentinel preserved. No recovery ACK/open.'
      : 'BROWSER_RECOVERY_DENIAL_PROVEN: one PM2 startup exited 1 at unshare; restart count unchanged, no profile process or CDP listener, unrelated app/display and parent policy/profile sentinel preserved. Recovery did NOT succeed; no production or arbitrary replay proof.',
  );
} finally {
  // Only disposable processes this test itself spawned; the container is --rm.
  if (browser?.exitCode === null) browser.kill?.('SIGKILL');
  try {
    if (pm2Home) await pm2('kill'); // Only the disposable fixture's private daemon.
  } finally {
    // Teardown only, never evidence that the numeric stop succeeded. Additional
    // production orphan effects still need original scope/journal integration.
    for (const handler of qaCrashpadCleanup.values()) {
      if (!(await sameLive(handler))) continue;
      console.error(
        JSON.stringify({
          marker: 'QA_FINALLY_CRASHPAD_CLEANUP',
          pid: handler.pid,
          start: handler.start,
        }),
      );
      process.kill(handler.pid, 'SIGKILL');
      await until(async () => !(await sameLive(handler)), 2000);
    }
    await restoreJournal?.close();
    socket?.close();
    primingDisplay?.kill('SIGTERM');
    conflictDisplay?.kill('SIGTERM');
    xvfb.kill('SIGTERM');
    server.close();
  }
}
