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
import { and, desc, eq, gt, isNull, like, lt, notLike, or } from 'drizzle-orm';
import { z } from 'zod';
import { taskFiles } from '../../db/schema/task-files.js';
import { users } from '../../db/schema/users.js';
import { FileService, decodeUploadFilename } from '../../files/file-service.js';
import { protectedProcedure, router } from '../trpc.js';

async function requireUserId(ctx: {
  db: typeof import('../../db/client.js').db;
  userId: string;
}): Promise<number> {
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

async function fileAvailabilityItems(
  fileService: Pick<FileService, 'isReadableForUser'>,
  fileIds: readonly string[],
  userId: number,
): Promise<Array<{ fileId: string; available: boolean }>> {
  return Promise.all(
    fileIds.map(async (fileId) => ({
      fileId,
      available: await fileService.isReadableForUser(fileId, userId),
    })),
  );
}

async function saveLibraryOutput(
  fileService: Pick<FileService, 'saveOutputToLibraryForUser'>,
  fileId: string,
  userId: number,
): Promise<{ ok: true }> {
  const saved = await fileService.saveOutputToLibraryForUser(fileId, userId);
  if (!saved) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'file not found' });
  }
  return { ok: true };
}

export const filesRouter = router({
  availability: protectedProcedure
    .input(
      z.object({
        fileIds: z.array(z.string().min(1).max(64)).min(1).max(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const fileService = new FileService(ctx.db, ctx.logger);
      return {
        items: await fileAvailabilityItems(fileService, input.fileIds, userId),
      };
    }),

  saveOutput: protectedProcedure
    .input(z.object({ fileId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const fileService = new FileService(ctx.db, ctx.logger);
      return saveLibraryOutput(fileService, input.fileId, userId);
    }),

  /**
   * List the caller's uploaded input files. Accepts a `type` filter:
   *   - 'all'       (default): every input file
   *   - 'images'    : mime starts with 'image/'
   *   - 'videos'    : mime starts with 'video/'
   *   - 'documents' : every other non-media mime (excludes images/videos)
   * Optional `q` matches both current filenames and the Latin-1 form
   * used by legacy uploads, so users can search with the correct name.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          type: z.enum(['all', 'images', 'videos', 'documents']).default('all'),
          q: z.string().max(100).optional(),
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(50),
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
      const notExpired = or(isNull(taskFiles.expiresAt), gt(taskFiles.expiresAt, now));
      if (notExpired) conds.push(notExpired);
      const searchTerms = libraryFilenameSearchTerms(input.q ?? '');
      if (searchTerms.length > 0) {
        const filenameMatches = searchTerms.map((term) => like(taskFiles.filename, `%${term}%`));
        const filenameSearch = or(...filenameMatches);
        if (filenameSearch) conds.push(filenameSearch);
      }
      if (input.type === 'images') {
        conds.push(like(taskFiles.mimetype, 'image/%'));
      } else if (input.type === 'videos') {
        conds.push(like(taskFiles.mimetype, 'video/%'));
      } else if (input.type === 'documents') {
        const documentMatches = and(
          notLike(taskFiles.mimetype, 'image/%'),
          notLike(taskFiles.mimetype, 'video/%'),
        );
        if (documentMatches) conds.push(documentMatches);
      }
      if (input.cursor) {
        conds.push(lt(taskFiles.id, input.cursor));
      }
      const rows = await ctx.db
        .select({
          id: taskFiles.id,
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
        .orderBy(desc(taskFiles.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      return {
        items: page.map((r) => ({
          fileId: r.externalId,
          filename: normalizeLibraryFilename(r.filename),
          mimetype: r.mimetype,
          sizeBytes: Number(r.sizeBytes),
          createdAt: r.createdAt,
        })),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
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
    row.status === 'active' && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())
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

function normalizeLibraryFilename(filename: string): string {
  return decodeUploadFilename(filename);
}

function libraryFilenameSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const legacyEncoded = Buffer.from(trimmed, 'utf8').toString('latin1');
  if (legacyEncoded === trimmed) return [trimmed];
  const lossySpaceEncoded = legacyEncoded.replaceAll('\u00a0', ' ');
  return lossySpaceEncoded === legacyEncoded
    ? [trimmed, legacyEncoded]
    : [trimmed, legacyEncoded, lossySpaceEncoded];
}

export const __filesRouterInternals = {
  deleteLibraryFile,
  fileAvailabilityItems,
  fileIsAvailableInLibrary,
  fileMatchesLibraryFilter,
  libraryFilenameSearchTerms,
  normalizeLibraryFilename,
  saveLibraryOutput,
};
