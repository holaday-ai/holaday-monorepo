/**
 * REBUILD-4 共同操作: one running task's shared browser. The person may click, type or scroll at any
 * time — there is no lease, no takeover and no handback. The assistant never pauses for them: before
 * each of its own actions it yields while the person is busy (an input within the last 2 s), then
 * re-reads the page and goes on from what it now shows.
 *
 * What stays from the handoff model: the person's inputs run one at a time in the order accepted
 * (an accepted input finishes even when the task stops); a missing transport receipt closes the
 * control (its outcome is unknown); the pool's physical-stop receipt is awaited before disposal.
 */
export type BrowserControlPhase = 'agent' | 'closed';

export interface BrowserControlSnapshot {
  phase: BrowserControlPhase;
  /** Always null: kept so old readers of the snapshot see no lease. */
  lease: null;
  error: 'observation_failed' | 'input_outcome_unknown' | null;
}

/** A missing transport receipt is not evidence that an input had no effect. */
export class BrowserInputOutcomeUnknownError extends Error {
  constructor() {
    super('browser_input_outcome_unknown');
    this.name = 'BrowserInputOutcomeUnknownError';
  }
}

type BrowserAction<T = void> = (signal: AbortSignal) => Promise<T>;

export interface HumanInputLog {
  count: number;
  /** Epoch ms of the first and the latest counted input in the window asked for. */
  firstAt: number | null;
  lastAt: number | null;
}

/**
 * FIX-53 #1 (协调方): what counts as the person acting — a press, a key, text, a navigation.
 * Moving the pointer does not; scrolling does not count as acting (it changes nothing), but it is
 * the person being busy: the assistant waits for it too (REBUILD-4 第 2 条: 按下、打字、滚动).
 */
export type HumanInputKind =
  | 'mouseDown'
  | 'mouseUp'
  | 'mouseMove'
  | 'scroll'
  | 'keyDown'
  | 'keyUp'
  | 'insertText'
  | 'navigate'
  /**
   * 复审 #1 #1: the viewer holds a press or key until a fresh frame names it — no coordinates, no
   * contents. The person is busy (the assistant yields), not yet acting.
   */
  | 'pending';
const ACTING_INPUTS: ReadonlySet<HumanInputKind> = new Set([
  'mouseDown',
  'keyDown',
  'insertText',
  'navigate',
]);
const BUSY_INPUTS: ReadonlySet<HumanInputKind> = new Set([...ACTING_INPUTS, 'scroll', 'pending']);
/** The times kept, enough for any one wait. */
const INPUT_TIMES_KEPT = 1_000;
/** REBUILD-4 第 2 条: the assistant's next action waits until the person has been still this long. */
export const HUMAN_IDLE_MS = 2_000;
/** 协调方判定 (复审 #1): said in the tool result when the person used the page while an action ran. */
export const HUMAN_ALSO_ACTED_NOTE =
  '（执行这一步时用户也在画面上操作，请重读页面：页面上的变化可能是用户造成的，不一定是这一步的结果。）';
/** A person who never stops (holding a key, scrolling a long page) does not hold the task forever. */
const MAX_YIELD_MS = 120_000;

export class BrowserControl {
  private phase: BrowserControlPhase = 'agent';
  private error: BrowserControlSnapshot['error'] = null;
  private pendingInputs = 0;
  private inputTail: Promise<void> = Promise.resolve();
  private readonly cancellation = new AbortController();
  private confirmStop!: () => void;
  private readonly stopped = new Promise<void>((resolve) => {
    this.confirmStop = resolve;
  });
  private waiters = new Set<() => void>();
  /** FIX-53 #1: when the person acted — evidence, never contents. */
  private readonly humanInputTimes: number[] = [];
  /** When the person was last busy (acting or scrolling); 0 before any input. */
  private lastBusyAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  snapshot(): BrowserControlSnapshot {
    return { phase: this.phase, lease: null, error: this.error };
  }

  /** The assistant may act whenever the task has not been stopped. */
  canAgentAct(): boolean {
    return this.phase === 'agent';
  }

  /**
   * The person's input, run in the order accepted. No lease: anyone the transport authorised (the
   * task's owner, on the frame they saw) may send it at any time.
   */
  async runHuman<T>(action: BrowserAction<T>, kind?: HumanInputKind): Promise<T> {
    if (this.phase === 'closed') throw new Error('browser_control_closed');
    this.noteHumanInput(kind);
    return this.enqueue(action);
  }

  /** Records the person's input time (an input that did not go through runHuman, e.g. navigation). */
  noteHumanInput(kind?: HumanInputKind): void {
    if (!kind) return;
    const at = this.now();
    if (BUSY_INPUTS.has(kind)) {
      this.lastBusyAt = at;
      this.notify();
    }
    if (ACTING_INPUTS.has(kind)) {
      this.humanInputTimes.push(at);
      if (this.humanInputTimes.length > INPUT_TIMES_KEPT) this.humanInputTimes.shift();
    }
  }

  /** The person's acting inputs since `since` (epoch ms): counts and times only. */
  humanInputLog(since = 0): HumanInputLog {
    const times = this.humanInputTimes.filter((at) => at >= since);
    return { count: times.length, firstAt: times[0] ?? null, lastAt: times.at(-1) ?? null };
  }

  /** Whether the person was busy within the last `idleMs`. */
  humanBusy(idleMs = HUMAN_IDLE_MS): boolean {
    return this.pendingInputs > 0 || (this.lastBusyAt > 0 && this.now() - this.lastBusyAt < idleMs);
  }

  /**
   * 协调方判定 (复审 #1): whether the person was busy (acting, scrolling, or an input still running)
   * at any time since `since` (epoch ms) — e.g. while the assistant's own action ran.
   */
  humanBusySince(since: number): boolean {
    return this.pendingInputs > 0 || this.lastBusyAt >= since;
  }

  /**
   * REBUILD-4 第 2、7 条: before the assistant's next action. While the person is busy — an input in
   * the last `idleMs`, or one still running — wait until they have been still `idleMs`; the caller
   * must then re-read the page and decide again (the action it had planned is void). `onWait` is
   * called once when a wait starts (the status line 「你在操作，我等你停下再继续」).
   */
  async yieldToHuman(
    opts: { idleMs?: number; maxWaitMs?: number; onWait?: () => void } = {},
  ): Promise<{ yielded: boolean; waitedMs: number }> {
    const idleMs = opts.idleMs ?? HUMAN_IDLE_MS;
    const started = this.now();
    if (!this.humanBusy(idleMs) || this.isClosed()) return { yielded: false, waitedMs: 0 };
    opts.onWait?.();
    const deadline = started + (opts.maxWaitMs ?? MAX_YIELD_MS);
    while (!this.isClosed() && this.humanBusy(idleMs) && this.now() < deadline) {
      if (this.pendingInputs > 0) {
        await this.changed();
        continue;
      }
      const left = Math.max(1, idleMs - (this.now() - this.lastBusyAt));
      await this.changedOrAfter(Math.min(left, deadline - this.now()));
    }
    return { yielded: true, waitedMs: Math.max(0, this.now() - started) };
  }

  /**
   * Waits for the person's reply to a question the assistant asked (or the timeout, or a stop).
   * The person may use the browser meanwhile; `resumed` says whether they did, and then `observe`
   * has re-read the page.
   */
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
    const started = this.now();
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
    let reason: 'reply' | 'closed' | 'timeout' = 'timeout';
    while (true) {
      if (this.isClosed()) {
        reason = 'closed';
        break;
      }
      if (result.ready) {
        if (result.error) throw result.error;
        reason = 'reply';
        break;
      }
      const left = timeoutMs - (this.now() - started);
      if (left <= 0) break;
      await this.changedOrAfter(left);
    }
    let resumed = false;
    if (reason !== 'closed' && this.humanInputLog(started).count > 0) {
      await this.yieldToHuman();
      if (!this.isClosed()) {
        try {
          await observe();
          resumed = true;
        } catch {
          this.close('observation_failed');
          reason = 'closed';
        }
      }
    }
    return { reason, value: result.value, resumed, waitedMs: Math.max(0, this.now() - started) };
  }

  /**
   * At a settled boundary of the assistant's own work: yields to a busy person, then re-reads the
   * page (`observe`). `resumed` is true when it waited — the caller's plan is stale.
   */
  async checkpoint(observe: () => Promise<void>): Promise<{ resumed: boolean; waitedMs: number }> {
    const waited = await this.yieldToHuman();
    if (!waited.yielded || this.isClosed()) return { resumed: false, waitedMs: waited.waitedMs };
    try {
      await observe();
    } catch {
      this.close('observation_failed');
      return { resumed: false, waitedMs: waited.waitedMs };
    }
    return { resumed: true, waitedMs: waited.waitedMs };
  }

  private async enqueue<T>(action: BrowserAction<T>): Promise<T> {
    this.pendingInputs++;
    // Already accepted actions finish in order. Cancellation skips queued actions but cannot
    // pretend an active action was cancelled. The owner must still settle it before disposal.
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

  close(error?: BrowserControlSnapshot['error']): void {
    this.phase = 'closed';
    if (error) this.error = error;
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

  private isClosed(): boolean {
    return this.phase === 'closed';
  }

  private changed(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.add(resolve);
    });
  }

  private async changedOrAfter(ms: number): Promise<void> {
    let wake!: () => void;
    const changed = new Promise<void>((resolve) => {
      wake = resolve;
      this.waiters.add(resolve);
    });
    const timer = setTimeout(wake, Math.max(0, ms));
    try {
      await changed;
    } finally {
      clearTimeout(timer);
      this.waiters.delete(wake);
    }
  }

  private notify(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiters) resolve();
  }
}
