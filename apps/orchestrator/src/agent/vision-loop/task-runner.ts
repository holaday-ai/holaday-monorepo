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
import type { RunOutcome } from './runner.js';
import { VisionLoopRunner } from './runner.js';

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
   * Optional per-tick observer hook — called after the commander
   * returns a decision but before the action is dispatched. Used
   * by Phase A Day 3 item 3 to write an `llm_calls` row per tick.
   * Kept as a plain callback (not an event subscribe) so the caller
   * can `await` the hook before proceeding to dispatch (important
   * for correct audit ordering).
   */
  onDecision?: (info: {
    tickIndex: number;
    decision: import('./runner.js').RunOutcome extends never
      ? never
      : import('./commander.js').VisionDecision;
  }) => Promise<void> | void;
}

/**
 * Start a vision-loop task, wired to the real WS transport. Returns
 * the outcome promise — the caller persists it to tasks/task_steps.
 * Does NOT touch the DB itself (separation of concerns; the tRPC
 * handler owns user-facing persistence, this function owns the loop).
 */
export async function startVisionLoopTask(opts: StartVisionLoopTaskOptions): Promise<RunOutcome> {
  const runner = new VisionLoopRunner({
    commander: opts.commander,
    userId: opts.userId,
    taskExternalId: opts.taskId,
    maxSteps: opts.maxSteps ?? 30,
    ...(opts.skillHint ? { skillHint: opts.skillHint } : {}),
    // Screenshot round-trip: send server.vision.observe, await the
    // matching client.vision.observation. SW-layer errors surface as
    // the observation's `error` field; we re-throw so the runner
    // catches it and fails the tick cleanly.
    screenshotFn: async (tickIndex) => {
      const obs = await requestVisionObservationFromSW(opts.userId, opts.taskId, tickIndex);
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
    },
    // Action round-trip: send server.vision.act, await
    // client.vision.acted. The runner has already translated
    // click coords from model-space to real viewport pixels.
    actionFn: async (tickIndex, action) => {
      const acted = await dispatchVisionActionToSW(opts.userId, opts.taskId, tickIndex, action);
      return {
        ok: acted.ok,
        ...(acted.message ? { message: acted.message } : {}),
      };
    },
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
