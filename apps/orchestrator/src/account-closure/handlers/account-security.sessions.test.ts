import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import type { ClosureHandlerContext } from '../handler-contract.js';
import { accountSecurityClosureHandler } from './account-security.js';

describe('current-device sessions during account closure', () => {
  it('selects and deletes sessions through the owning user before reporting completion', async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    let present = true;
    const context = {
      request: { id: 1, externalId: 'closure_test', userId: 7, userExternalId: 'usr_test' },
      signal: new AbortController().signal,
      checkpoint: null,
      pageSize: 100,
      db: {
        execute: async (query: Parameters<MySqlDialect['sqlToQuery']>[0]) => {
          const compiled = new MySqlDialect().sqlToQuery(query);
          queries.push(compiled);
          if (!compiled.sql.includes('auth_sessions')) return [[], []];
          expect(compiled.sql).toContain('parent.`external_id` = child.`user_external_id`');
          expect(compiled.sql).toContain('parent.`id` = ?');
          expect(compiled.params[0]).toBe(7);
          if (compiled.sql.startsWith('DELETE')) {
            expect(compiled.params).toEqual([7, 19]);
            present = false;
            return [{ affectedRows: 1 }, []];
          }
          return [present ? [{ id: 19 }] : [], []];
        },
      },
    } as unknown as ClosureHandlerContext;
    expect(await accountSecurityClosureHandler.run(context)).toMatchObject({
      kind: 'complete',
      processed: 1,
      retention: 'deleted',
    });
    expect(
      queries.some(
        (query) => query.sql.startsWith('DELETE') && query.sql.includes('auth_sessions'),
      ),
    ).toBe(true);
    expect(present).toBe(false);
  });
});
