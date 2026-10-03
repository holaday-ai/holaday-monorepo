import type { DriverAction } from '@holaday/browser-driver';
import type { SelectedChromeSessionCommand } from '@holaday/shared-types';
import type {
  BrowserExecutionOwnership,
  SelectedBrowserExecutionLease,
} from './browser-execution-ownership.js';
import type { SessionReply } from './selected-chrome-session.js';

type ActionOutcome = 'applied' | 'not_applied' | 'unknown';

export type SelectedChromeTransportReply =
  | SessionReply
  | { ok: true; closed: true }
  | { ok: false; error: string; actionOutcome?: ActionOutcome };

export interface SelectedChromeBridge {
  open(
    taskId: string,
    target: Extract<SelectedChromeSessionCommand, { op: 'open' }>['target'],
  ): Promise<SessionReply>;
  observe(taskId: string, sessionId: string): Promise<SessionReply>;
  execute(taskId: string, sessionId: string, action: DriverAction): Promise<SessionReply>;
  close(taskId: string, sessionId: string): Promise<{ ok: boolean }>;
  stopTask(taskId: string): Promise<void>;
}

interface ActiveSession {
  taskId: string;
  owner: string;
  lease: SelectedBrowserExecutionLease;
  sessionId: string | null;
  bridgeStarted: boolean;
  stopping: boolean;
  closeCleanupFailed: boolean;
  operation: Promise<SelectedChromeTransportReply> | null;
  cleanup: Promise<void> | null;
}

interface ClosedSession {
  taskId: string;
  sessionId: string;
  owner: string;
  closedAt: number;
}

const CLOSED_SESSION_TTL_MS = 60_000;
const MAX_CLOSED_SESSIONS = 100;
const CONFIRMED_PRE_DISPATCH = new Set([
  'browser_busy',
  'session_unavailable',
  'observation_required',
]);

/** Selected-session protocol over the already-tested bridge. */
export function createSelectedChromeTransport(deps: {
  bridge: SelectedChromeBridge;
  ownership: BrowserExecutionOwnership;
  prepareLegacy: () => Promise<void>;
  currentOwner: () => string | null;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let active: ActiveSession | null = null;
  const closedSessions: ClosedSession[] = [];

  function release(entry: ActiveSession): void {
    if (active === entry) active = null;
    entry.lease.release();
  }

  async function cleanup(entry: ActiveSession): Promise<void> {
    entry.cleanup ??= Promise.resolve()
      .then(async () => {
        if (entry.bridgeStarted) await deps.bridge.stopTask(entry.taskId);
        release(entry);
      })
      .catch((error) => {
        entry.cleanup = null;
        throw error;
      });
    await entry.cleanup;
  }

  function rememberClosed(entry: ActiveSession, sessionId: string): void {
    const cutoff = now() - CLOSED_SESSION_TTL_MS;
    while (closedSessions[0] && closedSessions[0].closedAt < cutoff) closedSessions.shift();
    closedSessions.push({ taskId: entry.taskId, sessionId, owner: entry.owner, closedAt: now() });
    while (closedSessions.length > MAX_CLOSED_SESSIONS) closedSessions.shift();
  }

  function wasRecentlyClosed(taskId: string, sessionId: string): boolean {
    const owner = deps.currentOwner();
    const cutoff = now() - CLOSED_SESSION_TTL_MS;
    while (closedSessions[0] && closedSessions[0].closedAt < cutoff) closedSessions.shift();
    return closedSessions.some(
      (entry) => entry.taskId === taskId && entry.sessionId === sessionId && entry.owner === owner,
    );
  }

  async function run(
    entry: ActiveSession,
    operation: () => Promise<SelectedChromeTransportReply>,
  ): Promise<SelectedChromeTransportReply> {
    if (entry.operation) return { ok: false, error: 'browser_busy' };
    const pending = Promise.resolve().then(operation);
    entry.operation = pending;
    try {
      return await pending;
    } finally {
      if (entry.operation === pending) entry.operation = null;
    }
  }

  async function open(
    taskId: string,
    command: Extract<SelectedChromeSessionCommand, { op: 'open' }>,
  ): Promise<SelectedChromeTransportReply> {
    if (active) return { ok: false, error: 'browser_busy' };
    const owner = deps.currentOwner();
    if (!owner) return { ok: false, error: 'session_unavailable' };
    const lease = deps.ownership.acquireSelected();
    if (!lease) return { ok: false, error: 'browser_busy' };
    const entry: ActiveSession = {
      taskId,
      owner,
      lease,
      sessionId: null,
      bridgeStarted: false,
      stopping: false,
      closeCleanupFailed: false,
      operation: null,
      cleanup: null,
    };
    active = entry;

    return run(entry, async () => {
      try {
        await deps.prepareLegacy();
      } catch {
        release(entry);
        return { ok: false, error: 'legacy_cleanup_failed' };
      }
      if (entry.stopping || deps.currentOwner() !== entry.owner) {
        release(entry);
        return { ok: false, error: 'session_unavailable' };
      }

      entry.bridgeStarted = true;
      let reply: SessionReply;
      try {
        reply = await deps.bridge.open(taskId, command.target);
      } catch {
        try {
          await cleanup(entry);
        } catch {
          return { ok: false, error: 'session_cleanup_failed' };
        }
        return { ok: false, error: 'attach_failed' };
      }
      if (entry.stopping) return { ok: false, error: 'session_unavailable' };
      if (!reply.ok) {
        try {
          await cleanup(entry);
        } catch {
          return { ok: false, error: 'session_cleanup_failed' };
        }
        return reply;
      }
      entry.sessionId = reply.sessionId;
      return reply;
    });
  }

  async function handle(
    taskId: string,
    command: SelectedChromeSessionCommand,
  ): Promise<SelectedChromeTransportReply> {
    if (command.op === 'open') return open(taskId, command);

    if (command.op === 'close' && wasRecentlyClosed(taskId, command.sessionId)) {
      return { ok: true, closed: true };
    }

    const entry = active;
    if (
      !entry ||
      entry.taskId !== taskId ||
      entry.sessionId !== command.sessionId ||
      deps.currentOwner() !== entry.owner
    ) {
      return {
        ok: false,
        error: 'session_unavailable',
        ...(command.op === 'act' ? { actionOutcome: 'not_applied' as const } : {}),
      };
    }

    if (command.op === 'close') {
      entry.stopping = true;
      if (entry.operation) await entry.operation.catch(() => undefined);
      if (entry.closeCleanupFailed) {
        try {
          await cleanup(entry);
          rememberClosed(entry, command.sessionId);
          return { ok: true, closed: true };
        } catch {
          return { ok: false, error: 'session_cleanup_failed' };
        }
      }
      try {
        const reply = await deps.bridge.close(taskId, command.sessionId);
        if (!reply.ok) {
          entry.stopping = false;
          return { ok: false, error: 'session_unavailable' };
        }
        rememberClosed(entry, command.sessionId);
        release(entry);
        return { ok: true, closed: true };
      } catch {
        entry.closeCleanupFailed = true;
        return { ok: false, error: 'session_cleanup_failed' };
      }
    }

    if (entry.stopping) {
      return {
        ok: false,
        error: 'session_unavailable',
        ...(command.op === 'act' ? { actionOutcome: 'not_applied' as const } : {}),
      };
    }

    if (command.op === 'observe') {
      return run(entry, () =>
        entry.stopping
          ? Promise.resolve({ ok: false, error: 'session_unavailable' })
          : deps.bridge.observe(taskId, command.sessionId),
      );
    }

    const reply = await run(entry, async () => {
      if (entry.stopping) {
        return {
          ok: false,
          error: 'session_unavailable',
          actionOutcome: 'not_applied',
        };
      }
      try {
        return await deps.bridge.execute(taskId, command.sessionId, command.action);
      } catch {
        return {
          ok: false,
          error: 'input_outcome_unknown',
          actionOutcome: 'unknown',
        };
      }
    });
    return !reply.ok && !reply.actionOutcome && CONFIRMED_PRE_DISPATCH.has(reply.error)
      ? { ...reply, actionOutcome: 'not_applied' }
      : reply;
  }

  async function stopTask(taskId: string): Promise<void> {
    const entry = active;
    if (!entry || entry.taskId !== taskId) return;
    entry.stopping = true;
    while (entry.operation) {
      const pending = entry.operation;
      await pending.catch(() => undefined);
      if (entry.operation === pending) break;
    }
    await cleanup(entry);
  }

  // Trusted auth lifecycle hook. Uses the entry's task identity, not UI state
  // that logout clears, and closes admission synchronously via stopTask.
  async function stopOnOwnerChange(nextOwner: string | null): Promise<void> {
    const entry = active;
    if (!entry || entry.owner === nextOwner) return;
    await stopTask(entry.taskId);
  }

  return { handle, stopTask, stopOnOwnerChange };
}
