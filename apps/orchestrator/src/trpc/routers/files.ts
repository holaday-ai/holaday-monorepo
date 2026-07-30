/**
 * Phase 16b — files library router. Read-only over the existing
 * task_files table (kind='input'); listing the user's uploads
 * regardless of which task each was attached to.
 *
 * Upload remains via the existing /api/files/upload Express
 * endpoint (multer-backed), already gated by plan tier. This router
 * just exposes list + delete so the new /files page has data.
 */

import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, isNull, like, or } from 'drizzle-orm';
import { z } from 'zod';
import { taskFiles } from '../../db/schema/task-files.js';
import { users } from '../../db/schema/users.js';
import { FileService } from '../../files/file-service.js';
import { protectedProcedure, router } from '../trpc.js';

async function requireUserId(
  ctx: { db: typeof import('../../db/client.js').db; userId: string },
): Promise<number> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return row.id;
}

async function deleteLibraryFile(
  fileService: Pick<FileService, 'deleteForUser'>,
  fileId: string,
  userId: number,
): Promise<{ ok: true }> {
  const deleted = await fileService.deleteForUser(fileId, userId);
  if (!deleted) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'file not found' });
  }
  return { ok: true };
}

export const filesRouter = router({
  /**
   * List the caller's uploaded input files. Accepts a `type` filter:
   *   - 'all'       (default): every input file
   *   - 'images'    : mime starts with 'image/'
   *   - 'videos'    : mime starts with 'video/'
   *   - 'documents' : every other non-media mime (excludes images/videos)
   * Optional `q` does a simple LIKE on filename for the search box
   * on the SPA's library page.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          type: z.enum(['all', 'images', 'videos', 'documents']).default('all'),
          q: z.string().max(100).optional(),
        })
        .default({ type: 'all' }),
    )
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const now = new Date();
      const conds = [
        eq(taskFiles.userId, userId),
        eq(taskFiles.kind, 'input'),
        eq(taskFiles.status, 'active'),
      ];
      const notExpired = or(
        isNull(taskFiles.expiresAt),
        gt(taskFiles.expiresAt, now),
      );
      if (notExpired) conds.push(notExpired);
      if (input.q && input.q.trim()) {
        conds.push(like(taskFiles.filename, `%${input.q.trim()}%`));
      }
      const rows = await ctx.db
        .select({
          externalId: taskFiles.externalId,
          filename: taskFiles.filename,
          mimetype: taskFiles.mimetype,
          sizeBytes: taskFiles.sizeBytes,
          createdAt: taskFiles.createdAt,
          status: taskFiles.status,
          expiresAt: taskFiles.expiresAt,
        })
        .from(taskFiles)
        .where(and(...conds))
        .orderBy(desc(taskFiles.createdAt))
        .limit(200);
      const filtered = rows.filter(
        (r) =>
          fileIsAvailableInLibrary(r, now) &&
          fileMatchesLibraryFilter(r.mimetype, input.type),
      );
      return filtered.map((r) => ({
        fileId: r.externalId,
        filename: r.filename,
        mimetype: r.mimetype,
        sizeBytes: Number(r.sizeBytes),
        createdAt: r.createdAt,
      }));
    }),

  /** Delete the owned backing object first, then remove its index row. */
  delete: protectedProcedure
    .input(z.object({ fileId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const fileService = new FileService(ctx.db, ctx.logger);
      return deleteLibraryFile(fileService, input.fileId, userId);
    }),
});

type LibraryFileFilter = 'all' | 'images' | 'videos' | 'documents';

function fileIsAvailableInLibrary(
  row: { status: string; expiresAt: Date | null },
  now = new Date(),
): boolean {
  return (
    row.status === 'active' &&
    (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())
  );
}

function fileMatchesLibraryFilter(mimetype: string, filter: LibraryFileFilter): boolean {
  const normalized = mimetype.toLowerCase();
  if (filter === 'images') return normalized.startsWith('image/');
  if (filter === 'videos') return normalized.startsWith('video/');
  if (filter === 'documents') {
    return !normalized.startsWith('image/') && !normalized.startsWith('video/');
  }
  return true;
}

export const __filesRouterInternals = {
  deleteLibraryFile,
  fileIsAvailableInLibrary,
  fileMatchesLibraryFilter,
};
