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
import { connect, disconnect, onServerMessage, send } from './ws-client.js';

/**
 * Lazy driver factory.
 *
 * Runtime Chrome SW path: dynamically import the Playwright-CRX adapter
 * (which uses chrome.debugger + chrome.tabs and is only meaningful inside
 * the extension SW).
 *
 * Fallback path (Vite dev / smoke-outside-Chrome / tests that import this
 * module to type-check the SW): fall back to the MockDriver stub so the
 * loop is still testable. The capability flag `typeof chrome !== 'undefined'`
 * is the cleanest "am I in a real SW?" check MV3 gives us.
 */
let driverPromise: Promise<HolaDayBrowserDriver> | null = null;
async function getDriver(): Promise<HolaDayBrowserDriver> {
  if (driverPromise) return driverPromise;
  driverPromise = (async (): Promise<HolaDayBrowserDriver> => {
    const hasCrxRuntime =
      typeof chrome !== 'undefined' &&
      typeof chrome.debugger !== 'undefined' &&
      typeof chrome.tabs !== 'undefined';
    if (!hasCrxRuntime) {
      console.warn('[holaday] no CRX runtime, falling back to MockDriver (stub)');
      return new MockDriver({ autoAckDelayMs: 200 });
    }
    try {
      const { PlaywrightCrxAdapter } = await import('@holaday/browser-driver/crx');
      console.info('[holaday] PlaywrightCrxAdapter ready');
      return new PlaywrightCrxAdapter();
    } catch (err) {
      console.error('[holaday] failed to load PlaywrightCrxAdapter, using MockDriver', err);
      return new MockDriver({ autoAckDelayMs: 200 });
    }
  })();
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

// ---------- Popup ⇄ SW messaging ----------

chrome.runtime.onInstalled.addListener(async () => {
  const token = await getAccessToken();
  if (token) connect(token);
});

chrome.runtime.onStartup.addListener(async () => {
  const token = await getAccessToken();
  if (token) connect(token);
});

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
