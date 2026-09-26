// Component check in a disposable, private-PID Linux container. Real /proc,
// not a complete host/PM2/nginx or release rehearsal; command readers are stubs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { readCutoverHostSnapshot } from '/source/browser-cutover-evidence.mjs';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
const groups = [];
const tree = async () => {
  const shell = spawn('/bin/sh', ['-c', 'sleep 600 & printf "%s\\n" "$!"; wait'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  groups.push(shell);
  const exited = once(shell, 'exit');
  shell.exited = exited;
  let buffer = '';
  for await (const chunk of shell.stdout) {
    buffer += chunk;
    if (buffer.includes('\n')) break;
  }
  const leaf = Number(buffer.trim());
  assert.ok(Number.isSafeInteger(leaf) && leaf > 1);
  assert.match(
    await fs.readFile(`/proc/${leaf}/status`, 'utf8'),
    new RegExp(`PPid:\\s+${shell.pid}\\n`),
  );
  return { shell: shell.pid, leaf };
};
try {
  const child = await tree();
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid(),
    now: Date.now,
    exec: async (command) => (command === 'pm2' ? '[]' : ''),
    nginxSnapshot: async () => ({ dump: 'synthetic nginx', files: [] }),
  };
  const snapshot = await readCutoverHostSnapshot(io);
  const shell = snapshot.processes.find((p) => p.pid === child.shell);
  const leaf = snapshot.processes.find((p) => p.pid === child.leaf);
  assert.equal(shell.ppid, process.pid);
  assert.equal(leaf.ppid, child.shell);
  assert.match(shell.exe, /\/(?:dash|bash|sh)$/);
  assert.match(leaf.exe, /\/sleep$/);
  assert.ok(snapshot.processes.some((p) => p.pid === process.pid));

  // Mutate only this fixture's own process family between the two observations.
  await assert.rejects(
    readCutoverHostSnapshot({
      ...io,
      exec: async (command) => {
        if (command === 'crontab') await tree();
        return io.exec(command);
      },
    }),
    /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
  );
  process.stdout.write(
    'real Linux proc: shell and sleep descendants retained; new child rejected\n',
  );
} finally {
  for (const child of groups.reverse()) {
    // Only the dedicated group created above, never a host or shared PM2 group.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        process.stderr.write('fixture process-group cleanup failed\n');
        process.exitCode = 1;
      }
    }
    await child.exited;
  }
}
