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
import { and, desc, eq, like, or } from 'drizzle-orm';
import { z } from 'zod';
import { taskFiles } from '../../db/schema/task-files.js';
import { users } from '../../db/schema/users.js';
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

export const filesRouter = router({
  /**
   * List the caller's uploaded input files. Accepts a `type` filter:
   *   - 'all'       (default): every input file
   *   - 'images'    : mime starts with 'image/'
   *   - 'documents' : every other mime (excludes images)
   * Optional `q` does a simple LIKE on filename for the search box
   * on the SPA's library page.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          type: z.enum(['all', 'images', 'documents']).default('all'),
          q: z.string().max(100).optional(),
        })
        .default({ type: 'all' }),
    )
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const conds = [eq(taskFiles.userId, userId), eq(taskFiles.kind, 'input')];
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
        })
        .from(taskFiles)
        .where(and(...conds))
        .orderBy(desc(taskFiles.createdAt))
        .limit(200);
      const filtered = rows.filter((r) => {
        if (input.type === 'images') return r.mimetype.startsWith('image/');
        if (input.type === 'documents') return !r.mimetype.startsWith('image/');
        return true;
      });
      return filtered.map((r) => ({
        fileId: r.externalId,
        filename: r.filename,
        mimetype: r.mimetype,
        sizeBytes: Number(r.sizeBytes),
        createdAt: r.createdAt,
      }));
    }),

  /**
   * Delete a file by external id. The on-disk bytes are reaped by
   * the existing files/cleanup-cron.ts pass — this row mark is
   * sufficient for the user-facing UX.
   */
  delete: protectedProcedure
    .input(z.object({ fileId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const result = await ctx.db
        .delete(taskFiles)
        .where(
          and(eq(taskFiles.externalId, input.fileId), eq(taskFiles.userId, userId)),
        );
      if ((result as unknown as { affectedRows?: number }).affectedRows === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'file not found' });
      }
      return { ok: true as const };
    }),
});

// Suppress unused-import warning for `or` if not used yet — kept for
// future filename+mime OR composition.
void or;
