import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it, vi } from 'vitest';
import type { ClosureHandlerContext } from '../handler-contract.js';
import {
  TEAM_WORK_ITEM_CLOSURE_TARGETS,
  assertNoActiveTeamWorkItemResponsibilitiesForFinalization,
  assertTeamWorkItemClosureSafe,
  hasRetainedTeamWorkFacts,
  minimizeRetainedTeamWorkSources,
} from './team-work-items.js';

function contextWithResults(results: unknown[]): ClosureHandlerContext & {
  db: {
    execute: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
} {
  const execute = vi.fn(async () => {
    const result = results.shift();
    if (result instanceof Error) throw result;
    return result ?? [[]];
  });
  const db = {
    execute,
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  return {
    db,
    storage: { delete: vi.fn(async () => undefined) },
    request: {
      id: 17,
      externalId: 'acr_team_work_items',
      userId: 42,
      userExternalId: 'usr_team_work_items',
    },
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

describe('team work-item account closure boundary', () => {
  it('blocks the sole accepted responsible until the work item is reassigned', async () => {
    const context = contextWithResults([[[{ id: 7 }]]]);

    await expect(assertTeamWorkItemClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    expect(compiledSql(context.db.execute.mock.calls[0]?.[0])).toContain(
      "role = 'responsible' and assignment.status = 'accepted'",
    );
    expect(compiledSql(context.db.execute.mock.calls[0]?.[0])).toContain(
      "work_item.status not in ('accepted', 'completed', 'cancelled', 'rejected_final', 'archived')",
    );
  });

  it('blocks unresolved direct or delegated review responsibility', async () => {
    const direct = contextWithResults([[[]], [[{ id: 8 }]]]);
    await expect(assertTeamWorkItemClosureSafe(direct)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    const directReviewSql = compiledSql(direct.db.execute.mock.calls[1]?.[0]);
    expect(directReviewSql).toContain(
      "work_item.status in ('submitted', 'resubmitted', 'in_review')",
    );
    expect(directReviewSql).toContain('contract.approver_user_id = ?');

    const delegated = contextWithResults([[[]], [[]], [[{ id: 9 }]]]);
    await expect(assertTeamWorkItemClosureSafe(delegated)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    const delegatedReviewSql = compiledSql(delegated.db.execute.mock.calls[2]?.[0]);
    expect(delegatedReviewSql).toContain('delegation.delegate_user_id = ?');
    expect(delegatedReviewSql).toContain('delegation.revoked_at is null');
  });

  it('blocks unresolved arbitration responsibility', async () => {
    const context = contextWithResults([[[]], [[]], [[]], [[{ id: 10 }]]]);

    await expect(assertTeamWorkItemClosureSafe(context)).rejects.toMatchObject({
      code: 'CAPABILITY_CHANGED',
    });
    const arbitrationSql = compiledSql(context.db.execute.mock.calls[3]?.[0]);
    expect(arbitrationSql).toContain("appeal.status in ('appeal_open', 'appeal_reviewing')");
    expect(arbitrationSql).toContain('contract.arbitrator_user_id = ?');
  });

  it('allows cleanup when no unresolved team responsibility remains', async () => {
    const context = contextWithResults([[[]], [[]], [[]], [[]]]);

    await expect(assertTeamWorkItemClosureSafe(context)).resolves.toBeUndefined();
  });

  it('does not classify terminal work items as active responsibility', async () => {
    const context = contextWithResults([[[]], [[]], [[]], [[]]]);
    await assertTeamWorkItemClosureSafe(context);
    const responsibleSql = compiledSql(context.db.execute.mock.calls[0]?.[0]);
    expect(responsibleSql).toContain(
      "not in ('accepted', 'completed', 'cancelled', 'rejected_final', 'archived')",
    );
    expect(responsibleSql).not.toContain("work_item.status <> 'archived'");
  });

  it('deactivates non-responsible assignments in a locked transaction and writes an event', async () => {
    const context = contextWithResults([
      [[{ id: 21 }]],
      [[{ id: 100 }]],
      [[{ id: 21 }]],
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    const target = TEAM_WORK_ITEM_CLOSURE_TARGETS.assignments;
    const ids = await target.selectOwnedIds(context, 100);
    const affected = await target.deleteOwnedIds(context, ids);

    expect(ids).toEqual([21]);
    expect(affected).toBe(1);
    expect(context.db.transaction).toHaveBeenCalledTimes(1);
    const statements = context.db.execute.mock.calls.map(([query]) => compiledSql(query));
    expect(statements[1]).toContain('from team_work_items work_item');
    expect(statements[1]).toContain('for update');
    expect(statements[2]).toContain('from team_work_item_assignments assignment');
    expect(statements[2]).toContain('for update');
    expect(statements[3]).toContain("role = 'responsible'");
    expect(statements[4]).toContain("set status = 'removed'");
    expect(statements[5]).toContain('insert into team_work_item_events');
  });

  it('revokes review delegations without deleting their historical facts', async () => {
    const context = contextWithResults([
      [[{ id: 31 }]],
      [[{ id: 200 }]],
      [[{ id: 31 }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    const target = TEAM_WORK_ITEM_CLOSURE_TARGETS.reviewDelegations;
    const ids = await target.selectOwnedIds(context, 100);
    const affected = await target.deleteOwnedIds(context, ids);

    expect(ids).toEqual([31]);
    expect(affected).toBe(1);
    const statements = context.db.execute.mock.calls.map(([query]) => compiledSql(query));
    expect(statements[1]).toContain('from projects project');
    expect(statements[1]).toContain('for update');
    expect(statements[2]).toContain('from team_task_review_delegations delegation');
    expect(statements[2]).toContain('for update');
    expect(statements[3]).toContain('set revoked_at = greatest');
    expect(statements[4]).toContain('insert into team_project_planning_events');
  });

  it('propagates event failure from the transaction boundary', async () => {
    const eventFailure = new Error('forced event failure');
    const context = contextWithResults([
      [[{ id: 21 }]],
      [[{ id: 100 }]],
      [[{ id: 21 }]],
      [[]],
      [{ affectedRows: 1 }],
      eventFailure,
    ]);
    const target = TEAM_WORK_ITEM_CLOSURE_TARGETS.assignments;
    const ids = await target.selectOwnedIds(context, 100);

    await expect(target.deleteOwnedIds(context, ids)).rejects.toBe(eventFailure);
    expect(context.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('locks and rejects active responsibility residue before final tombstoning', async () => {
    const clean = contextWithResults([[[]], [[]], [[]], [[]], [[]]]);
    await expect(
      assertNoActiveTeamWorkItemResponsibilitiesForFinalization(clean.db as never, 42),
    ).resolves.toBeUndefined();
    expect(clean.db.execute).toHaveBeenCalledTimes(5);
    for (const [query] of clean.db.execute.mock.calls) {
      expect(compiledSql(query)).toContain('for update');
    }

    const unsafe = contextWithResults([[[{ id: 7 }]]]);
    await expect(
      assertNoActiveTeamWorkItemResponsibilitiesForFinalization(unsafe.db as never, 42),
    ).rejects.toMatchObject({ code: 'CAPABILITY_CHANGED' });
  });

  it('deletes private objects and minimizes sources retained by team business facts in bounded pages', async () => {
    const fileContext = contextWithResults([
      [[{ id: 51, storagePath: 'private/task-file.pdf' }]],
      [{ affectedRows: 1 }],
    ]);
    await expect(minimizeRetainedTeamWorkSources(fileContext, 1)).resolves.toBe(1);
    expect(fileContext.storage.delete).toHaveBeenCalledWith(
      'private/task-file.pdf',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(compiledSql(fileContext.db.execute.mock.calls[0]?.[0])).toContain('limit ?');
    expect(compiledSql(fileContext.db.execute.mock.calls[1]?.[0])).toContain("storage_path = ''");

    const artifactContext = contextWithResults([
      [[]],
      [[{ id: 61, r2Key: 'private/evidence.json' }]],
      [{ affectedRows: 1 }],
    ]);
    await expect(minimizeRetainedTeamWorkSources(artifactContext, 1)).resolves.toBe(1);
    expect(artifactContext.storage.delete).toHaveBeenCalledWith(
      'private/evidence.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(compiledSql(artifactContext.db.execute.mock.calls[2]?.[0])).toContain(
      'raw_excerpt = null',
    );

    const taskContext = contextWithResults([[[]], [[]], [[{ id: 71 }]], [{ affectedRows: 1 }]]);

    await expect(minimizeRetainedTeamWorkSources(taskContext, 1)).resolves.toBe(1);
    const taskUpdate = compiledSql(taskContext.db.execute.mock.calls[3]?.[0]);
    expect(taskUpdate).toContain("intent = '[account closed]'");
    expect(taskUpdate).toContain('source_context = null');
    expect(taskUpdate).toContain('original_summary = null');
    expect(compiledSql(taskContext.db.execute.mock.calls[2]?.[0])).toContain('result is not null');
  });

  it('scrubs a retained AI task even when its user intent equals the old sentinel', async () => {
    const context = contextWithResults([[[]], [[]], [[{ id: 81 }]], [{ affectedRows: 1 }]]);
    await expect(minimizeRetainedTeamWorkSources(context, 100)).resolves.toBe(1);
    const selection = compiledSql(context.db.execute.mock.calls[2]?.[0]);
    expect(selection).toContain("task.intent <> '[account closed]'");
    expect(selection).toContain('or task.result is not null');
  });

  it('excludes execution tasks retained by immutable AI contribution facts', async () => {
    const context = contextWithResults([[[{ id: 71 }]], [{ affectedRows: 1 }]]);
    const target = TEAM_WORK_ITEM_CLOSURE_TARGETS.unretainedTasks;
    await expect(target.selectOwnedIds(context, 100)).resolves.toEqual([71]);
    await expect(target.deleteOwnedIds(context, [71])).resolves.toBe(1);
    for (const [query] of context.db.execute.mock.calls) {
      expect(compiledSql(query)).toContain('not exists');
      expect(compiledSql(query)).toContain('team_ai_contributions');
    }
  });

  it('classifies milestone and dependency creator facts as anonymized retention', async () => {
    const retained = contextWithResults([[[{ id: 91 }]]]);
    await expect(hasRetainedTeamWorkFacts(retained.db as never, 42)).resolves.toBe(true);
    const query = compiledSql(retained.db.execute.mock.calls[0]?.[0]);
    expect(query).toContain('from team_milestones where created_by_user_id = ?');
    expect(query).toContain('from team_work_item_dependencies where created_by_user_id = ?');

    const absent = contextWithResults([[[]]]);
    await expect(hasRetainedTeamWorkFacts(absent.db as never, 42)).resolves.toBe(false);
  });
});
