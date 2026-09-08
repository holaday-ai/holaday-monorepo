import { newExternalId } from '@holaday/shared-types';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { taskEvents } from '../db/schema/task-events.js';
import { tasks } from '../db/schema/tasks.js';
import {
  type CoreAdmission,
  CoreAdmissionError,
  type CoreTaskHead,
  type CoreTaskScope,
  assertPreparedCoreAdmission,
  parseCoreTaskHead,
  parseCoreTaskScope,
} from './core-task-admission.js';

/** Core text persistence only. No scheduling, model, quota, or automatic retries. */
export class CoreTaskRepository {
  constructor(private readonly db: DB) {}
  async readHead(input: CoreTaskScope): Promise<CoreTaskHead | null> {
    const scope = parseCoreTaskScope(input);
    try {
      const [head] = await this.db
        .select({
          status: tasks.status,
          executionId: tasks.executionId,
          executionRevision: tasks.executionRevision,
          recordVersion: tasks.coreRecordVersion,
        })
        .from(tasks)
        .where(scopeGuard(scope))
        .limit(1);
      return head ? parseCoreTaskHead(head) : null;
    } catch (error) {
      if (error instanceof CoreAdmissionError) throw error;
      throw new CoreAdmissionError('CORE_EXECUTION_READ_UNAVAILABLE');
    }
  }

  async admit(operation: CoreAdmission): Promise<{ persisted: boolean }> {
    assertPreparedCoreAdmission(operation);
    const op = operation;
    try {
      return await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(tasks)
          .set({
            status: 'executing',
            executionId: op.executionId,
            executionRevision: op.executionRevision,
            coreRecordVersion: op.recordVersion,
            result: sql`JSON_SET(COALESCE(${tasks.result}, JSON_OBJECT()), '$.coreRequirements', CAST(${JSON.stringify(op.requirements)} AS JSON))`,
            awaitingQuestion: null,
            awaitingKind: null,
            pauseReason: null,
            errorCode: null,
            errorMessage: null,
          })
          .where(
            and(
              eq(tasks.externalId, op.scope.taskId),
              eq(tasks.userId, op.scope.userId),
              eq(tasks.status, op.before.status),
              op.before.executionId === null
                ? isNull(tasks.executionId)
                : eq(tasks.executionId, op.before.executionId),
              eq(tasks.executionRevision, op.before.executionRevision),
              eq(tasks.coreRecordVersion, op.before.recordVersion),
              or(isNull(tasks.result), sql`JSON_TYPE(${tasks.result}) = 'OBJECT'`),
            ),
          );
        const header: unknown = Array.isArray(updated) ? updated[0] : updated;
        const affected =
          header && typeof header === 'object' && 'affectedRows' in header
            ? header.affectedRows
            : undefined;
        if (affected === 0) return { persisted: false };
        if (affected !== 1) throw new CoreAdmissionError('CORE_ADMISSION_WRITE_INVALID');
        const [row] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              scopeGuard(op.scope),
              eq(tasks.executionId, op.executionId),
              eq(tasks.executionRevision, op.executionRevision),
              eq(tasks.coreRecordVersion, op.recordVersion),
            ),
          )
          .limit(1);
        if (!row || !Number.isSafeInteger(row.id) || row.id <= 0)
          throw new CoreAdmissionError('CORE_ADMISSION_WRITE_INVALID');
        await tx.insert(taskEvents).values({
          externalId: newExternalId('taskEvent'),
          taskId: row.id,
          type: op.before.status === 'awaiting_user' ? 'task.resumed' : 'core.admitted',
          actor: op.before.status === 'awaiting_user' ? 'user' : 'system',
          payload: {
            executionId: op.executionId,
            executionRevision: op.executionRevision,
            recordVersion: op.recordVersion,
          },
        });
        return { persisted: true };
      });
    } catch (error) {
      if (error instanceof CoreAdmissionError) throw error;
      // A thrown commit response does not prove rollback. Keep the operation
      // available to the recovery coordinator, without exposing driver data.
      throw new CoreAdmissionError('CORE_ADMISSION_UNCONFIRMED');
    }
  }
}

function scopeGuard(scope: CoreTaskScope) {
  return and(eq(tasks.externalId, scope.taskId), eq(tasks.userId, scope.userId));
}
