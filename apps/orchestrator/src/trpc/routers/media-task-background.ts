import {
  DrizzleLlmCallRecorder,
  type LlmCallRecord,
  type LlmCallRecorder,
} from '../../agent/llm-call-recorder.js';
import { withMediaCallContext } from '../../agent/media-call-recorder.js';
import type { Context } from '../context.js';
import { runTaskBackground } from './task-background.js';
function recorder(ctx: Context, taskId: string): LlmCallRecorder {
  return new DrizzleLlmCallRecorder(ctx.db, {
    onError: () => ctx.logger.warn({ taskId }, 'task: cost persistence failed'),
  });
}
export function withTaskCostContext<T>(
  ctx: Context,
  taskId: string,
  action: () => Promise<T>,
  sink = recorder(ctx, taskId),
): Promise<T> {
  if (!ctx.userId) throw new Error('TASK_COST_OWNER_REQUIRED');
  return withMediaCallContext(
    { userExternalId: ctx.userId, taskExternalId: taskId, recorder: sink },
    action,
  );
}
export function runMediaTaskBackground<C extends Context, T>(
  ctx: C,
  taskId: string,
  action: (ctx: C) => Promise<T>,
): Promise<T> {
  return runTaskBackground(ctx, (next) => withTaskCostContext(next, taskId, () => action(next)));
}
/** Quote optimization precedes task insertion. Flush only after its new task exists. */
export function deferredTaskCosts(ctx: Context, taskId: string) {
  const calls: LlmCallRecord[] = [];
  const sink: LlmCallRecorder = {
    record: async (call) => {
      calls.push(call);
    },
  };
  return {
    run: <T>(action: () => Promise<T>) => withTaskCostContext(ctx, taskId, action, sink),
    flush: async () => {
      const target = recorder(ctx, taskId);
      for (const call of calls.splice(0)) await target.record(call);
    },
  };
}
