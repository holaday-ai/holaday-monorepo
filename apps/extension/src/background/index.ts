/**
 * MV3 service worker entry point.
 *
 * Holds the single WebSocket to the orchestrator and keeps an in-memory
 * view of the user's in-flight tasks. The popup is stateless — it asks
 * the SW for current state on open and subscribes to updates while open.
 *
 * Phase 0 step execution is **stubbed**: every server.task.dispatch is
 * auto-acked 500ms later with client.step.result status='ok'. Real DOM
 * I/O lands with Playwright-CRX in W2; the stub exists so the whole
 * Agent Loop (dispatch → result → advance → awaiting_user confirm →
 * pause → resume) is demonstrable end-to-end at the W1 checkpoint.
 */

import type { ServerMessage } from '@holaday/shared-types';
import { getAccessToken } from '../shared/storage.js';
import { connect, disconnect, onServerMessage, send } from './ws-client.js';

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

interface TaskView {
  taskId: string;
  status: TaskStatus;
  steps: StepView[];
  pendingConfirm?: { stepId: string; prompt: string; risk: 'low' | 'medium' | 'high' } | null;
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

const AUTO_ACK_DELAY_MS = 500;

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

  // Stub execution: auto-ack after a short delay so the Agent Loop
  // visibly advances without real DOM automation (W2 replaces this).
  setTimeout(() => {
    console.info('[holaday] stub-exec ok', { taskId: msg.taskId, stepId: msg.stepId });
    send({
      type: 'client.step.result',
      taskId: msg.taskId,
      stepId: msg.stepId,
      status: 'ok',
      data: { stub: true, kind: msg.action.kind },
    });
    const t = state.tasks.get(msg.taskId);
    if (t) {
      const step = t.steps.find((s) => s.id === msg.stepId);
      if (step) step.status = 'completed';
      t.lastUpdated = Date.now();
      pushTasksSnapshot();
    }
  }, AUTO_ACK_DELAY_MS);
}

function onUserConfirm(msg: Extract<ServerMessage, { type: 'server.user.confirm' }>): void {
  let task = state.tasks.get(msg.taskId);
  if (!task) {
    // Rehydrated task we hadn't seen yet — seed a minimal view.
    task = {
      taskId: msg.taskId,
      status: 'awaiting_user',
      steps: [{ id: msg.stepId, kind: 'unknown', status: 'awaiting_user' }],
      lastUpdated: Date.now(),
    };
    state.tasks.set(msg.taskId, task);
  }
  task.status = 'awaiting_user';
  task.pendingConfirm = { stepId: msg.stepId, prompt: msg.prompt, risk: msg.risk };
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
