import { TRPCError } from '@trpc/server';
import {
  type OperationLifetime,
  currentOperationLifetime,
} from '../../execution/owned-operation.js';
import { assertQueueAdmission } from '../../queue/task-queue-lifetime.js';
import type { EnqueueResult } from '../../queue/task-queue.js';
import type { Context } from '../context.js';

export interface TaskQueueExecutionInput<C extends Context> {
  taskId: string;
  userId: string;
  runFn: (ctx: C) => Promise<void>;
  onStart: (ctx: C) => Promise<void> | void;
  onTimeout?: (ctx: C) => Promise<void> | void;
}

export function enqueueTaskExecution<C extends Context>(
  ctx: C,
  input: TaskQueueExecutionInput<C>,
): EnqueueResult {
  const controller = ctx.executionDrain;
  const parent = ctx.executionLifetime;
  try {
    // This is a caller adapter, not a root-admission API. A real request scope
    // must exist before trusting any queue ACK (including a legacy queue).
    const ambient = currentOperationLifetime();
    if (
      controller &&
      (!parent || ambient?.drain !== parent.drain || ambient.owner !== parent.owner)
    )
      throw unavailable();
    assertQueueAdmission(controller, parent);
  } catch {
    throw unavailable();
  }
  if (!ctx.taskQueue) throw unavailable();
  const bind = (lifetime?: OperationLifetime): C => {
    const ambient = currentOperationLifetime();
    if (!controller && !parent && !lifetime && !ambient) return ctx;
    if (
      !controller ||
      !lifetime ||
      lifetime.drain !== controller.drain ||
      ambient?.drain !== lifetime.drain ||
      ambient.owner !== lifetime.owner ||
      lifetime.owner === parent?.owner
    ) {
      controller?.drain.block();
      throw unavailable();
    }
    assertQueueAdmission(controller, lifetime);
    return { ...ctx, executionLifetime: lifetime };
  };
  const result = ctx.taskQueue.enqueue({
    executionLifetime: parent,
    taskId: input.taskId,
    userId: input.userId,
    runFn: (life) => input.runFn(bind(life)),
    onStart: (life) => input.onStart(bind(life)),
    ...(input.onTimeout
      ? { onTimeout: (life?: OperationLifetime) => input.onTimeout?.(bind(life)) }
      : {}),
  });
  // Only a proven capacity refusal may enter the caller's business failure write.
  if (result.kind === 'rejected' && result.reasonCode !== 'capacity') throw unavailable();
  return result;
}

function unavailable(): TRPCError {
  return new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: '服务正在维护，请稍后再试。' });
}
