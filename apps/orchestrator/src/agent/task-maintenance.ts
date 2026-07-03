import { newExternalId } from '@holaday/shared-types';
import { and, eq, inArray, lt } from 'drizzle-orm';

import type { DB } from '../db/client.js';
import { taskEvents } from '../db/schema/task-events.js';
import { tasks } from '../db/schema/tasks.js';

type StaleTaskStatusColumn = 'createdAt' | 'updatedAt';
type TaskFailureSource = 'boot_sweep' | 'runtime_zombie_reaper' | 'restart_rehydration';

interface FailStaleTasksParams {
  source: TaskFailureSource;
  sourceStatuses: string[];
  staleBy: StaleTaskStatusColumn;
  cutoff: Date;
  errorCode: string;
  errorMessage: string;
  clearAwaiting?: boolean;
}

interface StaleTaskCandidate {
  id: number;
  externalId: string;
  status: string;
}

interface FailTaskWithEventParams {
  source: TaskFailureSource;
  taskExternalId: string;
  fromStatus: string;
  errorCode: string;
  errorMessage: string;
  clearAwaiting?: boolean;
}

function extractMysqlAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    if (typeof head?.affectedRows === 'number') return head.affectedRows;
  }
  const direct = (result as { affectedRows?: number } | null)?.affectedRows;
  return typeof direct === 'number' ? direct : 0;
}

/**
 * Mark abandoned transient task rows as failed and append an audit event
 * for each row that actually changed. The UPDATE is guarded by the row's
 * observed status and stale cutoff so a racing completion/resume cannot
 * receive a misleading task.failed event.
 */
export async function failStaleTasksWithEvents(
  db: DB,
  params: FailStaleTasksParams,
): Promise<number> {
  const staleColumn = params.staleBy === 'createdAt' ? tasks.createdAt : tasks.updatedAt;
  const candidates: StaleTaskCandidate[] = await db
    .select({
      id: tasks.id,
      externalId: tasks.externalId,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, params.sourceStatuses),
        lt(staleColumn, params.cutoff),
      ),
    );

  let changed = 0;
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const now = new Date();
      const update: Partial<typeof tasks.$inferInsert> = {
        status: 'failed',
        pauseReason: null,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        updatedAt: now,
        completedAt: now,
      };
      if (params.clearAwaiting) {
        update.awaitingQuestion = null;
        update.awaitingKind = null;
      }

      const result = await tx
        .update(tasks)
        .set(update)
        .where(
          and(
            eq(tasks.id, candidate.id),
            eq(tasks.status, candidate.status),
            lt(staleColumn, params.cutoff),
          ),
        );
      if (extractMysqlAffectedRows(result) === 0) return;

      await tx.insert(taskEvents).values({
        externalId: newExternalId('taskEvent'),
        taskId: candidate.id,
        type: 'task.failed',
        actor: 'system',
        payload: {
          source: params.source,
          from: candidate.status,
          to: 'failed',
          errorCode: params.errorCode,
          reason: params.errorMessage,
        },
      });
      changed += 1;
    });
  }
  return changed;
}

export async function failTaskWithEventIfStatus(
  db: DB,
  params: FailTaskWithEventParams,
): Promise<{ persisted: boolean }> {
  const [taskRow] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.externalId, params.taskExternalId))
    .limit(1);
  if (!taskRow) throw new Error(`task ${params.taskExternalId} not found in DB`);

  let persisted = true;
  await db.transaction(async (tx) => {
    const now = new Date();
    const update: Partial<typeof tasks.$inferInsert> = {
      status: 'failed',
      pauseReason: null,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      updatedAt: now,
      completedAt: now,
    };
    if (params.clearAwaiting) {
      update.awaitingQuestion = null;
      update.awaitingKind = null;
    }

    const result = await tx
      .update(tasks)
      .set(update)
      .where(
        and(
          eq(tasks.externalId, params.taskExternalId),
          eq(tasks.status, params.fromStatus),
        ),
      );
    if (extractMysqlAffectedRows(result) === 0) {
      persisted = false;
      return;
    }

    await tx.insert(taskEvents).values({
      externalId: newExternalId('taskEvent'),
      taskId: taskRow.id,
      type: 'task.failed',
      actor: 'system',
      payload: {
        source: params.source,
        from: params.fromStatus,
        to: 'failed',
        errorCode: params.errorCode,
        reason: params.errorMessage,
      },
    });
  });
  return { persisted };
}
