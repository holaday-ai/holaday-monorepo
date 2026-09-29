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
// --scoped-pm2-denied requires a container WITHOUT SYS_ADMIN and checks that
// failed recovery stays failed, with no PM2 restart or direct-browser fallback.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { cutoverRegistrationConfigDigest } from '../browser-cutover-evidence.mjs';
import {
  firstCutoverCloudBrowserRecoveryLaunch,
  readFirstCutoverCloudBrowserRecovery,
  restoreFirstCutoverCloudBrowser,
} from '../browser-first-cutover-runtime.mjs';
import { acquireReleaseJournal } from '../browser-maintenance-journal.mjs';
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
        '--scoped-pm2-denied',
      ].includes(process.argv[2])),
);
const appBlank = process.argv[2] === '--app-blank';
const policyProbe = process.argv[2] === '--policy-probe';
const deniedRecovery = process.argv[2] === '--scoped-pm2-denied';
const scopedPm2 = process.argv[2] === '--scoped-pm2' || deniedRecovery;
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
const xvfb = spawn('/usr/bin/Xvfb', [':98', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], {
  stdio: 'ignore',
});
let browser;
let socket;
let sequence = 0;
const pending = new Map();
let physicalStops = 0;
let recoveryVisits;
const retiredIdentities = [];
const pm2Home = scopedPm2 ? await fs.mkdtemp('/tmp/holaday-browser-pm2-') : undefined;
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
      { env: { ...process.env, PM2_HOME: pm2Home, DISPLAY: ':98' }, maxBuffer: 8 * 1024 * 1024 },
    )
  ).stdout;
let managed;
let stoppedManager;
let restoreJournal;
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
  const directory = await fs.mkdtemp('/tmp/holaday-cloud-restore-journal-');
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
      pmId: stoppedManager.pm_id + 100,
      scopeDigest: '1'.repeat(64),
      recoveryDigest: '2'.repeat(64),
    },
    {
      name: stoppedManager.name,
      pmId: stoppedManager.pm_id,
      scopeDigest: sha(retiredIdentities),
      recoveryDigest: sha(recovery),
    },
  ];
  await restoreJournal.bindExecutionSite('3'.repeat(64), scope);
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
    maintenanceEndsAtMs: Date.now() + 60000,
  };
  const io = {
    journal: restoreJournal,
    rpcSocket: `${pm2Home}/rpc.sock`,
    assertRecoveryScope: async (actual) => {
      assert.deepEqual(actual, input);
      assert.ok((await Promise.all(retiredIdentities.map(sameLive))).every((v) => !v));
      assert.equal(await sameLive(unrelated), true);
      assert.equal(xvfb.exitCode, null);
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
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function sameLive(identity) {
  const current = await processIdentity(identity.pid);
  return current?.start === identity.start && current.state !== 'Z';
}
async function ownedProcesses(root) {
  const observed = [];
  const selected = new Set([root.pid]);
  for (const name of (await fs.readdir('/proc')).filter((n) => /^[0-9]+$/.test(n))) {
    const pid = Number(name);
    let argv;
    try {
      argv = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
      throw error;
    }
    const identity = await processIdentity(pid);
    if (!identity || identity.state === 'Z') continue;
    observed.push(identity);
    if (argv.includes(profile)) selected.add(pid);
  }
  // Parent closure includes untagged descendants; profile seeds also cover
  // reparented crash handlers. Neither a name match nor ancestry alone suffices.
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
    else
      await pm2(
        'start',
        command,
        '--name',
        'holaday-chromium-headed',
        '--interpreter',
        'none',
        '--kill-timeout',
        '1600',
        ...(recovery?.autorestart === false ? ['--no-autorestart'] : []),
        '--',
        ...argv,
      );
    const matches = JSON.parse(await pm2('jlist')).filter(
      (r) => r.name === 'holaday-chromium-headed',
    );
    assert.equal(matches.length, 1);
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
    // Observe the real owned profile processes as well as descendants: a
    // reparented crash handler must not evade the post-stop assertion.
    const observed = await ownedProcesses(managed.identity);
    assert.ok(observed.length > 1, 'real browser children were observed');
    assert.equal(await sameLive(managed.identity), true);
    await pm2('stop', String(managed.pmId)); // Exactly one numeric stop, no retry.
    await until(async () => (await Promise.all(observed.map(sameLive))).every((live) => !live));
    const rows = JSON.parse(await pm2('jlist'));
    const stopped = rows.find((r) => r.pm_id === managed.pmId);
    assert.equal(stopped.pm2_env.status, 'stopped');
    assert.equal(stopped.pid, 0);
    assert.equal(await sameLive(unrelated), true);
    assert.equal(xvfb.exitCode, null);
    process.kill(xvfb.pid, 0);
    retiredIdentities.push(...observed);
    physicalStops++;
    console.log(
      JSON.stringify({
        physicalPm2Stop: physicalStops,
        observedProcesses: observed.length,
        oldProcessesLive: false,
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
  const before = visits;
  recoveryVisits = before;
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
    await fs.mkdir(`/var/lib/holaday-deploy/maintenance/${attempt}`, {
      recursive: true,
      mode: 0o700,
    });
    privatePolicy = `/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy`;
    await fs.mkdir(privatePolicy, { mode: 0o700 });
    await fs.writeFile(`${privatePolicy}/existing.json`, originalPolicy, { flag: 'wx' });
    await fs.writeFile(`${privatePolicy}/recovery.json`, JSON.stringify({ RestoreOnStartup: 5 }), {
      flag: 'wx',
    });
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
    assert.equal(recoveredManager.pm2_env.max_memory_restart, 0);
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
      'CLOUD_SAME_ID_RESTORE_PASS: original journal intent, single default RPC, same numeric registration and restart count; independent procfs/private policy observation. No physical-recovery ACK or candidate open.',
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
    assert.equal(xvfb.exitCode, null, 'the separate display remains running');
    process.kill(xvfb.pid, 0);
  }
  if (scopedPm2) assert.equal(physicalStops, 2, 'both reviewed PM2 lifetimes actually stopped');
  assert.equal(deniedRecovery, false, 'a denied recovery cannot report successful recovery');
  console.log(
    scopedPolicy
      ? 'BROWSER_SCOPED_POLICY_PASS: original policy outside namespace unchanged; private read-only policy, browser capabilities zero; same synthetic profile/persistent cookie, old-target positive control, no old URL on blank; session interruption accepted. NOT production or arbitrary background replay proof.'
      : 'BROWSER_RECOVERY_PROBE_PASS: real headed Brave, positive control, same synthetic cookie, no old URL on silent startup or explicit blank; NOT production or arbitrary background replay proof',
  );
} catch (error) {
  if (!deniedRecovery || physicalStops !== 1) throw error;
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
    assert.equal(row.pm2_env.restart_time, 0);
    assert.equal(row.pm2_env.exit_code, 1);
    assert.ok(row.pm2_env.pm_err_log_path.startsWith(`${pm2Home}/logs/`));
    const stderr = await fs.readFile(row.pm2_env.pm_err_log_path, 'utf8');
    assert.equal(
      (stderr.match(/unshare: unshare failed: Operation not permitted/g) ?? []).length,
      1,
      'one failed unshare launch, no replay',
    );
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
    assert.equal(xvfb.exitCode, null);
    process.kill(xvfb.pid, 0);
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
    'BROWSER_RECOVERY_DENIAL_PROVEN: one PM2 startup exited 1 at unshare; restart count zero, no profile process or CDP listener, unrelated app/display and parent policy/profile sentinel preserved. Recovery did NOT succeed; no production or arbitrary replay proof.',
  );
} finally {
  // Only disposable processes this test itself spawned; the container is --rm.
  if (browser?.exitCode === null) browser.kill?.('SIGKILL');
  if (pm2Home) await pm2('kill'); // Only the disposable fixture's private daemon.
  await restoreJournal?.close();
  socket?.close();
  xvfb.kill('SIGTERM');
  server.close();
}
