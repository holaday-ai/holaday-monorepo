/**
 * Phase 16 — user-skills router. The "专家技能" settings page reads
 * SKILL_META and the caller's users.selected_roles JSON, then lets
 * the user toggle each on/off. Selected skills feed into supercar's
 * existing role-matcher (already gates on selectedRoles via
 * gateRoleForUser in @holaday/shared-types).
 *
 * No new DB table — the storage is users.selected_roles which has
 * existed since Phase 10 Tier 2.
 */

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SKILL_META, skillMetaById } from '../../agent/skills/skill-meta.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Read users.selected_roles for the caller. Returns [] when the
 * column is NULL (free / new users) so consumers can iterate without
 * a null check.
 */
async function loadEnabledIds(
  ctx: { db: typeof import('../../db/client.js').db; userId: string },
): Promise<string[]> {
  const [row] = await ctx.db
    .select({ selectedRoles: users.selectedRoles, id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return Array.isArray(row.selectedRoles) ? row.selectedRoles : [];
}

export const skillsRouter = router({
  /**
   * List every skill in the catalogue with its enabled flag. The SPA
   * renders this as the SkillsPage card grid grouped by category.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const enabled = new Set(await loadEnabledIds(ctx));
    return SKILL_META.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      category: s.category,
      description: s.description,
      enabled: enabled.has(s.id),
    }));
  }),

  /**
   * Toggle a single skill on/off. Returns the new enabled state.
   * Unknown skill id → BAD_REQUEST so a stale frontend can't
   * silently write garbage to selected_roles.
   */
  toggle: protectedProcedure
    .input(z.object({ skillId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!skillMetaById(input.skillId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `unknown skill: ${input.skillId}`,
        });
      }
      const [row] = await ctx.db
        .select({ id: users.id, selectedRoles: users.selectedRoles })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const current = new Set(Array.isArray(row.selectedRoles) ? row.selectedRoles : []);
      const wasEnabled = current.has(input.skillId);
      if (wasEnabled) current.delete(input.skillId);
      else current.add(input.skillId);
      const next = Array.from(current);
      await ctx.db
        .update(users)
        .set({ selectedRoles: next.length === 0 ? null : next })
        .where(eq(users.id, row.id));
      return { skillId: input.skillId, enabled: !wasEnabled };
    }),
});
