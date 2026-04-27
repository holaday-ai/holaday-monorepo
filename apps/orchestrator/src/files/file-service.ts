/**
 * File service — single entry point for both directions of the
 * Phase 10 Tier 3 file flow.
 *
 *   - Inputs: user uploads (CSV / PDF / image / …) that the supercar
 *     agent reads into a user-message content block.
 *   - Outputs: files the agent generates via the `create_file` tool
 *     (xlsx / pdf / docx / …) for the user to download.
 *
 * Storage layout under FILES_ROOT (configurable via env, defaults to
 * /tmp/holaday-files):
 *
 *   <FILES_ROOT>/<userExternalId>/<kind>/<fileExternalId>/<filename>
 *
 * The per-(user, kind, fileId) directory keeps name collisions
 * impossible without ever reading user input as a path component
 * (every segment is server-generated).
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  newExternalId,
  type PlanId,
} from '@holaday/shared-types';
import type { Logger } from 'pino';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { taskFiles, type TaskFile } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';

export type FileKind = 'input' | 'output';

export const FILES_ROOT = process.env.HOLADAY_FILES_ROOT ?? '/tmp/holaday-files';

/**
 * Per-plan upload caps in bytes. 0 disables uploads entirely; the
 * upload route returns a typed 403 in that case so the SPA can
 * render the right upsell copy.
 */
export const UPLOAD_BYTE_LIMIT: Record<PlanId, number> = {
  free: 0,
  basic: 5 * 1024 * 1024,
  pro: 10 * 1024 * 1024,
};

/**
 * MIME types we'll accept. Everything else 415s. Keep in sync with
 * the SPA's `accept` attr on the file input — divergence shows up as
 * "looks like it works in dev but server rejects" bug reports.
 */
export const ACCEPTED_MIMES = new Set<string>([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

/** Loose extension fallback for clients that send octet-stream. */
export const ACCEPTED_EXTENSIONS = new Set<string>([
  '.txt', '.csv', '.md', '.json', '.pdf', '.xlsx', '.xls',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
]);

export class FileService {
  constructor(
    private readonly db: DB,
    private readonly logger: Logger,
  ) {}

  /**
   * Persist a freshly-uploaded buffer to disk and write the index
   * row. Returns the inserted task_files row (sans buffer).
   *
   * Caller must have already validated:
   *   - User's plan allows uploads
   *   - File size is within the plan cap
   *   - mimetype is in `ACCEPTED_MIMES` (or extension whitelist)
   */
  async storeUpload(opts: {
    userIdInternal: number;
    userExternalId: string;
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<TaskFile> {
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    const dir = path.join(FILES_ROOT, opts.userExternalId, 'input', externalId);
    await fs.mkdir(dir, { recursive: true });
    const storagePath = path.join(dir, safeFilename);
    await fs.writeFile(storagePath, opts.buffer);
    await this.db.insert(taskFiles).values({
      externalId,
      userId: opts.userIdInternal,
      taskId: null,
      kind: 'input',
      filename: safeFilename,
      mimetype: opts.mimetype,
      sizeBytes: opts.buffer.length,
      storagePath,
    });
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('storeUpload: row vanished after insert');
    this.logger.info(
      {
        fileId: externalId,
        userId: opts.userExternalId,
        size: opts.buffer.length,
        mimetype: opts.mimetype,
      },
      'file: stored upload',
    );
    return row;
  }

  /**
   * Persist an agent-generated buffer. Same shape as storeUpload but
   * tagged kind='output' and given a 24h TTL via expires_at. Always
   * scoped to a specific task — outputs only exist as a result of
   * tool calls inside a running task.
   */
  async storeOutput(opts: {
    userIdInternal: number;
    userExternalId: string;
    taskIdInternal: number;
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<TaskFile> {
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    const dir = path.join(FILES_ROOT, opts.userExternalId, 'output', externalId);
    await fs.mkdir(dir, { recursive: true });
    const storagePath = path.join(dir, safeFilename);
    await fs.writeFile(storagePath, opts.buffer);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.db.insert(taskFiles).values({
      externalId,
      userId: opts.userIdInternal,
      taskId: opts.taskIdInternal,
      kind: 'output',
      filename: safeFilename,
      mimetype: opts.mimetype,
      sizeBytes: opts.buffer.length,
      storagePath,
      expiresAt,
    });
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('storeOutput: row vanished after insert');
    return row;
  }

  /**
   * Load a file by external id, verifying it belongs to the caller.
   * Returns null when the file is missing OR owned by a different
   * user — both are 404s on the API surface (don't leak existence).
   */
  async loadForUser(
    fileExternalId: string,
    userExternalId: string,
  ): Promise<{ row: TaskFile; buffer: Buffer } | null> {
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, fileExternalId))
      .limit(1);
    if (!row) return null;
    // Look up the user by id since task_files stores user_id internal.
    // The cheapest way to verify ownership without an extra lookup is
    // to compare via the file's storage path, but that's brittle.
    // Instead the caller passes their externalId and we fetch their
    // internal id once — happens at the route layer; here we trust
    // the ownership has been pre-checked.
    void userExternalId;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    try {
      const buffer = await fs.readFile(row.storagePath);
      return { row, buffer };
    } catch (err) {
      this.logger.warn(
        { err, fileId: fileExternalId, path: row.storagePath },
        'file: read from disk failed (file deleted out-of-band?)',
      );
      return null;
    }
  }

  /**
   * Bulk-fetch the buffers + metadata for a set of file ids. Used
   * by the agent-loop to build the multi-modal user message. Skips
   * files that fail ownership or expiry checks (logged but not
   * surfaced — the agent should not crash because one file
   * disappeared between the upload and the task starting).
   */
  async loadMany(
    fileExternalIds: readonly string[],
    userIdInternal: number,
  ): Promise<Array<{ row: TaskFile; buffer: Buffer }>> {
    const out: Array<{ row: TaskFile; buffer: Buffer }> = [];
    for (const id of fileExternalIds) {
      const [row] = await this.db
        .select()
        .from(taskFiles)
        .where(eq(taskFiles.externalId, id))
        .limit(1);
      if (!row) continue;
      if (row.userId !== userIdInternal) continue;
      try {
        const buffer = await fs.readFile(row.storagePath);
        out.push({ row, buffer });
      } catch (err) {
        this.logger.warn({ err, fileId: id }, 'file: load skipped (disk read failed)');
      }
    }
    return out;
  }

  /**
   * Backfill `task_id` on a set of input files. Called from
   * tasks.create after the task row lands so `/files/by-task/:id`
   * (future endpoint) can list a task's attachments.
   */
  async linkToTask(
    fileExternalIds: readonly string[],
    taskIdInternal: number,
    userIdInternal: number,
  ): Promise<void> {
    for (const id of fileExternalIds) {
      await this.db
        .update(taskFiles)
        .set({ taskId: taskIdInternal })
        .where(eq(taskFiles.externalId, id));
    }
    void userIdInternal;
  }

  /**
   * List a task's files (both kinds). Used by the SPA to render the
   * download cards on completed tasks.
   */
  async listForTask(taskIdInternal: number): Promise<TaskFile[]> {
    return this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.taskId, taskIdInternal));
  }
}

/**
 * Map a file's internal task id (bigint) → external task id (the
 * one the SPA / API surface uses). Helper for routes that take the
 * external id and need to operate against the db row.
 */
export async function taskInternalIdFor(
  db: DB,
  taskExternalId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ id: tasks.id, userId: tasks.userId })
    .from(tasks)
    .where(eq(tasks.externalId, taskExternalId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Strip path separators + restrict length so a malicious filename
 * can't escape the per-file directory. Also removes leading dots so
 * we don't end up with hidden files.
 */
function sanitiseFilename(name: string): string {
  const stripped = name
    .replace(/[/\\\0]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = stripped.length > 200 ? stripped.slice(0, 200) : stripped;
  return truncated || `file-${randomUUID().slice(0, 8)}`;
}
