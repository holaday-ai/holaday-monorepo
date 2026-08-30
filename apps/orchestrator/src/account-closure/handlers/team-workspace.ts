import { sql } from 'drizzle-orm';
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

const organizationOwnership: RelationalDeleteTarget = directUserRows(
  'organizations',
  'owner_user_id',
);

const activeProjectLeadDuty: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT id FROM project_members WHERE user_id = ${context.request.userId} AND role = 'lead' AND status = 'active' ORDER BY id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds() {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  },
};

const teamProjectCreatorDuty: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT id FROM projects WHERE user_id = ${context.request.userId} AND organization_id IS NOT NULL ORDER BY id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds() {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
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
 * team project. Owners, active project leads, and the database owner of every
 * team project must transfer responsibility through the normal tenant-safe
 * APIs before account closure can continue. The final check is required while
 * `projects.user_id` remains an ON DELETE CASCADE foreign key.
 */
export async function assertTeamWorkspaceClosureSafe(
  context: ClosureHandlerContext,
): Promise<void> {
  await assertNoOwnedRows(
    context,
    [organizationOwnership, activeProjectLeadDuty, teamProjectCreatorDuty],
    'CAPABILITY_CHANGED',
  );
}

/**
 * Association cleanup is deliberately user-bound. Invitations that depend on
 * the closing manager are removed, subordinate reporting lines are detached,
 * and team memberships are deleted. Creator identity on a team project is not
 * treated as ownership; only personal projects are deleted.
 */
export const TEAM_WORKSPACE_CLOSURE_TARGETS = {
  invitationsManaged: directUserRows('organization_invitations', 'manager_user_id'),
  invitationsCreated: directUserRows('organization_invitations', 'invited_by_user_id'),
  reportingLines,
  projectMemberships: directUserRows('project_members'),
  organizationMemberships: directUserRows('organization_members'),
  personalProjects,
} as const satisfies Record<string, RelationalDeleteTarget>;
