import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannedTasks } from '../../db/schema/planned-tasks.js';
import { stockRiskMonitors } from '../../db/schema/stock-risk-monitors.js';
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

function createArchiveDb() {
  let selectCall = 0;
  let transactionCalls = 0;
  let rowLocks = 0;
  const db = {
    select() {
      const call = selectCall++;
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  if (call === 0) return Promise.resolve([{ id: 42 }]);
                  return {
                    async for(mode: string) {
                      if (mode === 'update') rowLocks += 1;
                      return [{ id: 7 }];
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    async transaction<T>(callback: (tx: unknown) => Promise<T>) {
      transactionCalls += 1;
      return callback(db);
    },
    update() {
      return {
        set() {
          return { where: async () => [{ affectedRows: 1 }] };
        },
      };
    },
  };
  return {
    db,
    transactionCalls: () => transactionCalls,
    rowLocks: () => rowLocks,
  };
}

function createFutureRescheduleDb(options: {
  nextRunAt?: Date;
  hasMonitor?: boolean;
  hasNonterminalRun?: boolean;
  status?: 'active' | 'running' | 'archived';
  lockedStatus?: 'active' | 'running' | 'archived';
} = {}) {
  let selectCount = 0;
  let movedMonitorTo: number | null = null;
  let transactionCalls = 0;
  let rowLocks = 0;
  let insertedPlans = 0;
  const plan = {
    ...recurringPlanRow(),
    nextRunAt: options.nextRunAt ?? recurringPlanRow().nextRunAt,
    status: options.status ?? 'active',
  };
  const db = {
    select() {
      const call = selectCount++;
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  if (call === 0) return Promise.resolve([{ id: 42 }]);
                  if (call === 1) return Promise.resolve([plan]);
                  if (call === 3) {
                    return {
                      async for(mode: string) {
                        if (mode === 'update') rowLocks += 1;
                        return [{ id: plan.id, status: options.lockedStatus ?? plan.status }];
                      },
                    };
                  }
                  if (call === 4) {
                    return Promise.resolve(options.hasMonitor ? [{ id: 91 }] : []);
                  }
                  return Promise.resolve(options.hasNonterminalRun ? [{ id: 92 }] : []);
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
      transactionCalls += 1;
      await callback(db);
    },
    update(table: unknown) {
      return {
        set(values: { plannedTaskId?: number }) {
          if (table === stockRiskMonitors && typeof values.plannedTaskId === 'number') {
            movedMonitorTo = values.plannedTaskId;
          }
          return {
            async where() {
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        async values() {
          if (table === plannedTasks) insertedPlans += 1;
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
  return {
    db,
    movedMonitorTo: () => movedMonitorTo,
    transactionCalls: () => transactionCalls,
    rowLocks: () => rowLocks,
    insertedPlans: () => insertedPlans,
  };
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

  it('archives a plan while holding its lifecycle row lock', async () => {
    const fixture = createArchiveDb();
    const caller = createCaller(fixture.db);

    await expect(caller.archive({ plannedTaskId: 'pln_daily' })).resolves.toEqual({ ok: true });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
  });

  it('rejects splitting a stock risk monitor even from its next occurrence', async () => {
    const fixture = createFutureRescheduleDb({
      nextRunAt: new Date('2026-08-12T09:00:00.000Z'),
      hasMonitor: true,
    });
    const caller = createCaller(fixture.db);

    await expect(caller.rescheduleOccurrence({
      plannedTaskId: 'pln_daily',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
      scheduledFor: '2026-08-12T10:00:00.000Z',
      scope: 'future',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '系统风险监控不支持拆分未来轮次，请改为调整整个系列',
    });

    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.movedMonitorTo()).toBeNull();
  });

  it('rejects editing future monitor occurrences through the planned-task editor', async () => {
    const fixture = createFutureRescheduleDb({
      nextRunAt: new Date('2026-08-12T09:00:00.000Z'),
      hasMonitor: true,
    });
    const caller = createCaller(fixture.db);

    await expect(caller.update({
      plannedTaskId: 'pln_daily',
      title: '监控多伦科技风险变化',
      instruction: '系统专用：检查多伦科技（603528）风险变化',
      items: ['检查多伦科技（603528）风险变化'],
      repeatType: 'daily',
      scheduledAt: '2026-08-12T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
      editScope: 'future',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '系统风险监控不支持拆分未来轮次，请改为调整整个系列',
    });

    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.movedMonitorTo()).toBeNull();
  });

  it('rejects splitting a risk monitor while an earlier occurrence is still pending', async () => {
    const fixture = createFutureRescheduleDb({ hasMonitor: true });
    const caller = createCaller(fixture.db);

    await expect(caller.rescheduleOccurrence({
      plannedTaskId: 'pln_daily',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
      scheduledFor: '2026-08-12T10:00:00.000Z',
      scope: 'future',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '系统风险监控不支持拆分未来轮次，请改为调整整个系列',
    });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.movedMonitorTo()).toBeNull();
  });

  it('rejects splitting a risk monitor while its current occurrence is running', async () => {
    const fixture = createFutureRescheduleDb({
      nextRunAt: new Date('2026-08-12T09:00:00.000Z'),
      hasMonitor: true,
      status: 'running',
    });
    const caller = createCaller(fixture.db);

    await expect(caller.rescheduleOccurrence({
      plannedTaskId: 'pln_daily',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
      scheduledFor: '2026-08-12T10:00:00.000Z',
      scope: 'future',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '系统风险监控不支持拆分未来轮次，请改为调整整个系列',
    });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.movedMonitorTo()).toBeNull();
  });

  it('rejects splitting a risk monitor while a manual run is nonterminal', async () => {
    const fixture = createFutureRescheduleDb({
      nextRunAt: new Date('2026-08-12T09:00:00.000Z'),
      hasMonitor: true,
      hasNonterminalRun: true,
    });
    const caller = createCaller(fixture.db);

    await expect(caller.rescheduleOccurrence({
      plannedTaskId: 'pln_daily',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
      scheduledFor: '2026-08-12T10:00:00.000Z',
      scope: 'future',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '系统风险监控不支持拆分未来轮次，请改为调整整个系列',
    });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.movedMonitorTo()).toBeNull();
  });

  it('rejects a future reschedule when the locked plan was archived after loading', async () => {
    const fixture = createFutureRescheduleDb({ lockedStatus: 'archived' });
    const caller = createCaller(fixture.db);

    await expect(caller.rescheduleOccurrence({
      plannedTaskId: 'pln_daily',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
      scheduledFor: '2026-08-12T10:00:00.000Z',
      scope: 'future',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '任务状态刚刚发生变化，请刷新后重试',
    });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.insertedPlans()).toBe(0);
  });

  it('rejects a future editor split when the locked plan was archived after loading', async () => {
    const fixture = createFutureRescheduleDb({ lockedStatus: 'archived' });
    const caller = createCaller(fixture.db);

    await expect(caller.update({
      plannedTaskId: 'pln_daily',
      title: '每日巡检',
      instruction: '检查一次',
      items: ['检查一次'],
      repeatType: 'daily',
      scheduledAt: '2026-08-12T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
      editScope: 'future',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '任务状态刚刚发生变化，请刷新后重试',
    });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.insertedPlans()).toBe(0);
  });

  it('rejects a future reschedule that initially loads an already archived plan', async () => {
    const fixture = createFutureRescheduleDb({
      status: 'archived',
      lockedStatus: 'archived',
    });
    const caller = createCaller(fixture.db);

    await expect(caller.rescheduleOccurrence({
      plannedTaskId: 'pln_daily',
      originalScheduledFor: '2026-08-12T09:00:00.000Z',
      scheduledFor: '2026-08-12T10:00:00.000Z',
      scope: 'future',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '任务状态刚刚发生变化，请刷新后重试',
    });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.rowLocks()).toBe(1);
    expect(fixture.insertedPlans()).toBe(0);
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
