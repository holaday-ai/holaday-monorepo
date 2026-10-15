import type { BrowserControl } from './browser-control.js';

export const CAPTCHA_HANDOFF_MS = 10 * 60_000;
export type CaptchaHandoffResult = 'resumed' | 'cancelled' | 'timeout';
interface WaitOptions {
  taskId: string;
  userId: string;
  control: BrowserControl;
  /** True means a wall remains. Failures never mean the wall disappeared. */
  hasWall: () => Promise<boolean>;
  onWaiting: () => Promise<void>;
  onResumed: () => Promise<boolean>;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
}
interface Entry {
  userId: string;
  control: BrowserControl;
  proceed: () => Promise<boolean>;
  cancel: () => void;
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
    return e?.userId === userId && e.control === control ? e.proceed() : false;
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
    let checking = false;
    const stop = (reason: CaptchaHandoffResult) => {
      outcome = reason;
      o.control.close();
    };
    const entry: Entry = {
      userId: o.userId,
      control: o.control,
      cancel: () => stop('cancelled'),
      proceed: async () => {
        if (checking || o.signal?.aborted || o.control.snapshot().phase !== 'human') return false;
        checking = true;
        try {
          if (await o.hasWall()) return false;
          const lease = o.control.snapshot().lease;
          if (!lease || o.signal?.aborted) return false;
          o.control.returnToAgent(lease);
          return true;
        } catch {
          return false;
        } finally {
          checking = false;
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
      await o.onWaiting();
      if (o.signal?.aborted || o.control.snapshot().phase === 'closed') return outcome;
      o.control.requestHuman();
      const receipt = await o.control.checkpoint(async () => {
        if (await o.hasWall()) throw new Error('captcha_still_visible');
        if (!(await o.onResumed())) throw new Error('captcha_resume_not_persisted');
      });
      if (receipt.resumed) outcome = 'resumed';
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
