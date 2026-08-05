import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAllBucketsForTesting } from '../../quota/rate-limiter.js';
import { notificationChannelsRouter, notificationsRouter } from './notifications.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

function tableName(table: unknown): string {
  return (
    (table as Record<symbol, string> | undefined)?.[
      Symbol.for('drizzle:Name')
    ] ?? ''
  );
}

function makeContext(options: {
  channels?: Array<{
    platform: string;
    webhookUrl: string;
    customTemplate: unknown;
  }>;
} = {}) {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const channels = options.channels ?? [
    {
      platform: 'custom',
      webhookUrl: 'https://hooks.example.com/existing',
      customTemplate: { text: '{{message}}' },
    },
  ];
  const db = {
    select() {
      return {
        from(table: unknown) {
          const name = tableName(table);
          return {
            where() {
              return {
                async limit() {
                  if (name === 'users') return [{ id: 42 }];
                  if (name === 'notification_channels') {
                    return channels;
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        async values(value: unknown) {
          inserted.push(value);
        },
      };
    },
    update() {
      return {
        set(value: unknown) {
          updated.push(value);
          return {
            async where() {
              return { affectedRows: 1 };
            },
          };
        },
      };
    },
  };

  return {
    inserted,
    updated,
    ctx: {
      db,
      userId: 'usr_test',
      logger: fakeLogger,
    } as never,
  };
}

describe('notificationChannelsRouter — webhook target safety', () => {
  beforeEach(() => {
    _resetAllBucketsForTesting();
  });

  it('create rejects a private target as BAD_REQUEST before persistence', async () => {
    const { ctx, inserted } = makeContext();
    await expect(
      notificationChannelsRouter.createCaller(ctx).create({
        platform: 'custom',
        webhookUrl: 'http://127.0.0.1/internal',
        customTemplate: { text: '{{message}}' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(inserted).toEqual([]);
  });

  it('update rejects a private target as BAD_REQUEST before persistence', async () => {
    const { ctx, updated } = makeContext();
    await expect(
      notificationChannelsRouter.createCaller(ctx).update({
        channelId: 'nch_test',
        webhookUrl: 'http://10.0.0.7/internal',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(updated).toEqual([]);
  });

  it('inline test rejects a private target as BAD_REQUEST before sending', async () => {
    const { ctx } = makeContext();
    await expect(
      notificationChannelsRouter.createCaller(ctx).test({
        platform: 'custom',
        webhookUrl: 'http://169.254.169.254/latest/meta-data',
        customTemplate: { text: '{{message}}' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('saved-channel test revalidates the stored target before sending', async () => {
    const { ctx } = makeContext();
    const unsafeDb = {
      ...(ctx as { db: object }).db,
      select() {
        return {
          from(table: unknown) {
            const name = tableName(table);
            return {
              where() {
                return {
                  async limit() {
                    if (name === 'users') return [{ id: 42 }];
                    return [
                      {
                        platform: 'custom',
                        webhookUrl: 'http://[::1]/internal',
                        customTemplate: { text: '{{message}}' },
                      },
                    ];
                  },
                };
              },
            };
          },
        };
      },
    };

    await expect(
      notificationChannelsRouter
        .createCaller({ ...(ctx as object), db: unsafeDb } as never)
        .test({ channelId: 'nch_test' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('requires a custom template when switching a saved channel to custom', async () => {
    const { ctx, updated } = makeContext({
      channels: [
        {
          platform: 'wecom',
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
          customTemplate: null,
        },
      ],
    });

    await expect(
      notificationChannelsRouter.createCaller(ctx).update({
        channelId: 'nch_test',
        platform: 'custom',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(updated).toEqual([]);
  });

  it('rejects oversized custom templates before persistence', async () => {
    const { ctx, inserted } = makeContext();

    await expect(
      notificationChannelsRouter.createCaller(ctx).create({
        platform: 'custom',
        webhookUrl: 'https://93.184.216.34/notify',
        customTemplate: { text: 'x'.repeat(32_769) },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(inserted).toEqual([]);
  });

  it('caps saved notification channels per account', async () => {
    const channels = Array.from({ length: 10 }, (_, index) => ({
      platform: 'custom',
      webhookUrl: `https://93.184.216.34/notify/${index}`,
      customTemplate: { text: '{{message}}' },
    }));
    const { ctx, inserted } = makeContext({ channels });

    await expect(
      notificationChannelsRouter.createCaller(ctx).create({
        platform: 'custom',
        webhookUrl: 'https://93.184.216.34/notify/new',
        customTemplate: { text: '{{message}}' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(inserted).toEqual([]);
  });

  it('rate-limits repeated channel creation attempts per account', async () => {
    const channels = Array.from({ length: 10 }, (_, index) => ({
      platform: 'custom',
      webhookUrl: `https://93.184.216.34/notify/${index}`,
      customTemplate: { text: '{{message}}' },
    }));
    const { ctx } = makeContext({ channels });
    const caller = notificationChannelsRouter.createCaller(ctx);
    const input = {
      platform: 'custom' as const,
      webhookUrl: 'https://93.184.216.34/notify/new',
      customTemplate: { text: '{{message}}' },
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(caller.create(input)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    await expect(caller.create(input)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });

  it('rate-limits repeated outbound notification tests per account', async () => {
    const { ctx } = makeContext();
    const caller = notificationChannelsRouter.createCaller(ctx);
    const input = {
      platform: 'custom' as const,
      webhookUrl: 'http://127.0.0.1/internal',
      customTemplate: { text: '{{message}}' },
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(caller.test(input)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    await expect(caller.test(input)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });
});

describe('notificationsRouter — keyset pagination', () => {
  it('returns limit items plus a cursor when an older page exists', async () => {
    const rows = [
      {
        id: 103,
        externalId: 'not_103',
        type: 'task_complete',
        title: 'three',
        message: 'three',
        isRead: false,
        createdAt: new Date('2026-08-05T03:00:00Z'),
        scheduledTaskId: null,
      },
      {
        id: 102,
        externalId: 'not_102',
        type: 'task_complete',
        title: 'two',
        message: 'two',
        isRead: false,
        createdAt: new Date('2026-08-05T02:00:00Z'),
        scheduledTaskId: null,
      },
      {
        id: 101,
        externalId: 'not_101',
        type: 'task_complete',
        title: 'one',
        message: 'one',
        isRead: false,
        createdAt: new Date('2026-08-05T01:00:00Z'),
        scheduledTaskId: null,
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
                  return { limit: async () => [{ id: 42 }] };
                }
                return {
                  orderBy() {
                    return { limit: async (limit: number) => rows.slice(0, limit) };
                  },
                };
              },
            };
          },
        };
      },
    };

    const page = await notificationsRouter
      .createCaller({ db, userId: 'usr_test', logger: fakeLogger } as never)
      .list({ limit: 2 });

    expect(page).toEqual({
      items: [
        expect.objectContaining({ notificationId: 'not_103' }),
        expect.objectContaining({ notificationId: 'not_102' }),
      ],
      nextCursor: { id: 102, createdAt: new Date('2026-08-05T02:00:00Z') },
    });
  });

  it('accepts an ISO cursor date from the JSON transport', async () => {
    const rows = [
      {
        id: 101,
        externalId: 'not_101',
        type: 'task_complete',
        title: 'one',
        message: 'one',
        isRead: false,
        createdAt: new Date('2026-08-05T01:00:00Z'),
        scheduledTaskId: null,
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
                  return { limit: async () => [{ id: 42 }] };
                }
                return {
                  orderBy() {
                    return { limit: async () => rows };
                  },
                };
              },
            };
          },
        };
      },
    };

    const page = await notificationsRouter
      .createCaller({ db, userId: 'usr_test', logger: fakeLogger } as never)
      .list({
        limit: 1,
        cursor: { id: 102, createdAt: '2026-08-05T02:00:00.000Z' },
      } as never);

    expect(page.items).toEqual([
      expect.objectContaining({ notificationId: 'not_101' }),
    ]);
  });
});
