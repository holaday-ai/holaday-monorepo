import { sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { readAffectedRows } from '../../db/mysql-result.js';
import {
  type ClosureHandlerContext,
  ClosureHandlerError,
  type RelationalDeleteTarget,
  assertNoOwnedRows,
  directUserRows,
} from '../handler-contract.js';

function readIds(result: unknown): number[] {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return rows.map((row) => {
    const id = Number((row as { id?: unknown }).id);
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    return id;
  });
}

const soleOrganizationOwnerDuty: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT m.id FROM organization_members m WHERE m.user_id = ${context.request.userId} AND m.role = 'owner' AND m.status = 'active' AND NOT EXISTS (SELECT 1 FROM organization_members replacement WHERE replacement.organization_id = m.organization_id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'owner' AND replacement.status = 'active') ORDER BY m.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds() {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  },
};

const untransferableOrganizationResponsibility: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT o.id FROM organizations o WHERE o.owner_user_id = ${context.request.userId} AND NOT EXISTS (SELECT 1 FROM organization_members replacement WHERE replacement.organization_id = o.id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'owner' AND replacement.status = 'active') ORDER BY o.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds() {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  },
};

const activeProjectLeadDuty: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT pm.id FROM project_members pm WHERE pm.user_id = ${context.request.userId} AND pm.role = 'lead' AND pm.status = 'active' AND NOT EXISTS (SELECT 1 FROM project_members replacement WHERE replacement.project_id = pm.project_id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'lead' AND replacement.status = 'active') ORDER BY pm.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds() {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  },
};

const untransferableTeamProjectCustody: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT p.id FROM projects p WHERE p.user_id = ${context.request.userId} AND p.organization_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_members replacement WHERE replacement.project_id = p.id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'lead' AND replacement.status = 'active') ORDER BY p.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds() {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  },
};

const organizationAssociations: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT DISTINCT o.id FROM organizations o LEFT JOIN organization_members membership ON membership.organization_id = o.id AND membership.user_id = ${context.request.userId} WHERE o.owner_user_id = ${context.request.userId} OR membership.id IS NOT NULL ORDER BY o.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds(context, ids) {
    if (ids.length === 0) return 0;
    return context.db.transaction(async (tx) => {
      const idList = sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      );
      const lockedIds = readIds(
        await tx.execute(
          sql`SELECT id FROM organizations WHERE id IN (${idList}) ORDER BY id ASC FOR UPDATE`,
        ),
      );
      if (lockedIds.length !== new Set(ids).size) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      await tx.execute(
        sql`SELECT id FROM organization_members WHERE organization_id IN (${idList}) ORDER BY organization_id ASC, id ASC FOR UPDATE`,
      );
      const unsafe = readIds(
        await tx.execute(
          sql`SELECT o.id FROM organizations o WHERE o.id IN (${idList}) AND (o.owner_user_id = ${context.request.userId} OR EXISTS (SELECT 1 FROM organization_members closing_owner WHERE closing_owner.organization_id = o.id AND closing_owner.user_id = ${context.request.userId} AND closing_owner.role = 'owner' AND closing_owner.status = 'active')) AND NOT EXISTS (SELECT 1 FROM organization_members replacement WHERE replacement.organization_id = o.id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'owner' AND replacement.status = 'active') ORDER BY o.id ASC`,
        ),
      );
      if (unsafe.length > 0) throw new ClosureHandlerError('CAPABILITY_CHANGED');
      await tx.execute(
        sql`UPDATE organizations o SET owner_user_id = (SELECT replacement.user_id FROM organization_members replacement WHERE replacement.organization_id = o.id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'owner' AND replacement.status = 'active' ORDER BY replacement.external_id ASC LIMIT 1) WHERE o.owner_user_id = ${context.request.userId} AND o.id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
      const remainingResponsibility = readIds(
        await tx.execute(
          sql`SELECT id FROM organizations WHERE owner_user_id = ${context.request.userId} AND id IN (${idList}) ORDER BY id ASC`,
        ),
      );
      if (remainingResponsibility.length > 0) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      await tx.execute(
        sql`DELETE FROM organization_members WHERE user_id = ${context.request.userId} AND organization_id IN (${idList})`,
      );
      return ids.length;
    });
  },
};

const teamProjectAssociations: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT DISTINCT p.id FROM projects p LEFT JOIN project_members membership ON membership.project_id = p.id AND membership.user_id = ${context.request.userId} WHERE p.organization_id IS NOT NULL AND (p.user_id = ${context.request.userId} OR membership.id IS NOT NULL) ORDER BY p.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds(context, ids) {
    if (ids.length === 0) return 0;
    return context.db.transaction(async (tx) => {
      const idList = sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      );
      const lockedIds = readIds(
        await tx.execute(
          sql`SELECT id FROM projects WHERE id IN (${idList}) AND organization_id IS NOT NULL ORDER BY id ASC FOR UPDATE`,
        ),
      );
      if (lockedIds.length !== new Set(ids).size) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      await tx.execute(
        sql`SELECT id FROM project_members WHERE project_id IN (${idList}) ORDER BY project_id ASC, id ASC FOR UPDATE`,
      );
      const unsafe = readIds(
        await tx.execute(
          sql`SELECT p.id FROM projects p WHERE p.id IN (${idList}) AND (p.user_id = ${context.request.userId} OR EXISTS (SELECT 1 FROM project_members closing_lead WHERE closing_lead.project_id = p.id AND closing_lead.user_id = ${context.request.userId} AND closing_lead.role = 'lead' AND closing_lead.status = 'active')) AND NOT EXISTS (SELECT 1 FROM project_members replacement WHERE replacement.project_id = p.id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'lead' AND replacement.status = 'active') ORDER BY p.id ASC`,
        ),
      );
      if (unsafe.length > 0) throw new ClosureHandlerError('CAPABILITY_CHANGED');
      await tx.execute(
        sql`UPDATE projects p SET user_id = (SELECT replacement.user_id FROM project_members replacement WHERE replacement.project_id = p.id AND replacement.user_id <> ${context.request.userId} AND replacement.role = 'lead' AND replacement.status = 'active' ORDER BY replacement.external_id ASC LIMIT 1) WHERE p.user_id = ${context.request.userId} AND p.organization_id IS NOT NULL AND p.id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
      const remainingCustody = readIds(
        await tx.execute(
          sql`SELECT id FROM projects WHERE user_id = ${context.request.userId} AND organization_id IS NOT NULL AND id IN (${idList}) ORDER BY id ASC`,
        ),
      );
      if (remainingCustody.length > 0) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      await tx.execute(
        sql`DELETE FROM project_members WHERE user_id = ${context.request.userId} AND project_id IN (${idList})`,
      );
      return ids.length;
    });
  },
};

const reportingLines: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT id FROM organization_members WHERE manager_user_id = ${context.request.userId} ORDER BY id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds(context, ids) {
    if (ids.length === 0) return 0;
    return readAffectedRows(
      await context.db.execute(
        sql`UPDATE organization_members SET manager_user_id = NULL WHERE manager_user_id = ${context.request.userId} AND id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
  },
};

const personalProjects: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT id FROM projects WHERE user_id = ${context.request.userId} AND organization_id IS NULL ORDER BY id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds(context, ids) {
    if (ids.length === 0) return 0;
    return readAffectedRows(
      await context.db.execute(
        sql`DELETE FROM projects WHERE user_id = ${context.request.userId} AND organization_id IS NULL AND id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
  },
};

/**
 * Closing an account must never silently dissolve an organization or orphan a
 * team project. A sole owner/lead blocks closure for operator attention. When
 * another active owner/lead exists, cleanup deterministically transfers the
 * two legacy FK responsibility columns before deleting memberships. This is
 * required while `projects.user_id` remains an ON DELETE CASCADE foreign key.
 */
export async function assertTeamWorkspaceClosureSafe(
  context: ClosureHandlerContext,
): Promise<void> {
  await assertNoOwnedRows(
    context,
    [
      soleOrganizationOwnerDuty,
      untransferableOrganizationResponsibility,
      activeProjectLeadDuty,
      untransferableTeamProjectCustody,
    ],
    'CAPABILITY_CHANGED',
  );
}

/**
 * Final tombstoning is a last fail-closed boundary. The category handler must
 * have removed every membership and transferred both legacy responsibility
 * foreign keys; lock and reject any residue before the account becomes closed.
 */
export async function assertNoTeamWorkspaceAssociationsForFinalization(
  db: Pick<DB, 'execute'>,
  userId: number,
): Promise<void> {
  const checks = [
    sql`SELECT id FROM organizations WHERE owner_user_id = ${userId} ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    sql`SELECT id FROM projects WHERE user_id = ${userId} AND organization_id IS NOT NULL ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    sql`SELECT id FROM organization_members WHERE user_id = ${userId} ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    sql`SELECT id FROM project_members WHERE user_id = ${userId} ORDER BY id ASC LIMIT 1 FOR UPDATE`,
  ];
  for (const check of checks) {
    if (readIds(await db.execute(check)).length > 0) {
      throw new ClosureHandlerError('CAPABILITY_CHANGED');
    }
  }
}

/**
 * Association cleanup is deliberately user-bound. Invitations that depend on
 * the closing manager are removed, subordinate reporting lines are detached,
 * and team memberships are deleted. Creator identity on a team project is not
 * treated as ownership; only personal projects are deleted.
 */
export const TEAM_WORKSPACE_CLOSURE_TARGETS = {
  organizationAssociations,
  teamProjectAssociations,
  invitationsManaged: directUserRows('organization_invitations', 'manager_user_id'),
  invitationsCreated: directUserRows('organization_invitations', 'invited_by_user_id'),
  reportingLines,
  personalProjects,
} as const satisfies Record<string, RelationalDeleteTarget>;
