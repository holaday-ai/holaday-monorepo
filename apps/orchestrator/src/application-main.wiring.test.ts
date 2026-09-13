import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Factory wiring only: service behavior has separate real drain/IO tests. No
// database, browser, HTTP server, queue or production authority is supplied here.
const s = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  const pool = { canAllocate: () => false, startGc: vi.fn(), shutdown: vi.fn(async () => {}) };
  return {
    logger,
    pool,
    legacyBrowser: vi.fn(),
    legacyPool: vi.fn(),
    dormant: vi.fn(() => pool),
    reaper: vi.fn(async () => ({ scanned: 0, killed: 0, pids: [] })),
    http: vi.fn(),
    ws: vi.fn(),
    httpReady: vi.fn(async () => {}),
    wsReady: vi.fn(async () => {}),
    closeHttp: vi.fn(async () => {}),
    closeWs: vi.fn(async () => {}),
    queue: vi.fn(() => ({ stop: vi.fn() })),
    energy: vi.fn(),
    idempotency: vi.fn(),
    scheduled: vi.fn(),
    planned: vi.fn(),
    prewarm: vi.fn(() => vi.fn(async () => {})),
    stopEnergy: vi.fn(async () => {}),
    recoverScheduled: vi.fn(async () => {}),
    recoverPlanned: vi.fn(async () => {}),
    stale: vi.fn(async () => 0),
    rehydrate: vi.fn(async () => ({ userCount: 0, taskCount: 0 })),
  };
});
vi.mock('undici', () => ({ ProxyAgent: class {}, setGlobalDispatcher() {} }));
vi.mock('global-agent', () => ({ bootstrap() {} }));
vi.mock('./config/env.js', () => ({
  env: {
    NODE_ENV: 'production',
    EXECUTOR_MODE: 'auto',
    MULTI_USER: true,
    MAX_BROWSER_INSTANCES: 1,
    BROWSER_SCREEN_SIZE: '1280x800x24',
    BROWSER_POOL_DIR: '/synthetic',
    BROWSER_VNC_WS_ENABLED: false,
    HTTP_PORT: 4000,
    WS_PORT: 4002,
  },
}));
vi.mock('./config/logger.js', () => ({ logger: s.logger }));
vi.mock('./db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error('unexpected database IO during closed boot');
      },
    },
  ),
}));
vi.mock('./agent/planners/stub.js', () => ({ StubPlanner: class {} }));
vi.mock('./agent/vision-loop/playwright-executor.js', () => ({
  PlaywrightExecutor: class {
    constructor() {
      s.legacyBrowser();
    }
    async connect() {
      return { ok: false, error: 'synthetic' };
    }
  },
}));
vi.mock('./browser-pool/index.js', () => ({
  BrowserPool: class {
    constructor() {
      s.legacyPool();
    }
    static dormantStrict = s.dormant;
    startGc() {}
    canAllocate() {
      return false;
    }
  },
  reapOrphans: s.reaper,
}));
vi.mock('./agent/supercar/index.js', () => ({
  createApifyAdapter: () => null,
  createZapierAdapter: () => null,
  createExecutionRouter: () => ({ status: () => 'unavailable' }),
}));
vi.mock('./cookies/sync-service.js', () => ({ injectPendingCookies: vi.fn() }));
vi.mock('./payment/index.js', () => ({ createPayPalAdapter: () => null }));
vi.mock('./queue/task-queue.js', () => ({ createTaskQueue: s.queue }));
vi.mock('./http.js', () => ({
  createHttpApp: (deps: unknown) => {
    s.http(deps);
    return {
      listen: () => ({
        on() {},
        close(callback: () => void) {
          callback();
        },
      }),
    };
  },
}));
vi.mock('./execution/http-listener.js', () => ({
  createHttpListener: () => ({
    server: {
      on() {},
      close(cb: () => void) {
        cb();
      },
    },
    ready: s.httpReady(),
    close: s.closeHttp,
  }),
}));
vi.mock('./ws/server.js', () => ({
  createWsServer: (_port: number, deps: unknown) => {
    s.ws(deps);
    return { ready: s.wsReady(), close: s.closeWs };
  },
  loadRehydratedTasks: s.rehydrate,
}));
vi.mock('./energy/analytics-cleanup.js', () => ({
  startEnergyAnalyticsCleanup: s.energy,
  stopEnergyAnalyticsCleanup: s.stopEnergy,
}));
vi.mock('./energy/analytics-store.js', () => ({ createEnergyAnalyticsStore: () => ({}) }));
vi.mock('./api-keys/webhook-idempotency-service.js', () => ({
  startIdempotencyCleanup: s.idempotency,
  stopIdempotencyCleanup: async () => {},
}));
vi.mock('./agent/scheduled-runner.js', () => ({
  startScheduledRunner: s.scheduled,
  stopScheduledRunner: async () => {},
  recoverStuckRunningScheduledTasks: s.recoverScheduled,
}));
vi.mock('./planned/planned-runner.js', () => ({
  startPlannedRunner: s.planned,
  stopPlannedRunner: async () => {},
  recoverStuckRunningPlannedTasks: s.recoverPlanned,
  configurePlannedRunSpecialDispatcher() {},
  queuePlannedRun: vi.fn(),
}));
vi.mock('./agent/task-maintenance.js', () => ({ failStaleTasksWithEvents: s.stale }));
vi.mock('./agent/a-share/briefing-dispatch.js', () => ({ isBriefingIntent: () => false }));
vi.mock('./agent/a-share/prewarm-scheduler.js', () => ({
  startPrewarmScheduler: s.prewarm,
  warmSharedCaches: vi.fn(),
  warmSymbolTable: vi.fn(),
}));
vi.mock('./agent/a-share/akshare-http-client.js', () => ({ HttpAkshareClient: class {} }));
vi.mock('./stocks/stock-risk-monitor-executor.js', () => ({
  createStockRiskMonitorSpecialDispatcher: () => ({}),
}));
vi.mock('./trpc/routers/stocks-risk-radar.js', () => ({
  createStockRiskRadarHttpClient: () => ({}),
}));
vi.mock('./trpc/routers/tasks.js', () => ({ tasksRouter: {} }));
vi.mock('./files/storage-provider.js', () => ({ getSharedStorageProvider: () => ({}) }));
vi.mock('./files/file-service.js', () => ({ FileService: class {} }));
vi.mock('./files/download-manager.js', () => ({ DownloadManager: class {} }));
vi.mock('./streaming/screencast-proxy.js', () => ({
  createScreencastProxy: () => ({ handleUpgrade() {} }),
}));
vi.mock('./browser-pool/vnc-proxy.js', () => ({ createVncProxy: () => ({ handleUpgrade() {} }) }));
vi.mock('./evidence/retention-reaper.js', () => ({ runRetentionReaper: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('controlled main passes one original controller everywhere and never starts legacy browser/recovery work', async () => {
  vi.stubEnv('HEADED_CDP_ENDPOINT', 'synthetic');
  vi.stubEnv('RETENTION_REAPER_ENABLED', 'false');
  vi.stubEnv('USER_TASK_CRYSTALLIZE_ENABLED', 'false');
  vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref() {} } as never);
  vi.spyOn(process, 'on').mockReturnValue(process);
  const controller = Object.freeze({
    drain: Object.freeze({ block: vi.fn(), snapshot: () => ({ mode: 'closed' }) }),
    quiesce: vi.fn(() => true),
  });
  const broker = Object.freeze({});
  const close = vi.fn(async () => {});
  const { startApplication } = await import('./application-main.js');
  const app = await startApplication({ controller, broker, close } as never);
  for (const factory of [
    s.http,
    s.ws,
    s.queue,
    s.energy,
    s.idempotency,
    s.scheduled,
    s.planned,
    s.prewarm,
  ]) {
    expect.soft(factory).toHaveBeenCalledOnce();
    expect.soft(factory.mock.calls[0]?.[0]).toMatchObject({ executionDrain: controller });
  }
  expect
    .soft(s.dormant)
    .toHaveBeenCalledWith(expect.any(Object), s.logger, { drain: controller.drain }, broker);
  for (const legacy of [
    s.legacyBrowser,
    s.legacyPool,
    s.reaper,
    s.recoverScheduled,
    s.recoverPlanned,
    s.stale,
    s.rehydrate,
  ])
    expect.soft(legacy).not.toHaveBeenCalled();
  expect(app, 'main must retain an awaitable shutdown').toBeDefined();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.stopEnergy.mockImplementationOnce(() => held);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('no forced exit');
  });
  const stopped = app.shutdown('synthetic');
  try {
    expect(controller.quiesce).toHaveBeenCalledOnce();
    expect(s.stopEnergy).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
  } finally {
    release();
  }
  await stopped;
  expect(close).toHaveBeenCalledOnce();
  expect(exit).not.toHaveBeenCalled();
});

it.each(['RETENTION_REAPER_ENABLED', 'USER_TASK_CRYSTALLIZE_ENABLED'])(
  'controlled startup refuses unmigrated %s instead of running it outside ownership',
  async (flag) => {
    vi.stubEnv(flag, 'true');
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref() {} } as never);
    vi.spyOn(process, 'on').mockReturnValue(process);
    const { startApplication } = await import('./application-main.js');
    await expect(
      startApplication({ controller: {}, broker: {}, close: async () => {} } as never),
    ).rejects.toThrow('CONTROLLED_BACKGROUND_UNPROVEN');
    expect(s.http).not.toHaveBeenCalled();
    expect(s.dormant).not.toHaveBeenCalled();
  },
);

it.each(['http', 'ws'] as const)(
  'main awaits %s readiness and its failed startup cleanup',
  async (kind) => {
    vi.stubEnv('RETENTION_REAPER_ENABLED', 'false');
    vi.stubEnv('USER_TASK_CRYSTALLIZE_ENABLED', 'false');
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref() {} } as never);
    vi.spyOn(process, 'on').mockReturnValue(process);
    let fail!: (error: Error) => void;
    const readiness = new Promise<void>((_yes, no) => {
      fail = no;
    });
    let release!: () => void;
    const cleanup = new Promise<void>((yes) => {
      release = yes;
    });
    const ready = kind === 'http' ? s.httpReady : s.wsReady;
    const stopped = kind === 'http' ? s.closeHttp : s.closeWs;
    ready.mockImplementationOnce(() => readiness);
    stopped.mockImplementationOnce(() => cleanup);
    const controller = {
      drain: { block: vi.fn(), snapshot: () => ({ mode: 'closed' }) },
      quiesce: vi.fn(() => true),
    };
    const close = vi.fn(async () => {});
    const { startApplication } = await import('./application-main.js');
    let settled = false;
    const pending = startApplication({ controller, broker: {}, close } as never);
    const observed = pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
      if (kind === 'http') expect(s.ws).not.toHaveBeenCalled();
      fail(new Error('synthetic bind failure'));
      await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
      expect(controller.quiesce).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
      expect(close).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await expect(pending).rejects.toThrow('synthetic bind failure');
    await observed;
    expect(close).toHaveBeenCalledOnce();
    expect(s.pool.shutdown).toHaveBeenCalledOnce();
  },
);
