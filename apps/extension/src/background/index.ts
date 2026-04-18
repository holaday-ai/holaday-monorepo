/**
 * MV3 service worker entry point.
 *
 * Holds the single WebSocket to the orchestrator and keeps an in-memory
 * view of the user's in-flight tasks. The popup is stateless — it asks
 * the SW for current state on open and subscribes to updates while open.
 *
 * Step execution (W2 Day 4): `server.task.dispatch` frames are routed
 * through a lazy-initialized `HolaDayBrowserDriver`. In a real Chrome
 * SW this is `PlaywrightCrxAdapter` (uses chrome.debugger + playwright-
 * crx). Outside a real SW (dev / host without Chrome) we fall back to
 * `MockDriver` so the loop still runs for typecheck / build.
 */

import type { DriverAction, HolaDayBrowserDriver } from '@holaday/browser-driver';
import { MockDriver } from '@holaday/browser-driver/mock';
import type { ServerMessage } from '@holaday/shared-types';
import { getAccessToken } from '../shared/storage.js';
import { connect, disconnect, isConnected, onServerMessage, send } from './ws-client.js';

/**
 * Token storage key — must match `apps/extension/src/shared/storage.ts`.
 * Hard-coded here to avoid importing the constant just for this listener.
 */
const TOKEN_STORAGE_KEY = 'holaday.access_token';

/**
 * MV3 service worker keepalive alarm name. Period is 0.5min (=30s, the
 * Chrome stable minimum). Each fire wakes the SW from idle death and
 * re-runs the connect loop — this is the actual safety net against
 * MV3's silent SW recycling, which kills both `setInterval` heartbeats
 * and the WebSocket itself.
 */
const KEEPALIVE_ALARM = 'holaday.keepalive';
const KEEPALIVE_PERIOD_MIN = 0.5;

/**
 * Lazy driver factory.
 *
 * Driver mode is picked at build time via `VITE_BROWSER_DRIVER`:
 *   - `auto` (default): in a real Chrome SW → PlaywrightCrxAdapter, and
 *     if the dynamic import or capability check fails we THROW — the
 *     popup gets a DRIVER_CRASH on every dispatch until the underlying
 *     issue is fixed. No silent `{stub:true}` masquerading as success.
 *     Outside Chrome (build verification / typecheck host) → MockDriver.
 *   - `mock`: force MockDriver everywhere. For CI builds, headless
 *     smoke, and intentionally offline dogfood.
 *
 * Build example:
 *   pnpm --filter @holaday/extension build                      # auto
 *   VITE_BROWSER_DRIVER=mock pnpm --filter @holaday/extension build
 */
type DriverMode = 'auto' | 'mock';
const RAW_DRIVER_MODE = import.meta.env.VITE_BROWSER_DRIVER as string | undefined;
const DRIVER_MODE: DriverMode = RAW_DRIVER_MODE === 'mock' ? 'mock' : 'auto';

let driverPromise: Promise<HolaDayBrowserDriver> | null = null;
async function getDriver(): Promise<HolaDayBrowserDriver> {
  if (driverPromise) return driverPromise;
  driverPromise = (async (): Promise<HolaDayBrowserDriver> => {
    if (DRIVER_MODE === 'mock') {
      console.info('[holaday] driver=MockDriver (VITE_BROWSER_DRIVER=mock)');
      return new MockDriver({ autoAckDelayMs: 200 });
    }

    const hasCrxRuntime =
      typeof chrome !== 'undefined' &&
      typeof chrome.debugger !== 'undefined' &&
      typeof chrome.tabs !== 'undefined';
    if (!hasCrxRuntime) {
      // Non-Chrome host (Vite dev, tsc host). Mock is the only sensible
      // option — `playwright-crx` can't run here at all.
      console.warn('[holaday] no chrome.debugger/tabs → MockDriver (build host fallback)');
      return new MockDriver({ autoAckDelayMs: 200 });
    }

    // Real Chrome SW: load the adapter. Any failure here is a real bug
    // (missing permission, bundle error, playwright-crx incompat) — we
    // surface it on every dispatch as DRIVER_CRASH instead of falling
    // back to Mock, which was the W2 Day-5 smoke-test trap (`{stub:true}`
    // in extract output looked like "it worked" when it hadn't).
    const { PlaywrightCrxAdapter } = await import('@holaday/browser-driver/crx');
    console.info('[holaday] driver=PlaywrightCrxAdapter (real Chrome)');
    return new PlaywrightCrxAdapter();
  })();
  // If the adapter load rejects, clear the cached promise so the next
  // dispatch (possibly after a user toggles permission / reloads) can
  // retry cleanly instead of being stuck on the old failure.
  driverPromise.catch(() => {
    driverPromise = null;
  });
  return driverPromise;
}

type StepStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'awaiting_user';

interface StepView {
  id: string;
  kind: string;
  status: StepStatus;
}

type TaskStatus =
  | 'planning'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

type PauseReason = 'user' | 'retries_exhausted' | 'quota_exceeded';

interface BatchItemView {
  label: string;
  preview: string;
  meta?: Record<string, unknown>;
}

type PendingConfirmView =
  | {
      kind: 'single';
      stepId: string;
      prompt: string;
      risk: 'low' | 'medium' | 'high';
    }
  | {
      kind: 'batch';
      stepId: string;
      batchIndex: number;
      batchTotal: number;
      items: BatchItemView[];
      risk: 'low' | 'medium' | 'high';
      summary?: string;
    };

interface TaskView {
  taskId: string;
  status: TaskStatus;
  steps: StepView[];
  pendingConfirm?: PendingConfirmView | null;
  pauseReason?: PauseReason | null;
  lastUpdated: number;
}

interface State {
  lastWelcomeAt: number | null;
  tasks: Map<string, TaskView>;
}

const state: State = {
  lastWelcomeAt: null,
  tasks: new Map(),
};

// ---------- WS → SW state updates ----------

onServerMessage((msg) => {
  if (msg.type === 'server.welcome') {
    state.lastWelcomeAt = Date.now();
    console.info('[holaday] welcome', msg);
    return;
  }
  if (msg.type === 'server.error') {
    console.warn('[holaday] server error', msg);
    return;
  }
  if (msg.type === 'server.task.dispatch') {
    onDispatch(msg);
    return;
  }
  if (msg.type === 'server.user.confirm') {
    onUserConfirm(msg);
    return;
  }
  if (msg.type === 'server.batch_confirm_required') {
    onBatchConfirm(msg);
    return;
  }
  if (msg.type === 'server.task.control') {
    onTaskControl(msg);
    return;
  }
  console.debug('[holaday] msg', msg);
});

function onDispatch(msg: Extract<ServerMessage, { type: 'server.task.dispatch' }>): void {
  let task = state.tasks.get(msg.taskId);
  if (!task) {
    task = {
      taskId: msg.taskId,
      status: 'executing',
      steps: [
        {
          id: msg.stepId,
          kind: msg.action.kind,
          status: 'executing',
        },
      ],
      lastUpdated: Date.now(),
    };
    state.tasks.set(msg.taskId, task);
  } else {
    const existingIdx = task.steps.findIndex((s) => s.id === msg.stepId);
    if (existingIdx < 0) {
      task.steps.push({ id: msg.stepId, kind: msg.action.kind, status: 'executing' });
    } else {
      const step = task.steps[existingIdx];
      if (step) step.status = 'executing';
    }
    task.status = 'executing';
    task.pauseReason = null;
    task.lastUpdated = Date.now();
  }
  pushTasksSnapshot();

  // Real execution path (W2 Day 4): hand the action to the driver.
  // The driver is PlaywrightCrxAdapter in a real Chrome SW, MockDriver
  // elsewhere. Either way we translate the result back to a
  // client.step.result frame the orchestrator's TaskController expects.
  void runStep(msg);
}

async function runStep(
  msg: Extract<ServerMessage, { type: 'server.task.dispatch' }>,
): Promise<void> {
  const action: DriverAction = {
    kind: msg.action.kind,
    ...(msg.action.selector ? { selector: msg.action.selector } : {}),
    ...(msg.action.payload ? { payload: msg.action.payload } : {}),
    ...(msg.deadlineMs ? { deadlineMs: msg.deadlineMs } : {}),
  };
  const startedAt = Date.now();
  try {
    const driver = await getDriver();
    const result = await driver.execute(action);
    const elapsed = Date.now() - startedAt;
    console.info('[holaday] step done', {
      taskId: msg.taskId,
      stepId: msg.stepId,
      kind: msg.action.kind,
      status: result.status,
      elapsed,
    });
    send({
      type: 'client.step.result',
      taskId: msg.taskId,
      stepId: msg.stepId,
      status: result.status,
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
    const t = state.tasks.get(msg.taskId);
    if (t) {
      const step = t.steps.find((s) => s.id === msg.stepId);
      if (step) {
        step.status =
          result.status === 'ok'
            ? 'completed'
            : result.status === 'awaiting_user'
              ? 'awaiting_user'
              : 'failed';
      }
      t.lastUpdated = Date.now();
      pushTasksSnapshot();
    }
  } catch (err) {
    console.error('[holaday] step crash', err);
    send({
      type: 'client.step.result',
      taskId: msg.taskId,
      stepId: msg.stepId,
      status: 'error',
      error: {
        code: 'DRIVER_CRASH',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function onUserConfirm(msg: Extract<ServerMessage, { type: 'server.user.confirm' }>): void {
  let task = state.tasks.get(msg.taskId);
  if (!task) {
    task = {
      taskId: msg.taskId,
      status: 'awaiting_user',
      steps: [{ id: msg.stepId, kind: 'unknown', status: 'awaiting_user' }],
      lastUpdated: Date.now(),
    };
    state.tasks.set(msg.taskId, task);
  }
  task.status = 'awaiting_user';
  task.pendingConfirm = {
    kind: 'single',
    stepId: msg.stepId,
    prompt: msg.prompt,
    risk: msg.risk,
  };
  task.lastUpdated = Date.now();
  const step = task.steps.find((s) => s.id === msg.stepId);
  if (step) step.status = 'awaiting_user';
  pushTasksSnapshot();
}

function onBatchConfirm(
  msg: Extract<ServerMessage, { type: 'server.batch_confirm_required' }>,
): void {
  let task = state.tasks.get(msg.taskId);
  if (!task) {
    task = {
      taskId: msg.taskId,
      status: 'awaiting_user',
      steps: [{ id: msg.stepId, kind: 'unknown', status: 'awaiting_user' }],
      lastUpdated: Date.now(),
    };
    state.tasks.set(msg.taskId, task);
  }
  task.status = 'awaiting_user';
  task.pendingConfirm = {
    kind: 'batch',
    stepId: msg.stepId,
    batchIndex: msg.batchIndex,
    batchTotal: msg.batchTotal,
    items: msg.items,
    risk: msg.risk,
    ...(msg.summary ? { summary: msg.summary } : {}),
  };
  task.lastUpdated = Date.now();
  const step = task.steps.find((s) => s.id === msg.stepId);
  if (step) step.status = 'awaiting_user';
  pushTasksSnapshot();
}

function onTaskControl(msg: Extract<ServerMessage, { type: 'server.task.control' }>): void {
  const task = state.tasks.get(msg.taskId);
  if (!task) return;
  if (msg.command === 'pause') {
    task.status = 'paused';
    task.pauseReason = (msg.reason as PauseReason | undefined) ?? 'user';
  } else if (msg.command === 'resume') {
    task.status = 'executing';
    task.pauseReason = null;
  } else if (msg.command === 'cancel') {
    task.status = 'cancelled';
    task.pauseReason = null;
  }
  task.lastUpdated = Date.now();
  pushTasksSnapshot();
}

// ---------- WS lifecycle ↔ MV3 SW lifecycle ----------

/**
 * Try to (re)open the WS using whatever token is in storage. Idempotent
 * on the ws-client side, so multiple call sites — onInstalled, onStartup,
 * keepalive alarm, storage change, popup nudge — are all safe to fire
 * concurrently. The MV3 SW gets killed after ~30s of idle so this
 * function is the single point we rely on to come back from the dead.
 */
async function ensureConnected(): Promise<void> {
  if (isConnected()) return;
  const token = await getAccessToken();
  if (token) connect(token);
}

// Install/startup are the obvious wake-ups, but in MV3 they fire only on
// install/update or browser launch — the SW also dies and respawns
// many times during a session, and neither event fires for those.
// That's why ensureConnected ALSO runs on the keepalive alarm and on
// every storage write below.
chrome.runtime.onInstalled.addListener(() => {
  void ensureConnected();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureConnected();
});

// Auto-reconnect when the popup writes a fresh token (login) or clears
// it (logout). This is what closes the gap "popup logged in but SW
// never noticed" — without it the user would have to manually trigger
// a chrome.runtime.sendMessage to wake the SW.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const change = changes[TOKEN_STORAGE_KEY];
  if (!change) return;
  if (typeof change.newValue === 'string' && change.newValue) {
    connect(change.newValue);
  } else if (change.oldValue && !change.newValue) {
    disconnect();
    state.tasks.clear();
  }
});

// Keepalive: chrome.alarms survive SW death. When the SW is recycled,
// the next alarm tick respawns it and we re-establish the WS. The
// 30-second cadence is Chrome's stable minimum and matches our
// HEARTBEAT_INTERVAL_MS — see shared-types/ws.ts.
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MIN });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void ensureConnected();
});

// Top-level boot reconnect. Runs whenever the SW module is (re)loaded —
// on install, on browser start, on alarm wakeup, on event-driven respawn.
// Pairs with the alarm above to make "always be trying to be connected"
// the default state whenever a token exists.
void ensureConnected();

// ---------- Popup ⇄ SW messaging ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'holaday.connect' && typeof msg.token === 'string') {
    connect(msg.token);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'holaday.disconnect') {
    disconnect();
    state.tasks.clear();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'holaday.status') {
    sendResponse({ lastWelcomeAt: state.lastWelcomeAt });
    return true;
  }
  if (msg?.type === 'holaday.tasks') {
    sendResponse({ tasks: tasksSnapshot() });
    return true;
  }
  return false;
});

function tasksSnapshot(): TaskView[] {
  return [...state.tasks.values()].sort((a, b) => b.lastUpdated - a.lastUpdated);
}

function pushTasksSnapshot(): void {
  // Fire-and-forget; popup may be closed — chrome.runtime surfaces a
  // "receiving end does not exist" error we can ignore.
  chrome.runtime
    .sendMessage({ type: 'holaday.tasks.update', tasks: tasksSnapshot() })
    .catch(() => {});
}
