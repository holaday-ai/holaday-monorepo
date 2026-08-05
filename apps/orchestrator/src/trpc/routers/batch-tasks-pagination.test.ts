import { describe, expect, it, vi } from 'vitest';
import { batchTasksRouter } from './batch-tasks.js';

function tableName(table: unknown): string {
  return (
    (table as Record<symbol, string> | undefined)?.[Symbol.for('drizzle:Name')] ?? ''
  );
}

describe('batchTasksRouter.list — keyset pagination', () => {
  it('returns limit items plus a cursor when an older page exists', async () => {
    const rows = [
      {
        id: 203,
        externalId: 'bat_203',
        name: 'three',
        status: 'completed',
        concurrency: 1,
        itemsTotal: 1,
        itemsDone: 1,
        itemsReview: 0,
        itemsFailed: 0,
        createdAt: new Date('2026-08-05T03:00:00Z'),
        completedAt: new Date('2026-08-05T03:01:00Z'),
      },
      {
        id: 202,
        externalId: 'bat_202',
        name: 'two',
        status: 'completed',
        concurrency: 1,
        itemsTotal: 1,
        itemsDone: 1,
        itemsReview: 0,
        itemsFailed: 0,
        createdAt: new Date('2026-08-05T02:00:00Z'),
        completedAt: new Date('2026-08-05T02:01:00Z'),
      },
      {
        id: 201,
        externalId: 'bat_201',
        name: 'one',
        status: 'completed',
        concurrency: 1,
        itemsTotal: 1,
        itemsDone: 1,
        itemsReview: 0,
        itemsFailed: 0,
        createdAt: new Date('2026-08-05T01:00:00Z'),
        completedAt: new Date('2026-08-05T01:01:00Z'),
      },
    ];
    const db = {
      select() {
        return {
          from(table: unknown) {
            const name = tableName(table);
            return {
              where() {
                if (name === 'users') {
                  return { limit: async () => [{ id: 42, externalId: 'usr_test', plan: 'free' }] };
                }
                if (name === 'batch_tasks') {
                  return {
                    orderBy() {
                      return { limit: async (limit: number) => rows.slice(0, limit) };
                    },
                  };
                }
                if (name === 'batch_task_items') return Promise.resolve([]);
                return Promise.resolve([]);
              },
            };
          },
        };
      },
    };

    const page = await batchTasksRouter
      .createCaller({ db, userId: 'usr_test', logger: { error: vi.fn() } } as never)
      .list({ limit: 2 } as never);

    expect(page).toEqual({
      items: [
        expect.objectContaining({ batchId: 'bat_203' }),
        expect.objectContaining({ batchId: 'bat_202' }),
      ],
      nextCursor: { id: 202, createdAt: new Date('2026-08-05T02:00:00Z') },
    });
  });

  it('accepts an ISO cursor date from the JSON transport', async () => {
    const rows = [
      {
        id: 201,
        externalId: 'bat_201',
        name: 'one',
        status: 'completed',
        concurrency: 1,
        itemsTotal: 1,
        itemsDone: 1,
        itemsReview: 0,
        itemsFailed: 0,
        createdAt: new Date('2026-08-05T01:00:00Z'),
        completedAt: new Date('2026-08-05T01:01:00Z'),
      },
    ];
    const db = {
      select() {
        return {
          from(table: unknown) {
            const name = tableName(table);
            return {
              where() {
                if (name === 'users') {
                  return { limit: async () => [{ id: 42, externalId: 'usr_test', plan: 'free' }] };
                }
                if (name === 'batch_tasks') {
                  return {
                    orderBy() {
                      return { limit: async () => rows };
                    },
                  };
                }
                if (name === 'batch_task_items') return Promise.resolve([]);
                return Promise.resolve([]);
              },
            };
          },
        };
      },
    };

    const page = await batchTasksRouter
      .createCaller({ db, userId: 'usr_test', logger: { error: vi.fn() } } as never)
      .list({
        limit: 1,
        cursor: { id: 202, createdAt: '2026-08-05T02:00:00.000Z' },
      } as never);

    expect(page.items).toEqual([
      expect.objectContaining({ batchId: 'bat_201' }),
    ]);
  });
});
