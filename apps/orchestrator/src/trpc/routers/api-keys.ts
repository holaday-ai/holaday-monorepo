/**
 * Phase 5d — API keys tRPC router.
 *
 * Endpoints:
 *   create  → mint a new key. Returns the plaintext ONCE; the SPA
 *             must show it to the user immediately. After this call
 *             responds, the plaintext is unrecoverable.
 *   list    → user's keys (display prefix + name + lastUsedAt +
 *             revokedAt). Never includes plaintext or hash.
 *   revoke  → soft-delete (sets revoked_at). Idempotent: revoking an
 *             already-revoked key returns ok=true without error.
 *
 * Used by the SPA's settings page to manage webhook access. The
 * webhook endpoint itself is REST (not tRPC) — see api/webhooks.ts.
 */

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { generateApiKey } from '../../api-keys/api-key-service.js';
import { apiKeys } from '../../db/schema/api-keys.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

const MAX_KEYS_PER_USER = 10;

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

export const apiKeysRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .select({
        externalId: apiKeys.externalId,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map((r) => ({
      apiKeyId: r.externalId,
      name: r.name,
      keyPrefix: r.keyPrefix,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        // ISO 8601 future timestamp; absent = never expires.
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      // Cap active keys per user so a runaway script can't spam the
      // table. Revoked keys don't count toward the limit (they're
      // dead but kept for audit).
      const liveCount = await ctx.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
      if (liveCount.length >= MAX_KEYS_PER_USER) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `每个账号最多 ${MAX_KEYS_PER_USER} 个有效 API key，请先撤销旧 key`,
        });
      }
      let expiresAt: Date | undefined;
      if (input.expiresAt) {
        const parsed = new Date(input.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'expiresAt must be a valid datetime',
          });
        }
        if (parsed.getTime() <= Date.now()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '过期时间必须晚于当前时间',
          });
        }
        expiresAt = parsed;
      }
      const externalId = newExternalId('apiKey');
      const { plaintext, displayPrefix, hash } = generateApiKey();
      await ctx.db.insert(apiKeys).values({
        externalId,
        userId,
        name: input.name,
        keyPrefix: displayPrefix,
        keyHash: hash,
        ...(expiresAt ? { expiresAt } : {}),
      });
      // Return the plaintext ONCE. SPA caller must show this to the
      // user immediately; subsequent .list never includes it. This is
      // the standard "secrets shown only at creation" pattern (GitHub,
      // Stripe, etc.).
      return {
        apiKeyId: externalId,
        plaintext,
        keyPrefix: displayPrefix,
        name: input.name,
      };
    }),

  revoke: protectedProcedure
    .input(z.object({ apiKeyId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      // Read-then-write so we can return ok=true on idempotent revoke
      // (revoking an already-revoked key).
      const [row] = await ctx.db
        .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
        .from(apiKeys)
        .where(
          and(eq(apiKeys.externalId, input.apiKeyId), eq(apiKeys.userId, userId)),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
      }
      if (row.revokedAt) {
        return { ok: true as const, alreadyRevoked: true };
      }
      await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(apiKeys.id, row.id));
      return { ok: true as const, alreadyRevoked: false };
    }),
});
