/**
 * Phase 16 — user-skills router. The "专家技能" settings page reads
 * SKILL_META and the caller's users.selected_skills JSON, then lets
 * the user toggle each on/off.
 *
 * P1.2 — storage moved from users.selected_roles to a new
 * users.selected_skills column. Mixing the two on the same JSON
 * column collided with /settings/roles' Basic-plan 5-pick gate
 * (a Basic user with 8 toggled skills would see "已选 13 / 5" on
 * the role page and get a 400 trying to save anything new). The
 * one-shot `scripts/split-skills.ts` partitions existing rows.
 */

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SKILL_META, skillMetaById } from '../../agent/skills/skill-meta.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Read users.selected_skills for the caller. Returns [] when the
 * column is NULL (free / new users) so consumers can iterate without
 * a null check.
 */
async function loadEnabledIds(
  ctx: { db: typeof import('../../db/client.js').db; userId: string },
): Promise<string[]> {
  const [row] = await ctx.db
    .select({ selectedSkills: users.selectedSkills, id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return Array.isArray(row.selectedSkills) ? row.selectedSkills : [];
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
   * silently write garbage to selected_skills.
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
        .select({ id: users.id, selectedSkills: users.selectedSkills })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const current = new Set(Array.isArray(row.selectedSkills) ? row.selectedSkills : []);
      const wasEnabled = current.has(input.skillId);
      if (wasEnabled) current.delete(input.skillId);
      else current.add(input.skillId);
      const next = Array.from(current);
      await ctx.db
        .update(users)
        .set({ selectedSkills: next.length === 0 ? null : next })
        .where(eq(users.id, row.id));
      return { skillId: input.skillId, enabled: !wasEnabled };
    }),
});
