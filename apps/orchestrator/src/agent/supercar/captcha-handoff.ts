import type { BrowserControl } from './browser-control.js';
import type { ChallengeInfo } from './captcha-challenge.js';

export const CAPTCHA_HANDOFF_MS = 10 * 60_000;
/** After this many "我已完成" with the wall still up, the user may continue another way. */
export const CAPTCHA_ROUNDS_BEFORE_ALTERNATE = 2;
export type CaptchaHandoffResult = 'resumed' | 'alternate' | 'cancelled' | 'timeout';
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
  /** Challenge kind and hint shown with the card (read-only). */
  challenge?: () => Promise<ChallengeInfo | null>;
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
  async wait(o: WaitOptions): Promise<CaptchaHandoffResult> {
    if (this.entries.has(o.taskId)) throw new Error('captcha_handoff_already_active');
    let outcome: CaptchaHandoffResult = 'cancelled';
    /** The check in progress; a press of 我已完成 waits for it instead of being dropped. */
    let checking: Promise<boolean> | null = null;
    let failedRounds = 0;
    let alternateChosen = false;
    let challenge: ChallengeInfo | null = null;
    const stop = (reason: CaptchaHandoffResult) => {
      outcome = reason;
      o.control.close();
    };
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
        if (failedRounds < CAPTCHA_ROUNDS_BEFORE_ALTERNATE || o.signal?.aborted) return false;
        const lease = o.control.snapshot().lease;
        if (o.control.snapshot().phase !== 'human' || !lease) return false;
        alternateChosen = true;
        o.control.returnToAgent(lease);
        return true;
      },
      proceed: async (manual = false) => {
        while (checking) {
          if (!manual) return false;
          await checking;
        }
        if (o.signal?.aborted || o.control.snapshot().phase !== 'human') return false;
        const check = (async () => {
          try {
            if (await o.hasWall()) {
              if (manual) failedRounds += 1;
              return false;
            }
            const lease = o.control.snapshot().lease;
            if (!lease || o.signal?.aborted) return false;
            o.control.returnToAgent(lease);
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
    const timeout = setTimeout(() => stop('timeout'), o.timeoutMs ?? CAPTCHA_HANDOFF_MS);
    const poll = setInterval(() => {
      void entry.proceed();
    }, o.pollMs ?? 1000);
    o.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (o.signal?.aborted) return outcome;
      challenge = (await o.challenge?.().catch(() => null)) ?? null;
      await o.onWaiting();
      if (o.signal?.aborted || o.control.snapshot().phase === 'closed') return outcome;
      o.control.requestHuman();
      const receipt = await o.control.checkpoint(async () => {
        // "换个方式继续" resumes the agent with the wall still up, by design.
        if (!alternateChosen && (await o.hasWall())) throw new Error('captcha_still_visible');
        if (!(await o.onResumed())) throw new Error('captcha_resume_not_persisted');
      });
      if (receipt.resumed) outcome = alternateChosen ? 'alternate' : 'resumed';
      return outcome;
    } finally {
      clearTimeout(timeout);
      clearInterval(poll);
      o.signal?.removeEventListener('abort', abort);
      if (this.entries.get(o.taskId) === entry) this.entries.delete(o.taskId);
    }
  }
}
export const captchaHandoffs = new CaptchaHandoffs();
