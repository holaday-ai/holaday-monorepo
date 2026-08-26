import { and, eq, inArray, isNull } from 'drizzle-orm';
import { supercarAbort } from '../agent/supercar/agent-loop.js';
import { cancelUserTasksForAccountClosure } from '../agent/task-repository.js';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { accountClosureEffects, accountClosureRequests } from '../db/schema/account-closures.js';
import { batchTaskItems, batchTasks } from '../db/schema/batch-tasks.js';
import { notificationChannels } from '../db/schema/notifications.js';
import { plannedTasks } from '../db/schema/planned-tasks.js';
import { scheduledTasks } from '../db/schema/scheduled-tasks.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';

type DBTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];

export interface ClosureEffectSummary {
  cancelledTaskIds: string[];
  cancelledBatchTaskIds: string[];
  cancelledBatchTaskItemIds: string[];
  pausedPlannedTaskIds: string[];
  pausedScheduledTaskIds: string[];
  disabledNotificationChannelIds: string[];
}

interface RestorationPolicyInput {
  resourceType: string;
  previousState: string;
  closureAppliedState: string;
}

/** Return the only safe stable state for a recorded reversible effect. */
export function closureRestorationTarget(input: RestorationPolicyInput): string | null {
  if (
    (input.resourceType === 'planned_task' || input.resourceType === 'scheduled_task') &&
    input.previousState === 'active' &&
    input.closureAppliedState === 'paused'
  ) {
    return 'active';
  }
  if (
    input.resourceType === 'notification_channel' &&
    input.previousState === 'enabled' &&
    input.closureAppliedState === 'disabled'
  ) {
    return 'enabled';
  }
  return null;
}

export async function applyImmediateClosureEffects(
  db: DB,
  input: { requestId: number; userId: number; userExternalId: string },
  deps: { abortTask?: (taskId: string) => boolean } = {},
): Promise<ClosureEffectSummary> {
  const summary = await db.transaction(async (tx) => {
    const [request] = await tx
      .select({ id: accountClosureRequests.id })
      .from(accountClosureRequests)
      .innerJoin(users, eq(users.id, accountClosureRequests.userId))
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.userId, input.userId),
          eq(accountClosureRequests.activeUserId, input.userId),
          inArray(accountClosureRequests.status, [
            'pending_grace',
            'processing',
            'needs_attention',
          ]),
          eq(users.externalId, input.userExternalId),
        ),
      )
      .limit(1)
      .for('update');
    if (!request) throw new Error('Account closure request is not active');

    const cancelledTasks = await cancelUserTasksForAccountClosure(tx, input.userId);
    for (const task of cancelledTasks) {
      await insertEffect(tx, {
        requestId: input.requestId,
        resourceType: 'task',
        resourceId: task.externalId,
        previousState: task.previousStatus,
        closureAppliedState: 'cancelled',
      });
    }

    const { cancelledBatchTaskIds, cancelledBatchTaskItemIds } = await cancelBatchWork(
      tx,
      input.requestId,
      input.userId,
    );

    const pausedPlannedTaskIds = await pauseFutureWork(
      tx,
      'planned_task',
      plannedTasks,
      input.requestId,
      input.userId,
    );
    const pausedScheduledTaskIds = await pauseFutureWork(
      tx,
      'scheduled_task',
      scheduledTasks,
      input.requestId,
      input.userId,
    );

    const enabledChannels = await tx
      .select({ id: notificationChannels.id, externalId: notificationChannels.externalId })
      .from(notificationChannels)
      .where(
        and(eq(notificationChannels.userId, input.userId), eq(notificationChannels.enabled, true)),
      )
      .for('update');
    const disabledNotificationChannelIds: string[] = [];
    for (const channel of enabledChannels) {
      const result = await tx
        .update(notificationChannels)
        .set({ enabled: false })
        .where(
          and(
            eq(notificationChannels.id, channel.id),
            eq(notificationChannels.userId, input.userId),
            eq(notificationChannels.enabled, true),
          ),
        );
      if (readAffectedRows(result) !== 1) continue;
      await insertEffect(tx, {
        requestId: input.requestId,
        resourceType: 'notification_channel',
        resourceId: channel.externalId,
        previousState: 'enabled',
        closureAppliedState: 'disabled',
      });
      disabledNotificationChannelIds.push(channel.externalId);
    }

    // Include previously recorded task effects as well as this transaction's
    // winners. A retry can therefore re-issue post-commit in-memory/external
    // cancellation without duplicating state changes or effect rows.
    const taskEffects = await tx
      .select({
        resourceId: accountClosureEffects.resourceId,
        previousState: accountClosureEffects.previousState,
      })
      .from(accountClosureEffects)
      .where(
        and(
          eq(accountClosureEffects.requestId, input.requestId),
          eq(accountClosureEffects.resourceType, 'task'),
          isNull(accountClosureEffects.restoredAt),
        ),
      );

    return {
      cancelledTaskIds: taskEffects.map((effect) => effect.resourceId),
      runningTaskIds: taskEffects
        .filter((effect) => effect.previousState === 'executing')
        .map((effect) => effect.resourceId),
      cancelledBatchTaskIds,
      cancelledBatchTaskItemIds,
      pausedPlannedTaskIds,
      pausedScheduledTaskIds,
      disabledNotificationChannelIds,
    };
  });

  // In-memory aborts happen only after the durable cancellation transaction.
  // A missing/failed local handle leaves the durable cancellation intact but
  // must surface a retry signal. A later apply pass re-reads the same effect
  // rows, so it can retry the abort without duplicating effects.
  const abortTask = deps.abortTask ?? supercarAbort;
  const abortFailures: string[] = [];
  for (const taskId of summary.runningTaskIds) {
    try {
      if (!abortTask(taskId)) abortFailures.push(taskId);
    } catch {
      abortFailures.push(taskId);
    }
  }
  if (abortFailures.length > 0) {
    throw new ImmediateClosureEffectsRetryableError(abortFailures.length);
  }
  const { runningTaskIds: _, ...publicSummary } = summary;
  return publicSummary;
}

export class ImmediateClosureEffectsRetryableError extends Error {
  constructor(public readonly failedAbortCount: number) {
    super(`Immediate closure effects require retry (${failedAbortCount} task aborts pending)`);
    this.name = 'ImmediateClosureEffectsRetryableError';
  }
}

export async function restoreImmediateClosureEffects(
  db: DB,
  input: { requestId: number; userId: number },
): Promise<void> {
  await db.transaction((tx) => restoreImmediateClosureEffectsInTransaction(tx, input));
}

export async function restoreImmediateClosureEffectsInTransaction(
  tx: DBTransaction,
  input: { requestId: number; userId: number },
): Promise<void> {
  const [request] = await tx
    .select({ status: accountClosureRequests.status })
    .from(accountClosureRequests)
    .innerJoin(users, eq(users.id, accountClosureRequests.userId))
    .where(
      and(
        eq(accountClosureRequests.id, input.requestId),
        eq(accountClosureRequests.userId, input.userId),
        eq(accountClosureRequests.status, 'cancelled'),
        eq(users.status, 'active'),
      ),
    )
    .limit(1)
    .for('update');
  if (!request) return;

  const effects = await tx
    .select({
      id: accountClosureEffects.id,
      resourceType: accountClosureEffects.resourceType,
      resourceId: accountClosureEffects.resourceId,
      previousState: accountClosureEffects.previousState,
      closureAppliedState: accountClosureEffects.closureAppliedState,
    })
    .from(accountClosureEffects)
    .where(
      and(
        eq(accountClosureEffects.requestId, input.requestId),
        isNull(accountClosureEffects.restoredAt),
      ),
    )
    .for('update');

  for (const effect of effects) {
    const target = closureRestorationTarget(effect);
    let handled = false;
    if (effect.resourceType === 'task') {
      await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.externalId, effect.resourceId),
            eq(tasks.userId, input.userId),
            eq(tasks.status, effect.closureAppliedState),
          ),
        )
        .limit(1);
      // Cancelled work is intentionally not restarted. A missing, moved, or
      // independently changed row is also a safe terminal no-op.
      handled = true;
    } else if (effect.resourceType === 'batch_task' || effect.resourceType === 'batch_task_item') {
      // Closure-cancelled batch work is never restarted on withdrawal.
      handled = true;
    } else if (effect.resourceType === 'planned_task' && target === 'active') {
      await tx
        .update(plannedTasks)
        .set({ status: 'active' })
        .where(
          and(
            eq(plannedTasks.externalId, effect.resourceId),
            eq(plannedTasks.userId, input.userId),
            eq(plannedTasks.status, effect.closureAppliedState),
          ),
        );
      handled = true;
    } else if (effect.resourceType === 'scheduled_task' && target === 'active') {
      await tx
        .update(scheduledTasks)
        .set({ status: 'active' })
        .where(
          and(
            eq(scheduledTasks.externalId, effect.resourceId),
            eq(scheduledTasks.userId, input.userId),
            eq(scheduledTasks.status, effect.closureAppliedState),
          ),
        );
      handled = true;
    } else if (effect.resourceType === 'notification_channel' && target === 'enabled') {
      await tx
        .update(notificationChannels)
        .set({ enabled: true })
        .where(
          and(
            eq(notificationChannels.externalId, effect.resourceId),
            eq(notificationChannels.userId, input.userId),
            eq(notificationChannels.enabled, false),
          ),
        );
      handled = true;
    }
    if (!handled) continue;
    await tx
      .update(accountClosureEffects)
      .set({ restoredAt: new Date() })
      .where(
        and(eq(accountClosureEffects.id, effect.id), isNull(accountClosureEffects.restoredAt)),
      );
  }
}

async function cancelBatchWork(
  tx: DBTransaction,
  requestId: number,
  userId: number,
): Promise<{ cancelledBatchTaskIds: string[]; cancelledBatchTaskItemIds: string[] }> {
  const candidates = await tx
    .select({ id: batchTasks.id, externalId: batchTasks.externalId, status: batchTasks.status })
    .from(batchTasks)
    .where(and(eq(batchTasks.userId, userId), inArray(batchTasks.status, ['pending', 'running'])))
    .for('update');
  const cancelledBatchTaskIds: string[] = [];
  const cancelledBatchTaskItemIds: string[] = [];
  for (const batch of candidates) {
    const items = await tx
      .select({
        id: batchTaskItems.id,
        externalId: batchTaskItems.externalId,
        status: batchTaskItems.status,
      })
      .from(batchTaskItems)
      .where(
        and(
          eq(batchTaskItems.batchId, batch.id),
          inArray(batchTaskItems.status, ['pending', 'running']),
        ),
      )
      .for('update');
    const parentResult = await tx
      .update(batchTasks)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(
        and(
          eq(batchTasks.id, batch.id),
          eq(batchTasks.userId, userId),
          eq(batchTasks.status, batch.status),
        ),
      );
    if (readAffectedRows(parentResult) !== 1) continue;
    await insertEffect(tx, {
      requestId,
      resourceType: 'batch_task',
      resourceId: batch.externalId,
      previousState: batch.status,
      closureAppliedState: 'cancelled',
    });
    cancelledBatchTaskIds.push(batch.externalId);
    for (const item of items) {
      const itemResult = await tx
        .update(batchTaskItems)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(
          and(
            eq(batchTaskItems.id, item.id),
            eq(batchTaskItems.batchId, batch.id),
            eq(batchTaskItems.status, item.status),
          ),
        );
      if (readAffectedRows(itemResult) !== 1) continue;
      await insertEffect(tx, {
        requestId,
        resourceType: 'batch_task_item',
        resourceId: item.externalId,
        previousState: item.status,
        closureAppliedState: 'cancelled',
      });
      cancelledBatchTaskItemIds.push(item.externalId);
    }
  }
  return { cancelledBatchTaskIds, cancelledBatchTaskItemIds };
}

async function insertEffect(
  tx: DBTransaction,
  input: typeof accountClosureEffects.$inferInsert,
): Promise<void> {
  await tx.insert(accountClosureEffects).values(input);
}

async function pauseFutureWork(
  tx: DBTransaction,
  resourceType: 'planned_task' | 'scheduled_task',
  table: typeof plannedTasks | typeof scheduledTasks,
  requestId: number,
  userId: number,
): Promise<string[]> {
  // `running` is a transient claim derived from the stable `active` state.
  // Recording `active` makes a pre-dispatch closure race exactly reversible.
  const candidates = await tx
    .select({ id: table.id, externalId: table.externalId, status: table.status })
    .from(table)
    .where(and(eq(table.userId, userId), inArray(table.status, ['active', 'running'])))
    .for('update');
  const changed: string[] = [];
  for (const resource of candidates) {
    const result = await tx
      .update(table)
      .set({ status: 'paused' })
      .where(
        and(eq(table.id, resource.id), eq(table.userId, userId), eq(table.status, resource.status)),
      );
    if (readAffectedRows(result) !== 1) continue;
    await insertEffect(tx, {
      requestId,
      resourceType,
      resourceId: resource.externalId,
      previousState: 'active',
      closureAppliedState: 'paused',
    });
    changed.push(resource.externalId);
  }
  return changed;
}
