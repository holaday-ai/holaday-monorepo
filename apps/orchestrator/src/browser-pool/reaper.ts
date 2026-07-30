/**
 * Orphan-process reaper for the browser pool.
 *
 * Called once at orchestrator startup. If a previous orchestrator
 * crashed without running shutdown() we'll have zombie Brave / Xvfb
 * / x11vnc / websockify processes hanging off the per-user data
 * dirs. Without this sweep the next allocate() will race over port
 * collisions and Singleton locks.
 *
 * Strategy: walk the process list, match anything whose command line
 * references `${config.baseDir}/task_*` or uses an Xvfb display /
 * port inside our configured range, and SIGTERM → (grace) → SIGKILL
 * them. We do NOT touch the legacy holaday-chromium-headed
 * singleton's ports (9223, 5901, 6080) — those stay pm2-managed.
 *
 * Worst case this is a no-op (fresh boot). Best case it lets us
 * recover cleanly from a crash without manual ssh + kill.
 */

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import type { Logger } from 'pino';
import type { PoolConfig } from './types.js';

const GRACE_MS = 2_000;

export interface ProcessEntry {
  pid: number;
  command: string;
}

/** Best-effort parse of /proc/<pid>/cmdline (Linux). Empty on error. */
async function readCmdline(pid: number): Promise<string> {
  try {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(`/proc/${pid}/cmdline`);
    // cmdline is NUL-separated argv; join with spaces for grep.
    return buf.toString('utf8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

/** List all processes visible in /proc on Linux. */
async function listProcProcesses(): Promise<ProcessEntry[]> {
  try {
    const entries = await readdir('/proc');
    const processes: ProcessEntry[] = [];
    for (const entry of entries) {
      const pid = Number.parseInt(entry, 10);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const command = await readCmdline(pid);
      if (command) processes.push({ pid, command });
    }
    return processes;
  } catch {
    return [];
  }
}

export function parsePsProcessList(output: string): ProcessEntry[] {
  const processes: ProcessEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1]!, 10);
    const command = match[2]!;
    if (Number.isInteger(pid) && pid > 0 && command) {
      processes.push({ pid, command });
    }
  }
  return processes;
}

async function listPsProcesses(): Promise<ProcessEntry[]> {
  return await new Promise((resolve) => {
    execFile(
      'ps',
      ['-axo', 'pid=,command='],
      { maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? [] : parsePsProcessList(stdout));
      },
    );
  });
}

async function listProcesses(): Promise<ProcessEntry[]> {
  const procProcesses = await listProcProcesses();
  if (procProcesses.length > 0) return procProcesses;
  return await listPsProcesses();
}

function matchesPool(cmd: string, config: PoolConfig): boolean {
  // Any process whose argv mentions our base dir is ours.
  if (cmd.includes(config.baseDir)) return true;
  // Xvfb on a display in our range (format: "Xvfb :123 -screen ...")
  const xvfbMatch = /(?:^|\s)Xvfb\s+:(\d+)/.exec(cmd);
  if (xvfbMatch) {
    const d = Number.parseInt(xvfbMatch[1] ?? '-1', 10);
    if (
      d >= config.displayStart &&
      d < config.displayStart + config.maxInstances
    ) {
      return true;
    }
  }
  // x11vnc -rfbport N with N in our range
  const rfbMatch = /-rfbport\s+(\d+)/.exec(cmd);
  if (rfbMatch) {
    const p = Number.parseInt(rfbMatch[1] ?? '-1', 10);
    if (
      p >= config.vncPortStart &&
      p < config.vncPortStart + config.maxInstances
    ) {
      return true;
    }
  }
  // websockify's first positional arg is "127.0.0.1:<port>". Match it
  // when the arg uses our websockify port range.
  const wsMatch = /websockify\s+(?:127\.0\.0\.1:)?(\d+)/.exec(cmd);
  if (wsMatch) {
    const p = Number.parseInt(wsMatch[1] ?? '-1', 10);
    if (
      p >= config.wsPortStart &&
      p < config.wsPortStart + config.maxInstances
    ) {
      return true;
    }
  }
  return false;
}

export function findOrphanProcessIds(
  processes: readonly ProcessEntry[],
  config: PoolConfig,
  selfPid = process.pid,
): number[] {
  return processes
    .filter(({ pid, command }) => pid !== selfPid && matchesPool(command, config))
    .map(({ pid }) => pid);
}

export function signalProcessOrGroup(
  pid: number,
  signal: NodeJS.Signals,
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill,
): boolean {
  try {
    kill(-pid, signal);
    return true;
  } catch {
    try {
      kill(pid, signal);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }
}

export interface ReaperResult {
  scanned: number;
  killed: number;
  pids: number[];
}

export async function reapOrphans(
  config: PoolConfig,
  logger: Logger,
): Promise<ReaperResult> {
  const processes = await listProcesses();
  const victims = findOrphanProcessIds(processes, config);
  const commandsByPid = new Map(
    processes.map(({ pid, command }) => [pid, command]),
  );
  for (const pid of victims) {
    const command = commandsByPid.get(pid) ?? '';
    logger.info({ pid, cmd: command.slice(0, 160) }, 'reaper: orphan match');
  }
  if (victims.length === 0) {
    logger.info({ scanned: processes.length }, 'reaper: no orphans found');
    return { scanned: processes.length, killed: 0, pids: [] };
  }

  for (const pid of victims) {
    signalProcessOrGroup(pid, 'SIGTERM');
  }
  await new Promise((r) => setTimeout(r, GRACE_MS));
  for (const pid of victims) {
    signalProcessOrGroup(pid, 'SIGKILL');
  }
  logger.warn(
    { killed: victims.length, pids: victims },
    'reaper: terminated orphaned pool processes',
  );
  return { scanned: processes.length, killed: victims.length, pids: victims };
}
