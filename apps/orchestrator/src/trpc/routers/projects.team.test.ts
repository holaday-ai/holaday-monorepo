import { getTableConfig } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema/index.js';

const { teamProjectsEnabledFor } = vi.hoisted(() => ({
  teamProjectsEnabledFor: vi.fn<(userId: string) => boolean>(),
}));

vi.mock('../../organizations/team-project-access.js', () => ({
  isTeamProjectsEnabledFor: teamProjectsEnabledFor,
}));

import { __projectsRouterInternals, projectsRouter } from './projects.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

type ProjectRow = {
  id: number;
  externalId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function tableName(table: unknown): string {
  if (!table || typeof table !== 'object') return '';
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : '';
}

function makePersonalDb() {
  const projectRows: ProjectRow[] = [
    {
      id: 10,
      externalId: 'prj_personal',
      name: 'Personal plan',
      description: 'Legacy project',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    },
  ];
  const selectedTables: string[] = [];
  const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
  const updated: Array<{ table: string; values: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const personalSnapshot = {
    projectId: 10,
    projectExternalId: 'prj_personal',
    projectOwnerUserId: 7,
    actorUserId: 7,
    actorExternalId: 'usr_personal',
    organizationInternalId: null,
    organizationRowId: null,
    organizationExternalId: null,
    organizationName: null,
    organizationStatus: null,
    teamProjectsEnabled: null,
    organizationMemberOrganizationId: null,
    organizationMemberUserId: null,
    organizationMemberRole: null,
    organizationMemberStatus: null,
    projectMemberProjectId: null,
    projectMemberUserId: null,
    projectMemberRole: null,
    projectMemberStatus: null,
  };

  const db = {
    select() {
      return {
        from(table: unknown) {
          const name = tableName(table);
          const hasResolvedUser = selectedTables.includes('users');
          selectedTables.push(name);
          const result =
            name === 'users'
              ? [{ id: 7 }]
              : name === 'projects'
                ? hasResolvedUser
                  ? projectRows
                  : [personalSnapshot]
                : name === 'tasks'
                  ? [{ projectId: 10, n: 3 }]
                  : [];
          const builder = {
            innerJoin() {
              return builder;
            },
            leftJoin() {
              return builder;
            },
            where() {
              return builder;
            },
            orderBy: async () => result,
            limit: async () => result.slice(0, 1),
            groupBy: async () => result,
          };
          return builder;
        },
      };
    },
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          inserted.push({ table: tableName(table), values });
          return [{ affectedRows: 1, insertId: 11 }];
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where() {
              updated.push({ table: tableName(table), values });
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        async where() {
          deleted.push(tableName(table));
          return [{ affectedRows: 1 }];
        },
      };
    },
    async transaction<Result>(callback: (executor: unknown) => Promise<Result>) {
      const tx = {
        select() {
          return {
            from() {
              const builder = {
                innerJoin() {
                  return builder;
                },
                leftJoin() {
                  return builder;
                },
                where() {
                  return builder;
                },
                for() {
                  return builder;
                },
                limit: async () => [
                  { id: 10, externalId: 'prj_personal', userId: 7, organizationId: null },
                ],
              };
              return builder;
            },
          };
        },
        update: db.update,
        delete: db.delete,
      };
      return callback(tx);
    },
  };

  return { db, selectedTables, inserted, updated, deleted };
}

function makeCaller(db: unknown) {
  return projectsRouter.createCaller({ db, userId: 'usr_personal', logger: fakeLogger } as never);
}

function makeTeamListDb() {
  const selectedTables: string[] = [];
  const teamRow = {
    id: 20,
    externalId: 'prj_team',
    name: 'Launch',
    description: 'Team launch',
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    scope: 'organization',
    organizationId: 'org_design',
    organizationName: 'Design',
    memberRole: 'lead',
    taskCount: 4,
  };
  const tx = {
    select() {
      return {
        from(table: unknown) {
          const name = tableName(table);
          selectedTables.push(name);
          const rows =
            name === 'users'
              ? [{ id: 7 }]
              : name === 'organization_members'
                ? [
                    {
                      organizationInternalId: 30,
                      organizationExternalId: 'org_design',
                      organizationStatus: 'active',
                      teamProjectsEnabled: true,
                      actorUserId: 7,
                      actorExternalId: 'usr_member',
                      organizationRole: 'manager',
                      organizationMemberStatus: 'active',
                    },
                  ]
                : name === 'projects'
                  ? [teamRow]
                  : [];
          const builder = {
            innerJoin() {
              return builder;
            },
            leftJoin() {
              return builder;
            },
            where() {
              return builder;
            },
            groupBy() {
              return builder;
            },
            for() {
              return builder;
            },
            orderBy: async () => rows,
            limit: async () => rows.slice(0, 1),
          };
          return builder;
        },
      };
    },
  };
  const db = {
    ...tx,
    async transaction<Result>(callback: (executor: typeof tx) => Promise<Result>) {
      return callback(tx);
    },
  };
  return { db, selectedTables };
}

function makeTeamCreateDb(
  options: {
    projectAffectedRows?: number;
    memberAffectedRows?: number;
    organizationRole?: string;
  } = {},
) {
  const events: string[] = [];
  const inserts: Array<{ table: string; values: Record<string, unknown>; executor: 'tx' }> = [];
  const actor = {
    organizationInternalId: 30,
    organizationExternalId: 'org_design',
    organizationName: 'Design',
    organizationStatus: 'active',
    teamProjectsEnabled: true,
    actorUserId: 7,
    actorExternalId: 'usr_member',
    organizationRole: options.organizationRole ?? 'manager',
    organizationMemberStatus: 'active',
  };
  let insertNumber = 0;
  const tx = {
    select() {
      return {
        from(table: unknown) {
          const selectedTable = tableName(table);
          const builder = {
            innerJoin() {
              return builder;
            },
            where() {
              return builder;
            },
            for() {
              return builder;
            },
            limit: async () => {
              events.push(`tx:select:${selectedTable}`);
              return [actor];
            },
          };
          return builder;
        },
      };
    },
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          const name = tableName(table);
          inserts.push({ table: name, values, executor: 'tx' });
          events.push(`tx:insert:${name}`);
          insertNumber += 1;
          if (insertNumber === 1) {
            return [{ insertId: 40, affectedRows: options.projectAffectedRows ?? 1 }];
          }
          return [{ insertId: 50, affectedRows: options.memberAffectedRows ?? 1 }];
        },
      };
    },
  };
  const db = {
    select: tx.select,
    async transaction<Result>(callback: (executor: typeof tx) => Promise<Result>) {
      events.push('root:transaction:begin');
      try {
        const result = await callback(tx);
        events.push('root:transaction:commit');
        return result;
      } catch (error) {
        events.push('root:transaction:rollback');
        throw error;
      }
    },
  };
  return { db, tx, inserts, events };
}

const readableTeamSnapshot = {
  projectId: 20,
  projectExternalId: 'prj_team',
  projectOwnerUserId: 7,
  actorUserId: 7,
  actorExternalId: 'usr_member',
  organizationInternalId: 30,
  organizationRowId: 30,
  organizationExternalId: 'org_design',
  organizationName: 'Design',
  organizationStatus: 'active',
  teamProjectsEnabled: true,
  organizationMemberOrganizationId: 30,
  organizationMemberUserId: 7,
  organizationMemberRole: 'manager',
  organizationMemberStatus: 'active',
  projectMemberProjectId: 20,
  projectMemberUserId: 7,
  projectMemberRole: 'lead',
  projectMemberStatus: 'active',
};

function makeTeamGetDb(snapshot = readableTeamSnapshot) {
  const detail = {
    externalId: 'prj_team',
    name: 'Launch',
    description: 'Team launch',
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    taskCount: 4,
  };
  const results = [[snapshot], [detail]];
  const tx = {
    select() {
      const rows = results.shift() ?? [];
      return {
        from() {
          const builder = {
            innerJoin() {
              return builder;
            },
            leftJoin() {
              return builder;
            },
            where() {
              return builder;
            },
            groupBy() {
              return builder;
            },
            for() {
              return builder;
            },
            limit: async () => rows,
          };
          return builder;
        },
      };
    },
  };
  const db = {
    ...tx,
    async transaction<Result>(callback: (executor: typeof tx) => Promise<Result>) {
      return callback(tx);
    },
  };
  return { db };
}

function makeTeamMembersDb() {
  const rows = [
    {
      projectMemberId: 'pmem_member',
      userId: 'usr_collaborator',
      displayName: 'Mina',
      avatarUrl: 'https://cdn.example/mina.png',
      role: 'member',
      email: 'must-not-leak@example.test',
      phone: 'must-not-leak',
      internalUserId: 99,
    },
  ];
  const results = [[readableTeamSnapshot], rows];
  const tx = {
    select() {
      const result = results.shift() ?? [];
      return {
        from() {
          const builder = {
            innerJoin() {
              return builder;
            },
            leftJoin() {
              return builder;
            },
            where() {
              return builder;
            },
            for() {
              return builder;
            },
            orderBy: async () => result,
            limit: async () => result,
          };
          return builder;
        },
      };
    },
  };
  const db = {
    ...tx,
    async transaction<Result>(callback: (executor: typeof tx) => Promise<Result>) {
      return callback(tx);
    },
  };
  return { db };
}

const targetOrganizationMember = {
  id: 31,
  externalId: 'omem_target',
  organizationId: 30,
  userId: 9,
  status: 'active',
  userExternalId: 'usr_collaborator',
  displayName: 'Mina',
  avatarUrl: null,
};
const targetProjectMember = {
  id: 41,
  externalId: 'pmem_target',
  projectId: 20,
  userId: 9,
  role: 'member',
  status: 'active',
};

function canonicalRouterMutationReads(
  snapshot = readableTeamSnapshot,
  memberships: unknown[] = [
    {
      ...targetProjectMember,
      id: 40,
      externalId: 'pmem_actor',
      userId: 7,
      role: snapshot.projectMemberRole,
      status: snapshot.projectMemberStatus,
    },
  ],
): [unknown[], unknown[], unknown[], unknown[], unknown[]] {
  return [
    [snapshot],
    [
      {
        id: 30,
        externalId: 'org_design',
        name: 'Design',
        status: 'active',
        teamProjectsEnabled: true,
      },
    ],
    [
      {
        id: 30,
        externalId: 'omem_actor',
        organizationId: 30,
        userId: 7,
        role: snapshot.organizationMemberRole,
        status: snapshot.organizationMemberStatus,
      },
    ],
    [{ id: 20, externalId: 'prj_team', userId: 7, organizationId: 30 }],
    memberships,
  ];
}

function canonicalRouterAddReads(): unknown[][] {
  const [candidate, organization, actorMember, project, memberships] =
    canonicalRouterMutationReads();
  return [candidate, organization, actorMember, [targetOrganizationMember], project, memberships];
}

function makeAccessMutationDb(selectResults: unknown[][], affectedRows: number[] = []) {
  const writes: Array<{
    kind: 'insert' | 'update' | 'delete';
    table: string;
    values?: Record<string, unknown>;
  }> = [];
  const take = () => selectResults.shift() ?? [];
  const result = () => [{ affectedRows: affectedRows.shift() ?? 1 }];
  const tx = {
    select() {
      return {
        from() {
          const rows = take();
          const builder = {
            innerJoin() {
              return builder;
            },
            leftJoin() {
              return builder;
            },
            where() {
              return builder;
            },
            for() {
              return builder;
            },
            orderBy() {
              return builder;
            },
            limit: async () => rows,
          };
          Object.defineProperty(builder, 'then', {
            value: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
          });
          return builder;
        },
      };
    },
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          writes.push({ kind: 'insert', table: tableName(table), values });
          return result();
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where() {
              writes.push({ kind: 'update', table: tableName(table), values });
              return result();
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        async where() {
          writes.push({ kind: 'delete', table: tableName(table) });
          return result();
        },
      };
    },
  };
  const db = {
    select: tx.select,
    async transaction<Result>(callback: (executor: typeof tx) => Promise<Result>) {
      return callback(tx);
    },
  };
  return { db, writes };
}

function makeConsistentReadDb(selectResults: unknown[][]) {
  const events: string[] = [];
  const transactionConfigs: unknown[] = [];
  const take = () => selectResults.shift() ?? [];
  const tx = {
    select() {
      return {
        from(table: unknown) {
          const selectedTable = tableName(table);
          const builder = {
            innerJoin() {
              return builder;
            },
            leftJoin() {
              return builder;
            },
            where() {
              return builder;
            },
            groupBy() {
              return builder;
            },
            for() {
              return builder;
            },
            limit: async () => {
              events.push(`tx:select:${selectedTable}`);
              return take();
            },
            orderBy: async () => {
              events.push(`tx:select:${selectedTable}`);
              return take();
            },
          };
          return builder;
        },
      };
    },
  };
  const db = {
    select() {
      events.push('root:select:forbidden');
      throw new Error('consistent team reads must not use the root executor');
    },
    async transaction<Result>(
      callback: (executor: typeof tx) => Promise<Result>,
      config?: unknown,
    ) {
      transactionConfigs.push(config);
      events.push('root:transaction:begin');
      try {
        const value = await callback(tx);
        events.push('root:transaction:commit');
        return value;
      } catch (error) {
        events.push('root:transaction:rollback');
        throw error;
      }
    },
  };
  return { db, events, transactionConfigs };
}

describe('projects router personal compatibility', () => {
  beforeEach(() => {
    teamProjectsEnabledFor.mockReset();
    teamProjectsEnabledFor.mockReturnValue(true);
  });

  it('keeps no-input list on the personal-only query path and exact legacy DTO', async () => {
    const fake = makePersonalDb();

    await expect(makeCaller(fake.db).list()).resolves.toEqual([
      {
        projectId: 'prj_personal',
        name: 'Personal plan',
        description: 'Legacy project',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        taskCount: 3,
      },
    ]);
    expect(fake.selectedTables).toEqual(['users', 'projects', 'tasks']);
    expect(fake.selectedTables).not.toContain('organizations');
    expect(fake.selectedTables).not.toContain('organization_members');
    expect(fake.selectedTables).not.toContain('project_members');
    expect(teamProjectsEnabledFor).not.toHaveBeenCalled();
  });

  it('compiles the personal list with creator binding and an explicit null organization scope', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __projectsRouterInternals.buildPersonalProjectListQuery(db, 7).toSQL();
    const compiled = query.sql.toLowerCase().replace(/\s+/g, ' ').trim();

    expect(compiled).toContain('`projects`.`user_id` = ?');
    expect(compiled).toContain('`projects`.`organization_id` is null');
    expect(query.params).toEqual([7]);
  });

  it('keeps personal create output and does not assign an organization', async () => {
    const fake = makePersonalDb();
    const result = await makeCaller(fake.db).create({
      name: '  Personal notes  ',
      description: 'Private',
    });

    expect(result).toEqual({
      projectId: expect.stringMatching(/^prj_/),
      name: 'Personal notes',
    });
    expect(fake.inserted).toEqual([
      {
        table: 'projects',
        values: {
          externalId: result.projectId,
          userId: 7,
          name: 'Personal notes',
          description: 'Private',
        },
      },
    ]);
  });

  it('keeps personal rename and delete response semantics', async () => {
    const renameFake = makePersonalDb();
    const deleteFake = makePersonalDb();

    await expect(
      makeCaller(renameFake.db).rename({ projectId: 'prj_personal', name: '  Renamed  ' }),
    ).resolves.toEqual({ ok: true, projectId: 'prj_personal', name: 'Renamed' });
    await expect(makeCaller(deleteFake.db).delete({ projectId: 'prj_personal' })).resolves.toEqual({
      ok: true,
      projectId: 'prj_personal',
    });
    expect(renameFake.updated).toEqual([{ table: 'projects', values: { name: 'Renamed' } }]);
    expect(deleteFake.deleted).toEqual(['projects']);
  });
});

describe('projects router team workspaces', () => {
  beforeEach(() => {
    teamProjectsEnabledFor.mockReset();
    teamProjectsEnabledFor.mockReturnValue(true);
  });

  it('lists only the requested active team membership with the team DTO', async () => {
    const fake = makeTeamListDb();
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (caller.list as unknown as (input: { organizationId: string }) => Promise<unknown>)({
        organizationId: 'org_design',
      }),
    ).resolves.toEqual([
      {
        projectId: 'prj_team',
        name: 'Launch',
        description: 'Team launch',
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
        updatedAt: new Date('2026-08-11T00:00:00.000Z'),
        taskCount: 4,
        scope: 'organization',
        organizationId: 'org_design',
        organizationName: 'Design',
        memberRole: 'lead',
      },
    ]);
    expect(teamProjectsEnabledFor).toHaveBeenCalledWith('usr_member');
    expect(fake.selectedTables).toEqual(['organization_members', 'projects']);
  });

  it('returns NOT_FOUND instead of an empty tenant oracle for an unavailable organization', async () => {
    const tx = {
      select() {
        return {
          from() {
            const builder = {
              innerJoin() {
                return builder;
              },
              leftJoin() {
                return builder;
              },
              where() {
                return builder;
              },
              groupBy() {
                return builder;
              },
              for() {
                return builder;
              },
              orderBy: async () => [],
              limit: async () => [],
            };
            return builder;
          },
        };
      },
    };
    const db = {
      ...tx,
      async transaction<Result>(callback: (executor: typeof tx) => Promise<Result>) {
        return callback(tx);
      },
    };
    const caller = projectsRouter.createCaller({
      db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (caller.list as unknown as (input: { organizationId: string }) => Promise<unknown>)({
        organizationId: 'org_hidden',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('runs organization authorization and list payload on one transaction executor', async () => {
    const membership = {
      organizationInternalId: 30,
      organizationExternalId: 'org_design',
      organizationStatus: 'active',
      teamProjectsEnabled: true,
      actorUserId: 7,
      actorExternalId: 'usr_member',
      organizationRole: 'manager',
      organizationMemberStatus: 'active',
    };
    const project = {
      externalId: 'prj_team',
      name: 'Launch',
      description: null,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
      organizationId: 'org_design',
      organizationName: 'Design',
      memberRole: 'lead',
      taskCount: 0,
    };
    const fake = makeConsistentReadDb([[membership], [project]]);
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (caller.list as unknown as (input: { organizationId: string }) => Promise<unknown>)({
        organizationId: 'org_design',
      }),
    ).resolves.toHaveLength(1);
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:organization_members',
      'tx:select:projects',
      'root:transaction:commit',
    ]);
  });

  it.each([
    [
      'get',
      [
        [readableTeamSnapshot],
        [
          {
            externalId: 'prj_team',
            name: 'Launch',
            description: null,
            createdAt: new Date('2026-08-10T00:00:00.000Z'),
            updatedAt: new Date('2026-08-11T00:00:00.000Z'),
            taskCount: 0,
          },
        ],
      ],
    ],
    [
      'members',
      [
        [readableTeamSnapshot],
        [
          {
            projectMemberId: 'pmem_member',
            userId: 'usr_collaborator',
            displayName: 'Mina',
            avatarUrl: null,
            role: 'member',
          },
        ],
      ],
    ],
  ] as const)(
    'runs %s authorization and payload on one transaction executor',
    async (procedure, results) => {
      const fake = makeConsistentReadDb(results.map((rows) => [...rows]));
      const caller = projectsRouter.createCaller({
        db: fake.db,
        userId: 'usr_member',
        logger: fakeLogger,
      } as never) as unknown as Record<string, (input: { projectId: string }) => Promise<unknown>>;

      await expect(caller[procedure]?.({ projectId: 'prj_team' })).resolves.toBeDefined();
      expect(fake.events[0]).toBe('root:transaction:begin');
      expect(fake.events).not.toContain('root:select:forbidden');
      expect(fake.events.at(-1)).toBe('root:transaction:commit');
      expect(fake.transactionConfigs).toEqual([
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ]);
    },
  );

  it('does not fetch an organization list payload after the locked membership recheck disappears', async () => {
    const fake = makeConsistentReadDb([[], [{ externalId: 'prj_must_not_leak' }]]);
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (caller.list as unknown as (input: { organizationId: string }) => Promise<unknown>)({
        organizationId: 'org_design',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:organization_members',
      'root:transaction:rollback',
    ]);
  });

  it.each([
    ['get', { ...readableTeamSnapshot, teamProjectsEnabled: false }],
    ['members', { ...readableTeamSnapshot, projectMemberStatus: 'inactive' }],
  ] as const)(
    'does not fetch a %s payload after the locked authorization row becomes invalid',
    async (procedure, snapshot) => {
      const fake = makeConsistentReadDb([[snapshot], [{ externalId: 'must_not_leak' }]]);
      const caller = projectsRouter.createCaller({
        db: fake.db,
        userId: 'usr_member',
        logger: fakeLogger,
      } as never) as unknown as Record<string, (input: { projectId: string }) => Promise<unknown>>;

      await expect(caller[procedure]?.({ projectId: 'prj_team' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(fake.events).toEqual([
        'root:transaction:begin',
        'tx:select:projects',
        'root:transaction:rollback',
      ]);
    },
  );

  it('compiles the team list with every tenant, rollout, and membership predicate', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __projectsRouterInternals
      .buildTeamProjectListQuery(db, 'usr_member', 'org_design')
      .toSQL();
    const compiled = query.sql.toLowerCase().replace(/\s+/g, ' ').trim();

    expect(compiled).toContain('`organizations`.`external_id` = ?');
    expect(compiled).toContain('`organizations`.`status` = ?');
    expect(compiled).toContain('`organizations`.`team_projects_enabled` = ?');
    expect(compiled).toContain('`users`.`external_id` = ?');
    expect(compiled).toContain('`organization_members`.`organization_id` = `organizations`.`id`');
    expect(compiled).toContain('`organization_members`.`user_id` = `users`.`id`');
    expect(compiled).toContain('`organization_members`.`status` = ?');
    expect(compiled).toContain('`project_members`.`project_id` = `projects`.`id`');
    expect(compiled).toContain('`project_members`.`user_id` = `users`.`id`');
    expect(compiled).toContain('`project_members`.`status` = ?');
    expect(query.params).toEqual(['org_design', 'active', true, 'usr_member', 'active', 'active']);
  });

  it('compiles team create, detail, and member queries with exact scope parameters', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const creator = __projectsRouterInternals
      .buildTeamProjectCreatorQuery(db, 'usr_member', 'org_design')
      .toSQL();
    const detail = __projectsRouterInternals.buildProjectDetailQuery(db, 20, 'prj_team').toSQL();
    const members = __projectsRouterInternals.buildActiveProjectMembersQuery(db, 20).toSQL();
    const creatorLead = __projectsRouterInternals
      .buildTeamProjectCreatorMembershipInsert(db, {
        externalId: 'pmem_generated',
        projectId: 20,
        userId: 7,
      })
      .toSQL();
    const projectInsert = __projectsRouterInternals
      .buildTeamProjectInsert(db, {
        externalId: 'prj_generated',
        userId: 7,
        organizationId: 30,
        name: 'Launch',
        description: 'Team launch',
      })
      .toSQL();
    const creatorSql = creator.sql.toLowerCase().replace(/\s+/g, ' ').trim();
    const memberSql = members.sql.toLowerCase().replace(/\s+/g, ' ').trim();

    expect(creatorSql).toContain('`users`.`external_id` = ?');
    expect(creatorSql).toContain('`organizations`.`id` = `organization_members`.`organization_id`');
    expect(creatorSql).toContain('`users`.`id` = `organization_members`.`user_id`');
    expect(creatorSql).toContain('`organization_members`.`status` = ?');
    expect(creatorSql).toContain('`organizations`.`external_id` = ?');
    expect(creatorSql).toContain('`organizations`.`status` = ?');
    expect(creatorSql).toContain('`organizations`.`team_projects_enabled` = ?');
    expect(creatorSql).toContain('for update');
    expect(creator.params).toEqual(['org_design', 'active', true, 'usr_member', 'active', 1]);
    expect(detail.params).toEqual([20, 'prj_team', 1]);
    expect(memberSql).toContain('`project_members`.`project_id` = ?');
    expect(memberSql).toContain('`project_members`.`status` = ?');
    expect(members.params).toEqual([20, 'active']);
    expect(creatorLead.sql).toContain('insert into `project_members`');
    expect(creatorLead.params).toEqual(['pmem_generated', 20, 7, 'lead', 'active']);
    expect(projectInsert.sql).toContain('insert into `projects`');
    expect(projectInsert.params).toEqual(['prj_generated', 7, 30, 'Launch', 'Team launch']);
  });

  it('fails every team-only procedure closed before database access when the user gate is off', async () => {
    teamProjectsEnabledFor.mockReturnValue(false);
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('database must not be touched while the team gate is off');
        },
      },
    );
    const caller = projectsRouter.createCaller({
      db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);
    const actions = [
      (caller.list as unknown as (input: { organizationId: string }) => Promise<unknown>)({
        organizationId: 'org_design',
      }),
      (
        caller.create as unknown as (input: {
          organizationId: string;
          name: string;
        }) => Promise<unknown>
      )({ organizationId: 'org_design', name: 'Launch' }),
      (caller as unknown as { get: (input: { projectId: string }) => Promise<unknown> }).get({
        projectId: 'prj_team',
      }),
      (
        caller as unknown as { members: (input: { projectId: string }) => Promise<unknown> }
      ).members({ projectId: 'prj_team' }),
      (
        caller as unknown as {
          addMember: (input: {
            projectId: string;
            organizationMemberId: string;
            role: 'member';
          }) => Promise<unknown>;
        }
      ).addMember({
        projectId: 'prj_team',
        organizationMemberId: 'omem_target',
        role: 'member',
      }),
      (
        caller as unknown as {
          removeMember: (input: {
            projectId: string;
            projectMemberId: string;
          }) => Promise<unknown>;
        }
      ).removeMember({ projectId: 'prj_team', projectMemberId: 'pmem_target' }),
    ];

    await Promise.all(
      actions.map((action) => expect(action).rejects.toMatchObject({ code: 'NOT_FOUND' })),
    );
  });

  it('hides team rename/delete when the user gate is off while preserving personal mutation', async () => {
    teamProjectsEnabledFor.mockReturnValue(false);
    const hiddenRename = makeAccessMutationDb([[readableTeamSnapshot]]);
    const hiddenDelete = makeAccessMutationDb([[readableTeamSnapshot]]);
    const personalSnapshot = {
      ...readableTeamSnapshot,
      projectId: 10,
      projectExternalId: 'prj_personal',
      projectOwnerUserId: 7,
      organizationInternalId: null,
      organizationRowId: null,
      organizationExternalId: null,
      organizationName: null,
      organizationStatus: null,
      teamProjectsEnabled: null,
      organizationMemberOrganizationId: null,
      organizationMemberUserId: null,
      organizationMemberRole: null,
      organizationMemberStatus: null,
      projectMemberProjectId: null,
      projectMemberUserId: null,
      projectMemberRole: null,
      projectMemberStatus: null,
    };
    const personalRename = makeAccessMutationDb(
      [
        [personalSnapshot],
        [personalSnapshot],
        [{ id: 10, externalId: 'prj_personal', userId: 7, organizationId: null }],
      ],
      [1],
    );
    const renameCaller = projectsRouter.createCaller({
      db: hiddenRename.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);
    const deleteCaller = projectsRouter.createCaller({
      db: hiddenDelete.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);
    const personalCaller = projectsRouter.createCaller({
      db: personalRename.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      renameCaller.rename({ projectId: 'prj_team', name: 'Hidden' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteCaller.delete({ projectId: 'prj_team' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      personalCaller.rename({ projectId: 'prj_personal', name: 'Personal' }),
    ).resolves.toEqual({ ok: true, projectId: 'prj_personal', name: 'Personal' });
    expect(hiddenRename.writes).toEqual([]);
    expect(hiddenDelete.writes).toEqual([]);
    expect(personalRename.writes).toEqual([
      { kind: 'update', table: 'projects', values: { name: 'Personal' } },
    ]);
  });

  it('creates the project and creator lead membership in one transaction', async () => {
    const fake = makeTeamCreateDb();
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    const result = await (
      caller.create as unknown as (input: {
        organizationId: string;
        name: string;
        description?: string;
      }) => Promise<Record<string, unknown>>
    )({ organizationId: 'org_design', name: '  Launch  ', description: 'Team launch' });

    expect(result).toEqual({
      projectId: expect.stringMatching(/^prj_/),
      name: 'Launch',
      scope: 'organization',
      organizationId: 'org_design',
      organizationName: 'Design',
      memberRole: 'lead',
    });
    expect(fake.inserts).toEqual([
      {
        table: 'projects',
        executor: 'tx',
        values: {
          externalId: result.projectId,
          userId: 7,
          organizationId: 30,
          name: 'Launch',
          description: 'Team launch',
        },
      },
      {
        table: 'project_members',
        executor: 'tx',
        values: {
          externalId: expect.stringMatching(/^pmem_/),
          projectId: 40,
          userId: 7,
          role: 'lead',
          status: 'active',
        },
      },
    ]);
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:organizations',
      'tx:select:organization_members',
      'tx:insert:projects',
      'tx:insert:project_members',
      'root:transaction:commit',
    ]);
  });

  it('rolls back team creation when the creator membership insert is not exact', async () => {
    const fake = makeTeamCreateDb({ memberAffectedRows: 0 });
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller.create as unknown as (input: {
          organizationId: string;
          name: string;
        }) => Promise<unknown>
      )({ organizationId: 'org_design', name: 'Launch' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.events.at(-1)).toBe('root:transaction:rollback');
  });

  it('rolls back team creation when the project insert affected-row count is not exact', async () => {
    const fake = makeTeamCreateDb({ projectAffectedRows: 0 });
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller.create as unknown as (input: {
          organizationId: string;
          name: string;
        }) => Promise<unknown>
      )({ organizationId: 'org_design', name: 'Launch' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:organizations',
      'tx:select:organization_members',
      'tx:insert:projects',
      'root:transaction:rollback',
    ]);
  });

  it('denies an established organization member without create permission before inserts', async () => {
    const fake = makeTeamCreateDb({ organizationRole: 'member' });
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller.create as unknown as (input: {
          organizationId: string;
          name: string;
        }) => Promise<unknown>
      )({ organizationId: 'org_design', name: 'Launch' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.inserts).toEqual([]);
  });

  it('gets a readable team project with authoritative scope, role, and task count', async () => {
    const fake = makeTeamGetDb();
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller as unknown as {
          get: (input: { projectId: string }) => Promise<unknown>;
        }
      ).get({ projectId: 'prj_team' }),
    ).resolves.toEqual({
      projectId: 'prj_team',
      name: 'Launch',
      description: 'Team launch',
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
      taskCount: 4,
      scope: 'organization',
      organizationId: 'org_design',
      organizationName: 'Design',
      memberRole: 'lead',
    });
  });

  it('hides a cross-tenant or actor-mismatched project get', async () => {
    const fake = makeTeamGetDb({ ...readableTeamSnapshot, actorExternalId: 'usr_other' });
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller as unknown as {
          get: (input: { projectId: string }) => Promise<unknown>;
        }
      ).get({ projectId: 'prj_team' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists active project members with a privacy-minimal DTO', async () => {
    const fake = makeTeamMembersDb();
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    const result = await (
      caller as unknown as {
        members: (input: { projectId: string }) => Promise<unknown[]>;
      }
    ).members({ projectId: 'prj_team' });

    expect(result).toEqual([
      {
        projectMemberId: 'pmem_member',
        userId: 'usr_collaborator',
        displayName: 'Mina',
        avatarUrl: 'https://cdn.example/mina.png',
        role: 'member',
      },
    ]);
    expect(result[0]).not.toHaveProperty('email');
    expect(result[0]).not.toHaveProperty('phone');
    expect(result[0]).not.toHaveProperty('internalUserId');
    expect(result[0]).not.toHaveProperty('status');
  });

  it('adds an active organization member and returns only collaboration fields', async () => {
    const fake = makeAccessMutationDb(canonicalRouterAddReads());
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller as unknown as {
          addMember: (input: {
            projectId: string;
            organizationMemberId: string;
            role: string;
          }) => Promise<unknown>;
        }
      ).addMember({
        projectId: 'prj_team',
        organizationMemberId: 'omem_target',
        role: 'viewer',
      }),
    ).resolves.toEqual({
      projectMemberId: expect.stringMatching(/^pmem_/),
      userId: 'usr_collaborator',
      displayName: 'Mina',
      avatarUrl: null,
      role: 'viewer',
    });
    expect(fake.writes).toEqual([
      expect.objectContaining({
        kind: 'insert',
        table: 'project_members',
        values: expect.objectContaining({ projectId: 20, userId: 9, role: 'viewer' }),
      }),
    ]);
  });

  it('removes the project-bound target through Task 7 without trusting an organization id', async () => {
    const fake = makeAccessMutationDb(
      canonicalRouterMutationReads(readableTeamSnapshot, [
        {
          ...targetProjectMember,
          id: 40,
          externalId: 'pmem_actor',
          userId: 7,
          role: 'lead',
        },
        targetProjectMember,
      ]),
      [1],
    );
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller as unknown as {
          removeMember: (input: {
            projectId: string;
            projectMemberId: string;
          }) => Promise<unknown>;
        }
      ).removeMember({ projectId: 'prj_team', projectMemberId: 'pmem_target' }),
    ).resolves.toEqual({
      ok: true,
      projectId: 'prj_team',
      projectMemberId: 'pmem_target',
      status: 'inactive',
    });
    expect(fake.writes).toEqual([
      {
        kind: 'update',
        table: 'project_members',
        values: { status: 'inactive' },
      },
    ]);
  });

  it('maps sole-project-lead removal to an accurate conflict message', async () => {
    const actorProjectMember = {
      ...targetProjectMember,
      id: 40,
      externalId: 'pmem_actor',
      userId: 7,
      role: 'lead',
    };
    const fake = makeAccessMutationDb(
      canonicalRouterMutationReads(readableTeamSnapshot, [actorProjectMember]),
    );
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      (
        caller as unknown as {
          removeMember: (input: {
            projectId: string;
            projectMemberId: string;
          }) => Promise<unknown>;
        }
      ).removeMember({ projectId: 'prj_team', projectMemberId: 'pmem_actor' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'project must retain an active lead',
    });
    expect(fake.writes).toEqual([]);
  });

  it('renames a team project through the transaction-bound Task 7 operation', async () => {
    const fake = makeAccessMutationDb(canonicalRouterMutationReads(), [1]);
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(caller.rename({ projectId: 'prj_team', name: '  Renamed  ' })).resolves.toEqual({
      ok: true,
      projectId: 'prj_team',
      name: 'Renamed',
    });
    expect(fake.writes).toEqual([
      { kind: 'update', table: 'projects', values: { name: 'Renamed' } },
    ]);
  });

  it.each(['rename', 'delete'] as const)(
    'hides a direct cross-tenant %s mutation before any write',
    async (procedure) => {
      const crossTenant = {
        ...readableTeamSnapshot,
        organizationRowId: 31,
        organizationExternalId: 'org_other',
        organizationMemberOrganizationId: 31,
        organizationMemberRole: 'owner',
      };
      const fake = makeAccessMutationDb([[crossTenant]], [1]);
      const caller = projectsRouter.createCaller({
        db: fake.db,
        userId: 'usr_member',
        logger: fakeLogger,
      } as never);

      const action =
        procedure === 'rename'
          ? caller.rename({ projectId: 'prj_team', name: 'Hidden' })
          : caller.delete({ projectId: 'prj_team' });
      await expect(action).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(fake.writes).toEqual([]);
    },
  );

  it('denies viewer rename and project-lead delete before any write', async () => {
    const viewerSnapshot = { ...readableTeamSnapshot, projectMemberRole: 'viewer' };
    const viewer = makeAccessMutationDb(canonicalRouterMutationReads(viewerSnapshot));
    const lead = makeAccessMutationDb(canonicalRouterMutationReads());
    const viewerCaller = projectsRouter.createCaller({
      db: viewer.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);
    const leadCaller = projectsRouter.createCaller({
      db: lead.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(
      viewerCaller.rename({ projectId: 'prj_team', name: 'Denied' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(leadCaller.delete({ projectId: 'prj_team' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(viewer.writes).toEqual([]);
    expect(lead.writes).toEqual([]);
  });

  it('deletes only the authorized project and relies on the task FK to set project_id null', async () => {
    const ownerSnapshot = { ...readableTeamSnapshot, organizationMemberRole: 'owner' };
    const fake = makeAccessMutationDb(canonicalRouterMutationReads(ownerSnapshot), [1]);
    const caller = projectsRouter.createCaller({
      db: fake.db,
      userId: 'usr_member',
      logger: fakeLogger,
    } as never);

    await expect(caller.delete({ projectId: 'prj_team' })).resolves.toEqual({
      ok: true,
      projectId: 'prj_team',
    });
    expect(fake.writes).toEqual([{ kind: 'delete', table: 'projects' }]);
    expect(fake.writes).not.toContainEqual(expect.objectContaining({ table: 'tasks' }));

    const projectForeignKey = getTableConfig(schema.tasks).foreignKeys.find(
      (foreignKey) => foreignKey.reference().foreignTable === schema.projects,
    );
    expect(projectForeignKey?.onDelete).toBe('set null');
  });
});
