import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { __projectAccessInternals } from './project-access.js';
import {
  createAffectedRowsOverride,
  createSqlCheckpoint,
  instrumentMysqlConnection,
  isOrganizationLockSql,
  isOrganizationMembershipSnapshotSql,
  isProjectAccessSnapshotSql,
} from './team-project-race-harness.js';
import { __teamProjectServiceInternals } from './team-project-service.js';

describe('team project race harness', () => {
  it.each(['query', 'execute'] as const)(
    'holds a matched %s after the real operation until the barrier releases',
    async (method) => {
      const connection = {
        query: async (sql: string) => ({ method: 'query', sql }),
        execute: async (sql: string) => ({ method: 'execute', sql }),
      };
      const checkpoint = createSqlCheckpoint({
        label: `${method}-organization-lock`,
        phase: 'after',
        matches: (sql) => sql.includes('from `organizations`') && sql.includes('for update'),
      });
      const instrumented = instrumentMysqlConnection(connection, [checkpoint]);

      let settled = false;
      const pending = instrumented[method](
        'select `id` from `organizations` where `external_id` = ? for update',
      );
      void pending.finally(() => {
        settled = true;
      });

      await checkpoint.waitUntilReached(250);
      await Promise.resolve();
      expect(settled).toBe(false);

      checkpoint.release();
      await expect(pending).resolves.toEqual({
        method,
        sql: 'select `id` from `organizations` where `external_id` = ? for update',
      });
    },
  );

  it('does not pause a non-matching statement', async () => {
    const connection = {
      query: async (sql: string) => sql,
    };
    const checkpoint = createSqlCheckpoint({
      label: 'organization-lock',
      phase: 'after',
      matches: (sql) => sql.includes('for update'),
    });
    const instrumented = instrumentMysqlConnection(connection, [checkpoint]);

    await expect(instrumented.query('select 1')).resolves.toBe('select 1');
    expect(checkpoint.wasReached()).toBe(false);
  });

  it('reports zero affected rows once after a matched real update result', async () => {
    const connection = {
      execute: async (sql: string) => [{ affectedRows: 1, marker: sql }, []] as const,
    };
    const override = createAffectedRowsOverride({
      matches: (sql) =>
        sql.startsWith('update `organization_members`') && sql.includes('set `role` = ?'),
      affectedRows: 0,
    });
    const instrumented = instrumentMysqlConnection(connection, [], [override]);

    const first = await instrumented.execute(
      'UPDATE `organization_members` SET `role` = ? WHERE `id` = ?',
    );
    const second = await instrumented.execute(
      'UPDATE `organization_members` SET `role` = ? WHERE `id` = ?',
    );

    expect(first[0]).toMatchObject({ affectedRows: 0 });
    expect(second[0]).toMatchObject({ affectedRows: 1 });
  });

  it('recognizes the real compiled SQL boundaries used by the race barriers', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const organizationLock = __teamProjectServiceInternals
      .buildLockedTeamOrganizationQuery(mockDb, 'org_integration')
      .toSQL().sql;
    const organizationMembershipSnapshot = __teamProjectServiceInternals
      .buildActiveTeamOrganizationMembershipQuery(mockDb, 'usr_integration', 'org_integration')
      .toSQL().sql;
    const projectAccessSnapshot = __projectAccessInternals
      .buildProjectAccessSnapshotQuery(mockDb, {
        actorExternalId: 'usr_integration',
        projectExternalId: 'prj_integration',
      })
      .toSQL().sql;

    expect(isOrganizationLockSql(organizationLock)).toBe(true);
    expect(isOrganizationMembershipSnapshotSql(organizationMembershipSnapshot)).toBe(true);
    expect(isProjectAccessSnapshotSql(projectAccessSnapshot)).toBe(true);
  });
});
