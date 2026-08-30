import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it, vi } from 'vitest';
import type { ClosureHandlerContext } from '../handler-contract.js';
import {
  TEAM_WORKSPACE_CLOSURE_TARGETS,
  assertTeamWorkspaceClosureSafe,
} from './team-workspace.js';

function contextWithResults(results: unknown[]): ClosureHandlerContext & {
  db: { execute: ReturnType<typeof vi.fn> };
} {
  const execute = vi.fn(async () => results.shift() ?? [[]]);
  return {
    db: { execute },
    request: { id: 1, externalId: 'acr_test', userId: 42, userExternalId: 'usr_test' },
    checkpoint: null,
    pageSize: 100,
    signal: new AbortController().signal,
  } as unknown as ClosureHandlerContext & { db: { execute: ReturnType<typeof vi.fn> } };
}

function compiledSql(value: unknown): string {
  return new MySqlDialect()
    .sqlToQuery(value as Parameters<MySqlDialect['sqlToQuery']>[0])
    .sql.replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

describe('team workspace account-closure boundary', () => {
  it('blocks closure before cleanup when the user still owns an organization', async () => {
    const context = contextWithResults([[[{ id: 7 }]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    expect(context.db.execute).toHaveBeenCalledTimes(1);
  });

  it('blocks closure before cleanup when the user still has an active project lead duty', async () => {
    const context = contextWithResults([[[]], [[{ id: 9 }]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    expect(context.db.execute).toHaveBeenCalledTimes(2);
    expect(compiledSql(context.db.execute.mock.calls[1]?.[0])).toContain(
      "from project_members where user_id = ? and role = 'lead' and status = 'active'",
    );
  });

  it('allows cleanup only after owner and active-lead duties are absent', async () => {
    const context = contextWithResults([[[]], [[]], [[]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).resolves.toBeUndefined();
  });

  it('blocks closure while the user is still the database owner of a team project', async () => {
    const context = contextWithResults([[[]], [[]], [[{ id: 10 }]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    expect(context.db.execute).toHaveBeenCalledTimes(3);
    expect(compiledSql(context.db.execute.mock.calls[2]?.[0])).toContain(
      'from projects where user_id = ? and organization_id is not null',
    );
  });

  it('keeps creator-owned team projects while deleting only personal projects', async () => {
    const context = contextWithResults([[[]]]);

    await TEAM_WORKSPACE_CLOSURE_TARGETS.personalProjects.selectOwnedIds(context, 100);

    expect(compiledSql(context.db.execute.mock.calls[0]?.[0])).toContain(
      'from projects where user_id = ? and organization_id is null',
    );
  });

  it('clears reporting lines without deleting subordinate memberships', async () => {
    const context = contextWithResults([[[{ id: 11 }]], [{ affectedRows: 1 }]]);
    const ids = await TEAM_WORKSPACE_CLOSURE_TARGETS.reportingLines.selectOwnedIds(context, 100);
    await TEAM_WORKSPACE_CLOSURE_TARGETS.reportingLines.deleteOwnedIds(context, ids);

    expect(ids).toEqual([11]);
    expect(compiledSql(context.db.execute.mock.calls[1]?.[0])).toContain(
      'update organization_members set manager_user_id = null',
    );
  });

  it('removes invitations and memberships through user-bound predicates', async () => {
    const targets = [
      TEAM_WORKSPACE_CLOSURE_TARGETS.invitationsManaged,
      TEAM_WORKSPACE_CLOSURE_TARGETS.invitationsCreated,
      TEAM_WORKSPACE_CLOSURE_TARGETS.projectMemberships,
      TEAM_WORKSPACE_CLOSURE_TARGETS.organizationMemberships,
    ];

    for (const target of targets) {
      const context = contextWithResults([[[{ id: 12 }]], [{ affectedRows: 1 }]]);
      const ids = await target.selectOwnedIds(context, 100);
      await target.deleteOwnedIds(context, ids);
      expect(compiledSql(context.db.execute.mock.calls[1]?.[0])).toMatch(
        /where `(manager_user_id|invited_by_user_id|user_id)` = \?/,
      );
    }
  });
});
