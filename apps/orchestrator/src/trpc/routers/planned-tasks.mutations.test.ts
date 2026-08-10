import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannedTasksRouter } from './planned-tasks.js';

function createInsertDb() {
  // This fake keeps authentication, transaction, and insert behavior real at
  // the router boundary while replacing only the external MySQL dependency.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return [{ id: 42 }];
                },
              };
            },
          };
        },
      };
    },
    async transaction(callback: (tx: unknown) => Promise<void>) {
      await callback(db);
    },
    insert() {
      return {
        async values() {
          return [{ insertId: 101 }];
        },
      };
    },
    delete() {
      return {
        async where() {
          return [{ affectedRows: 1 }];
        },
      };
    },
  };
  return db;
}

function recurringPlanRow() {
  return {
    id: 7,
    externalId: 'pln_daily',
    userId: 42,
    title: '每日巡检',
    instruction: '检查一次',
    notes: null,
    scope: 'single',
    repeatType: 'daily',
    rrule: null,
    firstRunAt: new Date('2026-08-09T09:00:00.000Z'),
    endsAt: null,
    nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
    timezone: 'Asia/Shanghai',
    reminderMinutes: null,
    status: 'active',
    itemCount: 1,
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    lastReminderRun: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function createUpdateDb() {
  let selectCount = 0;
  const plan = recurringPlanRow();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select() {
      const call = selectCount++;
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return call === 0 ? [{ id: 42 }] : [plan];
                },
                async orderBy() {
                  return [{ instruction: '检查一次' }];
                },
              };
            },
          };
        },
      };
    },
    async transaction(callback: (tx: unknown) => Promise<void>) {
      await callback(db);
    },
    update() {
      return {
        set() {
          return {
            async where() {
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
    delete() {
      return {
        async where() {
          return [{ affectedRows: 1 }];
        },
      };
    },
    insert() {
      return {
        values() {
          return {
            async onDuplicateKeyUpdate() {
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
  };
  return db;
}

function createCaller(db: unknown) {
  return plannedTasksRouter.createCaller({
    db,
    userId: 'usr_test',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
  } as never);
}

describe('plannedTasks mutation schedule feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the effective first run when create advances a stale recurring anchor', async () => {
    const caller = createCaller(createInsertDb());

    const result = await caller.create({
      title: '每日巡检',
      instruction: '检查一次',
      items: [],
      repeatType: 'daily',
      scheduledAt: '2026-08-09T09:00:00.000Z',
      timezone: 'Asia/Shanghai',
    });

    expect(result).toEqual({
      ok: true,
      plannedTaskId: expect.any(String),
      nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
      adjusted: true,
    });
  });

  it('rejects a past occurrence edit instead of rolling the recurring series forward', async () => {
    const caller = createCaller(createUpdateDb());

    await expect(
      caller.update({
        plannedTaskId: 'pln_daily',
        title: '每日巡检',
        instruction: '检查一次',
        items: [],
        repeatType: 'daily',
        scheduledAt: '2026-08-10T08:00:00.000Z',
        timezone: 'Asia/Shanghai',
        editScope: 'occurrence',
        originalScheduledFor: '2026-08-11T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '执行时间已过去，请重新选择',
    });
  });

  it('returns the adjusted next run after a stale full-series update', async () => {
    const caller = createCaller(createUpdateDb());

    const result = await caller.update({
      plannedTaskId: 'pln_daily',
      title: '每日巡检',
      instruction: '检查一次',
      items: [],
      repeatType: 'daily',
      scheduledAt: '2026-08-09T09:00:00.000Z',
      timezone: 'Asia/Shanghai',
      editScope: 'series',
    });

    expect(result).toEqual({
      ok: true,
      plannedTaskId: 'pln_daily',
      nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
      adjusted: true,
    });
  });
});

describe('plannedTasks load telemetry', () => {
  it('logs one bounded content-free initial-load metric', async () => {
    const info = vi.fn();
    const caller = plannedTasksRouter.createCaller({
      db: {},
      userId: 'usr_test',
      logger: {
        info,
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    } as never);
    await expect(
      caller.reportLoadMetric({
        view: 'dayGridMonth',
        plansMs: 410,
        calendarMs: 900,
        totalMs: 1050,
        plannedCount: 2,
        legacyCount: 1,
        slow: false,
      }),
    ).resolves.toEqual({ ok: true });
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      {
        event: 'planned_tasks_initial_load',
        view: 'dayGridMonth',
        plansMs: 410,
        calendarMs: 900,
        totalMs: 1050,
        plannedCount: 2,
        legacyCount: 1,
        slow: false,
      },
      'planned tasks initial load',
    );
    expect(JSON.stringify(info.mock.calls[0]?.[0])).not.toMatch(
      /usr_test|title|instruction|email|url/i,
    );
  });

  it('rejects out-of-range timing and unexpected content fields', async () => {
    const caller = plannedTasksRouter.createCaller({
      db: {},
      userId: 'usr_test',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    } as never);
    const valid = {
      view: 'dayGridMonth' as const,
      plansMs: 410,
      calendarMs: 900,
      totalMs: 1050,
      plannedCount: 2,
      legacyCount: 1,
      slow: false,
    };

    await expect(
      caller.reportLoadMetric({ ...valid, totalMs: 60_001 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.reportLoadMetric({ ...valid, instruction: '不应进入日志' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
