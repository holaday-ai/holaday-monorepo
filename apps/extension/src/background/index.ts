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

// MV3 Service Worker has no `window`. Vite 6 / CRXJS 2.0.0-beta.31 still
// emit a `__vitePreload` helper that calls `window.dispatchEvent(...)`
// on dynamic-import rejection — even with `build.modulePreload = false`
// — and the synthetic ReferenceError there masks whatever the real
// import failure was. We can't reach into the helper, so we install the
// narrowest possible shim here instead: JUST the property the helper
// calls, on the SW global. We deliberately DON'T alias
// `window = globalThis`, which would fool libs that check
// `typeof window === "object"` into assuming a DOM. I audited every
// `window.*` reference in node_modules/playwright-crx/lib/ — they're
// all either typeof-guarded and short-circuit on our 1-key shim
// (window.process / .Buffer / .crypto / .console are all undefined in
// the shim, so the `&&` chains fall through), or they live inside
// page-evaluate string literals (executed in the target page's real
// DOM, not the SW, so never see this shim).
{
  const g = globalThis as unknown as { window?: { dispatchEvent: (e: Event) => boolean } };
  if (typeof g.window === 'undefined') {
    g.window = { dispatchEvent: () => true };
  }
}

import type { DriverAction, HolaDayBrowserDriver } from '@holaday/browser-driver';
// Static import of the crx adapter. MV3 SWs (per w3c/ServiceWorker#1356)
// forbid dynamic `import()` at runtime — `TypeError: import() is
// disallowed on ServiceWorkerGlobalScope` — so the adapter MUST be
// bundled into the SW entry itself. In `VITE_BROWSER_DRIVER=mock`
// builds, vite.config.ts aliases this specifier to a stub so the
// 3MB playwright-crx dependency doesn't come along for the ride.
import { PlaywrightCrxAdapter } from '@holaday/browser-driver/crx';
import { MockDriver } from '@holaday/browser-driver/mock';
import type { ServerMessage } from '@holaday/shared-types';
import { tryAutoLogin } from '../shared/auto-login.js';
import { getAccessToken, setAccessToken } from '../shared/storage.js';
import { captureVisionObservation, executeCdpAction, getActiveTabId } from './cdp-actions.js';
import { buildLoginStatesMessage, readLoginStates } from './cookie-bridge.js';
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

    // Real Chrome SW: the adapter is already in the bundle (static
    // import at the top of this file — MV3 forbids dynamic import()).
    // Any failure from here on surfaces as DRIVER_CRASH on every
    // dispatch instead of silently falling back to Mock, which was
    // the W2 Day-5 smoke-test trap (`{stub:true}` in extract output
    // looked like "it worked" when it hadn't).
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

type StepStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'awaiting_user' | 'skipped';

interface StepView {
  id: string;
  kind: string;
  status: StepStatus;
  /**
   * Driver result.data kept locally so the popup's Results section can
   * render extract texts and a screenshot thumbnail without another
   * round-trip to the orchestrator. Populated on the first ok/failed
   * result for the step; shape depends on the step kind (extract →
   * {texts[], count, matched}; screenshot → {sizeBytes, thumbnail}
   * where thumbnail is a base64 JPEG captured by the SW).
   */
  output?: unknown;
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

/**
 * Live progress marker for vision-loop tasks. Classic (plan-once)
 * tasks leave this undefined and render via their steps[] array.
 * Vision-loop tasks have an empty steps[] and rely on this field for
 * popup progress feedback: "observing → deciding → acting" cycling
 * until the loop terminates with completed (summary) or failed (reason).
 */
interface VisionProgressView {
  phase: VisionPhase;
  tickIndex?: number;
  actionKind?: string;
  /** On phase=completed → task_done summary. On phase=failed → give_up reason. */
  detail?: string;
}

interface TaskView {
  taskId: string;
  status: TaskStatus;
  steps: StepView[];
  pendingConfirm?: PendingConfirmView | null;
  pauseReason?: PauseReason | null;
  lastUpdated: number;
  visionProgress?: VisionProgressView;
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
    // Phase 14 — first welcome after a (re)connect is the right moment
    // to ship the current login-state snapshot. Forces lastLoginStatesAt
    // to 0 so the throttle in maybeReportLoginStates always fires.
    lastLoginStatesAt = 0;
    void maybeReportLoginStates();
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
  if (msg.type === 'server.vision.observe') {
    void onVisionObserve(msg);
    return;
  }
  if (msg.type === 'server.vision.act') {
    void onVisionAct(msg);
    return;
  }
  if (msg.type === 'server.task.terminal') {
    onTaskTerminal(msg);
    return;
  }
  console.debug('[holaday] msg', msg);
});

/**
 * Orchestrator signalled a vision-loop task reached a terminal state.
 * Update the SW's in-memory TaskView + push the final progress event
 * to the popup so its card reflects completed/failed without polling.
 *
 * Fires regardless of whether the SW saw the loop in action (it may
 * not have — a task can reach `task_done` on its first tick, before
 * the runner dispatches any `server.vision.act` frame). If the task
 * isn't in state.tasks yet, create it with the final status.
 */
function onTaskTerminal(msg: Extract<ServerMessage, { type: 'server.task.terminal' }>): void {
  const detail = msg.summary ?? msg.reason ?? '';
  const statusMap: Record<
    'completed' | 'failed' | 'paused' | 'cancelled',
    'completed' | 'failed' | 'paused' | 'cancelled'
  > = {
    completed: 'completed',
    failed: 'failed',
    paused: 'paused',
    cancelled: 'cancelled',
  };
  const nextStatus = statusMap[msg.status];
  const phase: VisionPhase =
    msg.status === 'completed' ? 'completed' : msg.status === 'failed' ? 'failed' : 'failed';

  let task = state.tasks.get(msg.taskId);
  if (!task) {
    task = {
      taskId: msg.taskId,
      status: nextStatus,
      steps: [],
      lastUpdated: Date.now(),
    };
    state.tasks.set(msg.taskId, task);
  }
  task.status = nextStatus;
  task.lastUpdated = Date.now();
  task.visionProgress = {
    phase,
    ...(detail ? { detail } : {}),
  };
  pushTasksSnapshot();
  // Also fire a vision.progress event so the popup's existing
  // listener (which un-sticks the Run button) sees the final state.
  pushVisionProgress(msg.taskId, phase, { detail });
}

/**
 * Capture an observation for the vision loop and send it back.
 * Never throws — capture errors land in the observation's `error`
 * field so the orchestrator exits the loop cleanly.
 */
async function onVisionObserve(
  msg: Extract<ServerMessage, { type: 'server.vision.observe' }>,
): Promise<void> {
  trackVisionTask(msg.taskId, 'observing', { tickIndex: msg.tickIndex });
  const tabId = await getActiveTabId();
  if (tabId === null) {
    send({
      type: 'client.vision.observation',
      taskId: msg.taskId,
      tickIndex: msg.tickIndex,
      screenshotBase64: '',
      viewportWidth: 0,
      viewportHeight: 0,
      url: '',
      title: '',
      error: 'no active tab (window may have been backgrounded before task started)',
    });
    return;
  }
  const obs = await captureVisionObservation(tabId);
  send({
    type: 'client.vision.observation',
    taskId: msg.taskId,
    tickIndex: msg.tickIndex,
    screenshotBase64: obs.screenshotBase64,
    viewportWidth: obs.viewportWidth,
    viewportHeight: obs.viewportHeight,
    url: obs.url,
    title: obs.title,
    ...(obs.error ? { error: obs.error } : {}),
  });
  // After sending observation → orchestrator is calling Claude next.
  trackVisionTask(msg.taskId, 'deciding', { tickIndex: msg.tickIndex });
}

/**
 * Execute a VisionAction via CDP and report back.
 * Coordinates in msg.action are already real viewport pixels — the
 * orchestrator pre-translated them from Claude's model-space.
 */
async function onVisionAct(
  msg: Extract<ServerMessage, { type: 'server.vision.act' }>,
): Promise<void> {
  trackVisionTask(msg.taskId, 'acting', {
    tickIndex: msg.tickIndex,
    actionKind: msg.action.kind,
  });
  // Terminal actions complete the loop — orchestrator won't send
  // another frame after this. Mark the task done/failed in the
  // SW's view so the popup renders the right final state.
  if (msg.action.kind === 'done' || msg.action.kind === 'give_up') {
    const finalStatus: 'completed' | 'failed' = msg.action.kind === 'done' ? 'completed' : 'failed';
    const detail = msg.action.kind === 'done' ? msg.action.summary : msg.action.reason;
    finaliseVisionTask(msg.taskId, finalStatus, detail);
    send({
      type: 'client.vision.acted',
      taskId: msg.taskId,
      tickIndex: msg.tickIndex,
      ok: true,
      message: `${msg.action.kind} terminal; no driver work`,
    });
    return;
  }
  const tabId = await getActiveTabId();
  if (tabId === null) {
    send({
      type: 'client.vision.acted',
      taskId: msg.taskId,
      tickIndex: msg.tickIndex,
      ok: false,
      message: 'no active tab',
    });
    return;
  }
  const result = await executeCdpAction(tabId, msg.action);
  send({
    type: 'client.vision.acted',
    taskId: msg.taskId,
    tickIndex: msg.tickIndex,
    ok: result.ok,
    ...(result.message ? { message: result.message } : {}),
  });
  // After action executed → orchestrator takes another observation
  // next. Signal "deciding" so the popup doesn't look frozen.
  trackVisionTask(msg.taskId, 'deciding', { tickIndex: msg.tickIndex });
}

// ---------- Vision-loop task tracking for the popup ----------

/**
 * Per-loop phase label shown in the popup's progress line.
 *  observing → SW capturing a screenshot for the orchestrator
 *  deciding  → orchestrator is calling Claude; loop is waiting
 *  acting    → SW executing a CDP action (click/type/scroll/…)
 *  completed → task_done received; summary in detail
 *  failed    → task_give_up received; reason in detail
 */
export type VisionPhase = 'observing' | 'deciding' | 'acting' | 'completed' | 'failed';

/**
 * Upsert a vision-loop task into the SW's in-memory view so the
 * popup's task list renders it. Vision tasks don't receive classic
 * `server.task.dispatch` frames, so without this helper the popup
 * never sees them. Called on every observe/act tick to keep
 * `lastUpdated` fresh.
 */
function trackVisionTask(
  taskId: string,
  phase: VisionPhase,
  detail: { tickIndex?: number; actionKind?: string },
): void {
  let task = state.tasks.get(taskId);
  if (!task) {
    task = {
      taskId,
      status: 'executing',
      steps: [],
      lastUpdated: Date.now(),
    };
    state.tasks.set(taskId, task);
  }
  task.status = 'executing';
  task.lastUpdated = Date.now();
  task.visionProgress = {
    phase,
    ...(detail.tickIndex !== undefined ? { tickIndex: detail.tickIndex } : {}),
    ...(detail.actionKind ? { actionKind: detail.actionKind } : {}),
  };
  pushTasksSnapshot();
  pushVisionProgress(taskId, phase, detail);
}

function finaliseVisionTask(taskId: string, status: 'completed' | 'failed', detail: string): void {
  const task = state.tasks.get(taskId);
  if (task) {
    task.status = status;
    task.visionProgress = {
      phase: status === 'completed' ? 'completed' : 'failed',
      detail,
    };
    task.lastUpdated = Date.now();
  }
  pushTasksSnapshot();
  pushVisionProgress(taskId, status === 'completed' ? 'completed' : 'failed', {
    detail,
  });
}

/**
 * Fire-and-forget notification to the popup. Mirrors `pushTasksSnapshot`'s
 * pattern — swallows "no receiver" errors (popup is closed).
 */
function pushVisionProgress(
  taskId: string,
  phase: VisionPhase,
  detail: { tickIndex?: number; actionKind?: string; detail?: string },
): void {
  chrome.runtime
    .sendMessage({
      type: 'holaday.vision.progress',
      taskId,
      phase,
      ...detail,
    })
    .catch(() => {});
}

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
    // Task-level origin allowlist forwarded from the orchestrator's
    // Skill union. Empty / missing means unrestricted; the adapter
    // enforces per-action (goto validates payload.url, non-goto
    // validates page.url()).
    ...(msg.allowedOrigins && msg.allowedOrigins.length > 0
      ? { allowedOrigins: msg.allowedOrigins }
      : {}),
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
    // Always ship the driver's raw data over WS — the orchestrator
    // needs the unmodified payload for task_steps.output persistence.
    send({
      type: 'client.step.result',
      taskId: msg.taskId,
      stepId: msg.stepId,
      status: result.status,
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.error ? { error: result.error } : {}),
    });

    // Thumbnail comes in `result.data.thumbnail` directly from the
    // driver now (commit landing this change). We used to re-capture
    // here via chrome.tabs.captureVisibleTab, but that API requires
    // the target window to be focused — breaking the "agent runs
    // unattended" product invariant. CDP-based page.screenshot in
    // the driver works regardless of focus, so we just pass the
    // driver's output through.
    const t = state.tasks.get(msg.taskId);
    if (t) {
      const step = t.steps.find((s) => s.id === msg.stepId);
      if (step) {
        step.status =
          result.status === 'ok'
            ? 'completed'
            : result.status === 'awaiting_user'
              ? 'awaiting_user'
              : result.status === 'skipped'
                ? 'skipped'
                : 'failed';
        step.output = result.data;
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
  let token = await getAccessToken();
  // Phase 14 — opportunistic auto-login. If the user has a holaday.ai
  // session cookie in this Chrome profile, lift the JWT into our
  // local storage so the SW comes online without a separate sign-in
  // through the popup. Strict: only fires when we have nothing
  // already stored — never overwrites a token the user explicitly
  // installed.
  if (!token) {
    const lifted = await tryAutoLogin();
    if (lifted) {
      try {
        await setAccessToken(lifted);
        token = lifted;
        console.info('[holaday] auto-login: imported token from holaday.ai cookie');
      } catch (err) {
        console.warn('[holaday] auto-login: setAccessToken failed', err);
      }
    }
  }
  if (token) connect(token);
}

// Phase 14 — periodic login-state report. The SW samples the user's
// cookies for tracked domains and ships a domain → boolean map over
// the existing WS so the orchestrator's playbook router can log
// "user has Chrome login for X" when a matched playbook is login-
// required. Runs at most once every LOGIN_STATES_PERIOD_MS, gated
// on the WS being open. Best-effort: cookie-read errors fall through
// to `false` per-domain.
const LOGIN_STATES_PERIOD_MS = 5 * 60 * 1000;
let lastLoginStatesAt = 0;

async function maybeReportLoginStates(): Promise<void> {
  if (!isConnected()) return;
  const now = Date.now();
  if (now - lastLoginStatesAt < LOGIN_STATES_PERIOD_MS) return;
  lastLoginStatesAt = now;
  try {
    const states = await readLoginStates();
    const ok = send(buildLoginStatesMessage(states));
    if (!ok) {
      // WS closed between the readiness check and the send — clear
      // the throttle so the next alarm tick retries immediately
      // instead of waiting 5 minutes.
      lastLoginStatesAt = 0;
    }
  } catch (err) {
    console.warn('[holaday] cookie-bridge: report failed', err);
    lastLoginStatesAt = 0;
  }
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
  if (alarm.name === KEEPALIVE_ALARM) {
    void ensureConnected().then(() => maybeReportLoginStates());
  }
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
