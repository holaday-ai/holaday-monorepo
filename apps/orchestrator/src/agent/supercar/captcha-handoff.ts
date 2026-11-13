import type { BrowserControl, HumanInputLog } from './browser-control.js';
import type { ChallengeInfo } from './captcha-challenge.js';

export const CAPTCHA_HANDOFF_MS = 10 * 60_000;
/** After this many "我已完成" with the wall still up, the user may continue another way. */
export const CAPTCHA_ROUNDS_BEFORE_ALTERNATE = 2;
/**
 * `error`: the control channel closed on its own (input outcome unknown, observation or
 * viewport failure) — neither the user, the task nor the timer ended the wait (FIX-35 复审 #2).
 */
export type CaptchaHandoffResult =
  | 'resumed'
  /**
   * FIX-53 #1: the wall went away while the person sent no input and never pressed 我已完成 —
   * the page (or the agent's own earlier actions) cleared it, not the user.
   */
  | 'cleared'
  | 'alternate'
  | 'cancelled'
  | 'timeout'
  | 'error';
/**
 * What the person did during one wait: the evidence behind `resumed` versus `cleared`. Counts and
 * first / last times are of this wait only, and only presses, keys, text and navigations.
 */
export interface CaptchaHandoffActivity extends HumanInputLog {
  /** Acting inputs during this wait (the same as `count`). */
  inputs: number;
  /** The person pressed 我已完成 and the wall was gone. */
  confirmed: boolean;
}
export interface CaptchaHandoffStatus {
  failedRounds: number;
  alternateAvailable: boolean;
  challenge: ChallengeInfo | null;
}
interface WaitOptions {
  taskId: string;
  userId: string;
  control: BrowserControl;
  /** True means a wall remains. Failures never mean the wall disappeared. */
  hasWall: () => Promise<boolean>;
  onWaiting: () => Promise<void>;
  onResumed: () => Promise<boolean>;
  /** FIX-52 #8: the page itself is gone (its browser closed): no wait can end well. */
  pageGone?: () => boolean;
  /** Challenge kind and hint shown with the card (read-only). */
  challenge?: () => Promise<ChallengeInfo | null>;
  /** Called once when the wait ends, with what the person did in it. */
  onActivity?: (activity: CaptchaHandoffActivity) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
}
interface Entry {
  userId: string;
  control: BrowserControl;
  /** `manual`: the user pressed 我已完成; a wall still up then counts as a failed round. */
  proceed: (manual?: boolean) => Promise<boolean>;
  cancel: () => void;
  alternate: () => boolean;
  status: () => CaptchaHandoffStatus;
}
/** Only coordinates a user's handoff; never dispatches input or persists page contents. */
export class CaptchaHandoffs {
  private readonly entries = new Map<string, Entry>();
  active(taskId: string, userId: string, control?: BrowserControl): boolean {
    const e = this.entries.get(taskId);
    return !!e && e.userId === userId && (!control || e.control === control);
  }
  async proceed(taskId: string, userId: string, control: BrowserControl): Promise<boolean> {
    const e = this.entries.get(taskId);
    return e?.userId === userId && e.control === control ? e.proceed(true) : false;
  }
  status(taskId: string, userId: string, control: BrowserControl): CaptchaHandoffStatus | null {
    const e = this.entries.get(taskId);
    return e?.userId === userId && e.control === control ? e.status() : null;
  }
  /** "换个方式继续": only after repeated failed rounds; the agent resumes without the page. */
  alternate(taskId: string, userId: string, control: BrowserControl): boolean {
    const e = this.entries.get(taskId);
    return e?.userId === userId && e.control === control ? e.alternate() : false;
  }
  cancel(taskId: string, userId: string, control: BrowserControl): boolean {
    const e = this.entries.get(taskId);
    if (!e || e.userId !== userId || e.control !== control) return false;
    e.cancel();
    return true;
  }
  /**
   * REBUILD-4 第 6 条: the assistant stops at the wall and says 「这一步需要你来」; the person works
   * the page directly (no takeover). A 1 s poll (and 我已完成) checks the page; once the wall is gone
   * the wait ends, the assistant waits for the person to be still, checks once more and goes on.
   */
  async wait(o: WaitOptions): Promise<CaptchaHandoffResult> {
    if (this.entries.has(o.taskId)) throw new Error('captcha_handoff_already_active');
    let outcome: CaptchaHandoffResult = 'cancelled';
    /** The check in progress; a press of 我已完成 waits for it instead of being dropped. */
    let checking: Promise<boolean> | null = null;
    let failedRounds = 0;
    let alternateChosen = false;
    let confirmed = false;
    const startedAt = Date.now();
    const inputsDuring = () => o.control.humanInputLog(startedAt).count;
    let challenge: ChallengeInfo | null = null;
    let stopped = false;
    /** This round's end: the wall gone, 换个方式继续, or a stop. */
    let settled = false;
    let finish!: (result: CaptchaHandoffResult) => void;
    let round = new Promise<CaptchaHandoffResult>((resolve) => {
      finish = resolve;
    });
    const settle = (result: CaptchaHandoffResult) => {
      if (settled) return;
      settled = true;
      finish(result);
    };
    const stop = (reason: CaptchaHandoffResult) => {
      stopped = true;
      outcome = reason;
      o.control.close();
      settled = false;
      settle(reason);
    };
    const open = () => !settled && !o.signal?.aborted && o.control.snapshot().phase !== 'closed';
    const entry: Entry = {
      userId: o.userId,
      control: o.control,
      cancel: () => stop('cancelled'),
      status: () => ({
        failedRounds,
        alternateAvailable: failedRounds >= CAPTCHA_ROUNDS_BEFORE_ALTERNATE,
        challenge,
      }),
      alternate: () => {
        if (failedRounds < CAPTCHA_ROUNDS_BEFORE_ALTERNATE || !open()) return false;
        alternateChosen = true;
        settle('alternate');
        return true;
      },
      proceed: async (manual = false) => {
        while (checking) {
          if (!manual) return false;
          await checking;
        }
        if (!open()) return false;
        const check = (async () => {
          try {
            if (await o.hasWall()) {
              if (manual) failedRounds += 1;
              return false;
            }
            if (!open()) return false;
            if (manual) confirmed = true;
            settle('resumed');
            return true;
          } catch {
            return false;
          }
        })();
        checking = check;
        try {
          return await check;
        } finally {
          if (checking === check) checking = null;
        }
      },
    };
    this.entries.set(o.taskId, entry);
    const abort = () => stop('cancelled');
    // The wait's own time does not run out while the assistant waits for the person to be still
    // after the wall went (2 s): a wall cleared at the last moment is no timeout.
    let yielding = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (yielding) timedOut = true;
      else stop('timeout');
    }, o.timeoutMs ?? CAPTCHA_HANDOFF_MS);
    const poll = setInterval(() => {
      if (o.pageGone?.()) {
        if (!stopped) stop('error');
        return;
      }
      // FIX-35 复审 #2: the control closed on its own (outcome unknown, observation failed) —
      // neither the person, the task nor the timer ended the wait.
      if (!stopped && o.control.snapshot().phase === 'closed') {
        settled = false;
        settle('error');
        return;
      }
      void entry.proceed();
    }, o.pollMs ?? 1000);
    o.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (o.signal?.aborted) return outcome;
      challenge = (await o.challenge?.().catch(() => null)) ?? null;
      await o.onWaiting();
      if (o.signal?.aborted) return outcome;
      if (o.control.snapshot().phase === 'closed') return stopped ? outcome : 'error';
      while (true) {
        const result = await round;
        if (stopped) return outcome;
        if (result !== 'resumed' && result !== 'alternate') return result;
        // The person may still be at it (typing the last character): go on once they are still.
        yielding = true;
        try {
          await o.control.yieldToHuman();
        } finally {
          yielding = false;
        }
        if (stopped) return outcome;
        if (o.control.snapshot().phase === 'closed') return 'error';
        // "换个方式继续" resumes the agent with the wall still up, by design. A wall that came back
        // keeps the wait open.
        if (result === 'resumed' && (await o.hasWall().catch(() => true))) {
          if (timedOut) {
            stop('timeout');
            return outcome;
          }
          settled = false;
          round = new Promise<CaptchaHandoffResult>((resolve) => {
            finish = resolve;
          });
          continue;
        }
        const persisted = await o.onResumed().catch(() => false);
        // A cancel during the resume's persistence wins.
        if (stopped) return outcome;
        if (!persisted) return 'error';
        outcome = alternateChosen ? 'alternate' : 'resumed';
        if (outcome === 'resumed' && !confirmed && inputsDuring() === 0) outcome = 'cleared';
        return outcome;
      }
    } finally {
      const log = o.control.humanInputLog(startedAt);
      o.onActivity?.({ ...log, inputs: log.count, confirmed });
      clearTimeout(timeout);
      clearInterval(poll);
      o.signal?.removeEventListener('abort', abort);
      if (this.entries.get(o.taskId) === entry) this.entries.delete(o.taskId);
    }
  }
}
export const captchaHandoffs = new CaptchaHandoffs();
