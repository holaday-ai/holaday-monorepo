import { newExternalId } from '@holaday/shared-types';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../db/client.js';
import { type TaskFile, taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { BrowserFileSaveUnconfirmed } from './browser-output.js';
import type { StorageProvider } from './storage-provider.js';

class TaskOutputRefused extends Error {}

/** Stage bytes first, then publish only while holding the live task and owner locks. */
export async function persistLiveTaskOutput(
  deps: { db: DB; storage: StorageProvider; logger: Logger; expiresAt: Date },
  input: {
    userIdInternal: number;
    userExternalId: string;
    taskIdInternal: number;
    filename: string;
    mimetype: string;
    buffer: Buffer;
    canPublish?: () => boolean;
  },
): Promise<TaskFile> {
  const externalId = newExternalId('file');
  const { storagePath } = await deps.storage.put({
    userExternalId: input.userExternalId,
    kind: 'output',
    fileExternalId: externalId,
    filename: input.filename,
    mimetype: input.mimetype,
    buffer: input.buffer,
  });
  let failure: unknown;
  try {
    await deps.db.transaction(async (tx) => {
      // Account closure uses the same owner-first order. Cancellation updates
      // this task row, so its commit and publication have a single ordering.
      const [owner] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.id, input.userIdInternal), eq(users.externalId, input.userExternalId)))
        .limit(1)
        .for('update');
      if (!owner || owner.status !== 'active') throw new TaskOutputRefused('task_output_refused');
      const [task] = await tx
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.id, input.taskIdInternal), eq(tasks.userId, input.userIdInternal)))
        .limit(1)
        .for('update');
      if (!task || task.status !== 'executing' || input.canPublish?.() === false)
        throw new TaskOutputRefused('task_output_refused');
      await tx.insert(taskFiles).values({
        externalId,
        userId: input.userIdInternal,
        taskId: input.taskIdInternal,
        kind: 'output',
        filename: input.filename,
        mimetype: input.mimetype,
        sizeBytes: input.buffer.length,
        storagePath,
        expiresAt: deps.expiresAt,
      });
      if (input.canPublish?.() === false) throw new TaskOutputRefused('task_output_refused');
    });
  } catch (error) {
    failure = error;
  }
  let row: TaskFile | undefined;
  try {
    [row] = await deps.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
  } catch {
    throw new BrowserFileSaveUnconfirmed(externalId);
  }
  if (
    row &&
    row.userId === input.userIdInternal &&
    row.taskId === input.taskIdInternal &&
    row.status === 'active' &&
    row.kind === 'output' &&
    row.storagePath === storagePath &&
    row.filename === input.filename &&
    row.mimetype === input.mimetype &&
    row.sizeBytes === input.buffer.length &&
    row.expiresAt?.getTime() === deps.expiresAt.getTime()
  ) {
    try {
      const bytes = await deps.storage.get(storagePath);
      if (bytes?.equals(input.buffer)) return row;
    } catch {
      /* Preserve a possibly committed output on an uncertain read. */
    }
    throw new BrowserFileSaveUnconfirmed(externalId);
  }
  if (!row && failure instanceof TaskOutputRefused) {
    try {
      await deps.storage.delete(storagePath);
    } catch {
      deps.logger.warn({ fileId: externalId }, 'task output: refused staging cleanup failed');
      throw new BrowserFileSaveUnconfirmed(externalId);
    }
    throw failure;
  }
  // Unknown commits must retain their only copy and must never trigger a retry.
  throw new BrowserFileSaveUnconfirmed(externalId);
}
