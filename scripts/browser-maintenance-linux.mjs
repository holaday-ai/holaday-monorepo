import { readFile, readlink, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { captureMaintenanceProcesses } from './browser-maintenance-runtime-system.mjs';

export function createMaintenanceStopEffects(io = system) {
  requireLinuxRoot(io);
  return {
    now: () => performance.now(),
    sleep,
    readProcess: (pid) => readProcess(pid, io, true),
    signal: async (pid, signal, original) => {
      if (signal !== 'SIGTERM' || pid !== original?.pid)
        throw new Error('MAINTENANCE_SIGNAL_INPUT');
      // The helper pins a kernel process descriptor before validating identity.
      // No numeric-PID kill or PM2 stop/delete fallback is permitted.
      try {
        await io.exec('/usr/bin/python3', [
          fileURLToPath(new URL('./browser-maintenance-signal.py', import.meta.url)),
          String(pid),
          original.start,
          original.cwd,
          original.command,
        ]);
      } catch {
        throw new Error('MAINTENANCE_SIGNAL_UNPROVEN');
      }
    },
    managerStopped: async (role, original) => {
      const name = role === 'main' ? 'holaday-orchestrator' : 'holaday-account-closure-worker';
      const matches = (await readRows(io)).filter((row) => row?.name === name);
      if (!matches.length) return true;
      if (matches.length !== 1 || !original) return false;
      const { pid, pm2_env: env } = matches[0];
      return (
        pid === 0 &&
        ['stopped', 'errored'].includes(env?.status) &&
        env.autorestart === false &&
        !env.watch &&
        !env.max_memory_restart &&
        !env.cron_restart &&
        env.pm_cwd === original.cwd &&
        env.HOLADAY_ORDINARY_MAINTENANCE === '1' &&
        `/opt/holaday-releases/${env.HOLADAY_ORDINARY_CANDIDATE}/apps/orchestrator` === original.cwd
      );
    },
    portsFree: async () => {
      const ports = await readListeners(io);
      return ports[4001].length === 0 && ports[4002].length === 0;
    },
  };
}

const execFileAsync = promisify(execFile);
const system = {
  platform: process.platform,
  uid: process.getuid?.(),
  readFile,
  readlink,
  readdir,
  exec: async (command, args) =>
    (
      await execFileAsync(command, args, {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PM2_HOME: '/root/.pm2' },
      })
    ).stdout,
};
function requireLinuxRoot(io) {
  if (io.platform !== 'linux') throw new Error('MAINTENANCE_LINUX_REQUIRED');
  if (io.uid !== 0) throw new Error('MAINTENANCE_ROOT_REQUIRED');
}
function parseStart(stat, pid) {
  const text = String(stat);
  if (!text.startsWith(`${pid} (`)) throw new Error('MAINTENANCE_PROCESS_IDENTITY');
  // comm can contain ')' and spaces; parse only fields after its final ')'.
  const fields = text
    .slice(text.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  if (!/^[0-9]+$/.test(fields[19] ?? '')) throw new Error('MAINTENANCE_PROCESS_IDENTITY');
  return fields[19];
}
function classify(args, cwd) {
  // Match every application entry, including legacy/other-checkout orphans.
  // Do not mistake an arbitrary script mentioning index.ts for our process.
  for (const arg of args.slice(1)) {
    const path = arg.startsWith('/') ? arg : `${cwd}/${arg.replace(/^\.\//, '')}`;
    if (/\/apps\/orchestrator\/(src\/index\.ts|dist\/index\.js)$/.test(path)) return 'main';
    if (/\/apps\/orchestrator\/dist\/account-closure\/worker-entry\.js$/.test(path))
      return 'worker';
  }
  return null;
}
async function readProcess(pid, io, strict = false) {
  const directory = `/proc/${pid}`;
  try {
    const args = String(await io.readFile(`${directory}/cmdline`))
      .split('\0')
      .filter(Boolean);
    if (!args.length) {
      if (strict) throw new Error('MAINTENANCE_PROCESS_IDENTITY');
      return null;
    }
    // Avoid requiring cwd for unrelated kernel/system processes.
    const possible = args.some((arg) => /(?:index\.(?:ts|js)|worker-entry\.js)$/.test(arg));
    if (!possible) {
      if (strict) throw new Error('MAINTENANCE_PROCESS_IDENTITY');
      return null;
    }
    const before = parseStart(await io.readFile(`${directory}/stat`), pid);
    const cwd = await io.readlink(`${directory}/cwd`);
    const command = classify(args, cwd);
    if (!command) {
      if (strict) throw new Error('MAINTENANCE_PROCESS_IDENTITY');
      return null;
    }
    const status = String(await io.readFile(`${directory}/status`));
    const uids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
    if (!uids || new Set(uids.slice(1)).size !== 1) throw new Error('MAINTENANCE_PROCESS_IDENTITY');
    if (before !== parseStart(await io.readFile(`${directory}/stat`), pid))
      throw new Error('MAINTENANCE_PROCESS_IDENTITY');
    return { pid, start: before, cwd, command, uid: Number(uids[1]), autorestart: false };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') {
      if (strict) {
        // A missing cwd/cmdline alone is not proof that the process exited.
        try {
          await io.readFile(`${directory}/stat`);
        } catch (probeError) {
          if (probeError?.code === 'ENOENT' || probeError?.code === 'ESRCH') return null;
          throw new Error('MAINTENANCE_PROC_READ_UNPROVEN');
        }
        throw new Error('MAINTENANCE_PROCESS_IDENTITY');
      }
      return null;
    }
    if (error?.message === 'MAINTENANCE_PROCESS_IDENTITY') throw error;
    throw new Error('MAINTENANCE_PROC_READ_UNPROVEN');
  }
}
async function readRows(io) {
  try {
    const rows = JSON.parse(await io.exec('pm2', ['jlist']));
    if (!Array.isArray(rows)) throw new Error('invalid');
    return rows;
  } catch {
    throw new Error('MAINTENANCE_MANAGER_UNPROVEN');
  }
}
async function readListeners(io) {
  const result = {};
  for (const port of [4001, 4002]) {
    let text;
    try {
      text = await io.exec('ss', ['-H', '-ltnp', `sport = :${port}`]);
    } catch {
      throw new Error('MAINTENANCE_PORT_OWNER_UNPROVEN');
    }
    const owners = new Set();
    for (const line of String(text)
      .split('\n')
      .filter((line) => line.trim())) {
      const matches = [...line.matchAll(/pid=([1-9][0-9]*)/g)];
      if (!matches.length) throw new Error('MAINTENANCE_PORT_OWNER_UNPROVEN');
      for (const match of matches) owners.add(Number(match[1]));
    }
    result[port] = [...owners];
  }
  return result;
}

/** Read only. Never treats inaccessible observations as empty process lists. */
export async function observeMaintenanceRuntime(identity, io = system) {
  requireLinuxRoot(io);
  if (
    !/^[a-f0-9]{40}$/.test(identity?.candidate ?? '') ||
    !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '')
  )
    throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
  return captureMaintenanceProcesses({
    identity,
    root: `/opt/holaday-releases/${identity.candidate}`,
    ...(await inspectMaintenanceSystem(io)),
  });
}

export async function inspectMaintenanceSystem(io = system) {
  requireLinuxRoot(io);
  const rows = await readRows(io);
  const processes = [];
  let entries;
  try {
    entries = await io.readdir('/proc');
  } catch {
    throw new Error('MAINTENANCE_PROC_READ_UNPROVEN');
  }
  for (const entry of entries) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    const observed = await readProcess(Number(entry), io);
    if (observed) processes.push(observed);
  }
  return {
    rows,
    processes,
    listeners: await readListeners(io),
  };
}
