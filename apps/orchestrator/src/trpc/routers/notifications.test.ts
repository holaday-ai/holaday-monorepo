import { describe, expect, it, vi } from 'vitest';
import { notificationChannelsRouter } from './notifications.js';

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

function makeContext() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
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
                    return [
                      {
                        platform: 'custom',
                        webhookUrl: 'https://hooks.example.com/existing',
                        customTemplate: { text: '{{message}}' },
                      },
                    ];
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
});
