import {
  USER_BROWSER_PROTOCOL,
  type UserBrowserProtocol,
  type UserBrowserBinding,
  type UserBrowserTargetDescription,
} from '@holaday/shared-types';
import type { DriverAction, DriverResult } from '@holaday/browser-driver';

export interface SelectedChromeDriver {
  attachExistingTab(): Promise<DriverResult>;
  observeCurrentPage(): Promise<DriverResult>;
  execute(action: DriverAction): Promise<DriverResult>;
  describeTarget?(action: DriverAction, revision: number): Promise<DriverResult>;
  executeBound?(action: DriverAction, binding: UserBrowserBinding): Promise<DriverResult>;
  dispose(): Promise<void>;
}

export type SessionReply =
  | {
      ok: true;
      sessionId: string;
      observation?: unknown;
      target?: UserBrowserTargetDescription;
      protocol?: UserBrowserProtocol;
      tabs?: Array<{ tabId: number; origin: string; ownership: 'selected' | 'task' }>;
      actionOutcome?: 'applied' | 'not_applied';
    }
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
  /** The session's tab was closed (chrome.tabs.onRemoved). */
  tabClosed: boolean;
  v2: boolean;
  origins: readonly string[];
  tabs: Map<
    number,
    { driver: SelectedChromeDriver | null; origin: string; ownership: 'selected' | 'task' }
  >;
}

const SUPPORTED = new Set(['click', 'type', 'key', 'goto', 'wait']);
const BOUND_KINDS = new Set(['click', 'type', 'key', 'select']);
const NOT_APPLIED = new Set([
  'SELECTOR_NOT_FOUND',
  'SELECTOR_MISSING',
  'PAYLOAD_MISSING',
  'ORIGIN_BLOCKED',
  'NOT_ATTACHED',
  'target_binding_required',
  'target_changed',
  'stale_observation',
  'target_ambiguous',
  'target_missing',
  'target_unreadable',
  'origin_grant_required',
  'capability_missing',
]);

/** One local Chrome execution seat; the native CRX driver owns selectors. */
export class SelectedChromeSession {
  private entry: Entry | null = null;
  constructor(
    private readonly deps: {
      makeDriver: (
        tabId: number,
        options?: { v2: boolean; origins: readonly string[] },
      ) => SelectedChromeDriver;
      newTab?: (url: string) => Promise<number>;
      owner: () => string | null;
    },
  ) {}

  async open(input: {
    taskId: string;
    tabId: number;
    validate: () => Promise<void>;
    protocol?: UserBrowserProtocol;
    grantedOrigins?: readonly string[];
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
      tabClosed: false,
      v2: Boolean(input.protocol),
      origins: input.grantedOrigins ?? [],
      tabs: new Map(),
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
      if (entry.v2 && !entry.origins.length) return { ok: false, error: 'origin_grant_required' };
      entry.driver = entry.v2
        ? this.deps.makeDriver(input.tabId, { v2: true, origins: entry.origins })
        : this.deps.makeDriver(input.tabId);
      if (entry.v2 && (!entry.driver.describeTarget || !entry.driver.executeBound))
        return { ok: false, error: 'capability_missing' };
      entry.tabs.set(input.tabId, {
        driver: entry.driver,
        origin: entry.origins[0] ?? '',
        ownership: 'selected',
      });
      const attached = await entry.driver.attachExistingTab();
      if (attached.status !== 'ok')
        return {
          ok: false,
          error:
            attached.error?.code === 'ORIGIN_BLOCKED' ? 'origin_grant_required' : 'attach_failed',
        };
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

  /** Called from chrome.tabs.onRemoved: later actions fail fast with tab_closed. */
  markTabClosed(tabId: number): void {
    if (this.entry && this.entry.tabId === tabId) this.entry.tabClosed = true;
  }

  async observe(taskId: string, sessionId: string): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    return this.track(entry, () => this.observeEntry(entry));
  }

  async execute(
    taskId: string,
    sessionId: string,
    action: DriverAction,
    binding?: UserBrowserBinding,
  ): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (entry.tabClosed) return { ok: false, error: 'tab_closed', actionOutcome: 'not_applied' };
    if (!entry.ready) return { ok: false, error: 'observation_required' };
    if (entry.v2 && BOUND_KINDS.has(action.kind) && !binding)
      return { ok: false, error: 'target_binding_required', actionOutcome: 'not_applied' };
    if (
      entry.v2 &&
      action.kind === 'goto' &&
      !entry.origins.includes(webOrigin(action.payload?.url))
    )
      return { ok: false, error: 'origin_grant_required', actionOutcome: 'not_applied' };
    if (!SUPPORTED.has(action.kind) && !(entry.v2 && ['scroll', 'select'].includes(action.kind)))
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
          result =
            entry.v2 && BOUND_KINDS.has(action.kind) && binding && entry.driver.executeBound
              ? await entry.driver.executeBound(action, binding)
              : await entry.driver.execute(action);
        } catch (error) {
          if (action.kind === 'wait')
            return { ok: false, error: 'wait_failed', actionOutcome: 'not_applied' };
          throw error;
        }
        if (result.status !== 'ok') {
          if (action.kind === 'wait')
            return { ok: false, error: 'wait_failed', actionOutcome: 'not_applied' };
          if (result.error && NOT_APPLIED.has(result.error.code)) {
            // A selector "not found" because the tab went away is a closed tab, not a page change.
            return {
              ok: false,
              error: entry.tabClosed ? 'tab_closed' : result.error.code,
              actionOutcome: 'not_applied',
            };
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

  async describe(
    taskId: string,
    sessionId: string,
    action: DriverAction,
    revision: number,
  ): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (!entry.v2 || !entry.driver?.describeTarget)
      return { ok: false, error: 'capability_missing' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (!entry.ready || entry.quarantined) return { ok: false, error: 'observation_required' };
    return this.track(entry, async () => {
      const driver = entry.driver;
      if (!driver?.describeTarget) return { ok: false, error: 'capability_missing' };
      const result = await driver.describeTarget(action, revision);
      return result.status === 'ok'
        ? { ok: true, sessionId: entry.id, target: result.data as UserBrowserTargetDescription }
        : { ok: false, error: result.error?.code || 'target_unreadable' };
    });
  }

  async tabs(
    taskId: string,
    sessionId: string,
    command: { operation: 'list' | 'new' | 'switch'; tabId?: number; url?: string },
  ): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (!entry.v2) return { ok: false, error: 'capability_missing' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    return this.track(entry, async () => {
      if (command.operation === 'list')
        return {
          ok: true,
          sessionId: entry.id,
          tabs: [...entry.tabs].map(([tabId, tab]) => ({
            tabId,
            origin: tab.origin,
            ownership: tab.ownership,
          })),
        };
      let tabId = command.tabId;
      if (command.operation === 'new') {
        if (!command.url || !entry.origins.includes(webOrigin(command.url)))
          return { ok: false, error: 'origin_grant_required' };
        if (!this.deps.newTab) return { ok: false, error: 'capability_missing' };
        if (entry.tabs.size >= 10) return { ok: false, error: 'task_tab_limit' };
        tabId = await this.deps.newTab(command.url);
        entry.tabs.set(tabId, { driver: null, origin: webOrigin(command.url), ownership: 'task' });
      }
      if (tabId === undefined || !entry.tabs.has(tabId))
        return { ok: false, error: 'task_tab_required' };
      const tab = entry.tabs.get(tabId);
      if (!tab) return { ok: false, error: 'task_tab_required' };
      await entry.driver?.dispose();
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      tab.driver = this.deps.makeDriver(tabId, { v2: true, origins: entry.origins });
      entry.driver = tab.driver;
      entry.tabId = tabId;
      entry.tabClosed = false;
      entry.ready = false;
      const attached = await tab.driver.attachExistingTab();
      if (attached.status !== 'ok')
        return {
          ok: false,
          error:
            attached.error?.code === 'ORIGIN_BLOCKED' ? 'origin_grant_required' : 'attach_failed',
        };
      return this.observeEntry(entry);
    });
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
      .then(async () => {
        for (const tab of entry.tabs.values()) await tab.driver?.dispose();
      })
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
    if (entry.tabClosed) return { ok: false, error: 'tab_closed' };
    let result: DriverResult;
    try {
      result = await entry.driver.observeCurrentPage();
    } catch {
      return { ok: false, error: entry.tabClosed ? 'tab_closed' : 'observation_failed' };
    }
    if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
    if (result.status === 'ok' && !identifiesTab(result.data, entry.tabId))
      return { ok: false, error: 'target_changed' };
    entry.ready = result.status === 'ok' && result.data !== undefined;
    return result.status === 'ok' && result.data !== undefined
      ? {
          ok: true,
          sessionId: entry.id,
          observation: result.data,
          ...(entry.v2
            ? {
                tabs: [...entry.tabs].map(([tabId, tab]) => ({
                  tabId,
                  origin: tab.origin,
                  ownership: tab.ownership,
                })),
              }
            : {}),
          ...(entry.v2
            ? {
                protocol: {
                  ...USER_BROWSER_PROTOCOL,
                  capabilities: [...USER_BROWSER_PROTOCOL.capabilities],
                },
              }
            : {}),
        }
      : {
          ok: false,
          error: entry.tabClosed
            ? 'tab_closed'
            : result.error?.code === 'ORIGIN_BLOCKED'
              ? 'origin_grant_required'
              : 'observation_failed',
        };
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

function webOrigin(raw: unknown): string {
  try {
    return new URL(String(raw)).origin;
  } catch {
    return '';
  }
}
