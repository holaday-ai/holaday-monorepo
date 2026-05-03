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

/**
 * Phase 14 audit follow-up — GC cadence dropped from 60 s to 15 s
 * to match the new 30 s idle timeout (was 30 min). Anything longer
 * means an idle instance lingers up to GC_INTERVAL_MS past the
 * timeout, which on a 20-slot box would trickle into capacity
 * pressure under burst load.
 */
const GC_INTERVAL_MS = 15_000;
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
  /**
   * Phase 22a follow-up — per-user reference count. Incremented on
   * each allocate() (including the idempotent "return existing" path),
   * decremented by releaseRef(). The actual teardown only happens
   * when the count hits 0. This preserves the per-user-shared-Brave
   * design when a single user has many concurrent tasks (15 tasks
   * for one userId share one Brave) while still letting tasks.ts
   * proactively signal "I'm done with this slot" for prompt cleanup
   * once everyone's done.
   */
  private readonly refCounts = new Map<string, number>();
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
   *
   * `trackRef` controls whether this allocate counts toward the
   * per-user refcount (which gates teardown — see releaseRef).
   * Set true at task-admit sites (tasks.ts) so each pending task
   * holds a reference until its runFn .finally calls releaseRef.
   * Set false (default) at "I just want a handle" sites like
   * tasks.wakeBrowser or screencast-proxy auto-allocate, which
   * have no symmetric release call and would otherwise leak refs
   * permanently.
   */
  async allocate(
    userId: string,
    opts: { trackRef?: boolean } = {},
  ): Promise<BrowserInstance> {
    if (this.shuttingDown) {
      throw new Error('BrowserPool: shutting down, cannot allocate');
    }
    const trackRef = opts.trackRef === true;
    const existing = this.instances.get(userId);
    if (existing) {
      if (existing.status === 'ready') {
        existing.lastActiveAt = Date.now();
        if (trackRef) this.bumpRef(userId, 'allocate-existing');
        return existing;
      }
      // Phase 22a — defensive reap. The exit handler in spawnInstance
      // already auto-releases on child death, but if allocate races a
      // crash (status flipped to 'dead' but release hasn't completed
      // yet, OR an external observer set 'dead') we tear down + respawn
      // so the user gets a fresh, working browser instead of the same
      // broken handle.
      if (existing.status === 'dead') {
        this.logger.info(
          { userId, cdpPort: existing.cdpPort },
          'pool: allocate found dead instance — reaping before respawn',
        );
        await this.release(userId, 'reap-dead-on-allocate').catch(() => {
          /* release errors are logged inside release() — don't block respawn */
        });
        // Fall through to the inFlight + spawn path below.
      }
      // 'allocating' / 'draining' fall through to the inFlight check.
    }
    const pending = this.inFlight.get(userId);
    if (pending) {
      // Phase 23 hotfix — followers awaiting an in-flight spawn MUST
      // also bump the refcount when they take this branch. Without
      // this, 15 concurrent admits would all share the spawner's
      // single +1 (refcount stays at 1); when the first task
      // finishes and calls releaseRef, the count drops to 0 and the
      // shared instance is torn down out from under the other 14
      // queued tasks. They then throw "PlaywrightExecutor not
      // connected" on the next executor.getPage() call.
      // Pre-22a-hotfix tests were sequential so the followers always
      // saw the existing-ready path (which DID bump); only concurrent
      // admits during a cold spawn exercise this branch.
      const inst = await pending.promise;
      if (trackRef) this.bumpRef(userId, 'allocate-inflight');
      return inst;
    }

    const promise = this.spawnInstance(userId);
    this.inFlight.set(userId, { userId, promise });
    try {
      const instance = await promise;
      if (trackRef) this.bumpRef(userId, 'allocate-new');
      return instance;
    } finally {
      this.inFlight.delete(userId);
    }
  }

  private bumpRef(userId: string, source: string): void {
    const next = (this.refCounts.get(userId) ?? 0) + 1;
    this.refCounts.set(userId, next);
    this.logger.debug({ userId, refCount: next, source }, 'pool: ref+');
  }

  /**
   * Phase 22a follow-up — refcounted release.
   *
   * Decrements the per-user refcount. If other tasks still hold a
   * reference (count > 0 after decrement), this is a no-op aside
   * from the count update. Only when the LAST reference drops do
   * we actually tear down the Brave/Xvfb/x11vnc/websockify quartet
   * via the existing release() path.
   *
   * Use this instead of release() at task-completion sites; reserve
   * release() for unconditional teardowns (idle GC, dead-child
   * detection, shutdown).
   *
   * Returns the count after decrement so callers can log it.
   */
  async releaseRef(userId: string, reason = 'task-done'): Promise<number> {
    const before = this.refCounts.get(userId) ?? 0;
    if (before <= 1) {
      // Last reference (or stale call without prior allocate) — full
      // teardown via release(). release() resets the count to 0.
      this.refCounts.delete(userId);
      this.logger.info(
        { userId, reason },
        'pool: releaseRef — last reference, tearing down',
      );
      await this.release(userId, `lastref-${reason}`);
      return 0;
    }
    const after = before - 1;
    this.refCounts.set(userId, after);
    this.logger.debug(
      { userId, refCount: after, reason },
      'pool: releaseRef — instance still in use, decrement only',
    );
    return after;
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
    if (!inst) {
      // Even with no instance, clear any stale refcount entry.
      this.refCounts.delete(userId);
      return false;
    }
    if (inst.status === 'draining') return false;
    // Force-reset refcount on unconditional teardown so a future
    // allocate() starts at 0. Callers using releaseRef() should not
    // hit this path; GC / dead-child / shutdown paths can land here
    // with refCount > 0, and clearing prevents stale leak.
    this.refCounts.delete(userId);
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

  /**
   * Cheap synchronous "would allocate likely succeed?" check used by
   * the tasks.ts supercar gate. Returns true when this user already
   * has a ready instance (allocate would be a fast no-op) OR there's
   * at least one free slot. The actual spawn could still fail (Brave
   * crash, port collision) — callers must tolerate that. The gate
   * does, via runSupercarTask's null-executor guard which fails the
   * task gracefully rather than crashing.
   *
   * NOT a guarantee — just a hint that admitting the task to the
   * supercar branch isn't obviously hopeless. Cheaper than calling
   * allocate eagerly per task creation (which would burn 5s on
   * cold-start spawn for every task that lands in the gate).
   */
  canAllocate(userId: string): boolean {
    if (this.shuttingDown) return false;
    const existing = this.instances.get(userId);
    if (existing && existing.status === 'ready') return true;
    return this.allocator.availableCount() > 0;
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
      // Round-3 #8: Brave's first-run privacy ribbon + "managed by
      // your organisation" toast show up 1-3s AFTER the initial
      // connect, i.e. after our dismissBraveBanners pass in
      // connect() already ran. Schedule a second sweep 3s out so
      // the VNC stream doesn't lose a ribbon's worth of vertical
      // space for the first few iterations of the first task.
      // Fire-and-forget; executor errors are logged internally.
      setTimeout(() => {
        void executor.dismissChromeBanners().catch(() => {});
      }, 3_000);

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

      // Phase 22a — auto-detect and reap dead instances. Brave / x11vnc
      // / websockify can crash mid-task (sandbox SIGSEGV, OOM, X server
      // disconnect); without this, the instance stays at status='ready'
      // forever and every subsequent allocate(userId) returns the dead
      // handle. Attach a SECOND exit listener (the wrap() in spawn.ts
      // already attaches a logging-only one) that flips status to
      // 'dead' and triggers an asynchronous release. The status check
      // makes this a no-op when release() is the one killing the
      // children (it sets 'draining' first).
      const onChildDeath = (label: string) => () => {
        if (instance.status === 'ready' || instance.status === 'allocating') {
          this.logger.warn(
            { userId, label, cdpPort: instance.cdpPort },
            'pool: child died unexpectedly — marking dead + auto-releasing',
          );
          instance.status = 'dead';
          void this.release(userId, `${label}-died`).catch((err) => {
            this.logger.warn(
              { userId, err: err instanceof Error ? err.message : String(err) },
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

      // Phase 17 — fire the post-allocate hook (cookie sync drain).
      // Best-effort: log + continue on failure so a transient sync
      // problem can't block task dispatch.
      if (this.config.onInstanceReady) {
        void Promise.resolve(this.config.onInstanceReady(userId, executor)).catch(
          (err) => {
            this.logger.warn(
              { userId, err: err instanceof Error ? err.message : String(err) },
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
