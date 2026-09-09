import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

describe('owned task detail execution identity', () => {
  it.each([
    { executionId: 'synthetic_execution', executionRevision: 4 },
    { executionId: null, executionRevision: 0 },
  ])(
    'returns the persisted identity without exposing internal verification data: %j',
    async (identity) => {
      const queries: { sql: string; params: unknown[] }[] = [];
      const row = {
        id: 7,
        externalId: 'tsk_detail',
        intent: '合成任务',
        status: 'awaiting_user',
        ...identity,
        coreRecordVersion: 8,
        verificationJson: { privateInternal: true },
        result: {},
        projectId: null,
      };
      const db = {
        select(projection?: Record<string, unknown>) {
          return {
            from() {
              return {
                where(query: SQL) {
                  queries.push(new MySqlDialect().sqlToQuery(query));
                  const rows = !projection ? [row] : 'id' in projection ? [{ id: 9 }] : [];
                  return Object.assign(Promise.resolve(rows), {
                    limit: async () => rows,
                    orderBy: async () => rows,
                  });
                },
              };
            },
          };
        },
      };
      const logger = { child: () => logger, info() {}, warn() {}, error() {}, debug() {} };
      const result = await tasksRouter
        .createCaller({
          db,
          logger,
          userId: 'usr_synthetic',
          taskOrigin: 'user',
        } as unknown as Context)
        .detail({ taskId: 'tsk_detail' });
      expect(result).toMatchObject(identity);
      expect(result).not.toHaveProperty('verificationJson');
      expect(result).not.toHaveProperty('coreRecordVersion');
      expect(queries[1]?.params).toEqual(['tsk_detail', 9, 'user']);
    },
  );
});
