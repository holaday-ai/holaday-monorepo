/**
 * VisionLoopRunner — drives the per-task loop.
 *
 * Orchestrator-side state machine that owns one in-flight vision-loop
 * task from start to finish:
 *
 *   1. Ask the driver for an observation (screenshot + url + title + dims)
 *   2. Hand that to the commander → VisionDecision
 *   3. If decision.action is `done` / `give_up` → emit terminal event, exit
 *   4. Otherwise translate model-space click coords to real viewport
 *      pixels (where applicable), tell the driver to execute the action
 *   5. Record the completed turn (observation + action + executionResult
 *      + toolUseId) and loop
 *
 * Exit conditions:
 *   - action.kind === 'done'      → status 'completed', summary to user
 *   - action.kind === 'give_up'   → status 'failed', reason to user
 *   - history.length >= maxSteps → status 'paused', reason 'max_steps_reached'
 *   - external cancel()           → status 'cancelled'
 *   - commander throws            → status 'failed', error surfaced
 *     (commander contract says it shouldn't, but belt-and-braces)
 *
 * Decoupled from WS / DB / the Anthropic client. The caller passes:
 *   - `screenshotFn`: produces a VisionObservation. In prod this calls
 *     into the SW via WS; in tests it's a canned-sequence closure.
 *   - `actionFn`: executes a VisionAction on the real tab. In prod this
 *     calls into the SW via WS; in tests it's a noop / canned result.
 *   - `commander`: anything implementing VisionLoopCommander.
 *
 * Emits events (Node EventEmitter) so higher layers can stream progress
 * to the popup / task_events / llm_calls without the runner knowing
 * about any of those sinks.
 */

import { EventEmitter } from 'node:events';
import type { VisionAction } from './actions.js';
import type {
  VisionDecision,
  VisionLoopCommander,
  VisionLoopTurn,
  VisionObservation,
} from './commander.js';
import { modelCoordToReal } from './image.js';

export interface ActionResult {
  ok: boolean;
  /** Short free-text the driver returns; surfaced to the next prompt. */
  message?: string;
}

/**
 * Screenshot provider. Captures the current viewport and returns
 * enough metadata for the commander to produce the next action. The
 * `tickIndex` is supplied by the runner so the driver doesn't have
 * to count; everything else comes from the live tab.
 */
export type ScreenshotFn = (tickIndex: number) => Promise<VisionObservation>;

/**
 * Action executor. Coordinates in `action` are REAL viewport pixels —
 * the runner has already translated them through `modelCoordToReal`.
 * Driver just dispatches the CDP event; no scaling, no selector
 * resolution.
 */
export type ActionFn = (action: VisionAction) => Promise<ActionResult>;

export interface VisionLoopRunnerOptions {
  commander: VisionLoopCommander;
  screenshotFn: ScreenshotFn;
  actionFn: ActionFn;
  /** Per-task cap on loop ticks. Default 30 (matches DEFAULT_MAX_VISION_STEPS). */
  maxSteps?: number;
  /** Optional: free-form Skill body to include as context. */
  skillHint?: string;
  /** Forwarded to commander for llm_calls attribution / rate limits. */
  userId?: string;
}

/**
 * Terminal outcome of a vision-loop run.
 *
 *   completed  — Claude called task_done; `summary` is the model's report.
 *   failed     — Claude called task_give_up OR commander/driver errored;
 *                `reason` carries the human-readable cause.
 *   paused     — hit `maxSteps` before done/give_up; operator can resume
 *                by starting a new run with the accumulated history.
 *   cancelled  — external code called `runner.cancel()` mid-loop.
 */
export type RunOutcome =
  | { status: 'completed'; summary: string; history: VisionLoopTurn[] }
  | { status: 'failed'; reason: string; history: VisionLoopTurn[] }
  | { status: 'paused'; reason: string; history: VisionLoopTurn[] }
  | { status: 'cancelled'; history: VisionLoopTurn[] };

/**
 * Events the runner emits. Higher layers can subscribe to stream
 * progress into task_events, the popup, or the WS channel.
 *
 *   tick        — before commander is called (observation is ready)
 *   decision    — commander returned; action + usage metrics in hand
 *   acted       — driver finished executing the action
 *   turn        — a complete observation→action→result cycle recorded
 *   outcome     — terminal; loop is exiting
 */
export interface VisionLoopRunnerEvents {
  tick: (ev: { tickIndex: number; observation: VisionObservation }) => void;
  decision: (ev: { tickIndex: number; decision: VisionDecision }) => void;
  acted: (ev: {
    tickIndex: number;
    action: VisionAction;
    result: ActionResult;
  }) => void;
  turn: (ev: { tickIndex: number; turn: VisionLoopTurn }) => void;
  outcome: (outcome: RunOutcome) => void;
}

/**
 * Typing bridge between Node's loosely-typed EventEmitter and our
 * strongly-typed VisionLoopRunnerEvents. `on`/`emit` on the runner's
 * public surface are fully typed (see VisionLoopRunner.on below);
 * internally we cast through this narrow interface rather than drag
 * a generic Record constraint across the whole module.
 */
interface TypedVisionEmitter extends EventEmitter {
  on<K extends keyof VisionLoopRunnerEvents>(event: K, listener: VisionLoopRunnerEvents[K]): this;
  emit<K extends keyof VisionLoopRunnerEvents>(
    event: K,
    ...args: Parameters<VisionLoopRunnerEvents[K]>
  ): boolean;
}

export class VisionLoopRunner {
  private readonly commander: VisionLoopCommander;
  private readonly screenshotFn: ScreenshotFn;
  private readonly actionFn: ActionFn;
  private readonly maxSteps: number;
  private readonly skillHint?: string;
  private readonly userId?: string;
  private readonly emitter: EventEmitter = new EventEmitter();
  private cancelled = false;
  /** Running log of turns so run() and consumers can share one history. */
  private readonly history: VisionLoopTurn[] = [];

  constructor(opts: VisionLoopRunnerOptions) {
    this.commander = opts.commander;
    this.screenshotFn = opts.screenshotFn;
    this.actionFn = opts.actionFn;
    this.maxSteps = opts.maxSteps ?? 30;
    if (opts.skillHint) this.skillHint = opts.skillHint;
    if (opts.userId) this.userId = opts.userId;
  }

  /**
   * Subscribe to a runner event. Returns `this` for chaining and
   * mirrors EventEmitter's on() signature with stronger types.
   */
  on<K extends keyof VisionLoopRunnerEvents>(event: K, listener: VisionLoopRunnerEvents[K]): this {
    (this.emitter as TypedVisionEmitter).on(event, listener);
    return this;
  }

  /**
   * Stop the loop at the next tick boundary. Does NOT interrupt an
   * in-flight commander call or action execution — those finish
   * naturally. Use for user-initiated cancel / timeout.
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Run the loop from start to finish. Returns the terminal outcome
   * once the loop exits. Also emits 'outcome' with the same value
   * for subscribers.
   */
  async run(goal: string): Promise<RunOutcome> {
    for (let tick = 0; tick < this.maxSteps; tick++) {
      if (this.cancelled) {
        return this.finalise({ status: 'cancelled', history: this.history });
      }

      // 1. Observe.
      let observation: VisionObservation;
      try {
        observation = await this.screenshotFn(tick);
      } catch (err) {
        const reason = `screenshot failed at tick ${tick}: ${errMsg(err)}`;
        return this.finalise({ status: 'failed', reason, history: this.history });
      }
      this.emitEv('tick', { tickIndex: tick, observation });

      // 2. Decide.
      const decision = await this.commander.decideNextAction({
        intent: goal,
        observation,
        history: this.history,
        maxSteps: this.maxSteps,
        ...(this.skillHint ? { skillHint: this.skillHint } : {}),
        ...(this.userId ? { userId: this.userId } : {}),
      });
      this.emitEv('decision', { tickIndex: tick, decision });

      // 3. Terminal actions skip driver execution and exit immediately.
      if (decision.action.kind === 'done') {
        this.recordTurn(observation, decision.action, decision.toolUseId, {
          ok: true,
          message: 'task_done',
        });
        return this.finalise({
          status: 'completed',
          summary: decision.action.summary,
          history: this.history,
        });
      }
      if (decision.action.kind === 'give_up') {
        this.recordTurn(observation, decision.action, decision.toolUseId, {
          ok: false,
          message: decision.action.reason,
        });
        return this.finalise({
          status: 'failed',
          reason: decision.action.reason,
          history: this.history,
        });
      }

      // 4. Execute the action. For clicks, translate model-space coords
      //    to real viewport pixels first — the driver doesn't know
      //    about the resize.
      const realAction = translateToRealSpace(decision.action, decision.image);
      let result: ActionResult;
      try {
        result = await this.actionFn(realAction);
      } catch (err) {
        result = { ok: false, message: `driver threw: ${errMsg(err)}` };
      }
      this.emitEv('acted', { tickIndex: tick, action: realAction, result });

      // 5. Record the turn so the next commander call has history.
      //    We record the ORIGINAL (model-space) action so decodeToolUse
      //    round-trips cleanly on subsequent ticks.
      this.recordTurn(observation, decision.action, decision.toolUseId, result);

      // If the driver hard-failed, don't loop forever — one bad action
      // per task is tolerable, two is a pattern.
      if (!result.ok && this.sequentialDriverFails() >= 2) {
        return this.finalise({
          status: 'failed',
          reason: `driver failed twice in a row (last: ${result.message ?? 'no detail'})`,
          history: this.history,
        });
      }
    }

    return this.finalise({
      status: 'paused',
      reason: `max_steps_reached (${this.maxSteps})`,
      history: this.history,
    });
  }

  private recordTurn(
    observation: VisionObservation,
    action: VisionAction,
    toolUseId: string | undefined,
    result: ActionResult,
  ): void {
    const turn: VisionLoopTurn = {
      observation,
      action,
      executionResult: result,
      ...(toolUseId ? { toolUseId } : {}),
    };
    this.history.push(turn);
    this.emitEv('turn', { tickIndex: this.history.length - 1, turn });
  }

  private finalise(outcome: RunOutcome): RunOutcome {
    this.emitEv('outcome', outcome);
    return outcome;
  }

  /** Count trailing turns whose executionResult was !ok. */
  private sequentialDriverFails(): number {
    let n = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const t = this.history[i];
      if (!t) break;
      if (t.executionResult && !t.executionResult.ok) n += 1;
      else break;
    }
    return n;
  }

  private emitEv<K extends keyof VisionLoopRunnerEvents>(
    event: K,
    ...args: Parameters<VisionLoopRunnerEvents[K]>
  ): void {
    (this.emitter as TypedVisionEmitter).emit(event, ...args);
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Translate a VisionAction from model-space to real viewport space.
 * Only click has coordinates; other actions pass through unchanged.
 * Exported so integration tests can verify the translation matches
 * what the CDP layer will see.
 */
export function translateToRealSpace(
  action: VisionAction,
  image: { scaleX: number; scaleY: number },
): VisionAction {
  if (action.kind !== 'click') return action;
  const real = modelCoordToReal(action.x, action.y, image);
  return { ...action, x: real.x, y: real.y };
}
