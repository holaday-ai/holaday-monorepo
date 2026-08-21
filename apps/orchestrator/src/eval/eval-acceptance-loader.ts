import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { db } from '../db/client.js';
import { taskActionCaptures } from '../db/schema/task-action-captures.js';
import { taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import {
  type EvalAcceptanceSnapshot,
  buildEvalAcceptanceSnapshot,
} from './eval-acceptance-snapshot.js';

/**
 * Eval-only persistence probe. It deliberately selects only the task ledger,
 * MIME types, and action kinds. The returned value is reduced to counts; raw
 * file metadata, evidence facts, captured input, selectors, and coordinates
 * are never returned or written to the eval report.
 */
export async function loadEvalAcceptanceSnapshot(
  taskExternalId: string,
): Promise<EvalAcceptanceSnapshot> {
  const [taskRow] = await db
    .select({ id: tasks.id, evidenceJson: tasks.evidenceJson })
    .from(tasks)
    .where(eq(tasks.externalId, taskExternalId))
    .limit(1);

  if (!taskRow) {
    return buildEvalAcceptanceSnapshot({
      evidenceJson: null,
      outputFileMimeTypes: [],
      actionCaptureTypes: [],
    });
  }

  const now = new Date();
  const [outputRows, actionRows] = await Promise.all([
    db
      .select({ mimetype: taskFiles.mimetype })
      .from(taskFiles)
      .where(
        and(
          eq(taskFiles.taskId, taskRow.id),
          eq(taskFiles.kind, 'output'),
          eq(taskFiles.status, 'active'),
          or(isNull(taskFiles.expiresAt), gt(taskFiles.expiresAt, now)),
        ),
      ),
    db
      .select({ stepType: taskActionCaptures.stepType })
      .from(taskActionCaptures)
      .where(eq(taskActionCaptures.taskId, taskRow.id)),
  ]);

  return buildEvalAcceptanceSnapshot({
    evidenceJson: taskRow.evidenceJson,
    outputFileMimeTypes: outputRows.map((row) => row.mimetype),
    actionCaptureTypes: actionRows.map((row) => row.stepType),
  });
}
