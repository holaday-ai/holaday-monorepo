import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  observeMaintenanceRuntime,
  createMaintenanceStopEffects,
} from './browser-maintenance-linux.mjs';
import { retireMaintenanceRuntime } from './browser-maintenance-runtime.mjs';

const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const root = `/opt/holaday-releases/${identity.candidate}`;
const cwd = `${root}/apps/orchestrator`;
function fixture() {
  // Linux /proc/stat field 22 is starttime, even when comm contains spaces/').
  const stat = (pid, start) =>
    `${pid} (node ) loader) S ${Array(18).fill('0').join(' ')} ${start} 0 0\n`;
  const files = new Map([
    ['/proc/101/cmdline', `/opt/node22/bin/node\0--import\0tsx\0${cwd}/src/index.ts\0`],
    ['/proc/101/stat', stat(101, '987654')],
    ['/proc/101/status', 'Name:\tnode\nUid:\t998\t998\t998\t998\n'],
    ['/proc/102/cmdline', '/usr/sbin/nginx\0'],
  ]);
  const links = new Map([['/proc/101/cwd', cwd]]);
  const rows = [
    {
      name: 'holaday-orchestrator',
      pid: 101,
      pm2_env: {
        status: 'online',
        autorestart: false,
        watch: false,
        max_memory_restart: 0,
        cron_restart: null,
        pm_cwd: cwd,
        HOLADAY_ORDINARY_MAINTENANCE: '1',
        HOLADAY_ORDINARY_CANDIDATE: identity.candidate,
      },
    },
  ];
  const commands = [];
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const io = {
    platform: 'linux',
    uid: 0,
    readdir: async (path) => {
      assert.equal(path, '/proc');
      return ['self', '101', '102'];
    },
    readFile: async (path) => {
      if (!files.has(path)) throw missing();
      return files.get(path);
    },
    readlink: async (path) => {
      if (!links.has(path)) throw missing();
      return links.get(path);
    },
    exec: async (command, args) => {
      commands.push([command, args]);
      if (command === 'pm2' && args.join(' ') === 'jlist') return JSON.stringify(rows);
      if (command === 'ss' && ['sport = :4001', 'sport = :4002'].includes(args.at(-1)))
        return 'LISTEN 0 511 *:4001 *:* users:(("node",pid=101,fd=27))\n';
      throw new Error('UNEXPECTED_COMMAND');
    },
  };
  return { files, rows, commands, io, stat, links };
}

test('reads real-shaped proc/PM2/socket output into exact non-root instance proof', async () => {
  const f = fixture();
  const result = await observeMaintenanceRuntime(identity, f.io);
  assert.deepEqual(result, {
    identity,
    root,
    main: {
      pid: 101,
      start: '987654',
      uid: 998,
      cwd,
      command: 'main',
      autorestart: false,
    },
    worker: null,
  });
  assert.deepEqual(
    f.commands.map(([cmd, args]) => [cmd, args[0]]),
    [
      ['pm2', 'jlist'],
      ['ss', '-H'],
      ['ss', '-H'],
    ],
  );
});

test('refuses reused PID observed during proc sampling', async () => {
  const f = fixture();
  const read = f.io.readFile;
  let reads = 0;
  f.io.readFile = async (path) =>
    path === '/proc/101/stat' && ++reads > 1 ? f.stat(101, '999999') : read(path);
  await assert.rejects(observeMaintenanceRuntime(identity, f.io), /MAINTENANCE_PROCESS_IDENTITY/);
});

test('unreadable process or unidentified listening socket is not an empty proof', async () => {
  for (const kind of ['permission', 'anonymous-port', 'malformed-manager']) {
    const f = fixture();
    if (kind === 'permission') {
      const read = f.io.readFile;
      f.io.readFile = async (path) => {
        if (path === '/proc/101/status')
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return read(path);
      };
    } else {
      const exec = f.io.exec;
      f.io.exec = async (cmd, args) =>
        cmd === (kind === 'anonymous-port' ? 'ss' : 'pm2')
          ? kind === 'anonymous-port'
            ? 'LISTEN 0 511 *:4001 *:*\n'
            : '{}'
          : exec(cmd, args);
    }
    await assert.rejects(observeMaintenanceRuntime(identity, f.io), {
      message:
        kind === 'permission'
          ? 'MAINTENANCE_PROC_READ_UNPROVEN'
          : kind === 'anonymous-port'
            ? 'MAINTENANCE_PORT_OWNER_UNPROVEN'
            : 'MAINTENANCE_MANAGER_UNPROVEN',
    });
  }
});

test('detects an orphan app in another checkout instead of only scanning PM2 pid', async () => {
  const f = fixture();
  const other = '/opt/old-release/apps/orchestrator';
  f.files.set('/proc/102/cmdline', `/opt/node22/bin/node\0${other}/src/index.ts\0`);
  f.files.set('/proc/102/stat', f.stat(102, '654321'));
  f.files.set('/proc/102/status', 'Uid:\t998\t998\t998\t998\n');
  f.links.set('/proc/102/cwd', other);
  await assert.rejects(observeMaintenanceRuntime(identity, f.io), /MAINTENANCE_RUNTIME_UNPROVEN/);
});

test('non-Linux, non-root and invalid identity refuse before invoking commands', async () => {
  for (const change of [{ platform: 'darwin' }, { uid: 998 }, { invalidIdentity: true }]) {
    const f = fixture();
    await assert.rejects(
      observeMaintenanceRuntime(change.invalidIdentity ? {} : identity, { ...f.io, ...change }),
      {
        message: change.invalidIdentity
          ? 'MAINTENANCE_IDENTITY_MISMATCH'
          : change.platform
            ? 'MAINTENANCE_LINUX_REQUIRED'
            : 'MAINTENANCE_ROOT_REQUIRED',
      },
    );
    assert.deepEqual(f.commands, []);
  }
});

test('real stop adapter delegates one pinned TERM and requires actual disappearance plus free ports', async () => {
  const f = fixture();
  const observed = await observeMaintenanceRuntime(identity, f.io);
  const base = f.io.exec;
  let signalled = false;
  f.io.exec = async (command, args) => {
    if (command === '/usr/bin/python3') {
      assert.ok(args[0].endsWith('/browser-maintenance-signal.py'));
      assert.deepEqual(args.slice(1), ['101', '987654', cwd, 'main']);
      signalled = true;
      f.files.delete('/proc/101/cmdline');
      f.files.delete('/proc/101/stat');
      f.rows[0].pid = 0;
      f.rows[0].pm2_env.status = 'stopped';
      f.commands.push([command, args]);
      return '';
    }
    if (command === 'ss' && signalled) return '';
    return base(command, args);
  };
  await retireMaintenanceRuntime({
    ...observed,
    receipt: {
      protocol: 1,
      identity,
      mode: 'closed',
      needsReconciliation: false,
      idle: true,
    },
    deadlineMs: 5000,
    effects: createMaintenanceStopEffects(f.io),
  });
  assert.equal(f.commands.filter(([command]) => command === '/usr/bin/python3').length, 1);
  assert.equal(
    f.commands.some(([command, args]) => command === 'pm2' && args[0] !== 'jlist'),
    false,
  );
});

test('stop adapter refuses live PID with replaced command instead of calling it exited', async () => {
  const f = fixture();
  f.files.set('/proc/101/cmdline', '/usr/sbin/nginx\0');
  await assert.rejects(createMaintenanceStopEffects(f.io).readProcess(101), {
    message: 'MAINTENANCE_PROCESS_IDENTITY',
  });
});

test('stopped PM2 record with autorestart or another candidate is not a stop proof', async () => {
  for (const fault of ['autorestart', 'candidate', 'watch', 'memory']) {
    const f = fixture();
    const observed = await observeMaintenanceRuntime(identity, f.io);
    f.rows[0].pid = 0;
    f.rows[0].pm2_env.status = 'stopped';
    if (fault === 'autorestart') f.rows[0].pm2_env.autorestart = true;
    if (fault === 'candidate') f.rows[0].pm2_env.HOLADAY_ORDINARY_CANDIDATE = 'c'.repeat(40);
    if (fault === 'watch') f.rows[0].pm2_env.watch = true;
    if (fault === 'memory') f.rows[0].pm2_env.max_memory_restart = 512;
    assert.equal(
      await createMaintenanceStopEffects(f.io).managerStopped('main', observed.main),
      false,
    );
  }
});
