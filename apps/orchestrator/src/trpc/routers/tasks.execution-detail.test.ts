import { type SQL, getTableName } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

describe('owned task detail execution identity', () => {
  it('restores the owned original input and generated output after a file-only task fails', async () => {
    const row = {
      id: 7,
      externalId: 'tsk_files',
      status: 'failed',
      origin: 'user',
      projectId: null,
      intent: '仅处理我提供的JSON附件，生成summary.csv，交付原始JSON与新CSV。',
      result: {},
    };
    const files = [
      {
        externalId: 'file_original',
        filename: 'source.json',
        kind: 'input',
        mimetype: 'application/json',
        sizeBytes: 2,
        expiresAt: null,
      },
      {
        externalId: 'file_generated',
        filename: 'summary.csv',
        kind: 'output',
        mimetype: 'text/csv',
        sizeBytes: 8,
        expiresAt: null,
      },
    ];
    const queries: unknown[][] = [];
    const db = {
      select(projection?: Record<string, unknown>) {
        return {
          from(table: Parameters<typeof getTableName>[0]) {
            return {
              where(query: SQL) {
                const name = getTableName(table);
                const params = new MySqlDialect().sqlToQuery(query).params;
                if (name === 'task_files') queries.push(params);
                const rows =
                  name === 'users'
                    ? [{ id: 9 }]
                    : name === 'tasks' && !projection
                      ? [row]
                      : name === 'task_files'
                        ? files.filter((f) => params.includes(f.kind))
                        : [];
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
      .createCaller({ db, logger, userId: 'usr_owner', taskOrigin: 'user' } as unknown as Context)
      .detail({ taskId: 'tsk_files' });
    expect(result.status).toBe('failed');
    expect(
      (
        result.result as { metadata: { attachments: { fileId: string }[] } }
      ).metadata.attachments.map((f) => f.fileId),
    ).toEqual(['file_original', 'file_generated']);
    expect(queries[0]?.slice(0, 2)).toEqual([9, 7]);
  });
  it.each(['executing', 'completed', 'awaiting_user'])(
    'restores only unresolved inventory and preserves selected final outputs (%s)',
    async (status) => {
      const expiry = new Date(Date.now() + 86400000);
      const files = ['first', 'second'].map((name) => ({
        externalId: `file_${name}`,
        filename: `${name}.txt`,
        mimetype: 'text/plain',
        sizeBytes: 3,
        expiresAt: expiry,
      }));
      const row = {
        id: 7,
        externalId: 'tsk_inventory',
        intent: 'Read-only inventory',
        status,
        sourceContext: { browserSource: 'local-chrome' },
        projectId: null,
        result: {
          metadata: {
            attachments: [
              {
                fileId: 'file_first',
                filename: 'first.txt',
                mimetype: 'text/plain',
                sizeBytes: 3,
                downloadUrl: '/api/files/file_first/download',
                kind: 'txt',
                expiresAt: expiry.toISOString(),
              },
            ],
          },
        },
      };
      const queries: { table: string; params: unknown[] }[] = [];
      const db = {
        select(projection?: Record<string, unknown>) {
          return {
            from(table: Parameters<typeof getTableName>[0]) {
              const name = getTableName(table);
              return {
                where(query: SQL) {
                  queries.push({
                    table: name,
                    params: new MySqlDialect().sqlToQuery(query).params,
                  });
                  const rows =
                    name === 'users'
                      ? [{ id: 9 }]
                      : name === 'tasks' && !projection
                        ? [row]
                        : name === 'task_files'
                          ? files
                          : [];
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
      const output = await tasksRouter
        .createCaller({ db, logger, userId: 'usr_owner', taskOrigin: 'user' } as unknown as Context)
        .detail({ taskId: 'tsk_inventory' });
      expect(output.status).toBe(status);
      expect(output.executionObservation).toEqual(
        status === 'executing'
          ? {
              state: 'unconfirmed',
              reason: 'session_not_observed',
            }
          : null,
      );
      const result = output.result as { metadata: { attachments: { fileId: string }[] } };
      expect(result.metadata.attachments.map((file) => file.fileId)).toEqual(
        status === 'completed' ? ['file_first'] : ['file_first', 'file_second'],
      );
      expect(queries.find((query) => query.table === 'tasks')?.params).toEqual([
        'tsk_inventory',
        9,
        'user',
      ]);
      expect(queries.find((query) => query.table === 'task_files')?.params.slice(0, 4)).toEqual([
        9,
        7,
        'output',
        'active',
      ]);
    },
  );
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
      expect(result.executionObservation).toBeNull();
      expect(queries[1]?.params).toEqual(['tsk_detail', 9, 'user']);
    },
  );
});
