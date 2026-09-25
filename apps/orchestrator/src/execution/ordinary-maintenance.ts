import type { ExecutionAdmission } from './execution-admission.js';
import { type DrainSnapshot, ExecutionDrain } from './execution-drain.js';
import {
  type OperationLifetime,
  type OwnedOperation,
  startOwnedOperation,
} from './owned-operation.js';

export type MaintenanceMode = 'serving' | 'draining' | 'closed' | 'blocked';
export interface MaintenanceIdentity {
  candidate: string;
  bootId: string;
}
export interface MaintenanceRecord {
  identity: MaintenanceIdentity;
  mode: MaintenanceMode;
  needsReconciliation: boolean;
}
export interface MaintenanceSnapshot extends MaintenanceRecord {
  counts: DrainSnapshot;
}
export interface MaintenanceJournal {
  read(): MaintenanceRecord;
  persist(input: Omit<MaintenanceRecord, 'identity'>): void;
}
export interface MaintenanceChecks {
  verifyReady(identity: MaintenanceIdentity): Promise<void>;
  stopProducers(): Promise<void>;
  verifyRetainedQueue(): Promise<void>;
}

export class OrdinaryMaintenance implements ExecutionAdmission {
  readonly drain = new ExecutionDrain(1024, () => this.verifyDispatch());
  private readonly identity: MaintenanceIdentity;
  private readonly journal: MaintenanceJournal;
  private readonly checks: MaintenanceChecks;
  private mode: MaintenanceMode = 'closed';
  private dirty = false;
  private generation = 0;
  private opening = false;
  private stopping: Promise<void> | undefined;

  constructor(input: {
    identity: MaintenanceIdentity;
    journal: MaintenanceJournal;
    checks: MaintenanceChecks;
  }) {
    this.identity = Object.freeze({ ...input.identity });
    this.journal = input.journal;
    this.checks = input.checks;
    const record = this.journal.read();
    if (!this.sameIdentity(record.identity)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
    // A new process never inherits an open permission or clears old ambiguity.
    if (record.needsReconciliation || record.mode !== 'closed') {
      this.mode = 'blocked';
      this.dirty = true;
      this.drain.block();
    }
  }

  /** Storage/identity failures revoke admission but never overwrite a new owner's record. */
  tick(): void {
    if (this.mode === 'blocked') throw new Error('MAINTENANCE_BLOCKED');
    try {
      const record = this.journal.read();
      if (
        !this.sameIdentity(record.identity) ||
        record.mode !== this.mode ||
        record.needsReconciliation !== this.dirty
      )
        throw new Error('MAINTENANCE_STATE_CHANGED');
    } catch {
      this.block(false);
      throw new Error('MAINTENANCE_STATE_UNAVAILABLE');
    }
    const counts = this.drain.snapshot();
    if (counts.unknown > 0 || counts.mode === 'blocked') {
      this.block(true);
      throw new Error('MAINTENANCE_OUTCOME_UNKNOWN');
    }
  }

  runRoot<T>(action: (life: OperationLifetime) => Promise<T>): OwnedOperation<T> {
    this.tick();
    if (this.mode !== 'serving') throw new Error('MAINTENANCE_ADMISSION_CLOSED');
    this.persist('serving', true);
    return startOwnedOperation(
      this.drain,
      'request',
      async (owner) => action(Object.freeze({ drain: this.drain, owner })),
      { errorOutcome: 'unknown', dispatch: 'immediate' },
    );
  }

  snapshot(): MaintenanceSnapshot {
    try {
      this.tick();
    } catch {
      /* A status response reports the latched failure. */
    }
    return Object.freeze({
      identity: this.identity,
      mode: this.mode,
      needsReconciliation: this.dirty,
      counts: this.drain.snapshot(),
    });
  }

  /** Close synchronously, publish the barrier before invoking reentrant producer code. */
  beginMaintenance(): Promise<void> {
    this.generation++;
    this.drain.close();
    if (this.stopping) return this.stopping;
    try {
      this.tick();
      this.persist('draining', this.dirty);
    } catch {
      // tick/persist latched blocked. Still stop producers: this barrier is
      // not an idle receipt, and uncertainty must not leave timers dispatching.
    }
    this.stopping = Promise.resolve()
      .then(() => this.checks.stopProducers())
      .catch(() => {
        this.block(true);
        throw new Error('MAINTENANCE_PRODUCERS_UNPROVEN');
      });
    return this.stopping;
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
      throw new Error('MAINTENANCE_TIMEOUT_INVALID');
    this.tick();
    if (this.opening || this.mode === 'serving') throw new Error('MAINTENANCE_NOT_CLOSED');
    const deadline = performance.now() + timeoutMs;
    try {
      await this.withDeadline(this.beginMaintenance(), deadline);
      while (true) {
        this.tick();
        if (this.drain.snapshot().idle) break;
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new Error('MAINTENANCE_TIMEOUT');
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(10, remaining)));
      }
      await this.withDeadline(
        Promise.resolve().then(() => this.checks.verifyRetainedQueue()),
        deadline,
      );
      this.tick();
      if (!this.drain.snapshot().idle || performance.now() >= deadline)
        throw new Error('MAINTENANCE_IDLE_UNPROVEN');
      this.persist('closed', false);
      this.stopping = undefined;
    } catch {
      // A timeout is not cancellation. Raw operations still own their release.
      this.block(true);
      throw new Error('MAINTENANCE_IDLE_UNPROVEN');
    }
  }

  async resumeServing(): Promise<void> {
    this.tick();
    if (this.mode !== 'closed' || this.opening || this.stopping || !this.drain.snapshot().idle)
      throw new Error('MAINTENANCE_OPEN_DENIED');
    const generation = this.generation;
    this.opening = true;
    try {
      await this.checks.verifyReady(this.identity);
      this.tick();
      if (generation !== this.generation || this.mode !== 'closed' || !this.drain.snapshot().idle)
        throw new Error('MAINTENANCE_OPEN_SUPERSEDED');
      this.persist('serving', true);
      this.drain.open();
    } finally {
      this.opening = false;
    }
  }

  private sameIdentity(identity: MaintenanceIdentity): boolean {
    return (
      identity?.candidate === this.identity.candidate && identity?.bootId === this.identity.bootId
    );
  }

  private verifyDispatch(): void {
    this.tick();
    if (!this.dirty || (this.mode !== 'serving' && this.mode !== 'draining'))
      throw new Error('MAINTENANCE_DISPATCH_DENIED');
  }

  private persist(mode: MaintenanceMode, needsReconciliation: boolean): void {
    try {
      this.journal.persist({ mode, needsReconciliation });
      this.mode = mode;
      this.dirty = needsReconciliation;
    } catch {
      this.block(false);
      throw new Error('MAINTENANCE_STATE_UNAVAILABLE');
    }
  }

  private block(persist: boolean): void {
    this.mode = 'blocked';
    this.dirty = true;
    this.drain.block();
    if (persist) {
      try {
        if (this.sameIdentity(this.journal.read().identity))
          this.journal.persist({ mode: 'blocked', needsReconciliation: true });
      } catch {
        /* Local failure remains latched; never report a clean receipt. */
      }
    }
  }

  private async withDeadline<T>(pending: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('MAINTENANCE_TIMEOUT')),
        Math.max(0, deadline - performance.now()),
      );
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
