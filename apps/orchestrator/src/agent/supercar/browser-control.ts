import { randomUUID } from 'node:crypto';

export type BrowserControlPhase = 'agent' | 'requested' | 'human' | 'resuming' | 'closed';

export interface BrowserControlSnapshot {
  phase: BrowserControlPhase;
  lease: string | null;
  error: 'observation_failed' | 'viewport_failed' | 'input_outcome_unknown' | null;
}

/** A missing transport receipt is not evidence that an input had no effect. */
export class BrowserInputOutcomeUnknownError extends Error {
  constructor() {
    super('browser_input_outcome_unknown');
    this.name = 'BrowserInputOutcomeUnknownError';
  }
}

type BrowserAction<T = void> = (signal: AbortSignal) => Promise<T>;

/**
 * One running task's control handoff. A request is NOT a pause receipt:
 * only the runner, at a settled browser-action boundary, calls checkpoint.
 * The caller must not race browser side effects against a timeout and then
 * call checkpoint while the losing operation can still affect the page.
 */
export class BrowserControl {
  private phase: BrowserControlPhase = 'agent';
  private lease: string | null = null;
  private error: BrowserControlSnapshot['error'] = null;
  private checkpointActive = false;
  private pendingInputs = 0;
  private inputTail: Promise<void> = Promise.resolve();
  private queuedViewport: BrowserAction | null = null;
  private readonly handbackActions = new Set<BrowserAction>();
  private readonly cancellation = new AbortController();
  private confirmStop!: () => void;
  private readonly stopped = new Promise<void>((resolve) => {
    this.confirmStop = resolve;
  });
  private waiters = new Set<() => void>();

  snapshot(): BrowserControlSnapshot {
    return {
      phase: this.phase,
      lease: this.phase === 'human' ? this.lease : null,
      error: this.error,
    };
  }

  canAgentAct(): boolean {
    return this.phase === 'agent' && this.queuedViewport === null;
  }

  /** A layout update invalidates old coordinates, but never grants a human lease. */
  queueViewport(action: BrowserAction): void {
    if (this.isClosed()) throw new Error('browser_control_closed');
    this.queuedViewport = action;
    this.notify();
  }

  requestHuman(): BrowserControlSnapshot {
    if (this.phase === 'closed') throw new Error('browser_control_closed');
    if (this.phase === 'resuming') throw new Error('browser_control_transfer_pending');
    if (this.phase === 'agent') this.phase = 'requested';
    this.notify();
    return this.snapshot();
  }

  /** Existing user-reply waits and control handoffs share this one runner. */
  async waitForReply<T>(
    reply: Promise<T>,
    observe: () => Promise<void>,
    timeoutMs: number,
  ): Promise<{
    reason: 'reply' | 'closed' | 'timeout';
    value?: T;
    resumed: boolean;
    waitedMs: number;
  }> {
    const started = Date.now();
    let remaining = timeoutMs;
    let resumed = false;
    const result: { ready: boolean; value?: T; error?: unknown } = { ready: false };
    void reply.then(
      (value) => {
        result.ready = true;
        result.value = value;
        this.notify();
      },
      (error: unknown) => {
        result.ready = true;
        result.error = error;
        this.notify();
      },
    );
    const receipt = (reason: 'reply' | 'closed' | 'timeout') => ({
      reason,
      value: result.value,
      resumed,
      waitedMs: Math.max(0, Date.now() - started),
    });
    while (!this.isClosed()) {
      const boundary = await this.checkpoint(observe);
      resumed ||= boundary.resumed;
      if (this.isClosed()) break;
      if (!this.canAgentAct()) continue;
      if (result.ready) {
        if (result.error) throw result.error;
        return receipt('reply');
      }
      if (remaining <= 0) return receipt('timeout');
      const waitingSince = Date.now();
      let wake!: () => void;
      const changed = new Promise<void>((resolve) => {
        wake = resolve;
        this.waiters.add(resolve);
      });
      const timer = setTimeout(wake, remaining);
      try {
        await changed;
      } finally {
        clearTimeout(timer);
        this.waiters.delete(wake);
      }
      remaining -= Math.max(0, Date.now() - waitingSince);
    }
    return receipt('closed');
  }

  returnToAgent(lease: string): BrowserControlSnapshot {
    if (!lease || lease !== this.lease || (this.phase !== 'human' && this.phase !== 'resuming')) {
      throw new Error('browser_control_not_owned');
    }
    // Close admission synchronously, before waiting for accepted inputs.
    this.phase = 'resuming';
    this.notify();
    return this.snapshot();
  }

  async runHuman<T>(lease: string, action: BrowserAction<T>): Promise<T> {
    if (this.phase !== 'human' || !lease || lease !== this.lease) {
      throw new Error('browser_control_not_owned');
    }
    return this.enqueue(action);
  }

  /** Accepted input transports register key/button cleanup, including across disconnects. */
  beforeHandback(action: BrowserAction): void {
    this.handbackActions.add(action);
  }

  private async enqueue<T>(action: BrowserAction<T>): Promise<T> {
    this.pendingInputs++;
    // Already accepted actions finish in order even after returnToAgent.
    // Cancellation skips queued actions but cannot pretend an active action
    // was cancelled. The owner must still settle it before browser disposal.
    const result = this.inputTail.then(async () => {
      if (this.phase === 'closed') throw new Error('browser_control_closed');
      try {
        return await Promise.race([
          action(this.cancellation.signal),
          this.stopped.then(() => {
            throw new BrowserInputOutcomeUnknownError();
          }),
        ]);
      } catch (error) {
        if (error instanceof BrowserInputOutcomeUnknownError) this.close('input_outcome_unknown');
        throw error;
      }
    });
    this.inputTail = result.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await result;
    } finally {
      this.pendingInputs--;
      this.notify();
    }
  }

  async checkpoint(observe: () => Promise<void>): Promise<{ resumed: boolean; waitedMs: number }> {
    if (this.checkpointActive) throw new Error('browser_control_checkpoint_active');
    const manual = this.phase === 'requested';
    if (!manual && (this.phase !== 'agent' || !this.queuedViewport)) {
      return { resumed: false, waitedMs: 0 };
    }
    this.checkpointActive = true;
    const started = Date.now();
    if (manual) this.grantHuman();
    else this.phase = 'resuming';
    try {
      while (!this.isClosed()) {
        while (this.snapshot().phase === 'human') {
          if (this.queuedViewport) await this.flushViewport();
          else await this.changed();
        }
        if (this.isClosed()) break;
        while (this.pendingInputs > 0 && !this.isClosed()) await this.changed();
        if (this.isClosed()) break;
        await this.flushViewport();
        if (this.isClosed()) break;
        try {
          for (const action of this.handbackActions) {
            await this.enqueue(action);
            this.handbackActions.delete(action);
          }
        } catch {
          this.close('input_outcome_unknown');
          break;
        }
        if (this.isClosed()) break;
        try {
          await observe();
        } catch {
          if (this.isClosed()) break;
          if (!manual) {
            this.close('observation_failed');
            break;
          }
          this.grantHuman();
          this.error = 'observation_failed';
          continue;
        }
        if (this.isClosed()) break;
        // A resize arriving during capture makes that capture stale too.
        if (this.queuedViewport) continue;
        this.phase = 'agent';
        this.lease = null;
        this.error = null;
        return { resumed: true, waitedMs: Math.max(0, Date.now() - started) };
      }
      return { resumed: false, waitedMs: Math.max(0, Date.now() - started) };
    } finally {
      // Cancellation closes admission immediately, but the runner must not
      // release its browser while an accepted manual action is still live.
      while (this.pendingInputs > 0) await this.changed();
      this.checkpointActive = false;
    }
  }

  close(error?: BrowserControlSnapshot['error']): void {
    this.phase = 'closed';
    this.lease = null;
    if (error) this.error = error;
    this.queuedViewport = null;
    this.cancellation.abort();
    this.notify();
  }

  /** Only the owning pool's proven physical-stop receipt may call this. */
  confirmBrowserStopped(): void {
    if (!this.isClosed()) throw new Error('browser_stop_not_requested');
    this.confirmStop();
  }

  isSettled(): boolean {
    return this.pendingInputs === 0;
  }

  async settled(): Promise<void> {
    while (this.pendingInputs > 0) await this.changed();
  }

  private async flushViewport(): Promise<void> {
    while (this.queuedViewport && !this.isClosed()) {
      const action = this.queuedViewport;
      this.queuedViewport = null;
      try {
        await this.enqueue(action);
      } catch {
        if (!this.isClosed()) this.close('viewport_failed');
      }
    }
  }

  private grantHuman(): void {
    this.phase = 'human';
    this.lease = randomUUID();
    this.error = null;
  }

  private isClosed(): boolean {
    return this.phase === 'closed';
  }

  private changed(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.add(resolve);
    });
  }

  private notify(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiters) resolve();
  }
}
