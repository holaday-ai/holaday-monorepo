import { newExternalId } from '@holaday/shared-types';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
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
import {
  type CoreSettlement,
  CoreSettlementError,
  assertPreparedCoreSettlement,
} from './core-task-settlement.js';

const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    executionId: z.string().min(1).max(64),
    executionRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    commitId: z.string().uuid(),
  })
  .strict();

/** Core text persistence only. No scheduling, model, quota, or automatic retries. */
export class CoreTaskRepository {
  constructor(private readonly db: DB) {}
  /** Display-only plan. It does not alter accepted requirements or the P2 version. */
  async persistAdvisoryPlan(op: CoreAdmission, planText: string): Promise<boolean> {
    assertPreparedCoreAdmission(op);
    if (!planText.trim() || Buffer.byteLength(planText, 'utf8') > 32 * 1024) return false;
    try {
      const updated = await this.db
        .update(tasks)
        .set({ planText, planStatus: [] })
        .where(
          and(
            scopeGuard(op.scope),
            eq(tasks.status, 'executing'),
            eq(tasks.executionId, op.executionId),
            eq(tasks.executionRevision, op.executionRevision),
            eq(tasks.coreRecordVersion, op.recordVersion),
          ),
        );
      const header = Array.isArray(updated) ? updated[0] : updated;
      return (
        !!header &&
        typeof header === 'object' &&
        'affectedRows' in header &&
        header.affectedRows === 1
      );
    } catch {
      return false;
    }
  }
  async persistSuggestions(op: CoreSettlement, suggestions: string[]): Promise<boolean> {
    assertPreparedCoreSettlement(op);
    if (
      op.status !== 'completed' ||
      !suggestions.length ||
      suggestions.length > 3 ||
      suggestions.some(
        (item) => typeof item !== 'string' || item.trim().length < 4 || item.length > 40,
      )
    )
      return false;
    try {
      const updated = await this.db
        .update(tasks)
        .set({
          result: sql`JSON_SET(${tasks.result}, '$.followUpSuggestions', CAST(${JSON.stringify(suggestions)} AS JSON))`,
        })
        .where(
          and(
            scopeGuard(op.scope),
            eq(tasks.status, 'completed'),
            eq(tasks.executionId, op.executionId),
            eq(tasks.executionRevision, op.executionRevision),
            eq(tasks.coreRecordVersion, op.recordVersion),
          ),
        );
      const header = Array.isArray(updated) ? updated[0] : updated;
      return (
        !!header &&
        typeof header === 'object' &&
        'affectedRows' in header &&
        header.affectedRows === 1
      );
    } catch {
      return false;
    }
  }
  async settle(operation: CoreSettlement): Promise<{ persisted: boolean }> {
    assertPreparedCoreSettlement(operation);
    const op = operation;
    try {
      return await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(tasks)
          .set({
            status: op.status,
            coreRecordVersion: op.recordVersion,
            // Start from the allowed new payload: never retain an old summary,
            // failure, or unreviewed extra field. Preserve only accepted requirements.
            result: sql`JSON_SET(CAST(${JSON.stringify(op.result)} AS JSON), '$.coreRequirements', JSON_EXTRACT(${tasks.result}, '$.coreRequirements'))`,
            verificationJson: op.verification,
            verificationPassed: op.verificationPassed,
            failureLevel: op.verification.failureLevel,
            awaitingQuestion: op.awaitingQuestion,
            awaitingKind: op.awaitingKind,
            ...(op.result.planText !== undefined ? { planText: op.result.planText } : {}),
            completedAt: op.status === 'awaiting_user' ? null : new Date(),
            pauseReason: null,
            errorCode: op.status === 'failed' ? 'CORE_EXECUTION_FAILED' : null,
            errorMessage: op.status === 'failed' ? op.result.reason : null,
          })
          .where(
            and(
              scopeGuard(op.scope),
              eq(tasks.status, 'executing'),
              eq(tasks.executionId, op.executionId),
              eq(tasks.executionRevision, op.executionRevision),
              eq(tasks.coreRecordVersion, op.expectedRecordVersion),
              sql`JSON_TYPE(${tasks.result}) = 'OBJECT'`,
              sql`JSON_TYPE(JSON_EXTRACT(${tasks.result}, '$.coreRequirements')) = 'OBJECT'`,
            ),
          );
        const header: unknown = Array.isArray(updated) ? updated[0] : updated;
        const affected =
          header && typeof header === 'object' && 'affectedRows' in header
            ? header.affectedRows
            : undefined;
        if (affected === 0) return { persisted: false };
        if (affected !== 1) throw new CoreSettlementError('CORE_SETTLEMENT_WRITE_INVALID');
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
          throw new CoreSettlementError('CORE_SETTLEMENT_WRITE_INVALID');
        await tx.insert(taskEvents).values({
          externalId: newExternalId('taskEvent'),
          taskId: row.id,
          type: 'core.settled',
          actor: 'system',
          payload: {
            status: op.status,
            executionId: op.executionId,
            executionRevision: op.executionRevision,
            recordVersion: op.recordVersion,
            commitId: op.commitId,
          },
        });
        return { persisted: true };
      });
    } catch (error) {
      if (error instanceof CoreSettlementError) throw error;
      // Includes response loss AFTER commit. Only the recovery coordinator can
      // reconcile it; this method neither retries nor broadcasts a terminal state.
      throw new CoreSettlementError('CORE_SETTLEMENT_UNCONFIRMED');
    }
  }

  async readSettlement(
    input: CoreTaskScope,
  ): Promise<(CoreTaskHead & { commitId: string | null }) | null> {
    const scope = parseCoreTaskScope(input);
    try {
      const [row] = await this.db
        .select({
          status: tasks.status,
          executionId: tasks.executionId,
          executionRevision: tasks.executionRevision,
          recordVersion: tasks.coreRecordVersion,
          // Extract only receipt fields in SQL. Never load summary, detail, or full
          // verification_json into a recovery read. An executing row may still have
          // the prior round's metadata; it is not a current terminal receipt.
          receipt: sql<unknown>`CASE WHEN ${tasks.executionId} IS NOT NULL AND ${tasks.status} IN ('completed', 'partial_success', 'failed', 'awaiting_user') THEN JSON_OBJECT('schemaVersion', JSON_EXTRACT(${tasks.verificationJson}, '$.schemaVersion'), 'executionId', JSON_EXTRACT(${tasks.verificationJson}, '$.executionId'), 'executionRevision', JSON_EXTRACT(${tasks.verificationJson}, '$.executionRevision'), 'commitId', JSON_EXTRACT(${tasks.verificationJson}, '$.commitId')) ELSE NULL END`,
        })
        .from(tasks)
        .where(scopeGuard(scope))
        .limit(1);
      if (!row) return null;
      const { receipt, ...fields } = row;
      const head = parseCoreTaskHead(fields);
      if (
        head.executionId === null ||
        !['completed', 'partial_success', 'failed', 'awaiting_user'].includes(head.status)
      )
        return Object.freeze({ ...head, commitId: null });
      const parsed = receiptSchema.safeParse(
        typeof receipt === 'string' ? JSON.parse(receipt) : receipt,
      );
      if (
        !parsed.success ||
        parsed.data.executionId !== head.executionId ||
        parsed.data.executionRevision !== head.executionRevision
      )
        throw new CoreSettlementError('CORE_SETTLEMENT_READ_UNAVAILABLE');
      return Object.freeze({ ...head, commitId: parsed.data.commitId });
    } catch {
      throw new CoreSettlementError('CORE_SETTLEMENT_READ_UNAVAILABLE');
    }
  }
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
