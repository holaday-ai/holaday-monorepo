import { newExternalId } from '@holaday/shared-types';
import type { ServerMessage } from '@holaday/shared-types';

/**
 * In-memory state machine for the Agent Loop control plane.
 *
 * Phase 0 scaffold scope: this owns the *decision* on what to send next when
 * a `client.step.result` arrives. It does NOT yet persist to MySQL — that
 * lands when SkillLoader / planner exist (W2). Once persistence is added,
 * `loadTask` and `saveStep` will be the only methods that talk to Drizzle;
 * the decision logic stays pure.
 *
 * Status machine (mirrors docs/HOLADAY_ORCHESTRATOR_DESIGN.md):
 *
 *   pending → planning → executing ↔ awaiting_user
 *                          ↕             ↓
 *                        paused      cancelled
 *                          ↓
 *                      completed / failed
 */

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus = 'ok' | 'error' | 'awaiting_user';
export type Risk = 'low' | 'medium' | 'high';

export interface PlannedStep {
  id: string; // step external_id (stp_...)
  kind: 'goto' | 'click' | 'type' | 'extract' | 'wait' | 'eval' | 'screenshot';
  selector?: import('@holaday/shared-types').ResilientSelector;
  payload?: Record<string, unknown>;
  risk: Risk;
  // If true, execution must pause for user confirm even if it completes ok.
  requiresConfirm?: boolean;
}

export interface TaskState {
  taskId: string; // tsk_...
  status: TaskStatus;
  plan: PlannedStep[];
  cursor: number; // index of next step to dispatch
  pendingConfirm?: { stepId: string; prompt: string; risk: Risk } | null;
  error?: { code: string; message: string };
}

export interface ControllerInput {
  /** Existing in-memory state for this task (or `null` to seed from `plan`). */
  state: TaskState | null;
  /** New plan to seed if state is null. */
  plan?: PlannedStep[];
  /** Optional intent / metadata, kept for logs only. */
  intent?: string;
}

export interface StepResultInput {
  taskId: string;
  stepId: string;
  status: StepStatus;
  data?: unknown;
  error?: { code: string; message: string };
}

export type ControlEffect =
  | { kind: 'send'; message: ServerMessage }
  | { kind: 'persist'; state: TaskState }
  | { kind: 'noop' };

const HIGH_RISK_KINDS: ReadonlySet<PlannedStep['kind']> = new Set();

/**
 * Pure decision functions. The WS server (or future TaskRunner) calls these,
 * receives a list of effects, and acts on them. Keeping them pure makes the
 * state machine trivially testable.
 */
export class TaskController {
  /**
   * Bootstrap a task: returns the dispatch for the first step (or completion
   * if the plan is empty).
   */
  start(input: ControllerInput): { state: TaskState; effects: ControlEffect[] } {
    if (!input.state && !input.plan) {
      throw new Error('start() needs either an existing state or a plan');
    }
    const state: TaskState =
      input.state ??
      ({
        taskId: newExternalId('task'),
        status: 'planning',
        plan: input.plan ?? [],
        cursor: 0,
        pendingConfirm: null,
      } satisfies TaskState);

    if (state.plan.length === 0) {
      const completed: TaskState = { ...state, status: 'completed' };
      return {
        state: completed,
        effects: [{ kind: 'persist', state: completed }],
      };
    }

    const next = state.plan[state.cursor];
    if (!next) {
      const completed: TaskState = { ...state, status: 'completed' };
      return { state: completed, effects: [{ kind: 'persist', state: completed }] };
    }

    const executing: TaskState = { ...state, status: 'executing' };
    return {
      state: executing,
      effects: [
        { kind: 'persist', state: executing },
        { kind: 'send', message: dispatchMessage(executing.taskId, next) },
      ],
    };
  }

  /**
   * Apply a step result. Decides:
   *   - ok    → advance cursor; dispatch next or complete
   *   - error → mark failed, no further dispatch (Phase 0: no auto-retry)
   *   - awaiting_user → emit server.user.confirm with prompt; wait
   */
  onStepResult(
    state: TaskState,
    input: StepResultInput,
  ): {
    state: TaskState;
    effects: ControlEffect[];
  } {
    if (state.taskId !== input.taskId) {
      return { state, effects: [{ kind: 'noop' }] };
    }
    const current = state.plan[state.cursor];
    if (!current || current.id !== input.stepId) {
      // Out-of-order or stale step result: ignore for Phase 0.
      return { state, effects: [{ kind: 'noop' }] };
    }

    if (input.status === 'error') {
      const failed: TaskState = {
        ...state,
        status: 'failed',
        error: input.error ?? { code: 'STEP_ERROR', message: 'unspecified step error' },
      };
      return {
        state: failed,
        effects: [{ kind: 'persist', state: failed }],
      };
    }

    if (input.status === 'awaiting_user' || current.requiresConfirm || isHighRisk(current)) {
      const awaiting: TaskState = {
        ...state,
        status: 'awaiting_user',
        pendingConfirm: {
          stepId: current.id,
          prompt: defaultConfirmPrompt(current),
          risk: current.risk,
        },
      };
      return {
        state: awaiting,
        effects: [
          { kind: 'persist', state: awaiting },
          {
            kind: 'send',
            message: {
              type: 'server.user.confirm',
              taskId: state.taskId,
              stepId: current.id,
              prompt: defaultConfirmPrompt(current),
              risk: current.risk,
            },
          },
        ],
      };
    }

    // OK path: advance.
    const advanced: TaskState = { ...state, cursor: state.cursor + 1, pendingConfirm: null };
    const nextStep = advanced.plan[advanced.cursor];
    if (!nextStep) {
      const completed: TaskState = { ...advanced, status: 'completed' };
      return { state: completed, effects: [{ kind: 'persist', state: completed }] };
    }
    const executing: TaskState = { ...advanced, status: 'executing' };
    return {
      state: executing,
      effects: [
        { kind: 'persist', state: executing },
        { kind: 'send', message: dispatchMessage(executing.taskId, nextStep) },
      ],
    };
  }

  /**
   * User confirmed a paused step. We treat it as the equivalent of an ok
   * step.result and continue the loop.
   */
  userConfirm(
    state: TaskState,
    decision: 'approve' | 'reject',
  ): {
    state: TaskState;
    effects: ControlEffect[];
  } {
    if (state.status !== 'awaiting_user' || !state.pendingConfirm) {
      return { state, effects: [{ kind: 'noop' }] };
    }
    if (decision === 'reject') {
      const cancelled: TaskState = {
        ...state,
        status: 'cancelled',
        pendingConfirm: null,
      };
      return {
        state: cancelled,
        effects: [
          { kind: 'persist', state: cancelled },
          {
            kind: 'send',
            message: { type: 'server.task.control', taskId: state.taskId, command: 'cancel' },
          },
        ],
      };
    }
    // approve == continue
    const advanced: TaskState = {
      ...state,
      cursor: state.cursor + 1,
      pendingConfirm: null,
    };
    const nextStep = advanced.plan[advanced.cursor];
    if (!nextStep) {
      const completed: TaskState = { ...advanced, status: 'completed' };
      return { state: completed, effects: [{ kind: 'persist', state: completed }] };
    }
    const executing: TaskState = { ...advanced, status: 'executing' };
    return {
      state: executing,
      effects: [
        { kind: 'persist', state: executing },
        { kind: 'send', message: dispatchMessage(executing.taskId, nextStep) },
      ],
    };
  }

  /** External cancel (user closed task). */
  cancel(state: TaskState): { state: TaskState; effects: ControlEffect[] } {
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      return { state, effects: [{ kind: 'noop' }] };
    }
    const cancelled: TaskState = { ...state, status: 'cancelled', pendingConfirm: null };
    return {
      state: cancelled,
      effects: [
        { kind: 'persist', state: cancelled },
        {
          kind: 'send',
          message: { type: 'server.task.control', taskId: state.taskId, command: 'cancel' },
        },
      ],
    };
  }
}

function dispatchMessage(taskId: string, step: PlannedStep): ServerMessage {
  return {
    type: 'server.task.dispatch',
    taskId,
    stepId: step.id,
    action: {
      kind: step.kind,
      selector: step.selector,
      payload: step.payload,
    },
  };
}

function isHighRisk(step: PlannedStep): boolean {
  return step.risk === 'high' || HIGH_RISK_KINDS.has(step.kind);
}

function defaultConfirmPrompt(step: PlannedStep): string {
  const what = step.selector?.description ?? step.kind;
  return `请确认下一步：${what}`;
}
