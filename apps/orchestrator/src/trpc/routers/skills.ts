/**
 * Phase 16 — user-skills router. The Skills page reads
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

import { normalizeSkillIds } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SKILL_META, skillMetaById } from '../../agent/skills/skill-meta.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

function normalizeSelectedSkillIds(value: unknown): string[] {
  return normalizeSkillIds(value);
}

function toggleSelectedSkillIds(
  value: unknown,
  skillId: string,
): { next: string[]; enabled: boolean } {
  const current = new Set(normalizeSelectedSkillIds(value));
  const wasEnabled = current.has(skillId);
  if (wasEnabled) current.delete(skillId);
  else current.add(skillId);
  return { next: Array.from(current), enabled: !wasEnabled };
}

function buildSkillListRows(enabledIds: Iterable<string>) {
  const enabled = new Set(normalizeSelectedSkillIds(Array.from(enabledIds)));
  return SKILL_META.map((skill) => ({
    id: skill.id,
    name: skill.name,
    logoId: skill.logoId,
    category: skill.category,
    description: skill.description,
    aliases: [...skill.aliases],
    maturity: skill.maturity,
    connectors: [...skill.connectors],
    experience: {
      starterPrompts: [...skill.experience.starterPrompts],
      requiredInputs: [...skill.experience.requiredInputs],
      deliverables: [...skill.experience.deliverables],
      boundary: skill.experience.boundary,
      exampleSummary: skill.experience.exampleSummary,
    },
    enabled: enabled.has(skill.id),
  }));
}

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
    return buildSkillListRows(await loadEnabledIds(ctx));
  }),

  /**
   * Toggle a single skill on/off. Returns the new enabled state.
   * Unknown skill id → BAD_REQUEST so a stale frontend can't
   * silently write garbage to selected_skills.
   */
  toggle: protectedProcedure
    .input(z.object({ skillId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const skill = skillMetaById(input.skillId);
      if (!skill) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `unknown skill: ${input.skillId}`,
        });
      }
      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: users.id, selectedSkills: users.selectedSkills })
          .from(users)
          .where(eq(users.externalId, ctx.userId))
          .limit(1)
          .for('update');
        if (!row) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
        }
        const toggled = toggleSelectedSkillIds(row.selectedSkills, skill.id);
        await tx
          .update(users)
          .set({ selectedSkills: toggled.next.length === 0 ? null : toggled.next })
          .where(eq(users.id, row.id));
        return { skillId: skill.id, enabled: toggled.enabled };
      });
    }),
});

export const __skillsInternals = {
  buildSkillListRows,
  normalizeSelectedSkillIds,
  toggleSelectedSkillIds,
};
