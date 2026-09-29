// Reviewed legacy VNC lifecycle under the ORIGINAL PM2 stop mechanism.
// Only run in the existing disposable Linux image with a private PID namespace.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
const exec = promisify(execFile);
// PM2 TreeKill silently falls back to killing only the root when ps is absent.
// Fail BEFORE starting any fixture process if real procps tools are unavailable.
for (const tool of ['/usr/bin/ps', '/usr/bin/pkill']) {
  const { stdout } = await exec(tool, ['--version']);
  assert.match(stdout, /procps/, `${tool} must be the real procps executable`);
}
assert.equal(process.argv.length, 2);
const pm2 = async (...args) =>
  (
    await exec('/opt/node22/bin/node', ['/opt/node22/lib/node_modules/pm2/bin/pm2', ...args], {
      env: { PATH: '/opt/node22/bin:/usr/bin:/bin', HOME: '/root', PM2_HOME: '/tmp/vnc-pm2' },
      maxBuffer: 1024 * 1024,
    })
  ).stdout;
const log = '/tmp/vnc-qa-starts';
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
  '/tmp/legacy-vnc.sh',
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
await fs.mkdir('/var/lib/holaday-headed-brave/Default/Sessions', { recursive: true });
await fs.writeFile('/var/lib/holaday-headed-brave/Default/Sessions/qa-sentinel', 'synthetic-keep');
await pm2('start', '/bin/sleep', '--name', 'unrelated', '--interpreter', 'none', '--', '300');
await pm2(
  'start',
  '/tmp/legacy-vnc.sh',
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
await pm2('stop', String(target.pm_id));
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
