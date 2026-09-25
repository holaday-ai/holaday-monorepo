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
import {
  type BrowserViewportProfile,
  braveWindowSizeForProfile,
  dimensionsForProfile,
  xvfbScreenForProfile,
} from '@holaday/shared-types';
import type { Logger } from 'pino';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import { ExecutionDrain } from '../execution/execution-drain.js';
import type { ExecutionAdmission } from '../execution/execution-admission.js';
import {
  type OperationLifetime,
  captureOperationScopeVeto,
  currentOperationLifetime,
} from '../execution/owned-operation.js';
import { type PoolBackgroundWork, startPoolBackgroundWork } from './background-work.js';
import { BrokerBootSession } from './broker-boot-session.js';
import { BrokerPoolRuntime, type OriginalBrokerGroup } from './broker-pool-runtime.js';
import { BrokerVncIngress, type BrokerVncIngressRequest } from './broker-vnc-ingress.js';
import type { BrokerVncSessionAccess, BrokerVncSessionRequest } from './broker-vnc-session.js';
import { BrowserEgressProxy } from './egress-proxy.js';
import { SlotAllocator } from './port-allocator.js';
import {
  type SpawnedProcess,
  spawnBrave,
  spawnNativeChromium,
  spawnWebsockify,
  spawnX11vnc,
  spawnXvfb,
  waitForCdpReady,
} from './spawn.js';
import type { BrowserInstance, BrowserSlot, PoolConfig, PoolStats } from './types.js';

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
const STRICT_POOL = Symbol('original-strict-pool');
const brokerInvalid = () => new Error('POOL_BROKER_BINDING_INVALID');
interface BrokerInstanceRecord {
  taskId: string;
  readonly userId: string;
  readonly slot: BrowserSlot;
  readonly allocation: OperationLifetime;
  readonly scopeVeto: () => void;
  setup: boolean;
  closing: boolean;
  retained: boolean;
  retainedUntil?: number;
  retentionTtlMs?: number;
  lastActiveAt: number;
  revision: number;
  group?: OriginalBrokerGroup;
  executor?: PlaywrightExecutor;
  instance?: BrowserInstance;
  stopping?: Promise<void>;
}

interface PoolProcessRecord {
  readonly taskId: string;
  readonly slot: BrowserSlot;
  readonly userDataDir: string;
  readonly strict: boolean;
  readonly processes: SpawnedProcess[];
  instance?: BrowserInstance;
  stopping?: Promise<void>;
  failure?: Error;
}

export class BrowserPool {
  readonly #strict: boolean;
  #brokerRuntime?: BrokerPoolRuntime;
  #brokerBoot?: BrokerBootSession;
  #brokerDrain?: ExecutionDrain;
  #brokerStarting?: Promise<void>;
  #brokerLifetime?: OperationLifetime;
  #brokerVncIngress?: BrokerVncIngress;
  #releaseBroker?: () => boolean;
  readonly #brokerRecords = new Set<BrokerInstanceRecord>();
  readonly #brokerBindings = new WeakMap<BrowserInstance, BrokerInstanceRecord>();
  /** Keyed by taskId — one entry per allocated browser. */
  private readonly instances = new Map<string, BrowserInstance>();
  private readonly allocationPromises = new Map<
    string,
    { userId: string; promise: Promise<BrowserInstance>; cancelled: boolean }
  >();
  private readonly retentionTimers = new Map<string, NodeJS.Timeout>();
  private readonly releasePromises = new Map<string, Promise<boolean>>();
  private readonly backgroundWork = new WeakMap<BrowserInstance, PoolBackgroundWork>();
  private readonly processRecords = new Set<PoolProcessRecord>();
  private readonly instanceProcesses = new WeakMap<BrowserInstance, PoolProcessRecord>();
  private shutdownPromise: Promise<void> | null = null;
  private readonly allocator: SlotAllocator;
  private gcTimer: NodeJS.Timeout | null = null;
  private readonly gcRuns = new Set<Promise<void>>();
  private gcFailed = false;
  private maintenancePaused = false;
  private maintenancePause: Promise<void> | undefined;
  private shuttingDown = false;
  private readonly egressProxy: BrowserEgressProxy;

  constructor(
    private readonly config: PoolConfig,
    private readonly logger: Logger,
    mode?: typeof STRICT_POOL,
  ) {
    if (mode !== undefined && mode !== STRICT_POOL) throw brokerInvalid();
    this.#strict = mode === STRICT_POOL;
    this.allocator = new SlotAllocator(config);
    this.egressProxy = new BrowserEgressProxy({ logger });
    if (!this.#strict) mkdirSync(config.baseDir, { recursive: true });
  }

  /** No IO or admission. The real controller must authorize the first task. */
  static dormantStrict(
    config: PoolConfig,
    logger: Logger,
    parent: Pick<OperationLifetime, 'drain'>,
    boot: BrokerBootSession,
  ): BrowserPool {
    BrokerBootSession.assertReady(boot);
    if (
      !(parent.drain instanceof ExecutionDrain) ||
      !Number.isSafeInteger(config.maxInstances) ||
      config.maxInstances < 1 ||
      config.maxInstances > 32 ||
      config.screenSize !== '1280x800x24'
    )
      throw brokerInvalid();
    const pool = new BrowserPool(Object.freeze({ ...config }), logger, STRICT_POOL);
    pool.#brokerDrain = parent.drain;
    pool.#brokerBoot = boot;
    return pool;
  }

  /** Only controlled boot calls this. No injected runtime, group or endpoints. */
  static async openStrict(
    config: PoolConfig,
    logger: Logger,
    parent: OperationLifetime,
    boot: BrokerBootSession,
  ): Promise<BrowserPool> {
    const pool = BrowserPool.dormantStrict(config, logger, parent, boot);
    try {
      await pool.#startBroker(parent);
      return pool;
    } catch {
      await pool.shutdown().catch(() => {});
      throw brokerInvalid();
    }
  }

  #startBroker(parent: OperationLifetime, sourceVeto?: () => void): Promise<void> {
    if (this.shuttingDown || parent.drain !== this.#brokerDrain) throw brokerInvalid();
    if (this.#brokerStarting) return this.#brokerStarting;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const starting = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Publish the one attempt before callbacks or asynchronous acquisition.
    this.#brokerStarting = starting;
    try {
      parent.drain.assertDispatch(parent.owner);
      const owner = parent.drain.fork(parent.owner, 'execution');
      this.#releaseBroker = parent.drain.pin(owner);
      const lifetime = Object.freeze({ drain: parent.drain, owner });
      this.#brokerLifetime = lifetime;
      const veto = () => {
        sourceVeto?.();
        if (this.shuttingDown) throw brokerInvalid();
      };
      void (async () => {
        veto();
        this.#brokerRuntime = await BrokerPoolRuntime.open(lifetime, veto, this.#brokerBoot);
        // Own the returned resource before the final veto or cleanup.
        veto();
        lifetime.drain.assertDispatch(owner);
        this.#brokerVncIngress = new BrokerVncIngress(lifetime, () => this.#vetoBroker());
        veto();
      })().then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return starting;
  }

  #checkBroker(record?: BrokerInstanceRecord): void {
    const lifetime = this.#brokerLifetime;
    if (!this.#strict || !lifetime || !this.#brokerRuntime || this.shuttingDown)
      throw brokerInvalid();
    lifetime.drain.assertDispatch(lifetime.owner);
    if (record?.setup) record.allocation.drain.assertDispatch(record.allocation.owner);
    this.#vetoBroker(record);
  }
  #vetoBroker(record?: BrokerInstanceRecord): void {
    BrokerBootSession.assertReady(this.#brokerBoot);
    if (
      this.shuttingDown ||
      !this.#brokerLifetime ||
      this.#brokerLifetime.drain.snapshot().mode === 'blocked'
    )
      throw brokerInvalid();
    if (!record) return;
    if (!this.#brokerRecords.has(record) || record.closing) throw brokerInvalid();
    if (
      record.retained &&
      (record.retainedUntil === undefined || record.retainedUntil <= Date.now())
    )
      throw brokerInvalid();
    if (record.setup) record.scopeVeto();
    const inst = record.instance;
    if (
      inst &&
      (this.#brokerBindings.get(inst) !== record ||
        this.instances.get(record.taskId) !== inst ||
        inst.taskId !== record.taskId ||
        inst.userId !== record.userId ||
        inst.executor !== record.executor ||
        inst.status !== 'ready')
    )
      throw brokerInvalid();
    // Lease clocks and the original scope callback may synchronously revoke boot.
    BrokerBootSession.assertReady(this.#brokerBoot);
  }
  async #spawnBroker(
    taskId: string,
    userId: string,
    viewportProfile?: BrowserViewportProfile,
    pendingVeto?: () => void,
  ): Promise<BrowserInstance> {
    const allocation = currentOperationLifetime();
    this.#checkBroker();
    const runtime = this.#brokerRuntime;
    if (!runtime || !allocation || allocation.drain !== this.#brokerLifetime?.drain)
      throw brokerInvalid();
    allocation.drain.assertDispatch(allocation.owner);
    const originalScopeVeto = captureOperationScopeVeto();
    const scopeVeto = () => {
      originalScopeVeto();
      pendingVeto?.();
    };
    scopeVeto();
    if (
      viewportProfile &&
      (dimensionsForProfile(viewportProfile).width !== 1280 ||
        dimensionsForProfile(viewportProfile).height !== 800)
    )
      throw new Error('POOL_VIEWPORT_UNSUPPORTED');
    if (this.allocator.isFull()) throw new PoolCapacityError(this.config.maxInstances);
    const record: BrokerInstanceRecord = {
      taskId,
      userId,
      allocation,
      scopeVeto,
      slot: this.allocator.claim(),
      setup: true,
      closing: false,
      retained: false,
      revision: 0,
      lastActiveAt: Date.now(),
    };
    this.#brokerRecords.add(record);
    try {
      record.group = await runtime.create(record.slot.index, {
        check: () => this.#checkBroker(record),
        veto: () => this.#vetoBroker(record),
      });
      this.#checkBroker(record);
      const cdp = await record.group.cdp();
      this.#checkBroker(record);
      record.executor = new PlaywrightExecutor({
        networkPolicy: defaultBrowserNetworkPolicy,
        guardRequests: false,
      });
      const connected = await record.executor.connect(cdp.endpoint, { cdpHeaders: cdp.headers });
      this.#checkBroker(record);
      if (!connected.ok) throw brokerInvalid();
      const now = Date.now();
      const instance: BrowserInstance = {
        transport: 'broker',
        index: record.slot.index,
        taskId,
        userId,
        executor: record.executor,
        status: 'ready',
        createdAt: now,
        lastActiveAt: now,
      };
      record.instance = instance;
      this.#brokerBindings.set(instance, record);
      this.instances.set(taskId, instance);
      this.#checkBroker(record);
      this.backgroundWork.set(
        instance,
        startPoolBackgroundWork(instance, this.config, this.logger, () => {
          try {
            this.#checkBroker(record);
            return true;
          } catch {
            return false;
          }
        }),
      );
      this.#checkBroker(record);
      record.setup = false;
      return instance;
    } catch {
      await this.#stopBroker(record).catch(() => {});
      throw brokerInvalid();
    }
  }
  #stopBroker(record: BrokerInstanceRecord): Promise<void> {
    if (record.stopping) return record.stopping;
    record.closing = true;
    record.revision++;
    if (record.instance) record.instance.status = 'draining';
    // Cleanup may not depend on dispatch permission or erase physical slots.
    record.stopping = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled([
        record.instance && this.backgroundWork.get(record.instance)?.stop(),
        Promise.resolve().then(() => record.executor?.disconnect()),
        Promise.resolve().then(() => record.group?.close()),
      ]);
      if (outcomes.some((outcome) => outcome.status === 'rejected')) {
        const lifetime = this.#brokerLifetime;
        if (lifetime) lifetime.drain.markUnknown(lifetime.owner);
        throw brokerInvalid();
      }
    });
    return record.stopping;
  }

  /** Return false only for a genuinely legacy pool, never on strict failure. */
  handleBrokerVncUpgrade(request: BrokerVncIngressRequest): boolean {
    if (!this.#strict) return false;
    if (!this.#brokerVncIngress || !this.config.vncEnabled) {
      request.socket.destroy();
      return true;
    }
    this.#brokerVncIngress.accept(request);
    return true;
  }

  /** Pure revocation source captured before the authentication handoff yields.
   * A later task with the same visible key is not the original binding. */
  captureBrokerVncBindingVeto(
    instance: BrowserInstance,
    callerUserId: string,
    expectedTaskId: string,
  ): () => void {
    const record = this.#brokerBindings.get(instance);
    if (!record || record.userId !== callerUserId || record.taskId !== expectedTaskId)
      throw brokerInvalid();
    const revision = record.revision;
    const veto = () => {
      this.#vetoBroker(record);
      if (record.revision !== revision || record.taskId !== expectedTaskId) throw brokerInvalid();
    };
    this.#checkBroker(record);
    veto();
    return veto;
  }

  /** Server-only bridge. An instance DTO or its ports can never select a group. */
  openBrokerVnc(
    instance: BrowserInstance,
    callerUserId: string,
    request: BrokerVncSessionRequest,
  ): BrokerVncSessionAccess {
    this.#checkBroker();
    const record = this.#brokerBindings.get(instance);
    if (
      !record ||
      record.userId !== callerUserId ||
      !record.group ||
      this.config.vncEnabled !== true
    )
      throw brokerInvalid();
    this.#checkBroker(record);
    const revision = record.revision;
    const taskId = record.taskId;
    const originalVeto = request.veto.bind(request);
    let lastActivity = Date.now();
    return record.group.vncSession({
      ...request,
      veto: () => {
        originalVeto();
        this.#vetoBroker(record);
        if (record.revision !== revision || record.taskId !== taskId) throw brokerInvalid();
      },
      onActivity: () => {
        originalVeto();
        const now = Date.now();
        this.#vetoBroker(record);
        originalVeto();
        if (record.revision !== revision || record.taskId !== taskId || !Number.isSafeInteger(now))
          throw brokerInvalid();
        if (now - lastActivity < 1000) return;
        lastActivity = now;
        record.lastActiveAt = now;
        instance.lastActiveAt = now;
        if (record.retained && record.retentionTtlMs !== undefined) {
          record.retainedUntil = now + record.retentionTtlMs;
          instance.retainedUntil = record.retainedUntil;
          this.scheduleRetentionExpiry(taskId);
        }
      },
    });
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
    const caller = this.#strict ? currentOperationLifetime() : undefined;
    let originalScopeVeto: (() => void) | undefined;
    if (this.#strict) {
      if (!caller || caller.drain !== this.#brokerDrain) throw brokerInvalid();
      caller.drain.assertDispatch(caller.owner);
      originalScopeVeto = captureOperationScopeVeto();
    }
    if (this.shuttingDown) {
      throw new Error('BrowserPool: shutting down, cannot allocate');
    }
    if (this.releasePromises.has(taskId)) {
      throw new Error('BrowserPool: task browser release is not complete');
    }
    if (this.instances.has(taskId)) {
      // taskId is supposed to be unique per task; if we land here it
      // means tasks.ts retried admit on the same id. Return the
      // existing instance rather than spawning a duplicate.
      const inst = this.instances.get(taskId);
      if (inst && !this.processesRunning(inst)) throw new Error('POOL_PROCESS_CLEANUP_PENDING');
      if (inst && inst.status === 'ready') {
        if (inst.userId !== userId) {
          throw new Error('BrowserPool: task browser owner mismatch');
        }
        inst.lastActiveAt = Date.now();
        if (this.#strict) this.#vetoBroker(this.#brokerBindings.get(inst));
        return inst;
      }
      throw new Error('BrowserPool: task browser is not ready for reuse');
    }
    const pending = this.allocationPromises.get(taskId);
    if (pending) {
      if (pending.userId !== userId) {
        throw new Error('BrowserPool: task browser allocation owner mismatch');
      }
      return pending.promise;
    }
    if (
      Array.from(this.processRecords).some((record) => record.taskId === taskId) ||
      (this.#strict && Array.from(this.#brokerRecords).some((record) => record.taskId === taskId))
    ) {
      throw new Error('POOL_PROCESS_CLEANUP_PENDING');
    }

    let resolve!: (instance: BrowserInstance) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<BrowserInstance>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Register before spawn or any injected logger/hook can reenter shutdown.
    const entry = { userId, promise, cancelled: false };
    this.allocationPromises.set(taskId, entry);
    const pendingVeto = () => {
      originalScopeVeto?.();
      if (entry.cancelled) throw brokerInvalid();
    };
    void (async (): Promise<BrowserInstance> => {
      if (this.#strict) {
        if (!caller) throw brokerInvalid();
        try {
          await this.#startBroker(caller, pendingVeto);
        } catch {
          // Revoke synchronously; the shutdown receipt owns cleanup. Waiting
          // for it here would wait on this very allocation promise.
          void this.shutdown().catch(() => {});
          throw brokerInvalid();
        }
        pendingVeto();
        caller.drain.assertDispatch(caller.owner);
        this.#checkBroker();
        pendingVeto();
        return this.#spawnBroker(taskId, userId, viewportProfile, pendingVeto);
      }
      if (!this.#strict && this.allocator.isFull()) {
        await this.releaseOldestRetained('capacity-reclaim');
      }
      return this.spawnInstance(taskId, userId, viewportProfile);
    })().then(resolve, reject);
    try {
      return await promise;
    } finally {
      const current = this.allocationPromises.get(taskId);
      if (current?.promise === promise) {
        this.allocationPromises.delete(taskId);
      }
    }
  }

  /**
   * Bump the per-task last-active timestamp — callers invoke this
   * every time they hand a tool call to the underlying executor so
   * the GC doesn't reap an actively-running task.
   */
  touch(taskId: string): void {
    if (this.shuttingDown) return;
    const inst = this.instances.get(taskId);
    if (!inst) return;
    const now = Date.now();
    const bound = this.#brokerBindings.get(inst);
    if (this.#strict) {
      if (!bound || !this.processesRunning(inst)) return;
      bound.lastActiveAt = now;
      if (bound.retained && bound.retentionTtlMs !== undefined) {
        bound.retainedUntil = now + bound.retentionTtlMs;
        inst.retainedUntil = bound.retainedUntil;
        this.scheduleRetentionExpiry(taskId);
      }
      inst.lastActiveAt = now;
      return;
    }
    inst.lastActiveAt = now;
    if (inst.retainedUntil != null && inst.retentionTtlMs != null) {
      inst.retainedUntil = now + inst.retentionTtlMs;
      this.scheduleRetentionExpiry(taskId);
    }
  }

  /**
   * Keep a completed task's browser alive on a renewable idle lease.
   * A retained instance never reserves capacity ahead of new work: allocate()
   * reclaims the oldest retained browser before returning PoolCapacityError.
   */
  retain(taskId: string, ttlMs: number, reason = 'terminal-review'): boolean {
    if (this.shuttingDown) return false;
    const inst = this.instances.get(taskId);
    if (inst && !this.processesRunning(inst)) return false;
    if (!inst || inst.status !== 'ready' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return false;
    }

    const durationMs = Math.max(1, Math.floor(ttlMs));
    const retainedUntil = Date.now() + durationMs;
    inst.retainedUntil = retainedUntil;
    inst.retentionReason = reason;
    inst.retentionTtlMs = durationMs;
    const bound = this.#brokerBindings.get(inst);
    if (bound) {
      bound.retained = true;
      bound.retainedUntil = retainedUntil;
      bound.retentionTtlMs = durationMs;
    }
    this.scheduleRetentionExpiry(taskId);
    this.logger.info(
      { taskId, userId: inst.userId, reason, retainedUntil },
      'pool: retained terminal browser for review',
    );
    return true;
  }

  /**
   * Move a retained terminal browser to a follow-up task. The browser process,
   * profile, cookies and current page stay intact; only the pool ownership key
   * changes. This is deliberately limited to retained instances so a follow-up
   * can never steal a browser from an executing task.
   */
  adoptRetained(
    sourceTaskId: string,
    destinationTaskId: string,
    userId: string,
  ): BrowserInstance | null {
    if (this.shuttingDown) return null;
    const source = this.instances.get(sourceTaskId);
    if (source && !this.processesRunning(source)) return null;
    const broker = source && this.#brokerBindings.get(source);
    if (
      this.#strict &&
      (!broker ||
        !broker.retained ||
        broker.retainedUntil === undefined ||
        broker.retainedUntil <= Date.now())
    )
      return null;
    if (
      Array.from(this.processRecords).some(
        (record) => record.taskId === destinationTaskId && !record.instance,
      ) ||
      (this.#strict &&
        Array.from(this.#brokerRecords).some((record) => record.taskId === destinationTaskId))
    )
      return null;
    if (sourceTaskId === destinationTaskId) return null;
    if (this.releasePromises.has(destinationTaskId)) return null;
    if (this.allocationPromises.has(destinationTaskId)) return null;
    if (this.instances.has(destinationTaskId)) return null;
    const inst = this.instances.get(sourceTaskId);
    if (!inst || inst.status !== 'ready' || inst.userId !== userId || inst.retainedUntil == null) {
      return null;
    }

    const retentionTimer = this.retentionTimers.get(sourceTaskId);
    if (retentionTimer) clearTimeout(retentionTimer);
    this.retentionTimers.delete(sourceTaskId);
    this.instances.delete(sourceTaskId);

    if (broker) {
      broker.revision++;
      broker.taskId = destinationTaskId;
      broker.retained = false;
      broker.retainedUntil = undefined;
      broker.retentionTtlMs = undefined;
      broker.lastActiveAt = Date.now();
    }
    inst.taskId = destinationTaskId;
    inst.lastActiveAt = Date.now();
    delete inst.retainedUntil;
    delete inst.retentionReason;
    delete inst.retentionTtlMs;
    this.instances.set(destinationTaskId, inst);
    this.logger.info(
      { sourceTaskId, destinationTaskId, userId },
      'pool: adopted terminal browser for follow-up task',
    );
    if (broker) {
      try {
        this.#checkBroker(broker);
        if (broker.taskId !== destinationTaskId) return null;
      } catch {
        return null;
      }
    }
    return inst;
  }

  /**
   * Release whichever task currently owns an instance after a child process
   * dies. The task id is intentionally read from the mutable instance here:
   * retained browsers can be adopted by a follow-up task without respawning,
   * so a listener that captured the original id would leave a dead entry under
   * the new task key and make every later restore conflict forever.
   */
  private handleUnexpectedChildDeath(instance: BrowserInstance, label: string): void {
    if (instance.status !== 'ready' && instance.status !== 'allocating') return;
    const activeTaskId = instance.taskId;
    instance.status = 'dead';
    this.logger.warn(
      {
        taskId: activeTaskId,
        userId: instance.userId,
        label,
        cdpPort: instance.cdpPort,
      },
      'pool: child died unexpectedly — marking dead + auto-releasing',
    );
    void this.release(activeTaskId, `${label}-died`).catch((err) => {
      this.logger.warn(
        {
          taskId: activeTaskId,
          err: err instanceof Error ? err.message : String(err),
        },
        'pool: auto-release after child death failed',
      );
    });
  }

  /**
   * Tear down one task's quartet. Safe to call on unknown taskIds
   * (no-op). Returns true if something was released.
   */
  async release(taskId: string, reason = 'manual'): Promise<boolean> {
    this.assertOutsideBackground();
    const pending = this.releasePromises.get(taskId);
    if (pending) {
      await pending;
      return false;
    }
    const inst = this.instances.get(taskId);
    if (this.#strict) {
      const record = Array.from(this.#brokerRecords).find((entry) => entry.taskId === taskId);
      const allocation = this.allocationPromises.get(taskId);
      if (!record && !allocation) return false;
      if (allocation) allocation.cancelled = true;
      if (record) {
        record.closing = true;
        record.revision++;
        if (record.instance) record.instance.status = 'draining';
      }
      const retentionTimer = this.retentionTimers.get(taskId);
      if (retentionTimer) clearTimeout(retentionTimer);
      this.retentionTimers.delete(taskId);
      // Revoke first, then await any late acquisition before its original cleanup.
      const closing = Promise.resolve().then(async (): Promise<boolean> => {
        await allocation?.promise.catch(() => {});
        const owned =
          record ?? Array.from(this.#brokerRecords).find((entry) => entry.taskId === taskId);
        // No group allocation was attempted; the original pending task has
        // now actually settled. Existing physical claims remain conservative.
        if (!owned) return true;
        owned.closing = true;
        await this.#stopBroker(owned);
        throw new Error('POOL_GROUP_EXIT_UNPROVEN');
      });
      this.releasePromises.set(taskId, closing);
      return closing;
    }
    if (!inst) return false;
    if (inst.status === 'draining') return false;
    const retentionTimer = this.retentionTimers.get(taskId);
    if (retentionTimer) clearTimeout(retentionTimer);
    this.retentionTimers.delete(taskId);
    inst.status = 'draining';
    let resolve!: (released: boolean) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<boolean>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.releasePromises.set(taskId, promise);
    void this.backgroundWork.get(inst)?.stop();
    void this.releaseInstance(inst, reason).then(resolve, reject);
    // Keep rejected coordination receipts: shutdown must not mistake a failed
    // draining instance for an already completed release on its next attempt.
    const released = await promise;
    this.releasePromises.delete(taskId);
    return released;
  }

  private async releaseInstance(inst: BrowserInstance, reason: string): Promise<boolean> {
    if (this.#strict) {
      const record = this.#brokerBindings.get(inst);
      if (!record) throw brokerInvalid();
      await this.#stopBroker(record);
      throw new Error('POOL_GROUP_EXIT_UNPROVEN');
    }
    if (
      inst.transport === 'broker' ||
      inst.userDataDir === undefined ||
      inst.display === undefined ||
      inst.cdpPort === undefined ||
      inst.vncPort === undefined ||
      inst.wsPort === undefined
    )
      throw brokerInvalid();
    const taskId = inst.taskId;
    try {
      this.logger.info(
        { taskId, userId: inst.userId, reason, cdpPort: inst.cdpPort },
        'pool: release',
      );
    } catch (error) {
      if (!this.instanceProcesses.get(inst)?.strict) throw error;
      // Diagnostics cannot interrupt cleanup of an already acquired strict resource.
    }
    const teardown = this.tearDownInstance(inst);
    if (this.instanceProcesses.get(inst)?.strict) await teardown;
    else
      await teardown.catch((err) => {
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
    const record = this.instanceProcesses.get(inst);
    if (record) this.processRecords.delete(record);
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

  private scheduleRetentionExpiry(taskId: string): void {
    const existingTimer = this.retentionTimers.get(taskId);
    if (existingTimer) clearTimeout(existingTimer);
    if (this.maintenancePaused) { this.retentionTimers.delete(taskId); return; }

    const inst = this.instances.get(taskId);
    const bound = inst && this.#brokerBindings.get(inst);
    const expiry = this.#strict ? bound?.retainedUntil : inst?.retainedUntil;
    if (!inst || expiry == null) {
      this.retentionTimers.delete(taskId);
      return;
    }
    const delayMs = Math.max(1, expiry - Date.now());
    const timer = setTimeout(() => {
      this.retentionTimers.delete(taskId);
      const current = this.instances.get(taskId);
      const currentBound = current && this.#brokerBindings.get(current);
      const currentExpiry = this.#strict ? currentBound?.retainedUntil : current?.retainedUntil;
      if (!current || currentExpiry == null) return;
      if (currentExpiry > Date.now()) {
        this.scheduleRetentionExpiry(taskId);
        return;
      }
      const reason = current.retentionReason ?? 'terminal-review';
      void this.release(taskId, `${reason}-expired`).catch(() => {});
    }, delayMs);
    timer.unref?.();
    this.retentionTimers.set(taskId, timer);
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
    const instance = this.instances.get(taskId);
    if (this.#strict && instance && !this.processesRunning(instance)) return null;
    return instance ?? null;
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
      if (this.#strict && !this.processesRunning(inst)) continue;
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
    if (this.#strict) return this.allocator.availableCount() > 0;
    return (
      this.allocator.availableCount() > 0 ||
      Array.from(this.instances.values()).some(
        (inst) => inst.status === 'ready' && inst.retainedUntil != null,
      )
    );
  }

  /** Start the idle-timeout GC loop. Safe to call multiple times. */
  startGc(admission?: ExecutionAdmission): void {
    if (this.gcTimer || this.shuttingDown) return;
    if (this.maintenancePaused && (this.gcRuns.size || this.gcFailed))
      throw new Error('MAINTENANCE_POOL_UNPROVEN');
    this.maintenancePaused = false;
    this.maintenancePause = undefined;
    for (const id of this.instances.keys()) this.scheduleRetentionExpiry(id);
    this.gcTimer = setInterval(() => {
      let original: Promise<void>;
      try {
        original = admission ? admission.runRoot(async () => this.runGcSweep()).result : this.runGcSweep();
      } catch { return; /* Admission rejected before GC dispatched. */ }
      this.gcRuns.add(original);
      void original.then(() => { this.gcRuns.delete(original); }, () => {
        this.gcFailed = true;
        this.gcRuns.delete(original);
      });
    }, GC_INTERVAL_MS);
    this.gcTimer.unref?.();
  }

  stopGc(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  pauseMaintenanceProducers(): Promise<void> {
    if (this.maintenancePause) return this.maintenancePause;
    this.maintenancePaused = true;
    this.stopGc();
    for (const timer of this.retentionTimers.values()) clearTimeout(timer);
    this.retentionTimers.clear();
    this.maintenancePause = Promise.allSettled([...this.gcRuns]).then(() => {
      if (this.gcFailed) throw new Error('MAINTENANCE_POOL_UNPROVEN');
    });
    return this.maintenancePause;
  }
  assertMaintenanceIdle(): void {
    if (this.#strict || !this.maintenancePaused || this.gcTimer || this.gcRuns.size || this.gcFailed ||
      this.instances.size || this.allocationPromises.size || this.releasePromises.size ||
      this.processRecords.size || this.retentionTimers.size || this.allocator.usedCount())
      throw new Error('MAINTENANCE_POOL_UNPROVEN');
  }

  /**
   * Kill every instance. Used during orchestrator shutdown. Parallel
   * to make a 5-instance teardown under 5s even if one Brave is
   * mis-behaving.
   */
  async shutdown(): Promise<void> {
    this.assertOutsideBackground();
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    if (this.#strict) {
      void this.#brokerVncIngress?.close().catch(() => {});
      for (const record of this.#brokerRecords) {
        record.closing = true;
        void record.group?.close().catch(() => {});
      }
    }
    for (const instance of this.instances.values()) void this.backgroundWork.get(instance)?.stop();
    this.stopGc();
    for (const timer of this.retentionTimers.values()) clearTimeout(timer);
    this.retentionTimers.clear();
    this.shutdownPromise = Promise.resolve().then(async () => {
      await this.#brokerStarting?.catch(() => {});
      await Promise.allSettled(
        Array.from(this.allocationPromises.values(), (entry) => entry.promise),
      );
      if (this.#strict) {
        const stopped = await Promise.allSettled([
          this.#brokerVncIngress?.close(),
          ...[...this.#brokerRecords].map((record) => this.#stopBroker(record)),
          this.#brokerRuntime?.close(),
        ]);
        if (stopped.some((result) => result.status === 'rejected')) throw brokerInvalid();
        if (this.#brokerRecords.size) throw new Error('POOL_GROUP_EXIT_UNPROVEN');
        this.#releaseBroker?.();
        return;
      }
      const taskIds = Array.from(this.instances.keys());
      // Release receipts outlive the instance key when cleanup fails late.
      const pendingReleases = new Set(this.releasePromises.values());
      for (const id of taskIds) pendingReleases.add(this.release(id, 'shutdown'));
      const released = await Promise.allSettled(pendingReleases);
      const startup = await Promise.allSettled(
        Array.from(this.processRecords)
          .filter(
            (record) =>
              record.strict &&
              (!record.instance || this.instances.get(record.instance.taskId) !== record.instance),
          )
          .map((record) => this.stopProcesses(record)),
      );
      const failed = [...released, ...startup].find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      await this.egressProxy.close();
    });
    return this.shutdownPromise;
  }

  private async runGcSweep(): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.config.idleTimeoutMs;
    const stale: string[] = [];
    for (const inst of this.instances.values()) {
      if (inst.status !== 'ready') continue;
      if (this.#strict) {
        const bound = this.#brokerBindings.get(inst);
        if (!bound) continue;
        if (
          bound.retainedUntil !== undefined
            ? bound.retainedUntil <= now
            : bound.lastActiveAt < cutoff
        )
          stale.push(bound.taskId);
        continue;
      }
      if (inst.retainedUntil != null) {
        if (inst.retainedUntil <= now) stale.push(inst.taskId);
        continue;
      }
      if (inst.lastActiveAt < cutoff) stale.push(inst.taskId);
    }
    if (stale.length === 0) return;
    this.logger.info(
      { count: stale.length, taskIds: stale },
      'pool: gc — releasing idle instances',
    );
    await Promise.all(stale.map((id) => this.release(id, 'idle-timeout')));
  }

  private async releaseOldestRetained(reason: string): Promise<boolean> {
    let oldest: BrowserInstance | null = null;
    for (const inst of this.instances.values()) {
      if (inst.status !== 'ready' || inst.retainedUntil == null) continue;
      if (!oldest || inst.retainedUntil < (oldest.retainedUntil ?? Infinity)) {
        oldest = inst;
      }
    }
    if (!oldest) return false;
    return this.release(oldest.taskId, reason);
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
    const lifetime = currentOperationLifetime();
    if (this.allocator.isFull()) {
      throw new PoolCapacityError(this.config.maxInstances);
    }
    const slot: BrowserSlot = this.allocator.claim();
    const userDataDir = pathJoin(this.config.baseDir, taskIdToDirName(taskId));
    const record: PoolProcessRecord = {
      taskId,
      slot,
      userDataDir,
      strict: !!lifetime,
      processes: [],
    };
    this.processRecords.add(record);
    const processes = record.processes;
    let executor: PlaywrightExecutor | undefined;
    let instance: BrowserInstance | undefined;
    const assertActive = () => {
      if (!lifetime) return;
      lifetime.drain.assertDispatch(lifetime.owner);
      if (this.shuttingDown || lifetime.drain.snapshot().unknown)
        throw new Error('POOL_PROCESS_STOPPING');
      if (processes.some((p) => !p.lifecycle?.isRunning()))
        throw new Error('POOL_PROCESS_NOT_RUNNING');
    };
    const track = async (p: SpawnedProcess): Promise<void> => {
      processes.push(p);
      if (!lifetime) return;
      if (!p.lifecycle) throw new Error('POOL_PROCESS_RECEIPT_REQUIRED');
      await p.lifecycle.ready;
      assertActive();
    };
    try {
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

      const proxyServer = await this.egressProxy.start();
      assertActive();
      let xvfb: SpawnedProcess | null = null;
      let x11vnc: SpawnedProcess | null = null;
      let websockify: SpawnedProcess | null = null;
      let browserProcess: SpawnedProcess;

      if (process.platform === 'darwin') {
        assertActive();
        browserProcess = spawnNativeChromium(
          {
            display: slot.display,
            cdpPort: slot.cdpPort,
            userDataDir,
            proxyServer,
            ...(braveWindowSize ? { windowSize: braveWindowSize } : {}),
          },
          this.logger,
        );
        await track(browserProcess);
      } else {
        assertActive();
        xvfb = spawnXvfb(slot.display, xvfbScreen, this.logger);
        await track(xvfb);
        // Give Xvfb ~250ms to bind its Unix socket before Brave connects.
        await new Promise((r) => setTimeout(r, 250));
        assertActive();

        browserProcess = spawnBrave(
          {
            display: slot.display,
            cdpPort: slot.cdpPort,
            userDataDir,
            proxyServer,
            ...(braveWindowSize ? { windowSize: braveWindowSize } : {}),
          },
          this.logger,
        );
        await track(browserProcess);
      }

      assertActive();
      const version = await waitForCdpReady(slot.cdpPort, 15_000);
      assertActive();
      this.logger.info({ taskId, userId, cdpPort: slot.cdpPort, version }, 'pool: Brave CDP ready');

      if (process.platform !== 'darwin' && this.config.vncEnabled === true) {
        assertActive();
        x11vnc = spawnX11vnc(slot.display, slot.vncPort, this.logger);
        await track(x11vnc);

        assertActive();
        websockify = spawnWebsockify(slot.wsPort, slot.vncPort, this.logger);
        await track(websockify);
      }

      assertActive();
      executor = new PlaywrightExecutor({
        networkPolicy: defaultBrowserNetworkPolicy,
        // BrowserPool Chromium is already pinned to the egress proxy below.
        // Avoid Playwright routing here because routing disables HTTP cache.
        guardRequests: false,
      });
      if (viewportProfile) {
        executor.setViewportSize(dimensionsForProfile(viewportProfile));
      }
      assertActive();
      const connectResult = await executor.connect(`http://127.0.0.1:${slot.cdpPort}`);
      assertActive();
      if (!connectResult.ok) {
        throw new Error(`PlaywrightExecutor.connect failed: ${connectResult.error}`);
      }
      const now = Date.now();
      instance = {
        ...slot,
        taskId,
        userId,
        userDataDir,
        executor,
        xvfbPid: xvfb?.pid ?? 0,
        bravePid: browserProcess.pid,
        x11vncPid: x11vnc?.pid ?? 0,
        websockifyPid: websockify?.pid ?? 0,
        createdAt: now,
        lastActiveAt: now,
        status: 'ready',
        ...(viewportProfile ? { viewportProfile } : {}),
      };
      const boundInstance = instance;
      this.instanceProcesses.set(instance, record);
      this.backgroundWork.set(
        instance,
        startPoolBackgroundWork(
          instance,
          this.config,
          this.logger,
          () =>
            !this.shuttingDown &&
            boundInstance.status === 'ready' &&
            this.instances.get(boundInstance.taskId) === boundInstance,
        ),
      );
      this.instances.set(taskId, instance);
      record.instance = instance;

      // Phase 22a — auto-detect and reap dead instances. Brave / x11vnc
      // / websockify can crash mid-task (sandbox SIGSEGV, OOM, X
      // server disconnect); without this, the instance stays at
      // status='ready' forever. Attach a SECOND exit listener (the
      // wrap() in spawn.ts already attaches a logging-only one) that
      // flips status to 'dead' and triggers an asynchronous release.
      // The status check makes this a no-op when release() is already
      // the one killing the children (release sets 'draining' first).
      const onChildDeath = (label: string) => () =>
        this.handleUnexpectedChildDeath(boundInstance, label);
      browserProcess.child.on('exit', onChildDeath('browser'));
      x11vnc?.child.on('exit', onChildDeath('x11vnc'));
      websockify?.child.on('exit', onChildDeath('websockify'));
      xvfb?.child.on('exit', onChildDeath('xvfb'));

      return instance;
    } catch (err) {
      const releasing = instance && this.releasePromises.get(instance.taskId);
      if (releasing) {
        await releasing.catch(() => {});
        throw err;
      }
      if (instance)
        await this.backgroundWork
          .get(instance)
          ?.stop()
          .catch(() => {});
      const disconnected = await Promise.allSettled([
        Promise.resolve().then(() => executor?.disconnect()),
      ]);
      if (record.strict && disconnected.some((r) => r.status === 'rejected'))
        record.failure = new Error('POOL_PROCESS_CLEANUP_FAILED');
      if (instance && this.instances.get(instance.taskId) === instance) {
        this.instances.delete(instance.taskId);
      }
      // Unwind any half-started processes so we don't leak PIDs.
      if (record.strict) await this.stopProcesses(record);
      else
        for (const p of processes) {
          try {
            p.kill('SIGTERM');
          } catch {
            /* legacy best effort */
          }
        }
      this.allocator.release(slot);
      this.processRecords.delete(record);
      throw err;
    }
  }

  private async tearDownInstance(inst: BrowserInstance): Promise<void> {
    if (this.#strict || inst.transport === 'broker') throw brokerInvalid();
    const background = await Promise.allSettled([this.backgroundWork.get(inst)?.stop()]);
    const record = this.instanceProcesses.get(inst);
    if (record?.strict) {
      const disconnected = await Promise.allSettled([
        Promise.resolve().then(() => inst.executor.disconnect()),
      ]);
      const stopped = await Promise.allSettled([this.stopProcesses(record)]);
      const failure = [...background, ...disconnected, ...stopped].find(
        (r) => r.status === 'rejected',
      );
      if (failure?.status === 'rejected') throw failure.reason;
      return;
    }
    try {
      await inst.executor.disconnect();
    } catch {
      /* best-effort */
    }
    const pids = [inst.bravePid, inst.websockifyPid, inst.x11vncPid, inst.xvfbPid].filter(
      (pid): pid is number => typeof pid === 'number' && pid > 0,
    );
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
    const failed = background.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  private assertOutsideBackground(): void {
    for (const instance of this.instances.values()) {
      if (this.backgroundWork.get(instance)?.isCurrent()) {
        throw new Error('BROWSER_POOL_BACKGROUND_REENTRY');
      }
    }
  }

  private processesRunning(instance: BrowserInstance): boolean {
    if (this.#strict) {
      const bound = this.#brokerBindings.get(instance);
      if (!bound) return false;
      try {
        this.#checkBroker(bound);
        return true;
      } catch {
        return false;
      }
    }
    const record = this.instanceProcesses.get(instance);
    return (
      !record?.strict ||
      (!record.stopping && record.processes.every((p) => p.lifecycle?.isRunning()))
    );
  }

  private stopProcesses(record: PoolProcessRecord): Promise<void> {
    if (record.stopping) return record.stopping;
    record.stopping = Promise.resolve().then(async () => {
      const results = await Promise.allSettled(
        record.processes.map((p) =>
          Promise.resolve().then(() => {
            if (!p.lifecycle) throw new Error('POOL_PROCESS_RECEIPT_REQUIRED');
            return p.lifecycle.terminate();
          }),
        ),
      );
      const failed = results.find((r) => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (record.failure) throw record.failure;
    });
    return record.stopping;
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
