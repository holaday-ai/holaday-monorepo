import { createHash } from 'node:crypto';
import { newExternalId } from '@holaday/shared-types';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../db/client.js';
import { type TaskFile, taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import {
  type BrowserFileOrigin,
  type TaskBrowserFileOrigin,
  browserFileBytesMatch,
  browserFileSourceSchema,
  storedBrowserFileOriginSchema,
} from './browser-file-origin.js';
import { MAX_DOWNLOAD_BYTES } from './download-manager.js';
import type { StorageProvider } from './storage-provider.js';

export interface BrowserOutputInput {
  userIdInternal: number;
  userExternalId: string;
  source: BrowserFileOrigin;
  filename: string;
  mimetype: string;
  buffer: Buffer;
}
export type TaskBrowserOutputInput = Omit<BrowserOutputInput, 'source'> & {
  source: TaskBrowserFileOrigin;
};

/** The original id permits later owner-checked reconciliation; it is not a success receipt. */
export class BrowserFileSaveUnconfirmed extends Error {
  constructor(readonly fileId: string) {
    super('browser_file_save_unconfirmed');
    this.name = 'BrowserFileSaveUnconfirmed';
  }
}

const DEFINITE_INSERT_REJECTIONS = new Set([
  'ER_NO_REFERENCED_ROW_2',
  'ER_DATA_TOO_LONG',
  'ER_BAD_FIELD_ERROR',
  'ER_NO_SUCH_TABLE',
  'ER_BAD_NULL_ERROR',
  'ER_PARSE_ERROR',
  'ER_CHECK_CONSTRAINT_VIOLATED',
  'ER_DUP_ENTRY',
  'BROWSER_FILE_OWNER_UNAVAILABLE',
  'BROWSER_FILE_TASK_UNAVAILABLE',
]);

/** Uses the existing file index/storage; only a verified Home origin permits a null task. */
export async function persistBrowserOutput(
  deps: { db: DB; storage: StorageProvider; logger: Logger; expiresAt: Date },
  input: BrowserOutputInput | TaskBrowserOutputInput,
): Promise<TaskFile> {
  const source = storedBrowserFileOriginSchema.parse(input.source);
  if (source.kind === 'personal_home' && source.sessionId !== `bhs_${input.userExternalId}`)
    throw new Error('browser_file_owner_mismatch');
  if (
    (!input.buffer.length && source.kind === 'personal_home') ||
    input.buffer.length > MAX_DOWNLOAD_BYTES
  )
    throw new Error('browser_file_size_invalid');
  if (
    !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(input.mimetype) ||
    input.mimetype.length > 96
  )
    throw new Error('browser_file_type_invalid');
  const [owner] = await deps.db
    .select({ id: users.id, externalId: users.externalId, status: users.status })
    .from(users)
    .where(and(eq(users.id, input.userIdInternal), eq(users.externalId, input.userExternalId)))
    .limit(1);
  if (
    !owner ||
    owner.id !== input.userIdInternal ||
    owner.externalId !== input.userExternalId ||
    owner.status !== 'active'
  )
    throw new Error('browser_file_owner_mismatch');
  let taskId: number | null = null;
  if (source.taskId) {
    const [task] = await deps.db
      .select({ id: tasks.id, externalId: tasks.externalId, userId: tasks.userId })
      .from(tasks)
      .where(and(eq(tasks.externalId, source.taskId), eq(tasks.userId, owner.id)))
      .limit(1);
    if (!task || task.userId !== owner.id || task.externalId !== source.taskId)
      throw new Error('browser_file_task_unavailable');
    taskId = task.id;
  }
  const externalId = newExternalId('file');
  const browserSource = {
    ...source,
    sha256: createHash('sha256').update(input.buffer).digest('hex'),
  };
  const { storagePath } = await deps.storage.put({
    userExternalId: owner.externalId,
    kind: 'output',
    fileExternalId: externalId,
    filename: input.filename,
    mimetype: input.mimetype,
    buffer: input.buffer,
  });
  let insertError: unknown;
  try {
    await deps.db.transaction(async (tx) => {
      // Same owner-first lock as account closure/Vault. No late file can appear after its sweep.
      const [activeOwner] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.id, owner.id), eq(users.externalId, owner.externalId)))
        .limit(1)
        .for('update');
      if (!activeOwner || activeOwner.status !== 'active')
        throw Object.assign(new Error('browser_file_owner_unavailable'), {
          code: 'BROWSER_FILE_OWNER_UNAVAILABLE',
        });
      if (source.taskId) {
        const [task] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.externalId, source.taskId), eq(tasks.userId, owner.id)))
          .limit(1)
          .for('update');
        if (!task || task.id !== taskId)
          throw Object.assign(new Error('browser_file_task_unavailable'), {
            code: 'BROWSER_FILE_TASK_UNAVAILABLE',
          });
      }
      await tx.insert(taskFiles).values({
        externalId,
        userId: owner.id,
        taskId,
        kind: 'output',
        filename: input.filename,
        mimetype: input.mimetype,
        sizeBytes: input.buffer.length,
        storagePath,
        expiresAt: deps.expiresAt,
        browserSource,
      });
    });
  } catch (error) {
    insertError = error;
  }

  let row: TaskFile | undefined;
  try {
    [row] = await deps.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
  } catch {
    // A row may already be committed. Do not delete its only copy or start a fresh download.
    throw new BrowserFileSaveUnconfirmed(externalId);
  }
  const storedSource = browserFileSourceSchema.safeParse(row?.browserSource);
  if (
    row &&
    row.userId === owner.id &&
    row.taskId === taskId &&
    row.kind === 'output' &&
    row.status === 'active' &&
    row.storagePath === storagePath &&
    row.filename === input.filename &&
    row.mimetype === input.mimetype &&
    row.sizeBytes === input.buffer.length &&
    storedSource.success &&
    storedSource.data.sha256 === browserSource.sha256 &&
    storedSource.data.kind === source.kind &&
    (source.kind === 'personal_home'
      ? storedSource.data.kind === 'personal_home' &&
        storedSource.data.sessionId === source.sessionId &&
        storedSource.data.instanceId === source.instanceId
      : storedSource.data.kind === 'task_download' &&
        storedSource.data.originBasis === source.originBasis) &&
    storedSource.data.origin === source.origin &&
    storedSource.data.taskId === source.taskId &&
    row.expiresAt &&
    row.expiresAt.getTime() === deps.expiresAt.getTime()
  ) {
    try {
      const bytes = await deps.storage.get(storagePath);
      if (bytes && browserFileBytesMatch(row.browserSource, row.sizeBytes, bytes)) return row;
    } catch {
      /* Preserve a possibly committed file when storage cannot confirm the bytes. */
    }
    throw new BrowserFileSaveUnconfirmed(externalId);
  }

  const code =
    insertError && typeof insertError === 'object' && 'code' in insertError
      ? String(insertError.code)
      : '';
  if (!row && DEFINITE_INSERT_REJECTIONS.has(code)) {
    try {
      await deps.storage.delete(storagePath);
    } catch {
      deps.logger.warn({ fileId: externalId }, 'browser file: rejected output cleanup failed');
      throw new BrowserFileSaveUnconfirmed(externalId);
    }
    throw new Error('browser_file_save_failed');
  }
  throw new BrowserFileSaveUnconfirmed(externalId);
}
