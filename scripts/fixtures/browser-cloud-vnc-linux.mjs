// Reviewed legacy VNC lifecycle under the ORIGINAL PM2 stop mechanism.
// Only run in the existing disposable Linux image with a private PID namespace.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  cutoverCloudStopConfigDigest,
  cutoverRegistrationConfigDigest,
  validateFirstCutoverCloudSources,
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
// Stub modes remain unchanged. --controller-recovery-native uses actual cached
// x11vnc/websockify/Xvfb + held WS/RFB; neither mode proves production preflight,
// business/fence/other-host facts, headed recovery or a full recovery ACK.
const nativeRecovery = process.argv[2] === '--controller-recovery-native';
const controllerRecovery = process.argv[2] === '--controller-recovery' || nativeRecovery;
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
let nativeDisplay;
let displayBefore;
let nativeBefore;
let heldRfb;
const nativeSockets = [];
function qaError(error) {
  return {
    code: String(error?.code ?? '').slice(0, 128),
    message: String(error?.message ?? '').slice(0, 1024),
  };
}
async function nativeFailureDiagnostics(error) {
  console.error(JSON.stringify({ stage: 'QA_NATIVE_FAILURE', ...qaError(error) }));
  for (const path of [
    '/root/.pm2/logs/holaday-vnc-error.log',
    '/root/.pm2/logs/holaday-vnc-out.log',
  ]) {
    try {
      const file = await fs.open(path, 'r');
      try {
        const { size } = await file.stat();
        const tail = Buffer.alloc(Math.min(size, 8192));
        const { bytesRead } = await file.read(
          tail,
          0,
          tail.length,
          Math.max(0, size - tail.length),
        );
        console.error(
          JSON.stringify({
            stage: 'QA_NATIVE_LOG_TAIL',
            path,
            tail: tail.subarray(0, bytesRead).toString('utf8'),
          }),
        );
      } finally {
        await file.close();
      }
    } catch (diagnosticError) {
      console.error(
        JSON.stringify({ stage: 'QA_NATIVE_LOG_READ_FAILED', path, ...qaError(diagnosticError) }),
      );
    }
  }
  try {
    const { stdout } = await exec('/usr/bin/ss', ['-H', '-antp'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const rows = stdout.split('\n').filter((line) => {
      const fields = line.trim().split(/\s+/);
      return [fields[3], fields[4]].some((endpoint) => /:(5900|5901|6080)$/.test(endpoint ?? ''));
    });
    console.error(
      JSON.stringify({
        stage: 'QA_NATIVE_TCP_ROWS',
        count: rows.length,
        truncated: rows.length > 64 || rows.join('\n').length > 16384,
        rows: rows.slice(0, 64).join('\n').slice(0, 16384),
      }),
    );
  } catch (diagnosticError) {
    console.error(
      JSON.stringify({ stage: 'QA_NATIVE_TCP_READ_FAILED', ...qaError(diagnosticError) }),
    );
  }
}
async function qaIdentity(pid) {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
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
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
    throw error;
  }
}
async function nativeListeners() {
  return (await exec('/usr/bin/ss', ['-H', '-ltnp'], { timeout: 5000, maxBuffer: 1024 * 1024 }))
    .stdout;
}
function tcpListeners(raw) {
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      return {
        address: fields[3],
        port: Number(/:(\d+)$/.exec(fields[3])?.[1]),
        owners: [...new Set([...line.matchAll(/\bpid=(\d+)/g)].map((m) => Number(m[1])))].sort(
          (a, b) => a - b,
        ),
      };
    })
    .sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
}
function proveNativeListeners(raw, x11, web, handler) {
  const owned = new Set([x11, web, ...(handler ? [handler] : [])]);
  const rows = tcpListeners(raw).filter(
    (r) => [5900, 5901, 6080].includes(r.port) || r.owners.some((pid) => owned.has(pid)),
  );
  assert.equal(new Set(rows.map((r) => r.address)).size, rows.length);
  assert.equal(rows.filter((r) => r.address === '127.0.0.1:5901').length, 1);
  assert.equal(rows.filter((r) => r.address === '127.0.0.1:6080').length, 1);
  for (const r of rows) {
    if (['127.0.0.1:5901', '[::]:5900', '[::]:5901'].includes(r.address))
      assert.deepEqual(r.owners, [x11], 'actual x11vnc listener, including QA IPv6 extras');
    else {
      assert.equal(r.address, '127.0.0.1:6080', 'no other owned/legacy-port listeners');
      assert.ok(r.owners.includes(web) && r.owners.every((pid) => pid === web || pid === handler));
    }
  }
  return rows;
}
async function nativePortsReady(rootPid) {
  const raw = await nativeListeners();
  const rows = tcpListeners(raw);
  const x11 = rows.filter((r) => r.address === '127.0.0.1:5901');
  const web = rows.filter((r) => r.address === '127.0.0.1:6080');
  if (!x11.length || !web.length) return false;
  assert.equal(x11.length, 1);
  assert.equal(web.length, 1);
  assert.equal(x11[0].owners.length, 1);
  assert.equal(web[0].owners.length, 1);
  const x11Identity = await qaIdentity(x11[0].owners[0]);
  const webIdentity = await qaIdentity(web[0].owners[0]);
  assert.equal(x11Identity?.exe, '/usr/bin/x11vnc');
  assert.equal(webIdentity?.exe, nativePython);
  assert.equal(webIdentity.ppid, rootPid);
  const loop = await qaIdentity(x11Identity.ppid);
  assert.equal(loop?.ppid, rootPid);
  assert.match(loop.exe, /\/bash$/);
  proveNativeListeners(raw, x11Identity.pid, webIdentity.pid);
  return true;
}
async function untilNative(check) {
  const deadline = performance.now() + 8000;
  do {
    if (await check()) return;
    await sleep(50);
  } while (performance.now() < deadline);
  throw Error('QA_NATIVE_VNC_READINESS_TIMEOUT');
}
async function displayIdentity() {
  const identity = await qaIdentity(nativeDisplay.pid);
  assert.ok(identity && identity.exe === '/usr/bin/Xvfb');
  const names = await fs.readdir(`/proc/${identity.pid}/fd`);
  assert.ok(names.length <= 256);
  const owned = new Set(
    await Promise.all(names.map((fd) => fs.readlink(`/proc/${identity.pid}/fd/${fd}`))),
  );
  const sockets = (await fs.readFile('/proc/net/unix', 'utf8'))
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (f) => ['/tmp/.X11-unix/X98', '@/tmp/.X11-unix/X98'].includes(f[7]) && f[3] === '00010000',
    )
    .map((f) => ({ path: f[7], inode: f[6] }))
    .sort((a, b) => a.path.localeCompare(b.path));
  assert.equal(sockets.length, 2);
  assert.deepEqual(
    sockets.map((s) => s.path).sort(),
    ['/tmp/.X11-unix/X98', '@/tmp/.X11-unix/X98'].sort(),
  );
  for (const s of sockets) assert.ok(owned.has(`socket:[${s.inode}]`));
  assert.deepEqual(await qaIdentity(identity.pid), identity);
  return { identity, sockets };
}
async function openNativeRfb() {
  // Real binary WS/RFB negotiation, no screenshot or framebuffer requests.
  // Complete ServerInit so the handler stays connected past the Worker interval.
  const socket = new WebSocket('ws://127.0.0.1:6080', ['binary']);
  socket.binaryType = 'arraybuffer';
  nativeSockets.push(socket);
  const session = { socket, banner: null, failure: null };
  await new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    let receivedBytes = 0;
    let phase = 'version';
    let oldProtocol = false;
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
    });
    const timer = setTimeout(() => reject(Error('QA_NATIVE_RFB_TIMEOUT')), 5000);
    const fail = (event) => {
      if (session.failure === null)
        console.error(
          JSON.stringify({
            stage: 'QA_NATIVE_WS_FAILURE',
            phase: opened ? phase : 'http-upgrade',
            event: event?.type ?? 'protocol-error',
            ...qaError(event?.error ?? event),
            cause: qaError(event?.error?.cause ?? event?.cause),
            closeCode: event?.type === 'close' ? event.code : null,
            closeReason: String(event?.reason ?? '').slice(0, 1024),
          }),
        );
      session.failure = 'WS/RFB closed or invalid';
      clearTimeout(timer);
      reject(Error('QA_NATIVE_RFB_FAILED'));
    };
    socket.addEventListener('error', fail);
    socket.addEventListener('close', fail);
    socket.addEventListener('message', (event) => {
      try {
        receivedBytes += event.data.byteLength;
        assert.ok(receivedBytes <= 65536, 'bounded held RFB session');
        bytes = Buffer.concat([bytes, Buffer.from(event.data)]);
        assert.ok(bytes.length <= 65536);
        for (;;) {
          if (phase === 'version') {
            if (bytes.length < 12) return;
            session.banner = bytes.subarray(0, 12).toString('ascii');
            assert.match(session.banner, /^RFB 003\.00[38]\n$/);
            oldProtocol = session.banner === 'RFB 003.003\n';
            socket.send(bytes.subarray(0, 12));
            bytes = bytes.subarray(12);
            phase = 'security';
          } else if (phase === 'security') {
            if (oldProtocol) {
              if (bytes.length < 4) return;
              assert.equal(bytes.readUInt32BE(0), 1);
              bytes = bytes.subarray(4);
              socket.send(new Uint8Array([1]));
              phase = 'init';
            } else {
              if (!bytes.length || bytes.length < bytes[0] + 1) return;
              assert.ok(bytes[0] > 0 && bytes.subarray(1, bytes[0] + 1).includes(1));
              bytes = bytes.subarray(bytes[0] + 1);
              socket.send(new Uint8Array([1]));
              phase = 'security-result';
            }
          } else if (phase === 'security-result') {
            if (bytes.length < 4) return;
            assert.equal(bytes.readUInt32BE(0), 0);
            bytes = bytes.subarray(4);
            socket.send(new Uint8Array([1]));
            phase = 'init';
          } else if (phase === 'init') {
            if (bytes.length < 24) return;
            const length = bytes.readUInt32BE(20);
            assert.ok(length <= 4096);
            if (bytes.length < 24 + length) return;
            assert.ok(bytes.readUInt16BE(0) > 0 && bytes.readUInt16BE(2) > 0);
            bytes = bytes.subarray(24 + length);
            phase = 'held';
            clearTimeout(timer);
            resolve();
          } else {
            // Servers may send asynchronous bell/clipboard messages. No frame
            // requests are issued; discard bounded bytes without printing them.
            bytes = Buffer.alloc(0);
            return;
          }
        }
      } catch (error) {
        fail(error);
      }
    });
  });
  return session;
}
async function nativeTree(rootPid) {
  const all = [];
  const names = (await fs.readdir('/proc')).filter((n) => /^\d+$/.test(n));
  assert.ok(names.length <= 4096);
  for (const name of names) {
    const p = await qaIdentity(Number(name));
    if (p) all.push(p);
  }
  const ids = new Set([rootPid]);
  for (let i = 0; i < all.length; i++) for (const p of all) if (ids.has(p.ppid)) ids.add(p.pid);
  const tree = all.filter((p) => ids.has(p.pid)).sort((a, b) => a.pid - b.pid);
  assert.equal(
    tree.length,
    5,
    'actual wrapper, supervision shell, x11vnc, websockify, held handler',
  );
  const root = tree.find((p) => p.pid === rootPid);
  assert.match(root.exe, /\/bash$/);
  const x11 = tree.find((p) => p.exe === '/usr/bin/x11vnc');
  assert.ok(x11);
  const loop = tree.find((p) => p.pid === x11.ppid);
  assert.ok(loop && loop.pid !== root.pid && loop.ppid === root.pid && loop.exe === root.exe);
  const web = tree.find((p) => p.ppid === root.pid && p.exe === nativePython);
  assert.ok(web);
  const handler = tree.find((p) => p.ppid === web.pid && p.exe === web.exe);
  assert.ok(handler);
  const webArgs = (await fs.readFile(`/proc/${web.pid}/cmdline`, 'utf8'))
    .split('\0')
    .filter(Boolean);
  assert.deepEqual(webArgs.slice(webArgs.indexOf('/usr/bin/websockify')), [
    '/usr/bin/websockify',
    '--heartbeat',
    '30',
    '--web',
    '/usr/share/novnc',
    '127.0.0.1:6080',
    '127.0.0.1:5901',
  ]);
  assert.equal(handler.argvDigest, web.argvDigest);
  assert.deepEqual(
    (await fs.readFile(`/proc/${x11.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean),
    [
      'x11vnc',
      '-display',
      ':98',
      '-forever',
      '-nopw',
      '-shared',
      '-noxdamage',
      '-listen',
      '127.0.0.1',
      '-rfbport',
      '5901',
    ],
  );
  const listeners = proveNativeListeners(await nativeListeners(), x11.pid, web.pid, handler.pid);
  const connections = (
    await exec('/usr/bin/ss', ['-H', '-antp'], { timeout: 5000, maxBuffer: 1024 * 1024 })
  ).stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      return {
        state: fields[0],
        local: fields[3],
        peer: fields[4],
        owners: [...new Set([...line.matchAll(/\bpid=(\d+)/g)].map((m) => Number(m[1])))].sort(
          (a, b) => a - b,
        ),
      };
    })
    .filter((r) => r.state === 'ESTAB' && r.owners.includes(handler.pid))
    .sort((a, b) => a.local.localeCompare(b.local));
  assert.equal(connections.length, 2, 'real handler owns both held WS and upstream RFB');
  assert.equal(connections.filter((r) => r.local === '127.0.0.1:6080').length, 1);
  assert.equal(connections.filter((r) => r.peer === '127.0.0.1:5901').length, 1);
  for (const r of connections) assert.deepEqual(r.owners, [handler.pid]);
  for (const p of tree) {
    assert.deepEqual(p.uids, [0, 0, 0, 0]);
    assert.deepEqual(await qaIdentity(p.pid), p);
  }
  assert.equal(heldRfb.failure, null);
  assert.equal(heldRfb.socket.readyState, WebSocket.OPEN);
  return {
    tree,
    listeners,
    connections,
    roles: { x11: x11.pid, web: web.pid, handler: handler.pid },
    banner: heldRfb.banner,
  };
}
const nativePython = nativeRecovery ? await fs.realpath('/usr/bin/python3') : null;
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
try {
  if (!nativeRecovery) {
    for (const file of ['/usr/bin/x11vnc', '/usr/bin/websockify'])
      await fs.writeFile(file, stub, { flag: 'wx', mode: 0o755 });
  } else {
    for (const tool of ['/usr/bin/x11vnc', '/usr/bin/websockify', '/usr/bin/Xvfb', '/usr/bin/ss'])
      await fs.access(tool);
    nativeDisplay = spawn(
      '/usr/bin/Xvfb',
      [':98', '-screen', '0', '320x240x24', '-nolisten', 'tcp'],
      { stdio: 'ignore' },
    );
    await untilNative(() =>
      fs.stat('/tmp/.X11-unix/X98').then(
        (s) => s.isSocket(),
        () => false,
      ),
    );
    displayBefore = await displayIdentity();
  }
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
  await fs.writeFile(
    '/var/lib/holaday-headed-brave/Default/Sessions/qa-sentinel',
    'synthetic-keep',
  );
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
  if (!nativeRecovery) {
    do {
      starts = (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
      if (starts.length >= 3) break;
      await sleep(30);
    } while (Date.now() - start < 8000);
    assert.equal(starts.length, 3, 'both servers plus forked request handler');
  } else {
    const rootPid = (await rows()).find((r) => r.name === 'holaday-vnc').pid;
    await untilNative(() => nativePortsReady(rootPid));
    heldRfb = await openNativeRfb();
  }
  const before = await rows();
  const target = before.find((r) => r.name === 'holaday-vnc');
  const unrelated = before.find((r) => r.name === 'unrelated');
  const unrelatedBefore = nativeRecovery ? await qaIdentity(unrelated.pid) : null;
  if (nativeRecovery) {
    nativeBefore = await nativeTree(target.pid);
    console.log(
      JSON.stringify({
        marker: 'QA_IPV6_WILDCARD_NOT_PRODUCTION_APPROVED',
        listeners: nativeBefore.listeners,
        productionNetworkParity: false,
        isolation: 'disposable private PID; runner requires network none and no published ports',
      }),
    );
  }
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
    // SYNTHETIC source prerequisite only: fixed production-shaped paths/hashes
    // are not measurements of this QA image or of production. Keep the actual
    // process/default RPC/stop/recovery observations below independent of it.
    const metadataPath = '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info';
    const syntheticSourceFiles = [
      '/usr/bin/unshare',
      '/bin/sh',
      '/usr/bin/mount',
      '/usr/bin/setpriv',
      '/usr/bin/python3',
      '/usr/bin/Xvfb',
      '/opt/brave.com/brave/brave',
      '/opt/brave.com/brave/chrome_crashpad_handler',
      '/opt/holaday-vnc/start.sh',
      '/usr/bin/bash',
      '/usr/bin/x11vnc',
      '/usr/bin/websockify',
      '/usr/bin/pkill',
      '/usr/bin/sleep',
      '/usr/bin/date',
      ...[
        'package.json',
        'lib/God.js',
        'lib/God/ForkMode.js',
        'lib/Utility.js',
        'lib/God/ActionMethods.js',
      ].map((path) => `/usr/lib/node_modules/pm2/${path}`),
      '/usr/lib/python3.10/site.py',
      '/usr/lib/python3.10/importlib/metadata/__init__.py',
      ...['__init__', 'websocket', 'websocketserver', 'websocketproxy', 'websockifyserver'].map(
        (name) => `/usr/lib/python3/dist-packages/websockify/${name}.py`,
      ),
      ...['entry_points.txt', 'PKG-INFO', 'top_level.txt'].map((name) => `${metadataPath}/${name}`),
    ]
      .sort()
      .map((path) => ({
        path,
        resolvedPath: path,
        uid: 0,
        gid: 0,
        mode: 0o755,
        size: 1,
        digest: sha(['SYNTHETIC_QA_SOURCE_NOT_DISK_BYTES', path]),
      }));
    const syntheticWrapper = syntheticSourceFiles.find(
      (row) => row.path === '/opt/holaday-vnc/start.sh',
    );
    const identity = qaIdentity;
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
        processes: all.filter(
          (p) =>
            pinned.has(p.pid) ||
            [daemonPid, process.pid, ...(nativeRecovery ? [nativeDisplay.pid] : [])].includes(
              p.pid,
            ),
        ),
        observer: await identity(process.pid),
        managers,
        pm2Runtime: {
          pid: daemonPid,
          version: '6.0.14',
          killSignal: 'SIGINT',
          killTimeoutMs: 1600,
          sourceDigest: sha('qa-pm2'),
        },
        startup: {
          files: [
            {
              path: syntheticWrapper.path,
              resolved: syntheticWrapper.resolvedPath,
              present: true,
              digest: syntheticWrapper.digest,
              stat: { uid: 0, gid: 0, mode: 0o100755, size: syntheticWrapper.size },
            },
          ],
          directories: [],
          pm2Unit: '',
        },
        nginxFiles: [],
        systemd: '',
        unitFiles: '',
        timers: '',
        cron: '',
        rootCrontabPresent: false,
        listeners: nativeRecovery ? await nativeListeners() : '',
      };
    };
    const original = await snapshot();
    const remote = {
      ...structuredClone(original),
      hostname: 'qa-aliyun',
      ...(nativeRecovery ? { listeners: '' } : {}),
    };
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
          // Permanently retired application ports, not temporary cloud scope.
          // Actual VNC ports remain in the full raw snapshot and independent
          // nativeBefore/stop/restored proofs, including QA IPv6 port5900.
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
            processes: original.processes
              .filter((p) => ids.has(p.pid))
              .sort((a, b) => a.pid - b.pid),
          }),
        };
      });
      const cloudRecoverySources = {
        host: 'vultr',
        hostname: original.hostname,
        bootId,
        files: syntheticSourceFiles,
        roles: scope.map(({ name, pmId }) => ({
          name,
          pmId,
          selectionDigest: sha(['SYNTHETIC_QA_SELECTION_NOT_NATIVE_PROOF', name, pmId]),
        })),
        pythonEntry: {
          metadataPath,
          name: 'websockify',
          version: '0.10.0',
          group: 'console_scripts',
          entry: 'websockify',
          target: 'websockify.websocketproxy:websockify_init',
        },
      };
      validateFirstCutoverCloudSources(cloudRecoverySources, { scope });
      const maintenanceEndsAtMs = Date.now() + 30000;
      const executionSite = {
        binding,
        reviews,
        legacyDigest: proof.legacyDigest,
        cloudMaintenanceScope: scope,
        cloudRecoverySources,
        maintenanceEndsAtMs,
      };
      await journal.bindManifest(manifest);
      await journal.bindExecutionSite(sha(executionSite), scope);
      console.log(
        'VNC_SOURCE_PREREQUISITES_SYNTHETIC: source files/selection/package and wrapper startup metadata are synthetic; whole-site journal binding, current raw-config digests and default PM2 RPC are real. Not native source/capability or production proof.',
      );
      const observer = await createFirstCutoverRetirementObserver(
        { reviews, binding, legacyDigest: proof.legacyDigest, executionSite },
        {
          journal,
          readPair: pair,
          now: Date.now,
          readCloudRecoverySources: async ({ attempt, configs }) => {
            assert.equal(attempt, binding.attempt);
            assert.deepEqual(
              configs.map(({ name, pmId }) => ({ name, pmId })),
              scope.map(({ name, pmId }) => ({ name, pmId })),
            );
            const observed = structuredClone(cloudRecoverySources);
            return {
              ...observed,
              observedAtMs: Date.now(),
              roles: observed.roles.map((role, i) => ({
                ...role,
                configDigest: cutoverRegistrationConfigDigest(configs[i].config),
              })),
            };
          },
        },
      );
      for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
        await journal.persist(phase, { candidate: binding.candidate });
      const configBefore = await rows();
      await observer
        .stopCloudServices(
          { maintenanceEndsAtMs },
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
          if (nativeRecovery)
            assert.deepEqual(
              await displayIdentity(),
              displayBefore,
              'independent prerequisite Xvfb preserved',
            );
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
          assert.equal(
            (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
            bootId,
          );
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
          await journal.persist(phase, {
            candidate: binding.candidate,
            identity: candidateIdentity,
          });
        for (const phase of ['cloud-restore-intent', 'cloud-restored'])
          await journal.recordCloudMaintenanceEvent({
            ...scope[1],
            attempt: binding.attempt,
            inventoryDigest,
            host: 'vultr',
            phase,
          });
        console.log(
          nativeRecovery
            ? 'VNC_RECOVERY_SYNTHETIC_PREREQUISITES: headed events5/6, backup/candidate, business/fences and other-host/source facts are synthetic. VNC tools/display/WS are actual QA; versions differ from Ubuntu production, not production parity or native product VNC preflight.'
            : 'VNC_RECOVERY_SYNTHETIC_PREREQUISITES: headed events5/6, backup/candidate, business/fences, display and other-host/source facts are synthetic; Python substitutes are not actual x11vnc/websockify.',
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
        let logged;
        if (nativeRecovery) {
          const rootPid = (await readFirstCutoverCloudManagers())[0].pid;
          await untilNative(() => nativePortsReady(rootPid));
          heldRfb = await openNativeRfb();
          const facts = await nativeTree((await readFirstCutoverCloudManagers())[0].pid);
          logged = [
            { role: '/usr/bin/x11vnc', pid: facts.roles.x11 },
            { role: '/usr/bin/websockify', pid: facts.roles.web },
            { role: 'handler', pid: facts.roles.handler },
          ];
        } else {
          do {
            replacementLines = (await fs.readFile(log, 'utf8')).trim().split('\n');
            if (replacementLines.length >= 6) break;
            await sleep(30);
          } while (Date.now() < readyBy);
          assert.equal(replacementLines.length, 6);
          assert.deepEqual(replacementLines.slice(0, 3), starts);
          logged = replacementLines.slice(3).map((line) => {
            const [role, pid] = line.split(' ');
            return { role, pid: Number(pid) };
          });
          assert.deepEqual(logged.map((p) => p.role).sort(), [
            '/usr/bin/websockify',
            '/usr/bin/x11vnc',
            'handler',
          ]);
        }
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
            nativeRecovery
              ? 'root wrapper, supervision subshell, actual servers, WS/RFB handler'
              : 'root wrapper, supervision subshell, two substitute servers, forked handler',
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
          if (nativeRecovery) {
            assert.equal(x11.exe, '/usr/bin/x11vnc');
            assert.equal(web.exe, nativePython);
          } else assert.equal(x11.exe, web.exe);
          assert.equal(handler.exe, web.exe);
          for (const p of tree) {
            assert.ok(!oldIds.has(p.pid));
            assert.deepEqual(p.uids, [0, 0, 0, 0]);
            assert.deepEqual(await identity(p.pid), p);
          }
          const repeated = (await readFirstCutoverCloudManagers())[0];
          assert.equal(repeated.pid, row.pid);
          let nativeFacts;
          if (nativeRecovery) {
            nativeFacts = await nativeTree(row.pid);
            assert.deepEqual(nativeFacts.tree, tree);
          }
          assert.equal(
            cutoverRegistrationConfigDigest(repeated.pm2_env),
            configProof.recoveredConfigDigest,
          );
          if (!nativeRecovery)
            assert.equal(
              (await fs.readFile(log, 'utf8')).trim().split('\n').length,
              6,
              'no extra substitute lifetime',
            );
          assert.deepEqual(await journal.assertOwnership(), binding);
          assert.deepEqual(await journal.readFirstCutoverEffects(), intent);
          assert.ok(Date.now() < input.maintenanceEndsAtMs);
          return { pid: row.pid, tree, configProof, ...(nativeRecovery ? { nativeFacts } : {}) };
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
            servers: nativeRecovery
              ? 'actual x11vnc/websockify and held binary WS/RFB handler'
              : 'Python control-flow substitutes; not actual x11vnc/websockify',
            ...(nativeRecovery
              ? { productionVersionParity: false, nativeProductVncPreflight: false }
              : {}),
            synthetic: [
              'headed recovery5/6',
              'backup/candidate',
              nativeRecovery ? 'business/fence' : 'business/fence/display',
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
    if (nativeRecovery) {
      assert.deepEqual(await qaIdentity(unrelated.pid), unrelatedBefore);
      assert.deepEqual(await displayIdentity(), displayBefore);
      for (const p of nativeBefore.tree)
        assert.notEqual(
          (await qaIdentity(p.pid))?.start,
          p.start,
          'actual old VNC wrapper/server/handler identity gone',
        );
      assert.deepEqual(
        tcpListeners(await nativeListeners()).filter(
          (r) =>
            nativeBefore.listeners.some((old) => old.port === r.port) ||
            r.owners.some((pid) => nativeBefore.tree.some((p) => p.pid === pid)),
        ),
        [],
        'actual old VNC listener ports closed',
      );
      await untilNative(async () => heldRfb.socket.readyState === WebSocket.CLOSED);
      console.log(
        JSON.stringify({
          mode: process.argv[2],
          oldNativeTreeGone: true,
          oldListenersGone: true,
          oldRfbClosed: true,
        }),
      );
    } else {
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
    }
    assert.equal(
      await fs.readFile('/var/lib/holaday-headed-brave/Default/Sessions/qa-sentinel', 'utf8'),
      'synthetic-keep',
    );
    console.log(
      'VNC_PM2_TREE_PASS: one numeric-id stop, bounded escalation, forked handler gone, no restart, unrelated/profile preserved',
    );
  }
} catch (error) {
  if (nativeRecovery) await nativeFailureDiagnostics(error);
  throw error;
} finally {
  if (nativeRecovery) {
    // Isolated QA teardown AFTER success/failure assertions, never helps stop pass.
    for (const socket of nativeSockets) socket.close();
    try {
      await pm2('kill');
    } finally {
      if (nativeDisplay?.exitCode === null && nativeDisplay.signalCode === null) {
        nativeDisplay.kill('SIGTERM');
        const deadline = performance.now() + 2000;
        while (
          nativeDisplay.exitCode === null &&
          nativeDisplay.signalCode === null &&
          performance.now() < deadline
        )
          await sleep(50);
        if (nativeDisplay.exitCode === null && nativeDisplay.signalCode === null)
          nativeDisplay.kill('SIGKILL');
      }
    }
  }
}
