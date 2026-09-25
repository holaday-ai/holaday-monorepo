import type { DriverAction, DriverResult } from '@holaday/browser-driver';

export interface SelectedChromeDriver {
  attachExistingTab(): Promise<DriverResult>;
  observeCurrentPage(): Promise<DriverResult>;
  execute(action: DriverAction): Promise<DriverResult>;
  dispose(): Promise<void>;
}

export type SessionReply =
  | { ok: true; sessionId: string; observation: unknown; actionOutcome?: 'applied' | 'not_applied' }
  | { ok: false; error: string; actionOutcome?: 'applied' | 'not_applied' | 'unknown' };

interface Entry {
  id: string;
  taskId: string;
  tabId: number;
  owner: string | null;
  driver: SelectedChromeDriver | null;
  stopped: boolean;
  quarantined: boolean;
  ready: boolean;
  pending: Promise<SessionReply> | null;
  disposal?: Promise<void>;
}

const SUPPORTED = new Set(['click', 'type', 'key', 'goto', 'wait']);
const NOT_APPLIED = new Set([
  'SELECTOR_NOT_FOUND',
  'SELECTOR_MISSING',
  'PAYLOAD_MISSING',
  'ORIGIN_BLOCKED',
  'NOT_ATTACHED',
]);

/** One local Chrome execution seat; the native CRX driver owns selectors. */
export class SelectedChromeSession {
  private entry: Entry | null = null;
  constructor(
    private readonly deps: {
      makeDriver: (tabId: number) => SelectedChromeDriver;
      owner: () => string | null;
    },
  ) {}

  async open(input: {
    taskId: string;
    tabId: number;
    validate: () => Promise<void>;
  }): Promise<SessionReply> {
    if (this.entry) return { ok: false, error: 'browser_busy' };
    const owner = this.deps.owner();
    if (!owner) return { ok: false, error: 'session_unavailable' };
    const entry: Entry = {
      id: crypto.randomUUID(),
      taskId: input.taskId,
      tabId: input.tabId,
      owner,
      driver: null,
      stopped: false,
      quarantined: false,
      ready: false,
      pending: null,
    };
    this.entry = entry;
    const result = await this.track(entry, async () => {
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      try {
        await input.validate();
      } catch {
        return { ok: false, error: 'target_changed' };
      }
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      entry.driver = this.deps.makeDriver(input.tabId);
      const attached = await entry.driver.attachExistingTab();
      if (attached.status !== 'ok') return { ok: false, error: 'attach_failed' };
      if (!identifiesTab(attached.data, entry.tabId)) return { ok: false, error: 'target_changed' };
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      // Do not let a page change or account switch during attachment select a
      // different document for the first action.
      try {
        await input.validate();
      } catch {
        return { ok: false, error: 'target_changed' };
      }
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      const observed = await this.observeEntry(entry);
      if (observed.ok) entry.ready = true;
      return observed;
    });
    if (!result.ok) await this.stopTask(input.taskId);
    return result;
  }

  async observe(taskId: string, sessionId: string): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    return this.track(entry, () => this.observeEntry(entry));
  }

  async execute(taskId: string, sessionId: string, action: DriverAction): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (!entry.ready) return { ok: false, error: 'observation_required' };
    if (!SUPPORTED.has(action.kind))
      return { ok: false, error: 'unsupported_action', actionOutcome: 'not_applied' };
    if (action.kind === 'goto' && !isWebNavigation(action.payload?.url))
      return { ok: false, error: 'invalid_url', actionOutcome: 'not_applied' };
    return this.track(
      entry,
      async () => {
        if (!this.current(entry) || !entry.driver)
          return { ok: false, error: 'session_unavailable', actionOutcome: 'not_applied' };
        let result: DriverResult;
        try {
          result = await entry.driver.execute(action);
        } catch (error) {
          if (action.kind === 'wait')
            return { ok: false, error: 'wait_failed', actionOutcome: 'not_applied' };
          throw error;
        }
        if (result.status !== 'ok') {
          if (action.kind === 'wait')
            return { ok: false, error: 'wait_failed', actionOutcome: 'not_applied' };
          if (result.error && NOT_APPLIED.has(result.error.code)) {
            return { ok: false, error: result.error.code, actionOutcome: 'not_applied' };
          }
          entry.quarantined = true;
          return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
        }
        const actionOutcome =
          action.kind === 'wait' ? ('not_applied' as const) : ('applied' as const);
        if (!this.current(entry)) return { ok: false, error: 'session_stopped', actionOutcome };
        return { ...(await this.observeEntry(entry)), actionOutcome };
      },
      true,
    );
  }

  /** Session-scoped close for a future authenticated command endpoint. */
  async close(taskId: string, sessionId: string): Promise<{ ok: boolean }> {
    if (!this.find(taskId, sessionId)) return { ok: false };
    await this.stopTask(taskId);
    return { ok: true };
  }

  /** Privileged INTERNAL cancellation, also needed after logout. Never expose
   * directly as a client-supplied command; use close(taskId, sessionId) there.
   * Closing admission is immediate; releasing the driver waits for the actual
   * operation, not a timeout race. Caller may time out but must not infer idle. */
  async stopTask(taskId: string): Promise<void> {
    const entry = this.entry;
    if (!entry || entry.taskId !== taskId) return;
    entry.stopped = true;
    await entry.pending;
    entry.disposal ??= Promise.resolve()
      .then(() => entry.driver?.dispose())
      .catch((error) => {
        // Retain the stopped seat and driver handles until cleanup succeeds.
        // A later lifecycle cancellation may retry detach, never the input.
        entry.disposal = undefined;
        throw error;
      });
    await entry.disposal;
    if (this.entry === entry) this.entry = null;
  }

  private current(entry: Entry): boolean {
    return this.entry === entry && !entry.stopped && entry.owner === this.deps.owner();
  }

  private find(taskId: string, sessionId: string): Entry | null {
    const entry = this.entry;
    return entry && this.current(entry) && entry.taskId === taskId && entry.id === sessionId
      ? entry
      : null;
  }

  private async observeEntry(entry: Entry): Promise<SessionReply> {
    entry.ready = false;
    if (!this.current(entry) || !entry.driver) return { ok: false, error: 'session_unavailable' };
    let result: DriverResult;
    try {
      result = await entry.driver.observeCurrentPage();
    } catch {
      return { ok: false, error: 'observation_failed' };
    }
    if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
    if (result.status === 'ok' && !identifiesTab(result.data, entry.tabId))
      return { ok: false, error: 'target_changed' };
    entry.ready = result.status === 'ok' && result.data !== undefined;
    return result.status === 'ok' && result.data !== undefined
      ? { ok: true, sessionId: entry.id, observation: result.data }
      : { ok: false, error: 'observation_failed' };
  }

  private track(
    entry: Entry,
    run: () => Promise<SessionReply>,
    input = false,
  ): Promise<SessionReply> {
    const pending = Promise.resolve()
      .then(run)
      .catch((): SessionReply => {
        if (input) entry.quarantined = true;
        return {
          ok: false,
          error: input ? 'input_outcome_unknown' : 'observation_failed',
          ...(input ? { actionOutcome: 'unknown' as const } : {}),
        };
      })
      .finally(() => {
        if (entry.pending === pending) entry.pending = null;
      });
    entry.pending = pending;
    return pending;
  }
}

function identifiesTab(data: unknown, tabId: number): boolean {
  return typeof data === 'object' && data !== null && 'tabId' in data && data.tabId === tabId;
}

function isWebNavigation(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}
