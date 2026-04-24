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
 * references `${config.baseDir}/user_*` or uses an Xvfb display /
 * port inside our configured range, and SIGTERM → (grace) → SIGKILL
 * them. We do NOT touch the legacy holaday-chromium-headed
 * singleton's ports (9223, 5901, 6080) — those stay pm2-managed.
 *
 * Worst case this is a no-op (fresh boot). Best case it lets us
 * recover cleanly from a crash without manual ssh + kill.
 */

import { readdir } from 'node:fs/promises';
import type { Logger } from 'pino';
import type { PoolConfig } from './types.js';

const GRACE_MS = 2_000;

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

/** List all PIDs visible in /proc. */
async function listPids(): Promise<number[]> {
  try {
    const entries = await readdir('/proc');
    const pids: number[] = [];
    for (const entry of entries) {
      const n = Number.parseInt(entry, 10);
      if (Number.isInteger(n) && n > 0) pids.push(n);
    }
    return pids;
  } catch {
    return [];
  }
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

export interface ReaperResult {
  scanned: number;
  killed: number;
  pids: number[];
}

export async function reapOrphans(
  config: PoolConfig,
  logger: Logger,
): Promise<ReaperResult> {
  const pids = await listPids();
  const victims: number[] = [];
  for (const pid of pids) {
    if (pid === process.pid) continue; // don't reap ourselves
    const cmd = await readCmdline(pid);
    if (!cmd) continue;
    if (matchesPool(cmd, config)) {
      victims.push(pid);
      logger.info({ pid, cmd: cmd.slice(0, 160) }, 'reaper: orphan match');
    }
  }
  if (victims.length === 0) {
    logger.info({ scanned: pids.length }, 'reaper: no orphans found');
    return { scanned: pids.length, killed: 0, pids: [] };
  }

  for (const pid of victims) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // ESRCH = gone already; keep going
    }
  }
  await new Promise((r) => setTimeout(r, GRACE_MS));
  for (const pid of victims) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* noop */
    }
  }
  logger.warn(
    { killed: victims.length, pids: victims },
    'reaper: terminated orphaned pool processes',
  );
  return { scanned: pids.length, killed: victims.length, pids: victims };
}
