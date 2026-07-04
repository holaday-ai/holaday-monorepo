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

import { PLAN_CATALOGUE, normalizeSkillIds, type PlanId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SKILL_META, skillMetaById } from '../../agent/skills/skill-meta.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

const PLAN_IDS = new Set<string>(Object.keys(PLAN_CATALOGUE));
function skillCapForPlan(plan: string | null | undefined): number {
  if (plan && PLAN_IDS.has(plan)) {
    return PLAN_CATALOGUE[plan as PlanId].rolesAllowed;
  }
  return PLAN_CATALOGUE.free.rolesAllowed;
}

function skillLimitErrorMessage(plan: string | null | undefined, cap: number): string {
  if (cap <= 0) return '当前套餐暂不支持启用技能';
  const label = plan === 'pro' ? '专业版' : plan === 'basic' ? '基础版' : '当前套餐';
  return `${label}最多可启用 ${cap} 个技能，请先停用一个技能后再启用新的技能`;
}

function normalizeSelectedSkillIds(value: unknown): string[] {
  return normalizeSkillIds(value);
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
      const [row] = await ctx.db
        .select({ id: users.id, plan: users.plan, selectedSkills: users.selectedSkills })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const current = new Set(normalizeSelectedSkillIds(row.selectedSkills));
      const wasEnabled = current.has(skill.id);
      const cap = skillCapForPlan(row.plan);
      if (!wasEnabled && current.size >= cap) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: skillLimitErrorMessage(row.plan, cap),
        });
      }
      if (wasEnabled) current.delete(skill.id);
      else current.add(skill.id);
      const next = Array.from(current);
      await ctx.db
        .update(users)
        .set({ selectedSkills: next.length === 0 ? null : next })
        .where(eq(users.id, row.id));
      return { skillId: skill.id, enabled: !wasEnabled };
    }),
});

export const __skillsInternals = {
  buildSkillListRows,
  normalizeSelectedSkillIds,
  skillCapForPlan,
  skillLimitErrorMessage,
};
