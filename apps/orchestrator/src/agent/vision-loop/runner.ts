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

/**
 * How many consecutive tick-level failures tolerated before the runner
 * bails. F1 bumped this from 2 → 3: transient SPA flicker can hit
 * twice and recover on the third, and an extra tick costs one
 * commander call which is cheap compared to cascading a retry across
 * a whole task.
 */
const MAX_SEQUENTIAL_DRIVER_FAILS = 3;

/**
 * How many times to re-dispatch a single action when the driver
 * reports ok=false before recording the tick as failed. The default
 * is 2 attempts total (1 initial + 1 retry) — enough to swallow a
 * race with page reflow but not so many that we chew the clock on a
 * genuinely stuck target.
 */
const MAX_ACTION_ATTEMPTS = 2;
const ACTION_RETRY_DELAY_MS = 400;
import type { A11yAction } from './actions-a11y.js';
import type { VisionAction } from './actions.js';
import type {
  AccessibilityDecision,
  AccessibilityLoopTurn,
  VisionDecision,
  VisionLoopCommander,
  VisionLoopTurn,
  VisionObservation,
} from './commander.js';
import { modelCoordToReal } from './image.js';
import type { AccessibilityNodeRef } from './playwright-executor.js';
import {
  MIN_A11Y_ELEMENTS,
  type VisionMode,
  type VisionModeEnv,
  readVisionModeEnv,
} from './vision-mode.js';

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
 * resolution. `tickIndex` matches the screenshot's tickIndex so WS
 * adapters can correlate request/response frames.
 */
export type ActionFn = (tickIndex: number, action: VisionAction) => Promise<ActionResult>;

/**
 * Accessibility-mode observation surface. The runner asks the driver
 * for a snapshot (text + refs + url + title); the commander consumes
 * that instead of a screenshot in accessibility / auto modes.
 */
export interface AccessibilityObservation {
  snapshot: string;
  refs: AccessibilityNodeRef[];
  url: string;
  title: string;
}

export type AccessibilityFn = (tickIndex: number) => Promise<AccessibilityObservation>;

/**
 * A11y-mode action dispatcher. Parallel to ActionFn but carries an
 * A11yAction (ref-based) instead of a VisionAction (coord-based).
 */
export type A11yActionFn = (tickIndex: number, action: A11yAction) => Promise<ActionResult>;

/** Union of the two turn shapes — exported so outcome consumers can narrow. */
export type AnyTurn = VisionLoopTurn | AccessibilityLoopTurn;

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
  /** Forwarded to commander so each llm_calls row carries the task id. */
  taskExternalId?: string;
  /**
   * Override the VISION_MODE env. Tests use this to force a mode
   * without touching global env; prod callers usually omit and let
   * `readVisionModeEnv()` pick from process.env.
   */
  visionModeEnv?: VisionModeEnv;
  /**
   * Accessibility-mode transport. Required to run in `accessibility`
   * or `auto` (the latter peeks at a11y first each tick to decide).
   * Omit to pin the runner to screenshot mode regardless of env.
   */
  accessibilityFn?: AccessibilityFn;
  a11yActionFn?: A11yActionFn;
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
  | { status: 'completed'; summary: string; history: AnyTurn[] }
  | { status: 'failed'; reason: string; history: AnyTurn[] }
  | { status: 'paused'; reason: string; history: AnyTurn[] }
  | { status: 'cancelled'; history: AnyTurn[] };

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
  tick: (ev: {
    tickIndex: number;
    mode: VisionMode;
    /** Populated when mode='screenshot'. */
    observation?: VisionObservation;
    /** Populated when mode='accessibility'. */
    accessibility?: AccessibilityObservation;
  }) => void;
  decision: (ev: {
    tickIndex: number;
    mode: VisionMode;
    decision: VisionDecision | AccessibilityDecision;
  }) => void;
  acted: (ev: {
    tickIndex: number;
    mode: VisionMode;
    action: VisionAction | A11yAction;
    result: ActionResult;
  }) => void;
  turn: (ev: { tickIndex: number; turn: AnyTurn }) => void;
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
  private readonly accessibilityFn?: AccessibilityFn;
  private readonly a11yActionFn?: A11yActionFn;
  private readonly visionModeEnv: VisionModeEnv;
  private readonly maxSteps: number;
  private readonly skillHint?: string;
  private readonly userId?: string;
  private readonly taskExternalId?: string;
  private readonly emitter: EventEmitter = new EventEmitter();
  private cancelled = false;
  /**
   * Master history in chronological tick order. Each entry is either a
   * VisionLoopTurn or an AccessibilityLoopTurn; consumers narrow via
   * the turn's shape (VisionLoopTurn has `observation`, AccessibilityLoopTurn
   * has `snapshot`).
   */
  private readonly history: AnyTurn[] = [];
  /** Mode-scoped history shards fed back to the commander each tick. */
  private readonly visionHistory: VisionLoopTurn[] = [];
  private readonly a11yHistory: AccessibilityLoopTurn[] = [];

  constructor(opts: VisionLoopRunnerOptions) {
    this.commander = opts.commander;
    this.screenshotFn = opts.screenshotFn;
    this.actionFn = opts.actionFn;
    this.maxSteps = opts.maxSteps ?? 30;
    if (opts.skillHint) this.skillHint = opts.skillHint;
    if (opts.userId) this.userId = opts.userId;
    if (opts.taskExternalId) this.taskExternalId = opts.taskExternalId;
    if (opts.accessibilityFn) this.accessibilityFn = opts.accessibilityFn;
    if (opts.a11yActionFn) this.a11yActionFn = opts.a11yActionFn;
    // Mode source: explicit opt → env → 'auto'. A11y-capable callers
    // (task-runner wiring Playwright) should ALSO pass accessibilityFn
    // + a11yActionFn; without those we silently pin to screenshot even
    // if env says otherwise (see pickMode below).
    this.visionModeEnv = opts.visionModeEnv ?? readVisionModeEnv();
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

      // ---------- 1. Pick mode for this tick ----------
      // In 'auto', we sample the a11y snapshot here so we can decide
      // based on live ref count (MIN_A11Y_ELEMENTS threshold). The
      // fetched observation is reused below if we commit to a11y,
      // avoiding a double call.
      let mode: VisionMode;
      let preFetchedA11y: AccessibilityObservation | null = null;
      const a11yWired = Boolean(
        this.accessibilityFn && this.a11yActionFn && this.commander.decideNextActionAccessibility,
      );
      if (this.visionModeEnv === 'screenshot' || !a11yWired) {
        mode = 'screenshot';
      } else if (this.visionModeEnv === 'accessibility') {
        mode = 'accessibility';
      } else {
        // auto — we already verified accessibilityFn is present via a11yWired.
        const a11yFn = this.accessibilityFn;
        try {
          preFetchedA11y = a11yFn ? await a11yFn(tick) : null;
        } catch {
          preFetchedA11y = null;
        }
        mode =
          preFetchedA11y && preFetchedA11y.refs.length >= MIN_A11Y_ELEMENTS
            ? 'accessibility'
            : 'screenshot';
      }

      const outcome =
        mode === 'accessibility'
          ? await this.runA11yTick(tick, goal, preFetchedA11y)
          : await this.runScreenshotTick(tick, goal);
      if (outcome) return outcome;
    }

    return this.finalise({
      status: 'paused',
      reason: `max_steps_reached (${this.maxSteps})`,
      history: this.history,
    });
  }

  /**
   * Run a single tick in screenshot mode. Returns a terminal RunOutcome
   * to bubble up, or null to continue the loop.
   */
  private async runScreenshotTick(tick: number, goal: string): Promise<RunOutcome | null> {
    let observation: VisionObservation;
    try {
      observation = await this.screenshotFn(tick);
    } catch (err) {
      const reason = `screenshot failed at tick ${tick}: ${errMsg(err)}`;
      return this.finalise({ status: 'failed', reason, history: this.history });
    }
    this.emitEv('tick', { tickIndex: tick, mode: 'screenshot', observation });

    const decision = await this.commander.decideNextAction({
      intent: goal,
      observation,
      history: this.visionHistory,
      maxSteps: this.maxSteps,
      ...(this.skillHint ? { skillHint: this.skillHint } : {}),
      ...(this.userId ? { userId: this.userId } : {}),
      ...(this.taskExternalId ? { taskExternalId: this.taskExternalId } : {}),
    });
    this.emitEv('decision', { tickIndex: tick, mode: 'screenshot', decision });

    if (decision.action.kind === 'done') {
      this.recordVisionTurn(observation, decision.action, decision.toolUseId, {
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
      this.recordVisionTurn(observation, decision.action, decision.toolUseId, {
        ok: false,
        message: decision.action.reason,
      });
      return this.finalise({
        status: 'failed',
        reason: decision.action.reason,
        history: this.history,
      });
    }

    const realAction = translateToRealSpace(decision.action, decision.image);
    const result = await this.dispatchWithRetry(() => this.actionFn(tick, realAction));
    this.emitEv('acted', { tickIndex: tick, mode: 'screenshot', action: realAction, result });
    this.recordVisionTurn(observation, decision.action, decision.toolUseId, result);

    if (!result.ok && this.sequentialDriverFails() >= MAX_SEQUENTIAL_DRIVER_FAILS) {
      return this.finalise({
        status: 'failed',
        reason: `driver failed ${MAX_SEQUENTIAL_DRIVER_FAILS} ticks in a row (last: ${result.message ?? 'no detail'})`,
        history: this.history,
      });
    }
    return null;
  }

  /**
   * Run a single tick in accessibility mode. `preFetched` is the
   * observation the mode-picker already read (when arriving from
   * 'auto'); if null we fetch fresh.
   */
  private async runA11yTick(
    tick: number,
    goal: string,
    preFetched: AccessibilityObservation | null,
  ): Promise<RunOutcome | null> {
    // Safe to assert — `pickMode` in run() only routes here when the
    // full a11y trio (accessibilityFn / a11yActionFn / commander.a11y)
    // is present. Hoist once so we stop sprinkling non-null asserts.
    const accessibilityFn = this.accessibilityFn;
    const a11yActionFn = this.a11yActionFn;
    const commanderA11y = this.commander.decideNextActionAccessibility?.bind(this.commander);
    if (!accessibilityFn || !a11yActionFn || !commanderA11y) {
      return this.finalise({
        status: 'failed',
        reason: 'a11y mode picked but runner is not a11y-wired (internal invariant broken)',
        history: this.history,
      });
    }
    let obs: AccessibilityObservation;
    try {
      obs = preFetched ?? (await accessibilityFn(tick));
    } catch (err) {
      return this.finalise({
        status: 'failed',
        reason: `accessibility observe failed at tick ${tick}: ${errMsg(err)}`,
        history: this.history,
      });
    }
    this.emitEv('tick', { tickIndex: tick, mode: 'accessibility', accessibility: obs });

    const decision = await commanderA11y({
      intent: goal,
      snapshot: obs.snapshot,
      refs: obs.refs,
      url: obs.url,
      title: obs.title,
      tickIndex: tick,
      history: this.a11yHistory,
      maxSteps: this.maxSteps,
      ...(this.skillHint ? { skillHint: this.skillHint } : {}),
      ...(this.userId ? { userId: this.userId } : {}),
      ...(this.taskExternalId ? { taskExternalId: this.taskExternalId } : {}),
    });
    this.emitEv('decision', { tickIndex: tick, mode: 'accessibility', decision });

    if (decision.action.kind === 'done') {
      this.recordA11yTurn(obs, decision.action, decision.toolUseId, {
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
      this.recordA11yTurn(obs, decision.action, decision.toolUseId, {
        ok: false,
        message: decision.action.reason,
      });
      return this.finalise({
        status: 'failed',
        reason: decision.action.reason,
        history: this.history,
      });
    }

    const result = await this.dispatchWithRetry(() => a11yActionFn(tick, decision.action));
    this.emitEv('acted', {
      tickIndex: tick,
      mode: 'accessibility',
      action: decision.action,
      result,
    });
    this.recordA11yTurn(obs, decision.action, decision.toolUseId, result);

    if (!result.ok && this.sequentialDriverFails() >= MAX_SEQUENTIAL_DRIVER_FAILS) {
      return this.finalise({
        status: 'failed',
        reason: `driver failed ${MAX_SEQUENTIAL_DRIVER_FAILS} ticks in a row (last: ${result.message ?? 'no detail'})`,
        history: this.history,
      });
    }
    return null;
  }

  private recordA11yTurn(
    obs: AccessibilityObservation,
    action: A11yAction,
    toolUseId: string | undefined,
    result: ActionResult,
  ): void {
    const turn: AccessibilityLoopTurn = {
      snapshot: obs.snapshot,
      url: obs.url,
      title: obs.title,
      action,
      executionResult: result,
      ...(toolUseId ? { toolUseId } : {}),
    };
    this.a11yHistory.push(turn);
    this.history.push(turn);
    this.emitEv('turn', { tickIndex: this.history.length - 1, turn });
  }

  /**
   * Run an action-dispatch closure up to MAX_ACTION_ATTEMPTS times.
   * A thrown exception or `ok=false` result triggers a retry with
   * ACTION_RETRY_DELAY_MS gap between attempts; the LAST attempt's
   * result is returned. Never throws — a thrown final attempt becomes
   * `{ok: false, message: 'driver threw: ...'}`.
   *
   * This handles the "page was mid-reflow when we clicked" class of
   * failure that's otherwise indistinguishable from a real bug. The
   * sequentialDriverFails guard still fires on a cross-tick pattern;
   * we just swallow the single-tick flicker here.
   */
  private async dispatchWithRetry(fn: () => Promise<ActionResult>): Promise<ActionResult> {
    let result: ActionResult = { ok: false, message: 'dispatchWithRetry: no attempt made' };
    for (let attempt = 0; attempt < MAX_ACTION_ATTEMPTS; attempt++) {
      try {
        result = await fn();
      } catch (err) {
        result = { ok: false, message: `driver threw: ${errMsg(err)}` };
      }
      if (result.ok) return result;
      if (attempt + 1 < MAX_ACTION_ATTEMPTS) {
        await new Promise<void>((resolve) => setTimeout(resolve, ACTION_RETRY_DELAY_MS));
      }
    }
    return result;
  }

  private recordVisionTurn(
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
    this.visionHistory.push(turn);
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
