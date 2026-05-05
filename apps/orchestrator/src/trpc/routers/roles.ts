/**
 * Roles router — list the catalogue + persist the Basic-plan user's
 * pick of 5 open-pool roles.
 *
 * Two procedures:
 *   - `list` (protected): full role metadata, augmented with the
 *     user's plan + currently selected ids + change counter. The
 *     SPA's /settings/roles page renders all 33 cards from this.
 *   - `select` (protected): replace the user's selected_roles list.
 *     Validates the pick against open-pool membership + the 5-pick
 *     limit + the 3-changes-per-month anti-thrash cap. Pro plan
 *     callers get a 400 — they don't have a selection to make.
 */

import {
  BASIC_ROLE_PICK_LIMIT,
  OPEN_POOL_ROLE_IDS,
  ROLE_CATALOGUE,
  ROLE_CHANGES_PER_MONTH,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

const OPEN_POOL_SET: ReadonlySet<string> = new Set(OPEN_POOL_ROLE_IDS);

const selectInput = z.object({
  /**
   * Open-pool role ids the user wants active. Order is preserved
   * for display; functionally only set membership matters.
   * Empty list = "no roles" (a valid choice — user disables the
   * role layer entirely on Basic).
   */
  roleIds: z
    .array(z.string())
    .max(BASIC_ROLE_PICK_LIMIT, {
      message: `基础版最多可选 ${BASIC_ROLE_PICK_LIMIT} 个角色，请先减少再保存`,
    }),
});

/** Same UTC month boundary the QuotaService uses for paid plans. */
function currentMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export const rolesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({
        plan: users.plan,
        selectedRoles: users.selectedRoles,
        roleChangesThisMonth: users.roleChangesThisMonth,
        roleChangesPeriodStart: users.roleChangesPeriodStart,
      })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    // Reset the change counter when the stored period has rolled
    // over. We don't write the reset back here (read endpoint), but
    // we report 0 so the UI doesn't hide the "edit" button stalely.
    const monthStart = currentMonthStart();
    const changesThisMonth =
      user.roleChangesPeriodStart && user.roleChangesPeriodStart >= monthStart
        ? user.roleChangesThisMonth
        : 0;
    const rawSelected = (user.selectedRoles ?? []) as string[];
    // P1-final — sanitize for Basic plan. The skill/role split
    // migration kept every ROLE_CATALOGUE id (including Pro-exclusive
    // ones like contract-reviewer) in selected_roles. Pro-only cards
    // render as locked on /settings/roles for Basic users — they
    // can't be unchecked, so the user got locked: their draft list
    // still contained the Pro-only id, which `roles.select` then
    // rejected. Filter Pro-only ids out at read-time so the SPA
    // never sees them in `selected`. `needsRoleRepair` tells the
    // SPA to surface a "请保存以修复" hint; saving the sanitized
    // list rewrites the DB row to a clean state.
    const sanitizedSelected =
      user.plan === 'basic'
        ? rawSelected.filter((id) => OPEN_POOL_SET.has(id))
        : rawSelected;
    const needsRoleRepair = sanitizedSelected.length !== rawSelected.length;
    // overLimit kept for the over-limit-but-all-open-pool case
    // (e.g. a Basic user with 8 valid open-pool roles). The banner
    // copy is different from needsRoleRepair (one says "auto-removed
    // ineligible roles", the other says "trim manually").
    const overLimit =
      user.plan === 'basic' && sanitizedSelected.length > BASIC_ROLE_PICK_LIMIT;
    return {
      plan: user.plan,
      selected: sanitizedSelected,
      catalogue: ROLE_CATALOGUE,
      pickLimit: BASIC_ROLE_PICK_LIMIT,
      changesThisMonth,
      changesLimit: ROLE_CHANGES_PER_MONTH,
      overLimit,
      needsRoleRepair,
    };
  }),

  select: protectedProcedure.input(selectInput).mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .select({
        id: users.id,
        plan: users.plan,
        selectedRoles: users.selectedRoles,
        roleChangesThisMonth: users.roleChangesThisMonth,
        roleChangesPeriodStart: users.roleChangesPeriodStart,
      })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    if (user.plan !== 'basic') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          user.plan === 'pro'
            ? '专业版默认开启全部角色，无需选择'
            : '免费版无角色权限，请先升级到基础版',
      });
    }

    // De-duplicate + validate every id sits in the open pool. We
    // refuse Pro-exclusive ids here so a malicious client can't
    // sneak Pro roles onto a Basic account by hitting the API
    // directly — the client-side gate isn't the only defence.
    const dedup = Array.from(new Set(input.roleIds));
    for (const id of dedup) {
      if (!OPEN_POOL_SET.has(id)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `角色 ${id} 不在可选池中`,
        });
      }
    }

    // Anti-thrash: 3 changes per UTC calendar month. Counts only
    // when the new selection actually differs from the current one
    // — re-saving the same picks doesn't burn a change.
    const monthStart = currentMonthStart();
    const periodInSync =
      user.roleChangesPeriodStart && user.roleChangesPeriodStart >= monthStart;
    const currentSelected = (user.selectedRoles ?? []) as string[];
    const sameSelection =
      currentSelected.length === dedup.length &&
      currentSelected.every((id) => dedup.includes(id));

    let nextChangesThisMonth = periodInSync ? user.roleChangesThisMonth : 0;
    if (!sameSelection) {
      if (nextChangesThisMonth >= ROLE_CHANGES_PER_MONTH) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `本月角色已切换 ${ROLE_CHANGES_PER_MONTH} 次，下月再试`,
        });
      }
      nextChangesThisMonth += 1;
    }

    await ctx.db
      .update(users)
      .set({
        selectedRoles: dedup,
        roleChangesThisMonth: nextChangesThisMonth,
        roleChangesPeriodStart: monthStart,
      })
      .where(eq(users.id, user.id));

    return {
      ok: true as const,
      selected: dedup,
      changesThisMonth: nextChangesThisMonth,
      changesLimit: ROLE_CHANGES_PER_MONTH,
    };
  }),
});
