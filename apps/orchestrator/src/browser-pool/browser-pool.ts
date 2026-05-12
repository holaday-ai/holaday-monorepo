/**
 * BrowserPool — per-task Xvfb + Brave + x11vnc + websockify quartets.
 *
 * Phase 24 architecture: one task gets one Brave. No shared instances,
 * no refcount, no per-user serialisation queue. The previous per-user
 * design (one Brave shared across the user's serial task queue) was
 * the bottleneck behind the 11/15 zombie-reaper pile-ups: tasks 2..15
 * waited 15 minutes in the FIFO and timed out before their turn.
 *
 * On allocate(taskId, userId):
 *   1. Reserve a slot (deterministic port + display via SlotAllocator)
 *   2. Spawn Xvfb → wait for the X server unix socket
 *   3. Spawn Brave on a fresh, per-task user-data-dir
 *   4. Spawn x11vnc + websockify for the VNC stream
 *   5. Connect a fresh PlaywrightExecutor to the new CDP port
 *   6. Stash by taskId in the registry, fire onInstanceReady (cookie
 *      sync drains pending_cookies into the new Brave context)
 *
 * On release(taskId):
 *   - Disconnect the executor
 *   - Kill Brave / websockify / x11vnc / Xvfb (SIGTERM → 3s → SIGKILL)
 *   - Free the slot
 *   - rm -rf the per-task user-data-dir (avoids disk creep — every
 *     task spawns fresh, so the dir is single-use)
 *
 * Login state is preserved cross-task via the cookie-sync table: the
 * extension uploads the user's cookies; onInstanceReady drains them
 * into every newly-spawned Brave. The Brave profile dir itself is
 * disposable.
 *
 * Idle GC:
 *   - Timer ticks every 15s; instances with lastActiveAt older than
 *     idleTimeoutMs get released. Per-task means most instances will
 *     release themselves via tasks.ts .finally; the GC just catches
 *     stragglers (orphaned by uncaught throws etc).
 *
 * Capacity:
 *   - Hard cap on concurrent instances (config.maxInstances).
 *     allocate() throws PoolCapacityError when full so the caller can
 *     surface "service busy, try again" rather than a 500.
 *
 * Concurrency control happens upstream: tasks.ts checks per-user
 * concurrent task count against the user's plan limit before calling
 * allocate. The pool itself just enforces the global ceiling.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import type { Logger } from 'pino';
import {
  type BrowserViewportProfile,
  braveWindowSizeForProfile,
  xvfbScreenForProfile,
} from '@holaday/shared-types';
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

const GC_INTERVAL_MS = 15_000;
const KILL_GRACE_MS = 3_000;

export class BrowserPool {
  /** Keyed by taskId — one entry per allocated browser. */
  private readonly instances = new Map<string, BrowserInstance>();
  private readonly allocator: SlotAllocator;
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
   * Spawn a fresh Brave instance for this task. Pool keys by taskId,
   * so concurrent allocates with different taskIds get different
   * instances — there's no de-dup / "return existing" semantics here
   * (taskIds are unique by construction in tasks.ts). userId is
   * retained as the owner reference for cookie-sync + peekActiveForUser.
   */
  /**
   * Optimization #3 R1 — `viewportProfile` (sidepanel / desktop /
   * fullscreen / mobile) picks the Brave window-size + Xvfb screen
   * geometry + CDP streamer cap. Optional; falls back to the
   * legacy 'desktop' default when omitted so existing callers see
   * no behaviour change.
   */
  async allocate(
    taskId: string,
    userId: string,
    viewportProfile?: BrowserViewportProfile,
  ): Promise<BrowserInstance> {
    if (this.shuttingDown) {
      throw new Error('BrowserPool: shutting down, cannot allocate');
    }
    if (this.instances.has(taskId)) {
      // taskId is supposed to be unique per task; if we land here it
      // means tasks.ts retried admit on the same id. Return the
      // existing instance rather than spawning a duplicate.
      const inst = this.instances.get(taskId);
      if (inst && inst.status === 'ready') {
        inst.lastActiveAt = Date.now();
        return inst;
      }
    }
    return this.spawnInstance(taskId, userId, viewportProfile);
  }

  /**
   * Bump the per-task last-active timestamp — callers invoke this
   * every time they hand a tool call to the underlying executor so
   * the GC doesn't reap an actively-running task.
   */
  touch(taskId: string): void {
    const inst = this.instances.get(taskId);
    if (inst) inst.lastActiveAt = Date.now();
  }

  /**
   * Tear down one task's quartet. Safe to call on unknown taskIds
   * (no-op). Returns true if something was released.
   */
  async release(taskId: string, reason = 'manual'): Promise<boolean> {
    const inst = this.instances.get(taskId);
    if (!inst) return false;
    if (inst.status === 'draining') return false;
    inst.status = 'draining';
    this.logger.info(
      { taskId, userId: inst.userId, reason, cdpPort: inst.cdpPort },
      'pool: release',
    );
    await this.tearDownInstance(inst).catch((err) => {
      this.logger.warn(
        { taskId, err: err instanceof Error ? err.message : String(err) },
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
    this.instances.delete(taskId);
    // Best-effort dir cleanup. Per-task fresh dir means no other task
    // will reuse it; leaving it on disk just wastes inodes.
    try {
      rmSync(inst.userDataDir, { recursive: true, force: true });
    } catch (err) {
      this.logger.debug(
        { taskId, dir: inst.userDataDir, err: err instanceof Error ? err.message : String(err) },
        'pool: userDataDir cleanup failed (non-fatal)',
      );
    }
    return true;
  }

  /**
   * Snapshot of pool state for /trpc/health and ops dashboards.
   */
  stats(): PoolStats {
    const byUser = Array.from(this.instances.values()).map((inst) => ({
      taskId: inst.taskId,
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

  /** Look up an instance by taskId without touching lastActiveAt. */
  peek(taskId: string): BrowserInstance | null {
    return this.instances.get(taskId) ?? null;
  }

  /**
   * Find an active instance owned by the given user. When a user has
   * multiple concurrent tasks (Pro plan, 5-task ceiling), returns the
   * most-recently-active one — that's the one whose screencast the
   * user most likely wants to see in the panel.
   *
   * Used by:
   *   - streaming/screencast-proxy.ts — panel wants a Brave to attach
   *   - browser-pool/vnc-proxy.ts — same, for VNC fallback
   *   - http.ts — health probes / debug surfaces
   *
   * Returns null when the user has no active instance. Callers should
   * treat null as "panel can't show anything yet — wait for a task".
   */
  peekActiveForUser(userId: string): BrowserInstance | null {
    let best: BrowserInstance | null = null;
    for (const inst of this.instances.values()) {
      if (inst.userId !== userId) continue;
      if (inst.status !== 'ready') continue;
      if (!best || inst.lastActiveAt > best.lastActiveAt) {
        best = inst;
      }
    }
    return best;
  }

  /**
   * Cheap synchronous "would allocate likely succeed?" check. Returns
   * true when there's at least one free slot. Callers must still
   * tolerate a thrown PoolCapacityError because the slot count can
   * change between this check and the actual allocate.
   */
  canAllocate(): boolean {
    if (this.shuttingDown) return false;
    return this.allocator.availableCount() > 0;
  }

  /** Start the idle-timeout GC loop. Safe to call multiple times. */
  startGc(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => {
      void this.runGcSweep();
    }, GC_INTERVAL_MS);
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
    const taskIds = Array.from(this.instances.keys());
    await Promise.all(taskIds.map((id) => this.release(id, 'shutdown')));
  }

  private async runGcSweep(): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.config.idleTimeoutMs;
    const stale: string[] = [];
    for (const inst of this.instances.values()) {
      if (inst.status !== 'ready') continue;
      if (inst.lastActiveAt < cutoff) stale.push(inst.taskId);
    }
    if (stale.length === 0) return;
    this.logger.info(
      { count: stale.length, taskIds: stale },
      'pool: gc — releasing idle instances',
    );
    await Promise.all(stale.map((id) => this.release(id, 'idle-timeout')));
  }

  /**
   * Spawn the four sidecars + the executor for one task. Per-task
   * fresh user-data-dir (taskId-derived) — login state is restored
   * via the cookie-sync onInstanceReady hook, not via on-disk profile
   * persistence.
   */
  private async spawnInstance(
    taskId: string,
    userId: string,
    viewportProfile?: BrowserViewportProfile,
  ): Promise<BrowserInstance> {
    if (this.allocator.isFull()) {
      throw new PoolCapacityError(this.config.maxInstances);
    }
    const slot: BrowserSlot = this.allocator.claim();
    const userDataDir = pathJoin(this.config.baseDir, taskIdToDirName(taskId));
    // Optimization #3 R1 — resolve per-task viewport geometry from
    // the profile. Falls back to the legacy config.screenSize +
    // Brave default when no profile is set (back-compat).
    const xvfbScreen = viewportProfile
      ? xvfbScreenForProfile(viewportProfile)
      : this.config.screenSize;
    const braveWindowSize = viewportProfile
      ? braveWindowSizeForProfile(viewportProfile)
      : undefined;

    this.logger.info(
      {
        taskId,
        userId,
        ...slot,
        userDataDir,
        viewportProfile: viewportProfile ?? null,
        xvfbScreen,
      },
      'pool: spawning quartet',
    );

    // Per-task dirs are fresh, but rm any leftover from a re-run with
    // the same taskId (shouldn't happen but defensive). Brave's
    // SingletonLock files are part of any profile, so this also
    // cleans those without us having to enumerate them.
    try {
      rmSync(userDataDir, { recursive: true, force: true });
      mkdirSync(userDataDir, { recursive: true });
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
      const xvfb = spawnXvfb(slot.display, xvfbScreen, this.logger);
      processes.push(xvfb);
      // Give Xvfb ~250ms to bind its Unix socket before Brave connects.
      await new Promise((r) => setTimeout(r, 250));

      const brave = spawnBrave(
        {
          display: slot.display,
          cdpPort: slot.cdpPort,
          userDataDir,
          ...(braveWindowSize ? { windowSize: braveWindowSize } : {}),
        },
        this.logger,
      );
      processes.push(brave);

      const version = await waitForCdpReady(slot.cdpPort, 15_000);
      this.logger.info(
        { taskId, userId, cdpPort: slot.cdpPort, version },
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
      // Brave's first-run privacy ribbon + "managed by your
      // organisation" toast show up 1-3s AFTER the initial connect.
      // Schedule a second sweep 3s out so the VNC stream doesn't
      // lose a ribbon's worth of vertical space for early iterations.
      setTimeout(() => {
        void executor.dismissChromeBanners().catch(() => {});
      }, 3_000);

      const now = Date.now();
      const instance: BrowserInstance = {
        ...slot,
        taskId,
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
        ...(viewportProfile ? { viewportProfile } : {}),
      };
      this.instances.set(taskId, instance);

      // Phase 22a — auto-detect and reap dead instances. Brave / x11vnc
      // / websockify can crash mid-task (sandbox SIGSEGV, OOM, X
      // server disconnect); without this, the instance stays at
      // status='ready' forever. Attach a SECOND exit listener (the
      // wrap() in spawn.ts already attaches a logging-only one) that
      // flips status to 'dead' and triggers an asynchronous release.
      // The status check makes this a no-op when release() is already
      // the one killing the children (release sets 'draining' first).
      const onChildDeath = (label: string) => () => {
        if (instance.status === 'ready' || instance.status === 'allocating') {
          this.logger.warn(
            { taskId, userId, label, cdpPort: instance.cdpPort },
            'pool: child died unexpectedly — marking dead + auto-releasing',
          );
          instance.status = 'dead';
          void this.release(taskId, `${label}-died`).catch((err) => {
            this.logger.warn(
              { taskId, err: err instanceof Error ? err.message : String(err) },
              'pool: auto-release after child death failed',
            );
          });
        }
        // status 'draining' or 'dead' => release in progress, no-op.
      };
      brave.child.on('exit', onChildDeath('brave'));
      x11vnc.child.on('exit', onChildDeath('x11vnc'));
      websockify.child.on('exit', onChildDeath('websockify'));
      xvfb.child.on('exit', onChildDeath('xvfb'));

      // Cookie-sync drain. Fires per task spawn (was per user spawn
      // before phase 24). The hook signature still takes userId since
      // cookies are stored per-user, but the call point is now
      // per-task — every new Brave gets a fresh injection.
      if (this.config.onInstanceReady) {
        void Promise.resolve(this.config.onInstanceReady(userId, executor)).catch(
          (err) => {
            this.logger.warn(
              { taskId, userId, err: err instanceof Error ? err.message : String(err) },
              'pool: onInstanceReady hook threw',
            );
          },
        );
      }
      return instance;
    } catch (err) {
      // Unwind any half-started processes so we don't leak PIDs.
      killAll();
      this.allocator.release(slot);
      throw err;
    }
  }

  private async tearDownInstance(inst: BrowserInstance): Promise<void> {
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
 * Filesystem-safe per-task directory name. Strips any character that
 * might confuse a shell or fs (anything outside [a-zA-Z0-9_-]) and
 * prefixes `task_` so `ls /var/lib/holaday-browsers/task_*` is
 * predictable for ops + reaper scripts.
 */
export function taskIdToDirName(taskId: string): string {
  const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `task_${safe}`;
}
