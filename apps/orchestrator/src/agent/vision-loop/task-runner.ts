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

  return runner.run(opts.intent);
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
