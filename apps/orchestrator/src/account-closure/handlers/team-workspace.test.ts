import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it, vi } from 'vitest';
import type { ClosureHandlerContext } from '../handler-contract.js';
import {
  TEAM_WORKSPACE_CLOSURE_TARGETS,
  assertNoTeamWorkspaceAssociationsForFinalization,
  assertTeamWorkspaceClosureSafe,
} from './team-workspace.js';

function contextWithResults(results: unknown[]): ClosureHandlerContext & {
  db: {
    execute: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
} {
  const execute = vi.fn(async () => results.shift() ?? [[]]);
  const db = {
    execute,
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  return {
    db,
    request: { id: 1, externalId: 'acr_test', userId: 42, userExternalId: 'usr_test' },
    checkpoint: null,
    pageSize: 100,
    signal: new AbortController().signal,
  } as unknown as ClosureHandlerContext & {
    db: {
      execute: ReturnType<typeof vi.fn>;
      transaction: ReturnType<typeof vi.fn>;
    };
  };
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
    const context = contextWithResults([[[]], [[]], [[{ id: 9 }]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    expect(context.db.execute).toHaveBeenCalledTimes(3);
    expect(compiledSql(context.db.execute.mock.calls[2]?.[0])).toContain(
      "from project_members pm where pm.user_id = ? and pm.role = 'lead' and pm.status = 'active'",
    );
    expect(compiledSql(context.db.execute.mock.calls[2]?.[0])).toContain('not exists');
  });

  it('allows cleanup only after owner and active-lead duties are absent', async () => {
    const context = contextWithResults([[[]], [[]], [[]], [[]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).resolves.toBeUndefined();
  });

  it('locks and rejects any final team-workspace residue before tombstoning', async () => {
    const clean = contextWithResults([[[]], [[]], [[]], [[]]]);
    await expect(
      assertNoTeamWorkspaceAssociationsForFinalization(clean.db as never, 42),
    ).resolves.toBeUndefined();
    expect(clean.db.execute).toHaveBeenCalledTimes(4);
    for (const [query] of clean.db.execute.mock.calls) {
      expect(compiledSql(query)).toContain('for update');
    }

    const unsafe = contextWithResults([[[{ id: 7 }]]]);
    await expect(
      assertNoTeamWorkspaceAssociationsForFinalization(unsafe.db as never, 42),
    ).rejects.toMatchObject({ code: 'CAPABILITY_CHANGED' });
    expect(unsafe.db.execute).toHaveBeenCalledTimes(1);
  });

  it('blocks closure while the user is still the database owner of a team project', async () => {
    const context = contextWithResults([[[]], [[]], [[]], [[{ id: 10 }]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    expect(context.db.execute).toHaveBeenCalledTimes(4);
    expect(compiledSql(context.db.execute.mock.calls[3]?.[0])).toContain(
      'from projects p where p.user_id = ? and p.organization_id is not null',
    );
  });

  it('blocks a stale designated owner when no active replacement exists', async () => {
    const context = contextWithResults([[[]], [[{ id: 8 }]]]);

    await expect(assertTeamWorkspaceClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    expect(compiledSql(context.db.execute.mock.calls[1]?.[0])).toContain(
      'from organizations o where o.owner_user_id = ?',
    );
  });

  it('transfers designated organization responsibility before membership cleanup', async () => {
    const context = contextWithResults([
      [[{ id: 7 }]],
      [[{ id: 7 }]],
      [[]],
      [[]],
      [{ affectedRows: 1 }],
      [[]],
      [{ affectedRows: 1 }],
    ]);
    const ids = await TEAM_WORKSPACE_CLOSURE_TARGETS.organizationAssociations.selectOwnedIds(
      context,
      100,
    );
    const affected = await TEAM_WORKSPACE_CLOSURE_TARGETS.organizationAssociations.deleteOwnedIds(
      context,
      ids,
    );

    expect(ids).toEqual([7]);
    expect(affected).toBe(1);
    expect(compiledSql(context.db.execute.mock.calls[0]?.[0])).toContain(
      'left join organization_members membership',
    );
    expect(compiledSql(context.db.execute.mock.calls[1]?.[0])).toContain('for update');
    expect(compiledSql(context.db.execute.mock.calls[4]?.[0])).toContain(
      'update organizations o set owner_user_id =',
    );
    expect(compiledSql(context.db.execute.mock.calls[4]?.[0])).toContain(
      'order by replacement.external_id asc limit 1',
    );
    expect(compiledSql(context.db.execute.mock.calls[6]?.[0])).toContain(
      'delete from organization_members',
    );
    expect(context.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('transfers team-project custody to another active lead before deleting memberships', async () => {
    const context = contextWithResults([
      [[{ id: 10 }]],
      [[{ id: 10 }]],
      [[]],
      [[]],
      [{ affectedRows: 1 }],
      [[]],
      [{ affectedRows: 1 }],
    ]);
    const ids = await TEAM_WORKSPACE_CLOSURE_TARGETS.teamProjectAssociations.selectOwnedIds(
      context,
      100,
    );
    const affected = await TEAM_WORKSPACE_CLOSURE_TARGETS.teamProjectAssociations.deleteOwnedIds(
      context,
      ids,
    );

    expect(ids).toEqual([10]);
    expect(affected).toBe(1);
    expect(compiledSql(context.db.execute.mock.calls[4]?.[0])).toContain(
      'update projects p set user_id =',
    );
    expect(compiledSql(context.db.execute.mock.calls[4]?.[0])).toContain(
      "replacement.role = 'lead'",
    );
    expect(compiledSql(context.db.execute.mock.calls[6]?.[0])).toContain(
      'delete from project_members',
    );
    expect(context.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('fails closed inside the locked organization transaction when the replacement disappeared', async () => {
    const context = contextWithResults([[[{ id: 7 }]], [[{ id: 7 }]], [[]], [[{ id: 7 }]]]);
    const ids = await TEAM_WORKSPACE_CLOSURE_TARGETS.organizationAssociations.selectOwnedIds(
      context,
      100,
    );

    await expect(
      TEAM_WORKSPACE_CLOSURE_TARGETS.organizationAssociations.deleteOwnedIds(context, ids),
    ).rejects.toMatchObject({ code: 'CAPABILITY_CHANGED' });
    expect(context.db.execute).toHaveBeenCalledTimes(4);
    expect(context.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('fails closed inside the locked project transaction when the replacement disappeared', async () => {
    const context = contextWithResults([[[{ id: 10 }]], [[{ id: 10 }]], [[]], [[{ id: 10 }]]]);
    const ids = await TEAM_WORKSPACE_CLOSURE_TARGETS.teamProjectAssociations.selectOwnedIds(
      context,
      100,
    );

    await expect(
      TEAM_WORKSPACE_CLOSURE_TARGETS.teamProjectAssociations.deleteOwnedIds(context, ids),
    ).rejects.toMatchObject({ code: 'CAPABILITY_CHANGED' });
    expect(context.db.execute).toHaveBeenCalledTimes(4);
    expect(context.db.transaction).toHaveBeenCalledTimes(1);
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
