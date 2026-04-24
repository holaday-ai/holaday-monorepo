/**
 * BrowserPool — per-user Xvfb + Brave + x11vnc + websockify quartets.
 *
 * Phase 8 multi-tenant browser isolation. On allocate(userId):
 *   1. Reserve a slot (deterministic port + display)
 *   2. Spawn Xvfb → wait for DISPLAY to come up
 *   3. Spawn Brave pointed at that display + a per-user data dir
 *   4. Spawn x11vnc + websockify for the VNC stream
 *   5. Connect a fresh PlaywrightExecutor to the new CDP port
 *   6. Stash everything in the registry and return
 *
 * On release:
 *   - Kill the four sidecars (SIGTERM → 3 s grace → SIGKILL)
 *   - Disconnect the executor
 *   - Free the slot
 *   - Preserve the user-data-dir so next allocate() restores logins
 *
 * Idle GC:
 *   - Timer ticks every 60 s; any instance with lastActiveAt older
 *     than idleTimeoutMs gets released.
 *
 * Capacity:
 *   - Hard cap on concurrent instances (MAX_BROWSER_INSTANCES).
 *     allocate() throws a typed error when full so the caller can
 *     surface a clear "service busy, retry in a bit" to the user.
 *
 * Not covered here (later phases): nginx / orchestrator VNC routing,
 * per-user rate limits, user-data-dir quotas. This class's single
 * job is lifecycle of the four OS processes + the executor handle.
 */

import { mkdirSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import type { Logger } from 'pino';
import { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import { SlotAllocator } from './port-allocator.js';
import {
  spawnBrave,
  spawnWebsockify,
  spawnX11vnc,
  spawnXvfb,
  waitForCdpReady,
  type SpawnedProcess,
} from './spawn.js';
import type {
  BrowserInstance,
  BrowserSlot,
  PoolConfig,
  PoolStats,
} from './types.js';

/** Thrown by allocate() when capacity is reached. Callers should
 *  map this to a 503-equivalent user-facing error, not a 500. */
export class PoolCapacityError extends Error {
  constructor(public readonly capacity: number) {
    super(`browser pool at capacity (${capacity} instances)`);
    this.name = 'PoolCapacityError';
  }
}

const GC_INTERVAL_MS = 60_000;
const KILL_GRACE_MS = 3_000;

interface InFlightAllocation {
  userId: string;
  promise: Promise<BrowserInstance>;
}

export class BrowserPool {
  private readonly instances = new Map<string, BrowserInstance>();
  private readonly allocator: SlotAllocator;
  /** De-dupe concurrent allocate() calls for the same userId. */
  private readonly inFlight = new Map<string, InFlightAllocation>();
  private gcTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(
    private readonly config: PoolConfig,
    private readonly logger: Logger,
  ) {
    this.allocator = new SlotAllocator(config);
    mkdirSync(config.baseDir, { recursive: true });
  }

  /**
   * Get (or create) the browser instance bound to this user. Idempotent
   * — concurrent callers racing on the same userId will all resolve to
   * the same instance. A newly-returned instance has status='ready'
   * and its CDP port is reachable.
   */
  async allocate(userId: string): Promise<BrowserInstance> {
    if (this.shuttingDown) {
      throw new Error('BrowserPool: shutting down, cannot allocate');
    }
    const existing = this.instances.get(userId);
    if (existing && existing.status === 'ready') {
      existing.lastActiveAt = Date.now();
      return existing;
    }
    const pending = this.inFlight.get(userId);
    if (pending) return pending.promise;

    const promise = this.spawnInstance(userId);
    this.inFlight.set(userId, { userId, promise });
    try {
      const instance = await promise;
      return instance;
    } finally {
      this.inFlight.delete(userId);
    }
  }

  /**
   * Bump the per-user last-active timestamp — callers invoke this
   * every time they hand a tool call to the underlying executor so
   * the GC doesn't reap an actively-running task.
   */
  touch(userId: string): void {
    const inst = this.instances.get(userId);
    if (inst) inst.lastActiveAt = Date.now();
  }

  /**
   * Tear down one user's quartet. Safe to call on unknown userIds
   * (no-op). Returns true if something was released.
   */
  async release(userId: string, reason = 'manual'): Promise<boolean> {
    const inst = this.instances.get(userId);
    if (!inst) return false;
    if (inst.status === 'draining') return false;
    inst.status = 'draining';
    this.logger.info({ userId, reason, cdpPort: inst.cdpPort }, 'pool: release');
    await this.tearDownInstance(inst).catch((err) => {
      this.logger.warn(
        { userId, err: err instanceof Error ? err.message : String(err) },
        'pool: teardown error (continuing)',
      );
    });
    this.allocator.release({
      index: inst.index,
      display: inst.display,
      cdpPort: inst.cdpPort,
      vncPort: inst.vncPort,
      wsPort: inst.wsPort,
    });
    this.instances.delete(userId);
    return true;
  }

  /**
   * Snapshot of pool state for /trpc/health and ops dashboards.
   */
  stats(): PoolStats {
    const byUser = Array.from(this.instances.values()).map((inst) => ({
      userId: inst.userId,
      cdpPort: inst.cdpPort,
      status: inst.status,
      lastActiveAt: inst.lastActiveAt,
      createdAt: inst.createdAt,
    }));
    const active = byUser.filter((u) => u.status === 'ready').length;
    const idle = this.allocator.availableCount();
    return { active, idle, capacity: this.config.maxInstances, byUser };
  }

  /** Look up an instance without touching lastActiveAt. */
  peek(userId: string): BrowserInstance | null {
    return this.instances.get(userId) ?? null;
  }

  /** Start the idle-timeout GC loop. Safe to call multiple times. */
  startGc(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => {
      void this.runGcSweep();
    }, GC_INTERVAL_MS);
    // A setInterval keeps the event loop alive. We don't need that —
    // the HTTP server is what keeps the orchestrator up — so unref so
    // shutdown isn't delayed by a sleeping GC timer.
    this.gcTimer.unref?.();
  }

  stopGc(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /**
   * Kill every instance. Used during orchestrator shutdown. Parallel
   * to make a 5-instance teardown under 5s even if one Brave is
   * mis-behaving.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stopGc();
    const userIds = Array.from(this.instances.keys());
    await Promise.all(userIds.map((id) => this.release(id, 'shutdown')));
  }

  private async runGcSweep(): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.config.idleTimeoutMs;
    const stale: string[] = [];
    for (const inst of this.instances.values()) {
      if (inst.status !== 'ready') continue;
      if (inst.lastActiveAt < cutoff) stale.push(inst.userId);
    }
    if (stale.length === 0) return;
    this.logger.info(
      { count: stale.length, userIds: stale },
      'pool: gc — releasing idle instances',
    );
    await Promise.all(stale.map((id) => this.release(id, 'idle-timeout')));
  }

  /**
   * The real spawn path. Broken out so allocate() can wrap it in
   * inFlight de-dup without growing nested try/finally.
   */
  private async spawnInstance(userId: string): Promise<BrowserInstance> {
    if (this.allocator.isFull()) {
      throw new PoolCapacityError(this.config.maxInstances);
    }
    const slot: BrowserSlot = this.allocator.claim();
    const userDataDir = pathJoin(this.config.baseDir, userIdToDirName(userId));

    this.logger.info(
      { userId, ...slot, userDataDir },
      'pool: spawning quartet',
    );

    // Best-effort cleanup of Singleton* lockfiles from a prior run —
    // Brave refuses to start on a profile that still shows a lock.
    // Ignore errors (file may not exist; dir may be fresh).
    try {
      mkdirSync(userDataDir, { recursive: true });
      const { rmSync } = await import('node:fs');
      for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try {
          rmSync(pathJoin(userDataDir, name), { force: true });
        } catch {
          /* noop */
        }
      }
    } catch {
      /* mkdirSync race / perm — will fail below with a clearer error */
    }

    const processes: SpawnedProcess[] = [];
    const killAll = (): void => {
      for (const p of processes) {
        try {
          p.kill('SIGTERM');
        } catch {
          /* best-effort */
        }
      }
    };

    try {
      const xvfb = spawnXvfb(slot.display, this.config.screenSize, this.logger);
      processes.push(xvfb);
      // Give Xvfb ~250ms to bind its Unix socket before Brave connects.
      await new Promise((r) => setTimeout(r, 250));

      const brave = spawnBrave(
        {
          display: slot.display,
          cdpPort: slot.cdpPort,
          userDataDir,
        },
        this.logger,
      );
      processes.push(brave);

      const version = await waitForCdpReady(slot.cdpPort, 15_000);
      this.logger.info(
        { userId, cdpPort: slot.cdpPort, version },
        'pool: Brave CDP ready',
      );

      const x11vnc = spawnX11vnc(slot.display, slot.vncPort, this.logger);
      processes.push(x11vnc);

      const websockify = spawnWebsockify(slot.wsPort, slot.vncPort, this.logger);
      processes.push(websockify);

      const executor = new PlaywrightExecutor();
      const connectResult = await executor.connect(
        `http://127.0.0.1:${slot.cdpPort}`,
      );
      if (!connectResult.ok) {
        throw new Error(
          `PlaywrightExecutor.connect failed: ${connectResult.error}`,
        );
      }

      const now = Date.now();
      const instance: BrowserInstance = {
        ...slot,
        userId,
        userDataDir,
        executor,
        xvfbPid: xvfb.pid,
        bravePid: brave.pid,
        x11vncPid: x11vnc.pid,
        websockifyPid: websockify.pid,
        createdAt: now,
        lastActiveAt: now,
        status: 'ready',
      };
      this.instances.set(userId, instance);
      return instance;
    } catch (err) {
      // Unwind any half-started processes so we don't leak PIDs.
      killAll();
      this.allocator.release(slot);
      throw err;
    }
  }

  private async tearDownInstance(inst: BrowserInstance): Promise<void> {
    // Disconnect the executor first so Playwright flushes its CDP
    // WebSocket cleanly; then kill Brave → websockify → x11vnc →
    // Xvfb (reverse of spawn). Each kill is SIGTERM; SIGKILL after
    // a short grace window in case the child ignored the request.
    try {
      await inst.executor.disconnect();
    } catch {
      /* best-effort */
    }
    const pids = [
      inst.bravePid,
      inst.websockifyPid,
      inst.x11vncPid,
      inst.xvfbPid,
    ];
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        /* ESRCH = already gone; EPERM surfaces in the logger below */
      }
    }
    await new Promise((r) => setTimeout(r, KILL_GRACE_MS));
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * Map an external userId (UUID-ish, like `usr_EeYpvsvLtyDzN4VLQi7BT`)
 * to a filesystem-safe directory name. We conservatively strip any
 * non-alphanumeric/underscore/dash — the prefix `user_` keeps the
 * shape predictable for the reaper + makes `ls /var/lib/holaday-
 * browsers/user_*` easy for ops.
 */
export function userIdToDirName(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `user_${safe}`;
}
