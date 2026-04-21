/**
 * Vision-loop task runner for the orchestrator — the glue between
 * tRPC `tasks.create` (which starts a task) and the WS-backed
 * VisionLoopRunner (which drives the per-tick observe → decide → act
 * cycle).
 *
 * Responsibilities:
 *   - Build a `VisionLoopRunner` wired to the WS request/response
 *     plumbing (screenshotFn / actionFn) and the user's commander.
 *   - Kick it off asynchronously; `startVisionLoopTask` returns the
 *     outcome promise so callers can persist the terminal state.
 *   - Emit per-tick side effects (llm_calls rows land in a separate
 *     commit). For Phase A Day 3 item 2 we just connect the pipes;
 *     DB persistence of the decision stream comes in item 3.
 *
 * Kept deliberately thin. Anything cross-cutting (rate limits, per-
 * user quotas, batch-confirm gates) lives either in the commander
 * or in higher-level orchestration that wraps this function.
 */

import { dispatchVisionActionToSW, requestVisionObservationFromSW } from '../../ws/server.js';
import type { VisionLoopCommander } from './commander.js';
import type { PageLike, PlaywrightExecutor } from './playwright-executor.js';
import type {
  A11yActionFn,
  AccessibilityFn,
  ActionFn,
  RunOutcome,
  ScreenshotFn,
} from './runner.js';
import { VisionLoopRunner } from './runner.js';

interface Transport {
  screenshotFn: ScreenshotFn;
  actionFn: ActionFn;
  accessibilityFn?: AccessibilityFn;
  a11yActionFn?: A11yActionFn;
}

export interface StartVisionLoopTaskOptions {
  /** External (user-facing) task id — used to correlate WS frames. */
  taskId: string;
  /** External user id (usr_…) — used to select a connected SW client. */
  userId: string;
  /** Free-form user intent. */
  intent: string;
  /** Commander implementation to drive decide-next-action. */
  commander: VisionLoopCommander;
  /** Per-task loop cap. Default 30 (matches DEFAULT_MAX_VISION_STEPS). */
  maxSteps?: number;
  /** Optional Skill body as a prompt hint. */
  skillHint?: string;
  /**
   * Phase D Step 3: when set, the runner observes + acts via
   * Playwright instead of the WS → SW → CDP round-trip. On any
   * Playwright-side failure we do NOT silently fall back to WS
   * mid-task — the loop exits as failed so the operator sees what
   * broke. Fallback-on-connect-failure happens at orchestrator
   * boot, not per-task.
   */
  playwrightExecutor?: PlaywrightExecutor | null;
  /**
   * Optional per-tick observer hook — called after the commander
   * returns a decision but before the action is dispatched. Used
   * by Phase A Day 3 item 3 to write an `llm_calls` row per tick.
   * Kept as a plain callback (not an event subscribe) so the caller
   * can `await` the hook before proceeding to dispatch (important
   * for correct audit ordering).
   */
  onDecision?: (info: {
    tickIndex: number;
    mode: import('./vision-mode.js').VisionMode;
    decision:
      | import('./commander.js').VisionDecision
      | import('./commander.js').AccessibilityDecision;
  }) => Promise<void> | void;
  /**
   * Fires when the runner has pulled a fresh observation for a tick
   * and is about to call the commander. G4 wires this to a
   * `server.vision.tick.start` broadcast so the web workbench can
   * append an in-progress step card.
   */
  onTickStart?: (info: {
    tickIndex: number;
    mode: import('./vision-mode.js').VisionMode;
  }) => void;
  /**
   * Fires once per tick after the turn has been recorded — covers
   * both "driver executed the action" and "commander returned a
   * terminal action" (done / give_up) paths. G4 wires this to
   * `server.vision.tick.end` so the step card can flip to its
   * final state.
   */
  onTickEnd?: (info: {
    tickIndex: number;
    mode: import('./vision-mode.js').VisionMode;
    actionKind: string;
    actionSummary: string;
    durationMs: number;
    ok: boolean;
    message?: string;
  }) => void;
  /**
   * Fires right after a screenshot-mode observation lands, with the
   * raw JPEG bytes (base64, no data: prefix) + url + viewport. G5
   * wires this to a `server.vision.screencast` broadcast so the web
   * workbench can render a poor-man's screencast in the right-hand
   * panel. a11y-mode ticks have no image and skip this hook.
   */
  onScreencast?: (info: {
    tickIndex: number;
    imageBase64: string;
    url: string;
    viewportWidth: number;
    viewportHeight: number;
  }) => void;
}

/**
 * Start a vision-loop task, wired to the real WS transport. Returns
 * the outcome promise — the caller persists it to tasks/task_steps.
 * Does NOT touch the DB itself (separation of concerns; the tRPC
 * handler owns user-facing persistence, this function owns the loop).
 */
export async function startVisionLoopTask(opts: StartVisionLoopTaskOptions): Promise<RunOutcome> {
  // Pick the observation + action transport. When Playwright is
  // wired at boot we go direct (no WS / SW); otherwise fall through
  // to the classic SW round-trip. The selection happens once per
  // task at start-up; we don't swap mid-loop.
  const transport: Transport = opts.playwrightExecutor
    ? buildPlaywrightTransport(opts.playwrightExecutor)
    : buildWsTransport(opts.userId, opts.taskId);

  // Park the tab on about:blank before we start so anti-bot modals
  // or half-loaded frames from the previous task can't poison this
  // one. `resetPageForTask` swallows its own failures; the typeof
  // guard keeps the older test-runner stubs happy (they pass a duck-
  // typed PlaywrightExecutor that doesn't implement the new method).
  if (opts.playwrightExecutor && typeof opts.playwrightExecutor.resetPageForTask === 'function') {
    await opts.playwrightExecutor.resetPageForTask();
  }

  // Only Playwright transport provides the a11y pair — SW transport
  // can't serve ariaSnapshot. Runner auto-pins to screenshot mode
  // when these are undefined.
  const runner = new VisionLoopRunner({
    commander: opts.commander,
    userId: opts.userId,
    taskExternalId: opts.taskId,
    maxSteps: opts.maxSteps ?? 30,
    ...(opts.skillHint ? { skillHint: opts.skillHint } : {}),
    screenshotFn: transport.screenshotFn,
    actionFn: transport.actionFn,
    ...(transport.accessibilityFn ? { accessibilityFn: transport.accessibilityFn } : {}),
    ...(transport.a11yActionFn ? { a11yActionFn: transport.a11yActionFn } : {}),
  });

  if (opts.onDecision) {
    const hook = opts.onDecision;
    runner.on('decision', (ev) => {
      // Fire-and-forget — await is inside the hook implementation if
      // it needs ordering. Any thrown / rejected work is logged and
      // does NOT kill the loop.
      void Promise.resolve(hook(ev)).catch((err) => {
        // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
        console.warn('[vision-loop] onDecision hook threw', err);
      });
    });
  }

  // Per-tick streaming hooks. `tick` gives us the start timestamp;
  // `turn` (which fires for both acted + terminal paths) gives us
  // the closing action + duration. We keep the timestamps in a Map
  // keyed by tickIndex so out-of-order bookkeeping can't cross-pollute.
  if (opts.onTickStart || opts.onTickEnd) {
    const startedAt = new Map<number, number>();
    const lastMode = new Map<number, import('./vision-mode.js').VisionMode>();
    // Populate timing on every tick, even when onTickStart is unset —
    // onTickEnd needs it for durationMs.
    runner.on('tick', (ev) => {
      startedAt.set(ev.tickIndex, Date.now());
      lastMode.set(ev.tickIndex, ev.mode);
    });
    if (opts.onTickStart) {
      const hookStart = opts.onTickStart;
      runner.on('tick', (ev) => {
        try {
          hookStart({ tickIndex: ev.tickIndex, mode: ev.mode });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
          console.warn('[vision-loop] onTickStart hook threw', err);
        }
      });
    }
    if (opts.onTickEnd) {
      const hookEnd = opts.onTickEnd;
      // The runner's `turn` event carries the full AnyTurn — that
      // includes the action + executionResult for BOTH vision-mode
      // and a11y-mode turns, and fires after terminal done/give_up
      // paths too. Using it as the single "tick finished" signal
      // keeps the start/end pair well-defined even when the driver
      // is bypassed (done / give_up never hit `acted`).
      runner.on('turn', (ev) => {
        const started = startedAt.get(ev.tickIndex);
        const mode = lastMode.get(ev.tickIndex) ?? 'screenshot';
        const durationMs = started ? Date.now() - started : 0;
        startedAt.delete(ev.tickIndex);
        lastMode.delete(ev.tickIndex);
        const { action, executionResult } = ev.turn;
        try {
          hookEnd({
            tickIndex: ev.tickIndex,
            mode,
            actionKind: action.kind,
            actionSummary: describeAction(action),
            durationMs,
            ok: executionResult?.ok ?? false,
            ...(executionResult?.message ? { message: executionResult.message } : {}),
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
          console.warn('[vision-loop] onTickEnd hook threw', err);
        }
      });
    }
  }

  // G5 screencast + G8 follow-up: every tick pushes a frame to the
  // workbench for traceability, regardless of whether the commander
  // consumed it.
  //   - screenshot mode: reuse the JPEG the commander already has
  //     (ev.observation.screenshotBase64). Zero extra cost.
  //   - accessibility mode: commander gets text only, so we fire a
  //     *display-only* screenshot via PlaywrightExecutor here. Runs
  //     concurrently with the commander call (the runner doesn't
  //     await listeners), so it doesn't stretch the tick budget.
  //
  // Best-effort: capture failures are logged and swallowed. A missing
  // screencast frame is visually noticeable (right panel shows "等待
  // 第一帧"), but MUST NOT stall the loop.
  if (opts.onScreencast) {
    const hookCast = opts.onScreencast;
    const executor = opts.playwrightExecutor ?? null;
    runner.on('tick', (ev) => {
      if (ev.mode === 'screenshot' && ev.observation) {
        try {
          hookCast({
            tickIndex: ev.tickIndex,
            imageBase64: ev.observation.screenshotBase64,
            url: ev.observation.url,
            viewportWidth: ev.observation.viewportWidth,
            viewportHeight: ev.observation.viewportHeight,
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
          console.warn('[vision-loop] onScreencast hook threw', err);
        }
        return;
      }
      if (ev.mode === 'accessibility' && executor) {
        void captureDisplayFrame(executor, ev.tickIndex, hookCast);
      }
    });
  }

  return runner.run(opts.intent);
}

/**
 * Display-only screenshot for accessibility-mode ticks. Completely
 * decoupled from the commander path — the JPEG we produce here is
 * NEVER fed back into Claude's prompt. Existence of this helper is
 * the whole point of G8: give the UI a frame even when the loop is
 * in a11y mode.
 */
async function captureDisplayFrame(
  executor: import('./playwright-executor.js').PlaywrightExecutor,
  tickIndex: number,
  hookCast: NonNullable<StartVisionLoopTaskOptions['onScreencast']>,
): Promise<void> {
  try {
    const page = (await executor.getPage()) as unknown as import('./playwright-executor.js').PageLike;
    const shot = await executor.screenshot(page);
    if (shot.error || !shot.base64) return;
    let url = '';
    try {
      url = page.url();
    } catch {
      // chrome:// and about: pages can throw; URL blank is fine.
    }
    hookCast({
      tickIndex,
      imageBase64: shot.base64,
      url,
      viewportWidth: shot.viewportWidth ?? 0,
      viewportHeight: shot.viewportHeight ?? 0,
    });
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
    console.warn('[vision-loop] a11y-tick display screenshot failed', err);
  }
}

/**
 * Short Chinese label for an action — rendered verbatim in the
 * web workbench's step card. Covers the full VisionAction + A11yAction
 * discriminated union; unknown kinds fall through to the bare kind.
 */
function describeAction(
  action:
    | import('./actions.js').VisionAction
    | import('./actions-a11y.js').A11yAction,
): string {
  switch (action.kind) {
    case 'click':
      return `点击 (${action.x}, ${action.y})`;
    case 'type':
      return `输入：${truncate(action.text, 40)}`;
    case 'key':
      return `按键：${action.key}`;
    case 'scroll':
      return `滚动 ${action.dy}px`;
    case 'wait':
      return `等待 ${action.ms}ms`;
    case 'screenshot':
      return '截图';
    case 'done':
      return '任务完成';
    case 'give_up':
      return `放弃：${truncate(action.reason, 40)}`;
    case 'click_ref':
      return `点击元素 ${action.ref}`;
    case 'type_in_ref':
      return `在 ${action.ref} 中输入：${truncate(action.text, 40)}`;
    case 'press_key':
      return `按键：${action.key}`;
    case 'navigate':
      return `打开 ${action.url}`;
    default:
      return (action as { kind: string }).kind;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Legacy transport — keeps the classic WS/SW/CDP path working when
 * Playwright isn't available or EXECUTOR_MODE=legacy. Unchanged from
 * the pre–Step 3 implementation; factored out so the branch in
 * `startVisionLoopTask` stays clean.
 */
function buildWsTransport(
  userId: string,
  taskId: string,
): { screenshotFn: ScreenshotFn; actionFn: ActionFn } {
  const screenshotFn: ScreenshotFn = async (tickIndex) => {
    const obs = await requestVisionObservationFromSW(userId, taskId, tickIndex);
    if (obs.error) throw new Error(obs.error);
    if (!obs.screenshotBase64 || obs.viewportWidth === 0 || obs.viewportHeight === 0) {
      throw new Error(
        `malformed observation from SW at tick ${tickIndex}: empty screenshot or zero dims`,
      );
    }
    return {
      screenshotBase64: obs.screenshotBase64,
      viewportWidth: obs.viewportWidth,
      viewportHeight: obs.viewportHeight,
      url: obs.url,
      title: obs.title,
      tickIndex,
    };
  };
  const actionFn: ActionFn = async (tickIndex, action) => {
    const acted = await dispatchVisionActionToSW(userId, taskId, tickIndex, action);
    return {
      ok: acted.ok,
      ...(acted.message ? { message: acted.message } : {}),
    };
  };
  return { screenshotFn, actionFn };
}

/**
 * Playwright transport — observe + act against the user's Chrome
 * directly via CDP. No WS, no SW. Coordinate translation still
 * happens in the runner (modelCoordToReal on the click path); here
 * we just ferry the screenshot bytes / click events through
 * PlaywrightExecutor.
 *
 * The screenshot path re-uses the executor's screenshot() which
 * already produces a JPEG at quality 80; the runner's resize step
 * downstream is tolerant of that (resizeForVisionModel treats
 * small viewports as passthrough and only re-encodes when it needs
 * to shrink past MAX_LONG_EDGE).
 *
 * Action translation: VisionAction kinds map onto PlaywrightExecutor
 * methods 1:1 except `screenshot` (runner asks for fresh observation
 * on next tick — nothing for the executor to do) and terminal
 * actions (`done`/`give_up` — runner never dispatches these to
 * actionFn). `type` focuses nothing on its own, matching screenshot-
 * mode semantics: the commander is expected to click first.
 */
function buildPlaywrightTransport(executor: PlaywrightExecutor): {
  screenshotFn: ScreenshotFn;
  actionFn: ActionFn;
  accessibilityFn: import('./runner.js').AccessibilityFn;
  a11yActionFn: import('./runner.js').A11yActionFn;
} {
  const screenshotFn: ScreenshotFn = async (tickIndex) => {
    // Cast through unknown — Playwright's real Page has a richer
    // Accessibility type than PageLike's duck-typed subset.
    const page = (await executor.getPage()) as unknown as PageLike;
    const shot = await executor.screenshot(page);
    if (shot.error || !shot.base64) {
      throw new Error(`playwright screenshot failed at tick ${tickIndex}: ${shot.error ?? '?'}`);
    }
    let title = '';
    try {
      title = await page.title();
    } catch {
      // best-effort — chrome:// pages may throw
    }
    return {
      screenshotBase64: shot.base64,
      viewportWidth: shot.viewportWidth ?? 0,
      viewportHeight: shot.viewportHeight ?? 0,
      url: page.url(),
      title,
      tickIndex,
    };
  };
  const actionFn: ActionFn = async (_tickIndex, action) => {
    const page = (await executor.getPage()) as unknown as PageLike;
    switch (action.kind) {
      case 'click':
        return executor.click(page, action.x, action.y, action.button ?? 'left');
      case 'type':
        return executor.type(page, action.text);
      case 'key':
        return executor.pressKey(page, action.key);
      case 'scroll':
        return executor.scroll(page, action.dy);
      case 'wait':
        return executor.wait(page, action.ms);
      case 'screenshot':
        return { ok: true, message: 'noop — runner re-observes on next tick' };
      case 'done':
      case 'give_up':
        return { ok: true, message: `${action.kind} terminal — no driver work` };
      default:
        return { ok: false, message: 'unknown VisionAction kind' };
    }
  };
  // ---- accessibility-mode transport ----
  // Cheap: the executor already owns accessibilitySnapshot and the
  // ref-based action dispatchers live behind `resolveRef + act`.
  const accessibilityFn: import('./runner.js').AccessibilityFn = async (tickIndex) => {
    const page = (await executor.getPage()) as unknown as PageLike;
    const snap = await executor.accessibilitySnapshot(page);
    if (snap.error) {
      throw new Error(`playwright a11y snapshot failed at tick ${tickIndex}: ${snap.error}`);
    }
    return {
      snapshot: snap.text,
      refs: snap.refs,
      url: snap.url,
      title: snap.title,
    };
  };
  const a11yActionFn: import('./runner.js').A11yActionFn = async (_tickIndex, action) => {
    const page = (await executor.getPage()) as unknown as PageLike;
    switch (action.kind) {
      case 'click_ref': {
        // Resolve the ref by role+name from the current snapshot, then
        // page.getByRole({name}) click. Same locator rules screen-
        // reader users see; no coord math.
        const snap = await executor.accessibilitySnapshot(page);
        const info = snap.refs.find((r) => r.ref === action.ref);
        if (!info) return { ok: false, message: `ref ${action.ref} not in current snapshot` };
        return executor.clickByRoleName(page, info.role, info.name);
      }
      case 'type_in_ref': {
        const snap = await executor.accessibilitySnapshot(page);
        const info = snap.refs.find((r) => r.ref === action.ref);
        if (!info) return { ok: false, message: `ref ${action.ref} not in current snapshot` };
        const clickRes = await executor.clickByRoleName(page, info.role, info.name);
        if (!clickRes.ok) return clickRes;
        return executor.type(page, action.text);
      }
      case 'press_key':
        return executor.pressKey(page, action.key);
      case 'scroll':
        return executor.scroll(page, action.dy);
      case 'wait':
        return executor.wait(page, action.ms);
      case 'screenshot':
        return { ok: true, message: 'noop — runner re-observes on next tick' };
      case 'navigate':
        try {
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          return { ok: true, message: `navigated to ${action.url}` };
        } catch (err) {
          return {
            ok: false,
            message: `goto failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      case 'done':
      case 'give_up':
        return { ok: true, message: `${action.kind} terminal — no driver work` };
      default:
        return { ok: false, message: 'unknown A11yAction kind' };
    }
  };
  return { screenshotFn, actionFn, accessibilityFn, a11yActionFn };
}
