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
import {
  clearAccessToken,
  clearStoredUser,
  getAccessToken,
  normalizeAccessToken,
  setAccessToken,
} from '../shared/storage.js';
import { captureVisionObservation, executeCdpAction, getActiveTabId } from './cdp-actions.js';
import { buildLoginStatesMessage, readLoginStates } from './cookie-bridge.js';
import { runCookieSync } from './cookie-sync.js';
import { runHistorySync } from './history-sync.js';
import { handleExtensionToolCall } from './extension-tools.js';
import { isTrustedAuthBridgeSender } from './auth-bridge-trust.js';
import { decideAuthTokenAction } from './auth-token-handler.js';
import { withDeadline } from '../shared/deadline.js';
import {
  connect,
  disconnect,
  getWsConnectionStatus,
  isConnected,
  isReconnectCapped,
  onServerMessage,
  onUnauthorized,
  reconnect,
  resetWsReconnectAttempts,
  send,
} from './ws-client.js';

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
  | 'partial_success'
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
    // Phase 17 — also kick off a full cookie-value sync on welcome,
    // throttled at most once per WELCOME_COOKIE_SYNC_DEBOUNCE_MS.
    // Best-effort: errors logged + swallowed.
    void maybeRunCookieSync('welcome');
    // Phase 25 — and a browsing-history sync. 24h gate inside the
    // helper means the welcome path is also rate-limited; first
    // post-install welcome fires it, subsequent same-day welcomes
    // skip.
    void maybeRunHistorySync('welcome');
    // Successful auth → reset the failure counter + known-bad
    // tracking so a future genuine failure starts fresh. Also
    // cancels any pending backoff retry that's no longer needed.
    if (pendingAuthRetry) {
      clearTimeout(pendingAuthRetry);
      pendingAuthRetry = null;
    }
    void resetAuthFailureState();
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
  if (msg.type === 'server.extension.tool_call') {
    // Phase 25 Mode B v0.1 — orchestrator wants us to drive the
    // user's local Chrome (login state inherited). Fire-and-forget;
    // handleExtensionToolCall owns the result-send path on every
    // success/failure branch.
    void handleExtensionToolCall(msg);
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
    'completed' | 'partial_success' | 'failed' | 'paused' | 'cancelled',
    'completed' | 'partial_success' | 'failed' | 'paused' | 'cancelled'
  > = {
    completed: 'completed',
    partial_success: 'partial_success',
    failed: 'failed',
    paused: 'paused',
    cancelled: 'cancelled',
  };
  const nextStatus = statusMap[msg.status];
  const phase: VisionPhase =
    msg.status === 'completed' || msg.status === 'partial_success'
      ? 'completed'
      : msg.status === 'failed'
        ? 'failed'
        : 'failed';

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
 * Auth-failure circuit breaker. The orchestrator can reject a token for
 * many reasons (expired, signed with a different secret, deleted user).
 * Without a brake the SW would loop forever:
 *   ensureConnected → auto-login lifts SAME bad token → setAccessToken
 *   → storage.onChanged → reconnect → 4401 → onUnauthorized → repeat.
 *
 * Two guardrails persisted in chrome.storage so they survive SW restart:
 *   - AUTH_FAILURES_KEY: count of consecutive 4401/UNAUTHORIZED events.
 *     At MAX_AUTH_FAILURES the SW freezes auto-retry — only a user-
 *     initiated retry (Side Panel button) clears the counter.
 *   - KNOWN_BAD_TOKEN_KEY: the most recently rejected token. ensureConnected
 *     refuses to re-import the same value, so even before the count cap
 *     fires we don't hammer the same bad creds.
 *
 * Backoff between auto-retries: 1s → 2s → 4s, then frozen.
 */
const AUTH_FAILURES_KEY = 'holaday.auth.consecutive_failures';
const KNOWN_BAD_TOKEN_KEY = 'holaday.auth.known_bad_token';
const MAX_AUTH_FAILURES = 3;
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];
const AUTH_STATE_STORAGE_TIMEOUT_MS = 1_500;
/**
 * Phase 17b — known-bad-token expiry. Storing a forever-marker
 * caused a stuck state: the user re-logs in on holaday.ai, the
 * cookie sets a fresh JWT, but if the orchestrator regenerated the
 * SAME token (server-side session extension) or the ext lifted a
 * stale token from a tab that hadn't refreshed yet, the value
 * matched the bad marker and the SW silently refused to retry.
 *
 * 5 min covers transient orchestrator hiccups + a one-tab-stale
 * window without making the user wait. After expiry the marker
 * auto-clears on the next read; manual Side Panel "我已登录，重试"
 * still works as a hard reset.
 */
const KNOWN_BAD_TOKEN_TTL_MS = 5 * 60 * 1000;
let pendingAuthRetry: ReturnType<typeof setTimeout> | null = null;

async function getAuthFailures(): Promise<number> {
  try {
    const out = await withDeadline(
      chrome.storage.local.get(AUTH_FAILURES_KEY),
      AUTH_STATE_STORAGE_TIMEOUT_MS,
      'auth_failures_read_timeout',
    );
    const v = out[AUTH_FAILURES_KEY];
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Read the most-recently-rejected token, honouring the 5-minute
 * TTL. Returns null when the marker is missing, expired, or in
 * the legacy bare-string format (which we treat as expired so a
 * SW upgrade doesn't keep the user in the stuck state).
 *
 * Side effect: an expired / legacy marker is removed in the
 * background so subsequent reads short-circuit on the absent key.
 */
async function getKnownBadToken(): Promise<string | null> {
  try {
    const out = await withDeadline(
      chrome.storage.local.get(KNOWN_BAD_TOKEN_KEY),
      AUTH_STATE_STORAGE_TIMEOUT_MS,
      'known_bad_token_read_timeout',
    );
    const v = out[KNOWN_BAD_TOKEN_KEY];
    // Legacy: bare string from before this commit. Drop it — treating
    // it as expired matches the new TTL semantics and unsticks any
    // user who upgraded the extension while in the freeze state.
    if (typeof v === 'string') {
      void withDeadline(
        chrome.storage.local.remove(KNOWN_BAD_TOKEN_KEY),
        AUTH_STATE_STORAGE_TIMEOUT_MS,
        'known_bad_token_remove_timeout',
      ).catch(() => undefined);
      return null;
    }
    if (!v || typeof v !== 'object') return null;
    const obj = v as { token?: unknown; ts?: unknown };
    if (typeof obj.token !== 'string' || obj.token.length === 0) return null;
    if (typeof obj.ts !== 'number') return null;
    const ageMs = Date.now() - obj.ts;
    if (ageMs > KNOWN_BAD_TOKEN_TTL_MS) {
      // Expired — wipe so the next read doesn't pay this branch.
      void withDeadline(
        chrome.storage.local.remove(KNOWN_BAD_TOKEN_KEY),
        AUTH_STATE_STORAGE_TIMEOUT_MS,
        'known_bad_token_expired_remove_timeout',
      ).catch(() => undefined);
      console.info(
        `[holaday] auth: known-bad-token expired (${Math.round(ageMs / 1000)}s old); will retry`,
      );
      return null;
    }
    return obj.token;
  } catch {
    return null;
  }
}

/**
 * Stamp `token` as known-bad with the current timestamp. The
 * record auto-expires via `getKnownBadToken` after
 * KNOWN_BAD_TOKEN_TTL_MS.
 */
async function setKnownBadToken(token: string): Promise<void> {
  await withDeadline(
    chrome.storage.local.set({
      [KNOWN_BAD_TOKEN_KEY]: { token, ts: Date.now() },
    }),
    AUTH_STATE_STORAGE_TIMEOUT_MS,
    'known_bad_token_write_timeout',
  );
}

async function resetAuthFailureState(): Promise<void> {
  await withDeadline(
    chrome.storage.local.remove([AUTH_FAILURES_KEY, KNOWN_BAD_TOKEN_KEY]),
    AUTH_STATE_STORAGE_TIMEOUT_MS,
    'auth_failure_state_remove_timeout',
  );
}

/**
 * Phase 18b — full auth reset. Wipes EVERY auth-related storage
 * key (token + user + failure counter + bad-token marker) and
 * pulls down any live socket. Called from:
 *   - the popup "重置连接" button (user-initiated, frozen state)
 *   - `chrome.runtime.onInstalled` (auto, on install/update so an
 *     extension upgrade can't inherit a stuck state from before)
 *
 * Different from `resetAuthFailureState` which only clears the
 * circuit-breaker bookkeeping — that's the right scope for the
 * Side Panel "我已登录，重试" button (don't drop the token, just
 * give it another shot). This one is a hard reset.
 */
async function resetAllAuthState(): Promise<void> {
  if (pendingAuthRetry) {
    clearTimeout(pendingAuthRetry);
    pendingAuthRetry = null;
  }
  await withDeadline(
    chrome.storage.local.remove([
      TOKEN_STORAGE_KEY,
      'holaday.user',
      AUTH_FAILURES_KEY,
      KNOWN_BAD_TOKEN_KEY,
    ]),
    AUTH_STATE_STORAGE_TIMEOUT_MS,
    'all_auth_state_remove_timeout',
  );
  // Ensure no live socket is left holding the cleared token.
  disconnect();
  state.tasks.clear();
}

/**
 * Try to (re)open the WS using whatever token is in storage. Multiple
 * call sites converge here — onInstalled, onStartup, keepalive alarm,
 * storage change, popup nudge — and the MV3 SW gets killed after
 * ~30s of idle so this is the single recovery path. Skips entirely
 * once the failure counter has hit the freeze threshold; the user
 * has to click the Side Panel "我已登录，重试" button (which calls
 * resetAuthFailureState) to give it another shot.
 */
async function ensureConnected(): Promise<{ token: string | null; frozen?: boolean }> {
  if (isConnected()) return { token: await getAccessToken() };
  const failures = await getAuthFailures();
  if (failures >= MAX_AUTH_FAILURES) {
    console.warn(
      `[holaday] auth: frozen (${failures}/${MAX_AUTH_FAILURES} consecutive failures); manual retry required`,
    );
    return { token: null, frozen: true };
  }
  let token = await getAccessToken();
  if (!token) {
    const lifted = await tryAutoLogin();
    if (lifted) {
      const knownBad = await getKnownBadToken();
      if (knownBad && lifted === knownBad) {
        console.warn(
          '[holaday] ensureConnected: lifted token matches last-rejected; not retrying',
        );
        return { token: null };
      }
      try {
        await setAccessToken(lifted);
        token = lifted;
        console.info('[holaday] auto-login: imported token from workbench tab');
      } catch (err) {
        console.warn('[holaday] auto-login: setAccessToken failed', err);
      }
    }
  }
  if (token) connect(token);
  return { token };
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

/**
 * Phase 17 — cookie-value sync throttle. Welcome + alarm both call
 * this; the timestamp dedupes so a tight reconnect cycle doesn't
 * burn the orchestrator with redundant POSTs.
 *
 * The interval matches the `30 * 60 * 1000` spec target (30 min)
 * for the alarm path; the welcome path is allowed to fire whenever
 * it does so freshly-authed users get an instant sync.
 */
const COOKIE_SYNC_PERIOD_MS = 30 * 60 * 1000;
let lastCookieSyncAt = 0;

async function maybeRunCookieSync(reason: 'welcome' | 'alarm' | 'manual'): Promise<void> {
  const now = Date.now();
  if (reason === 'alarm' && now - lastCookieSyncAt < COOKIE_SYNC_PERIOD_MS) return;
  lastCookieSyncAt = now;
  try {
    const res = await runCookieSync();
    if (res === null) {
      // No token — silent skip, sync will retry on next welcome.
      return;
    }
    console.info(
      `[holaday] cookie-sync (${reason}): synced ${res.synced} cookies across ${res.domains.length} domains${
        res.deferred ? ' (parked, no live Brave)' : ' (immediate inject)'
      }`,
    );
  } catch (err) {
    console.warn('[holaday] cookie-sync failed', err);
    // Reset throttle so the next attempt isn't gated by the failed run.
    lastCookieSyncAt = 0;
  }
}

/**
 * Phase 25 — browsing-history sync throttle. Cadence is much slower
 * than cookies (cookies move per-session, browsing patterns change
 * per-week). 24 hours matches the spec target. Initial sync runs at
 * the first WS welcome after install; subsequent runs are alarm-
 * gated. Throttle state lives in chrome.storage.local so SW restarts
 * don't double-up.
 *
 * Settings toggle (HISTORY_SYNC_ENABLED_KEY) is a user opt-out for
 * the privacy-conscious — default ON because the value depends on
 * the orchestrator having the data.
 */
const HISTORY_SYNC_PERIOD_MS = 24 * 60 * 60 * 1000;
const HISTORY_SYNC_LAST_AT_KEY = 'holaday.history.lastSyncAt';
const HISTORY_SYNC_ENABLED_KEY = 'holaday.history.enabled';
const HISTORY_SYNC_STORAGE_TIMEOUT_MS = 1_500;

async function isHistorySyncEnabled(): Promise<boolean> {
  try {
    const out = await withDeadline(
      chrome.storage.local.get(HISTORY_SYNC_ENABLED_KEY),
      HISTORY_SYNC_STORAGE_TIMEOUT_MS,
      'history_sync_enabled_read_timeout',
    );
    const v = out[HISTORY_SYNC_ENABLED_KEY];
    // Default ON when key missing — explicit `false` disables.
    return v !== false;
  } catch {
    return true;
  }
}

async function getLastHistorySyncAt(): Promise<number> {
  try {
    const out = await withDeadline(
      chrome.storage.local.get(HISTORY_SYNC_LAST_AT_KEY),
      HISTORY_SYNC_STORAGE_TIMEOUT_MS,
      'history_sync_last_at_read_timeout',
    );
    const v = out[HISTORY_SYNC_LAST_AT_KEY];
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

async function setLastHistorySyncAt(t: number): Promise<void> {
  try {
    await withDeadline(
      chrome.storage.local.set({ [HISTORY_SYNC_LAST_AT_KEY]: t }),
      HISTORY_SYNC_STORAGE_TIMEOUT_MS,
      'history_sync_last_at_write_timeout',
    );
  } catch {
    /* non-fatal */
  }
}

async function maybeRunHistorySync(reason: 'welcome' | 'alarm' | 'manual'): Promise<void> {
  if (!(await isHistorySyncEnabled())) return;
  const now = Date.now();
  if (reason === 'alarm') {
    const last = await getLastHistorySyncAt();
    if (now - last < HISTORY_SYNC_PERIOD_MS) return;
  }
  try {
    const res = await runHistorySync();
    if (res === null) {
      // No token OR empty history — silent skip, will retry next cadence.
      return;
    }
    await setLastHistorySyncAt(now);
    console.info(
      `[holaday] history-sync (${reason}): ingested ${res.ingested} domains, rejected ${res.rejected}`,
    );
  } catch (err) {
    console.warn('[holaday] history-sync failed', err);
    // Do NOT advance the timestamp on failure — next cadence retries.
  }
}

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
chrome.runtime.onInstalled.addListener((details) => {
  // Phase 18b — install / upgrade clears any persisted auth state
  // so a stuck "frozen 3/3" or stale known-bad-token from a prior
  // version can't keep blocking the new build. The auto-login path
  // re-imports a fresh token from any open holaday.ai tab on the
  // very next ensureConnected tick, so a clean install never
  // requires a manual login.
  if (details.reason === 'install' || details.reason === 'update') {
    void resetAllAuthState().then(() => ensureConnected());
  } else {
    void ensureConnected();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void ensureConnected();
});

// Auto-reconnect on token changes. Phase 14 fix: detect VALUE
// change (not just appearance/removal). When auto-login lifts a
// fresher token over a stale one, the previous version called the
// idempotent `connect()` which short-circuited because the OLD
// socket was still in OPEN state — so the new token never made
// it onto the wire. `reconnect()` explicitly closes the old
// socket and opens a new one with the new token.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const change = changes[TOKEN_STORAGE_KEY];
  if (!change) return;
  const oldVal = normalizeAccessToken(change.oldValue);
  const newVal = normalizeAccessToken(change.newValue);
  if (newVal && newVal !== oldVal) {
    // Token appeared OR replaced. Force a fresh socket.
    state.tasks.clear();
    reconnect(newVal);
    console.info('[holaday] storage.onChanged: token changed, reconnected WS');
  } else if (!newVal && oldVal) {
    disconnect();
    state.tasks.clear();
    console.info('[holaday] storage.onChanged: token cleared, WS disconnected');
  }
});

// Phase 14 — orchestrator rejected our auth (close 4401 or
// server.error code='UNAUTHORIZED'). Drop the stale token + user,
// remember the token as known-bad so ensureConnected refuses to
// re-import the same value, and schedule the next attempt with
// 1s/2s/4s backoff. After MAX_AUTH_FAILURES the SW freezes —
// only a Side Panel "我已登录，重试" click clears the state.
onUnauthorized(() => {
  void (async () => {
    const rejected = await getAccessToken();
    const prev = await getAuthFailures();
    const next = prev + 1;
    try {
      await withDeadline(
        chrome.storage.local.set({ [AUTH_FAILURES_KEY]: next }),
        AUTH_STATE_STORAGE_TIMEOUT_MS,
        'auth_failures_write_timeout',
      );
    } catch (err) {
      console.warn('[holaday] auth: failed to persist failure count', err);
    }
    if (rejected) {
      try {
        // Persist BEFORE clearing the token, otherwise getAccessToken
        // returns null on the next ensureConnected and we lose the
        // "this token is bad" signal.
        await setKnownBadToken(rejected);
      } catch (err) {
        console.warn('[holaday] auth: failed to persist known-bad token', err);
      }
    }
    const cleanup = await Promise.allSettled([clearAccessToken(), clearStoredUser()]);
    for (const result of cleanup) {
      if (result.status === 'rejected') {
        console.warn('[holaday] auth: failed to clear rejected session state', result.reason);
      }
    }
    disconnect();
    state.tasks.clear();
    pushTasksSnapshot();
    if (next >= MAX_AUTH_FAILURES) {
      console.warn(
        `[holaday] auth: frozen after ${next}/${MAX_AUTH_FAILURES} failures; manual retry required`,
      );
      return;
    }
    const delay =
      RETRY_BACKOFF_MS[Math.min(next - 1, RETRY_BACKOFF_MS.length - 1)] ?? 4_000;
    console.info(
      `[holaday] auth: rejected (attempt ${next}/${MAX_AUTH_FAILURES}); next retry in ${delay}ms`,
    );
    if (pendingAuthRetry) clearTimeout(pendingAuthRetry);
    pendingAuthRetry = setTimeout(() => {
      pendingAuthRetry = null;
      void ensureConnected();
    }, delay);
  })();
});

// Keepalive: chrome.alarms survive SW death. When the SW is recycled,
// the next alarm tick respawns it and we re-establish the WS. The
// 30-second cadence is Chrome's stable minimum and matches our
// HEARTBEAT_INTERVAL_MS — see shared-types/ws.ts.
//
// Phase 25 — the alarm path now consults `isReconnectCapped()` before
// driving ensureConnected. Without this guard, the 30 s alarm would
// kick off a fresh reconnect cycle EVERY tick after the in-memory
// cap fired — defeating the persistent-cap fix in ws-client. With
// it, three failed attempts → silence until the user explicitly
// re-engages via the popup or chrome.runtime.onStartup.
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MIN });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    void (async () => {
      if (await isReconnectCapped()) {
        // Persistent cap is hit — don't burn another connect cycle on
        // a known-unreachable orchestrator. The popup's manual retry
        // path will clear the cap when the user is ready.
        return;
      }
      await ensureConnected();
      void maybeReportLoginStates();
      // Phase 17 — internally throttled to once per 30 min, so safe
      // to fire from the keepalive cadence (30 s).
      void maybeRunCookieSync('alarm');
      // Phase 25 — 24h gate inside the helper.
      void maybeRunHistorySync('alarm');
    })();
  }
});

// Top-level boot reconnect. Runs whenever the SW module is (re)loaded —
// on install, on browser start, on alarm wakeup, on event-driven respawn.
// Pairs with the alarm above to make "always be trying to be connected"
// the default state whenever a token exists.
//
// Phase 25 — same cap-aware gate as the alarm. If the persistent
// counter says 3 attempts already failed in earlier SW lives, this
// boot stays silent too. chrome.runtime.onStartup clears the cap on
// a fresh browser launch (handler below), and the popup's "重置连接"
// nudge clears it for an already-running browser.
void (async () => {
  if (await isReconnectCapped()) return;
  await ensureConnected();
})();

// Fresh browser session → forget any cap from a previous Chrome
// instance. Without this, a user who hit the cap, quit Chrome, and
// restarted would silently stay disconnected until they noticed and
// opened the popup. onStartup only fires on actual browser launch
// (not on SW respawn), so the persistent cap inside one session is
// untouched.
chrome.runtime.onStartup.addListener(() => {
  void resetWsReconnectAttempts().then(() => {
    void ensureConnected();
  });
});

// ---------- Popup ⇄ SW messaging ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'holaday.auth.token' && (msg.token === null || typeof msg.token === 'string')) {
    // Phase 25b — push from the auth-bridge content script on a
    // workbench page. Treats `null` as logout and a fresh string as
    // login / account swap. Idempotent: identical-to-stored values
    // are short-circuited so we don't churn the WS on poll ticks.
    if (!isTrustedAuthBridgeSender(_sender.url)) {
      console.warn(
        '[holaday] auth-bridge: ignoring message from untrusted sender',
        _sender.url,
      );
      sendResponse({ ok: false, reason: 'untrusted_sender' });
      return true;
    }
    void (async () => {
      try {
        const incoming = typeof msg.token === 'string' ? msg.token : null;
        const stored = await getAccessToken();
        const knownBad = await getKnownBadToken();
        const action = decideAuthTokenAction(incoming, stored, knownBad);

        if (action.kind === 'unchanged') {
          sendResponse({ ok: true, action: 'unchanged' });
          return;
        }
        if (action.kind === 'refuse') {
          // Phase 25b fix — auth-bridge tried to revive the same token
          // the orchestrator rejected via 4401. Refusing here prevents
          // the cycle where every 3 s poll undoes onUnauthorized's
          // cleanup; the user has to log in fresh on the SPA before
          // this gate releases. See auth-token-handler.ts for the full
          // rationale + regression tests.
          console.warn(
            '[holaday] auth-bridge: refusing to revive knownBad token (orchestrator already rejected it)',
          );
          if (
            action.reason === 'known_bad_token' &&
            incoming !== null &&
            normalizeAccessToken(stored) === normalizeAccessToken(incoming)
          ) {
            await clearAccessToken();
            await clearStoredUser();
            disconnect();
            state.tasks.clear();
            pushTasksSnapshot();
          }
          sendResponse({ ok: false, reason: action.reason });
          return;
        }
        if (action.kind === 'clear') {
          // SPA logged out → mirror. clearStoredUser + clearAccessToken
          // wipe both the token and the cached user shape; disconnect
          // tears down the WS so the next ensureConnected starts fresh
          // (and returns null because no token is stored).
          await clearAccessToken();
          await clearStoredUser();
          disconnect();
          state.tasks.clear();
          pushTasksSnapshot();
          sendResponse({ ok: true, action: 'cleared' });
          return;
        }
        // action.kind === 'set' — fresh token (login OR account swap).
        // Write to chrome.storage; ws-client's storage.onChanged listener
        // sees the change and calls reconnect(newToken). Reset the
        // auth-failure freeze too: the SPA just produced a NEW token
        // (the cycle-breaker above already filtered the case where
        // it's actually the same dead one).
        await setAccessToken(action.token);
        await resetAuthFailureState();
        await resetWsReconnectAttempts();
        sendResponse({ ok: true, action: 'set' });
      } catch (err) {
        console.warn('[holaday] auth-bridge: token message failed', err);
        sendResponse({ ok: false, reason: 'internal_error' });
      }
    })();
    return true; // keep response channel open
  }

  if (msg?.type === 'holaday.connect' && typeof msg.token === 'string') {
    connect(msg.token);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'holaday.disconnect') {
    disconnect();
    state.tasks.clear();
    pushTasksSnapshot();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'holaday.status') {
    void getWsConnectionStatus().then((ws) => {
      sendResponse({ lastWelcomeAt: state.lastWelcomeAt, ws });
    });
    return true;
  }
  if (msg?.type === 'holaday.tasks') {
    sendResponse({ tasks: tasksSnapshot() });
    return true;
  }
  if (msg?.type === 'holaday.resetConnection') {
    // Phase 18b — popup "重置连接" button. Hard reset of every
    // auth-related storage key + live socket, then immediately
    // tries auto-login from the current holaday.ai tab. Unlike
    // tryAutoLogin (which is the soft thaw — keep the token,
    // just clear the failure counter), this nukes the lot.
    // Phase 25 — also clears the persistent ws-reconnect cap so
    // a 3-attempt freeze unfreezes immediately.
    void (async () => {
      try {
        await resetAllAuthState();
        await resetWsReconnectAttempts();
        const { token, frozen } = await ensureConnected();
        sendResponse({
          ok: Boolean(token),
          token: token ?? null,
          ...(frozen ? { frozen: true } : {}),
        });
      } catch (err) {
        console.warn('[holaday] resetConnection failed', err);
        sendResponse({ ok: false, reason: 'internal_error' });
      }
    })();
    return true;
  }
  if (msg?.type === 'holaday.tryAutoLogin') {
    // Phase 14 — Side Panel mount + "我已登录，重试" button nudge
    // the SW to attempt localStorage-based auto-login synchronously
    // (rather than waiting up to 30s for the keepalive alarm). A
    // user-initiated retry also counts as ground for un-freezing
    // the auth circuit breaker — clear the failure counter +
    // known-bad token so the next ensureConnected runs fresh.
    // Phase 25 — same treatment for the ws-network cap.
    void (async () => {
      try {
        if (pendingAuthRetry) {
          clearTimeout(pendingAuthRetry);
          pendingAuthRetry = null;
        }
        await resetAuthFailureState();
        await resetWsReconnectAttempts();
        const { token, frozen } = await ensureConnected();
        sendResponse({
          ok: Boolean(token),
          token: token ?? null,
          ...(frozen ? { frozen: true } : {}),
        });
      } catch (err) {
        console.warn('[holaday] tryAutoLogin failed', err);
        sendResponse({ ok: false, reason: 'internal_error' });
      }
    })();
    return true; // keep response channel open for async resolve
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
