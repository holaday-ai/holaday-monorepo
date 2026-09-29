// Diagnostic for the approved cloud-browser recovery boundary, NOT a release gate.
// Its no-replay + cookie-retention assertions currently FAIL for every tested mode.
// Run only in a disposable network-none Linux container, never with a real profile.
// No argument: silent startup; --app-blank: app window; --policy-probe: global
// policy characterization INSIDE THE CONTAINER ONLY. Never install this policy
// on a shared host. See the 2026-09-30 checkpoint for exact failures and limits.
// Retaining BOTH cookies is an exploratory hypothesis, not an added release
// requirement: the approved maintenance scope already accepts session interruption.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 && ['--app-blank', '--policy-probe'].includes(process.argv[2])),
);
const appBlank = process.argv[2] === '--app-blank';
const policyProbe = process.argv[2] === '--policy-probe';
const exe = '/opt/brave.com/brave/brave';
const version = (await promisify(execFile)(exe, ['--version'])).stdout;
assert.match(version, /^Brave Browser 147\.1\.89\.141 /);
console.log(version.trim());
const profile = await fs.mkdtemp('/tmp/holaday-synthetic-browser-');
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
const xvfb = spawn('/usr/bin/Xvfb', [':99', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], {
  stdio: 'ignore',
});
let browser;
let socket;
let sequence = 0;
const pending = new Map();
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
  '--disable-features=BraveCleanupSessionCookiesOnSessionRestore',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=9229',
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
async function launch(extra) {
  browser = spawn(exe, [...args, ...extra], {
    env: { ...process.env, DISPLAY: ':99' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  browser.stderr.on('data', (b) => {
    errors = (errors + b.toString()).slice(-8192);
  });
  let endpoint;
  await until(async () => {
    if (browser.exitCode !== null) throw Error(`QA_BROWSER_EXIT_${browser.exitCode}: ${errors}`);
    let v;
    try {
      const r = await fetch('http://127.0.0.1:9229/json/version', {
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
  const done = once(browser, 'exit');
  await cdp('Browser.close');
  await done;
  socket.close();
  await until(async () => {
    try {
      await fetch('http://127.0.0.1:9229/json/version', { signal: AbortSignal.timeout(200) });
      return false;
    } catch {
      return true;
    }
  });
}
try {
  await until(async () =>
    fs.access('/tmp/.X11-unix/X99').then(
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
  await launch(['about:blank']);
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
  await launch(appBlank ? ['--app=about:blank'] : ['--no-startup-window']);
  await sleep(2000);
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
  // All original retention gates remain below; a policy-only result is NOT
  // overall acceptance and may correctly fail the session-cookie assertion.
  if (policyProbe) {
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
  assert.ok(
    cookies.cookies.some((c) => c.name === 'qa_login' && c.value === 'synthetic'),
    'same profile retained synthetic login',
  );
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
  for (const name of ['qa_login', 'qa_session'])
    assert.ok(
      afterBlank.cookies.some((c) => c.name === name && c.value === 'synthetic'),
      `blank retains ${name}`,
    );
  assert.equal(
    await fs.readFile(`${profile}/Default/Sessions/preserve-sentinel`, 'utf8'),
    'synthetic-preserve',
  );
  await close();
  console.log(
    'BROWSER_RECOVERY_PROBE_PASS: real headed Brave, positive control, same synthetic cookie, no old URL on silent startup or explicit blank; NOT production or arbitrary background replay proof',
  );
} finally {
  // Only disposable processes this test itself spawned; the container is --rm.
  if (browser?.exitCode === null) browser.kill('SIGKILL');
  socket?.close();
  xvfb.kill('SIGTERM');
  server.close();
}
