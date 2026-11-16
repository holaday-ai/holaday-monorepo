import { type SQL, getTableName } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { pino } from 'pino';
import { expect, it } from 'vitest';
import { finalizeClaim } from '../api-keys/webhook-idempotency-service.js';
import type { DB } from '../db/client.js';
import type { TaskState } from './task-controller.js';
import { TaskRepository } from './task-repository.js';

const state: TaskState = { taskId: 'tsk_recovered', status: 'executing', plan: [], cursor: 0 };
const context = {
  userId: 7,
  intent: '整理后台报表',
  creationReceipt: { idempotencyKey: 'spa_task:owned-operation', requestHash: 'a'.repeat(64) },
};

// The external SQL boundary is replaced, while the real repository owns the transaction.
function database(receiptAffected: number) {
  let committed: string[] = [];
  const guards: Array<{ sql: string; params: unknown[] }> = [];
  const receiptValues: Record<string, unknown>[] = [];
  const db = {
    transaction: async (work: (tx: unknown) => Promise<void>) => {
      const pending: string[] = [];
      const tx = {
        insert: (table: Parameters<typeof getTableName>[0]) => ({
          values: async () => {
            pending.push(getTableName(table));
            return [{ insertId: 41 }];
          },
        }),
        update: (table: Parameters<typeof getTableName>[0]) => ({
          set: (values: Record<string, unknown>) => ({
            where: async (guard: SQL) => {
              expect(getTableName(table)).toBe('webhook_idempotency');
              pending.push('creation_receipt');
              receiptValues.push(values);
              guards.push(new MySqlDialect().sqlToQuery(guard));
              return [{ affectedRows: receiptAffected }];
            },
          }),
        }),
      };
      await work(tx);
      committed = pending;
    },
  } as unknown as DB;
  return { db, guards, receiptValues, committed: () => committed };
}

it('links the creation receipt in the task insert transaction, before it can be replayed', async () => {
  const h = database(1);
  await new TaskRepository(h.db, 'eval').insertTask(state, context);
  expect(h.committed()).toContain('tasks');
  expect(h.committed()).toContain('creation_receipt');
  expect(h.receiptValues).toEqual([
    { taskId: 'tsk_recovered', responseJson: { taskId: 'tsk_recovered', status: 'executing' } },
  ]);
  expect(h.guards[0]?.sql).toContain('`webhook_idempotency`.`user_id` = ?');
  expect(h.guards[0]?.sql).toContain('`webhook_idempotency`.`request_hash` = ?');
  expect(h.guards[0]?.sql).toContain('`webhook_idempotency`.`expires_at` > ?');
  expect(h.guards[0]?.params).toEqual([
    7,
    'spa_task:owned-operation',
    'a'.repeat(64),
    '',
    expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
  ]);
});

it('rolls back the new task when its owned, matching pending receipt is missing', async () => {
  const h = database(0);
  await expect(new TaskRepository(h.db).insertTask(state, context)).rejects.toThrow(
    'task_creation_receipt_lost',
  );
  expect(h.committed()).toEqual([]);
});

it('leaves the legacy task insert path unchanged when no creation receipt was requested', async () => {
  const h = database(0);
  await new TaskRepository(h.db).insertTask(state, { userId: 7, intent: '整理报表' });
  expect(h.committed()).toEqual(['tasks', 'task_events']);
  expect(h.receiptValues).toEqual([]);
});

it.each([
  { existing: { responseJson: { taskId: 'tsk_recovered', status: 'executing' } }, accepted: true },
  { existing: { responseJson: { taskId: 'tsk_other', status: 'executing' } }, accepted: false },
  { existing: undefined, accepted: false },
])(
  'confirms only an identical committed response when the write changes zero rows ($accepted)',
  async ({ existing, accepted }) => {
    const guards: Array<{ sql: string; params: unknown[] }> = [];
    const response = { taskId: 'tsk_recovered', status: 'executing' };
    const where = (guard: SQL) => {
      guards.push(new MySqlDialect().sqlToQuery(guard));
    };
    const db = {
      update: () => ({
        set: () => ({
          where: async (guard: SQL) => {
            where(guard);
            return [{ affectedRows: 0 }];
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: (guard: SQL) => {
            where(guard);
            return { limit: async () => (existing ? [existing] : []) };
          },
        }),
      }),
    } as unknown as DB;
    expect(
      await finalizeClaim(
        { db, logger: pino({ level: 'silent' }) },
        7,
        'spa_task:owned-operation',
        'tsk_recovered',
        response,
        { requestHash: 'a'.repeat(64) },
      ),
    ).toBe(accepted);
    expect(guards).toHaveLength(2);
    for (const guard of guards) {
      expect(guard.params).toEqual([
        7,
        'spa_task:owned-operation',
        'a'.repeat(64),
        'tsk_recovered',
      ]);
    }
  },
);
