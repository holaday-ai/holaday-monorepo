import { BrowserControl } from './browser-control.js';

interface BrowserBinding {
  taskId: string;
  userId: string;
  executor?: object;
}
interface ControlSession {
  control: BrowserControl;
  active: boolean;
}

/** Weak identity keys prevent a replacement browser from inheriting a lease. */
export class BrowserControlSessions {
  private readonly entries = new WeakMap<BrowserBinding, ControlSession>();
  private readonly controlledExecutors = new WeakSet<object>();
  private readonly legacyInputs = new WeakMap<object, number>();
  private readonly legacyVncInstances = new WeakSet<BrowserBinding>();

  beginLegacyInput(executor: object): () => void {
    if (this.controlledExecutors.has(executor)) throw new Error('browser_control_requires_cdp');
    this.legacyInputs.set(executor, (this.legacyInputs.get(executor) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.legacyInputs.set(executor, (this.legacyInputs.get(executor) ?? 1) - 1);
    };
  }

  /** Raw RFB has no per-action settlement receipt; replace this instance before controlled use. */
  claimLegacyVnc(instance: BrowserBinding): void {
    if (this.entries.has(instance)) throw new Error('browser_control_requires_cdp');
    this.legacyVncInstances.add(instance);
  }

  private claimControlled(instance: BrowserBinding): void {
    if (this.legacyVncInstances.has(instance)) throw new Error('browser_legacy_transport');
    if (instance.executor) {
      if (this.legacyInputs.get(instance.executor)) throw new Error('browser_legacy_input_active');
      this.controlledExecutors.add(instance.executor);
    }
  }

  get(instance: BrowserBinding, userId: string, taskId: string): ControlSession | null {
    if (instance.userId !== userId || instance.taskId !== taskId) return null;
    return this.entries.get(instance) ?? null;
  }

  start(instance: BrowserBinding): { control: BrowserControl; finish: () => void } {
    this.claimControlled(instance);
    const previous = this.entries.get(instance);
    if (previous?.active || (previous && !previous.control.isSettled()))
      throw new Error('browser_runner_active');
    if (previous?.control.snapshot().error === 'input_outcome_unknown')
      throw new Error('browser_input_outcome_unknown');
    previous?.control.close();
    const entry = { control: new BrowserControl(), active: true };
    this.entries.set(instance, entry);
    return {
      control: entry.control,
      finish: () => {
        entry.control.close();
        if (!entry.control.isSettled()) throw new Error('browser_input_unsettled');
        entry.active = false;
      },
    };
  }

  /** Caller has verified a terminal DB task and the same restored pool instance. */
  review(instance: BrowserBinding): ControlSession {
    this.claimControlled(instance);
    const previous = this.entries.get(instance);
    if (previous?.active || (previous && !previous.control.isSettled()))
      throw new Error('browser_runner_active');
    if (previous?.control.snapshot().error) throw new Error('browser_input_outcome_unknown');
    if (previous?.control.snapshot().phase === 'human') return previous;
    previous?.control.close();
    const entry = { control: new BrowserControl(), active: false };
    this.entries.set(instance, entry);
    entry.control.requestHuman();
    void entry.control.checkpoint(async () => undefined).finally(() => entry.control.close());
    return entry;
  }

  async quarantine(instance: BrowserBinding, stop: () => Promise<boolean>): Promise<void> {
    const entry = this.entries.get(instance);
    if (!entry) return;
    entry.control.close('input_outcome_unknown');
    // false/rejection is explicitly NOT a stop receipt. Retain the pending
    // actor and pool claim in that case; never report resource recovery.
    if (await stop()) entry.control.confirmBrowserStopped();
  }
}

export const browserControlSessions = new BrowserControlSessions();
