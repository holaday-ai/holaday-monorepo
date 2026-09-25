import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OrdinaryMaintenance, type MaintenanceRecord } from './execution/ordinary-maintenance.js';
import type { OrdinaryApplicationHooks } from './execution/ordinary-application.js';

// Factory wiring only: service behavior has separate real drain/IO tests. No
// database, browser, HTTP server, queue or production authority is supplied here.
const s = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  const pool = { canAllocate: () => false, startGc: vi.fn(), shutdown: vi.fn(async () => {}) };
  return {
    logger,
    pool,
    legacyBrowser: vi.fn(),
    browserConnect: vi.fn(async () => ({ ok: false, error: 'synthetic' })),
    legacyPool: vi.fn(),
    dormant: vi.fn(() => pool),
    reaper: vi.fn(async () => ({ scanned: 0, killed: 0, pids: [] })),
    http: vi.fn(),
    ws: vi.fn(),
    httpReady: vi.fn(async () => {}),
    wsReady: vi.fn(async () => {}),
    closeHttp: vi.fn(async () => {}),
    closeWs: vi.fn(async () => {}),
    queue: vi.fn(() => ({ stop: vi.fn(async () => {}), size: () => 0 })),
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
  pool: { end: vi.fn(async () => {}) },
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
      return s.browserConnect();
    }
    async disconnect() {}
  },
}));
vi.mock('./browser-pool/index.js', () => ({
  BrowserPool: class {
    private paused = false;
    constructor() {
      s.legacyPool();
    }
    static dormantStrict = s.dormant;
    startGc() {
      this.paused = false;
    }
    stopGc() {}
    async pauseMaintenanceProducers() {
      this.paused = true;
    }
    assertMaintenanceIdle() {
      if (!this.paused) throw new Error('MAINTENANCE_POOL_UNPROVEN');
    }
    async shutdown() {}
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

async function ordinaryFixture() {
  vi.stubEnv('RETENTION_REAPER_ENABLED', 'false');
  vi.stubEnv('USER_TASK_CRYSTALLIZE_ENABLED', 'false');
  vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref() {} } as never);
  vi.spyOn(process, 'on').mockReturnValue(process);
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: false };
  let hooks: OrdinaryApplicationHooks | undefined;
  const coordinator = new OrdinaryMaintenance({
    identity,
    journal: {
      read: () => record,
      persist: (input) => {
        record = { identity, ...input };
      },
    },
    checks: {
      async verifyReady() {
        if (!hooks) throw new Error('not bound');
      },
      prepareServing: async () => {
        await hooks!.prepareServing();
      },
      startProducers: () => hooks!.startProducers(),
      stopProducers: async () => {
        await hooks?.stopProducers();
      },
      verifyRetainedQueue: async () => {
        await hooks!.verifyRetainedQueue();
      },
    },
  });
  const closeState = vi.fn();
  const closeControl = vi.fn(async () => {
    await coordinator.beginMaintenance();
  });
  const { startApplication } = await import('./application-main.js');
  const application = await startApplication(undefined, {
    coordinator,
    bind(value) {
      hooks = value;
    },
    closeState,
    closeControl,
  });
  expect(hooks).toBeDefined();
  return { application, coordinator, closeState, closeControl, readRecord: () => record };
}
it('ordinary maintenance boot is dormant until verified open and preserves receipt listeners while draining', async () => {
  const { application, coordinator, closeState, closeControl, readRecord } =
    await ordinaryFixture();
  for (const factory of [
    s.legacyBrowser,
    s.legacyPool,
    s.reaper,
    s.queue,
    s.energy,
    s.idempotency,
    s.scheduled,
    s.planned,
    s.prewarm,
    s.recoverScheduled,
    s.recoverPlanned,
    s.stale,
    s.rehydrate,
  ])
    expect.soft(factory).not.toHaveBeenCalled();
  expect(s.http.mock.calls[0]?.[0]).toMatchObject({
    executionDrain: coordinator,
    ordinaryMaintenance: coordinator,
  });
  expect(s.ws.mock.calls[0]?.[0]).toMatchObject({
    executionDrain: coordinator,
    ordinaryMaintenance: coordinator,
  });
  await coordinator.resumeServing();
  for (const factory of [s.queue, s.energy, s.idempotency, s.scheduled, s.planned, s.prewarm])
    expect.soft(factory).toHaveBeenCalledOnce();
  expect(s.reaper).not.toHaveBeenCalled();
  expect(s.recoverScheduled).not.toHaveBeenCalled();
  expect(s.recoverPlanned).not.toHaveBeenCalled();
  expect(s.stale).not.toHaveBeenCalled();
  expect(s.rehydrate).not.toHaveBeenCalled();
  await coordinator.beginMaintenance();
  expect(s.closeWs).not.toHaveBeenCalled();
  expect(s.closeHttp).not.toHaveBeenCalled();
  await application.shutdown('synthetic');
  expect(s.closeWs).toHaveBeenCalledOnce();
  expect(s.closeHttp).toHaveBeenCalledOnce();
  expect(closeControl).toHaveBeenCalledOnce();
  expect(closeState).toHaveBeenCalledOnce();
  expect(readRecord()).toMatchObject({ mode: 'closed', needsReconciliation: false });
});
it('ordinary shutdown waits for the original producer stop before closing receipt listeners', async () => {
  const f = await ordinaryFixture();
  await f.coordinator.resumeServing();
  let done!: () => void;
  const held = new Promise<void>((resolve) => {
    done = resolve;
  });
  s.stopEnergy.mockImplementationOnce(() => held);
  const stopped = f.application.shutdown('synthetic');
  await vi.waitFor(() => expect(s.stopEnergy).toHaveBeenCalledOnce());
  expect(s.closeWs).not.toHaveBeenCalled();
  expect(s.closeHttp).not.toHaveBeenCalled();
  expect(f.closeState).not.toHaveBeenCalled();
  done();
  await stopped;
  expect(s.closeWs).toHaveBeenCalledOnce();
  expect(f.closeState).toHaveBeenCalledOnce();
});
it('ordinary producer failure preserves maintenance without closing receipts or forcing exit', async () => {
  const f = await ordinaryFixture();
  await f.coordinator.resumeServing();
  const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
  s.stopEnergy.mockRejectedValueOnce(new Error('synthetic stop failure'));
  await expect(f.application.shutdown('synthetic')).rejects.toThrow();
  expect(f.coordinator.snapshot()).toMatchObject({ mode: 'blocked', needsReconciliation: true });
  expect(s.closeWs).not.toHaveBeenCalled();
  expect(f.closeState).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});
it('close during lazy browser preparation also pauses a pool created after the close barrier', async () => {
  const f = await ordinaryFixture();
  let done!: () => void;
  const held = new Promise<void>((resolve) => {
    done = resolve;
  });
  s.browserConnect.mockImplementationOnce(async () => {
    await held;
    return { ok: false, error: 'synthetic' };
  });
  const opening = f.coordinator.resumeServing();
  const observed = expect(opening).rejects.toThrow('MAINTENANCE_OPEN_SUPERSEDED');
  await vi.waitFor(() => expect(s.browserConnect).toHaveBeenCalledOnce());
  await f.coordinator.beginMaintenance();
  done();
  await observed;
  expect(s.queue).not.toHaveBeenCalled();
  expect(s.energy).not.toHaveBeenCalled();
  await f.application.shutdown('synthetic');
  expect(f.readRecord()).toMatchObject({ mode: 'closed', needsReconciliation: false });
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

it.each(['energy', 'ws'] as const)(
  'ordinary shutdown failure at %s exits instead of leaving HTTP serving',
  async (stage) => {
    vi.stubEnv('RETENTION_REAPER_ENABLED', 'false');
    vi.stubEnv('USER_TASK_CRYSTALLIZE_ENABLED', 'false');
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref() {} } as never);
    const on = vi.spyOn(process, 'on').mockReturnValue(process);
    const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
    const previousExitCode = process.exitCode;
    try {
      const { startApplication } = await import('./application-main.js');
      await startApplication();
      expect(s.httpReady).toHaveBeenCalledOnce();
      expect(s.wsReady).toHaveBeenCalledOnce();
      const fail = stage === 'energy' ? s.stopEnergy : s.closeWs;
      fail.mockRejectedValueOnce(new Error('synthetic ordinary shutdown failure'));
      const handler = on.mock.calls.find(([event]) => event === 'SIGTERM')?.[1];
      expect(handler).toBeDefined();
      handler!();
      await vi.waitFor(() => expect(exit.mock.calls).toEqual([[1]]));
    } finally {
      process.exitCode = previousExitCode;
    }
  },
);
