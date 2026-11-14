/**
 * BROWSER-HOME-1 step 4 — tasks.create({ browserHomeSession: true }) runs IN the person's open
 * cloud browser and gives it back on every terminal state.
 *
 * The real tasks.create path (admission, quota, the browser lane's dispatch, the run's terminal
 * persistence and release) on a real BrowserPool whose process spawn is stubbed. The search /
 * agent runner itself is replaced by a script returning each terminal outcome, so the test is
 * about the browser's ownership, not the model.
 */

import { pino } from 'pino';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as classifier from '../../agent/intent-classifier.js';
import type { SupercarOutcome } from '../../agent/supercar/agent-loop.js';
import { browserControlSessions } from '../../agent/supercar/browser-control-sessions.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { BROWSER_HOME_IDLE_TIMEOUT_MS } from '../../browser-home/browser-home-session.js';
import { lendBrowserHomeToTask } from '../../browser-home/browser-home-task.js';
import { BrowserPool } from '../../browser-pool/browser-pool.js';
import type {
  BrowserInstance,
  BrowserSessionTarget,
  PoolConfig,
} from '../../browser-pool/types.js';
import { env } from '../../config/env.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import * as messages from '../../llm/messages-adapter.js';
import { QuotaService } from '../../quota/quota-service.js';
import { pickInstanceForRoute } from '../../streaming/screencast-proxy.js';
import * as extensionWs from '../../ws/server.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

type RunArgs = { taskId: string; executor: unknown; preserveExistingPage?: boolean };
const script = vi.hoisted(() => ({
  run: null as null | ((args: RunArgs) => Promise<unknown>),
}));

vi.mock('../../agent/search-fallback/search-engine-fallback.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../agent/search-fallback/search-engine-fallback.js')>();
  return {
    ...original,
    runSearchWithFallback: vi.fn(async (args: RunArgs) => {
      if (!script.run) throw new Error('no scripted run');
      return script.run(args);
    }),
  };
});

const USER = 'usr_browser_home';
const OTHER = 'usr_browser_home_other';
const original = { ...env };

function makePool() {
  const cfg: PoolConfig = {
    maxInstances: 4,
    idleTimeoutMs: 300_000,
    baseDir: '/tmp/holaday-test',
    cdpPortStart: 9300,
    vncPortStart: 5910,
    wsPortStart: 6090,
    displayStart: 100,
    screenSize: '1280x800x24',
  };
  const pool = new BrowserPool(cfg, pino({ level: 'silent' }));
  const page = {
    url: () => 'https://shop.example/item/1',
    title: async () => 'Item 1',
    evaluate: async () => ({ bodyTextLen: 100, images: 0, inputs: 0, buttons: 1 }),
    waitForTimeout: async () => {},
    screenshot: async () => Buffer.from('jpeg'),
  };
  const spawn = vi.fn(
    async (taskId: string, userId: string, _profile?: unknown, session?: BrowserSessionTarget) => {
      const allocator = (pool as unknown as { allocator: { claim: () => unknown } }).allocator;
      const slot = allocator.claim() as {
        index: number;
        display: number;
        cdpPort: number;
        vncPort: number;
        wsPort: number;
      };
      const inst: BrowserInstance = {
        ...slot,
        taskId,
        userId,
        ...(session?.sessionPolicy ? { sessionPolicy: session.sessionPolicy } : {}),
        userDataDir: `/tmp/test-task-${taskId}`,
        executor: {
          getPage: async () => page,
          resetPageForTask: vi.fn(async () => {}),
          navigate: vi.fn(async () => ({ ok: true })),
          screenshot: async () => ({
            base64: 'cGFnZQ==',
            viewportWidth: 1280,
            viewportHeight: 800,
          }),
          disconnect: vi.fn().mockResolvedValue(undefined),
        } as unknown as BrowserInstance['executor'],
        xvfbPid: 1000 + slot.index,
        bravePid: 2000 + slot.index,
        x11vncPid: 3000 + slot.index,
        websockifyPid: 4000 + slot.index,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        status: 'ready',
      };
      (pool as unknown as { instances: Map<string, BrowserInstance> }).instances.set(taskId, inst);
      return inst;
    },
  );
  (pool as unknown as { spawnInstance: typeof spawn }).spawnInstance = spawn;
  (pool as unknown as { tearDownInstance: () => Promise<void> }).tearDownInstance = async () =>
    undefined;
  return { pool, spawn };
}

async function openHome(pool: BrowserPool, userId = USER): Promise<BrowserInstance> {
  const inst = await pool.allocate(`bhs_${userId}`, userId, undefined, {
    sessionPolicy: 'anonymous',
  });
  pool.setIdleTimeout(`bhs_${userId}`, BROWSER_HOME_IDLE_TIMEOUT_MS);
  return inst;
}

function makeCtx(pool: BrowserPool, userId = USER) {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const db = {
    select(projection: Record<string, unknown> = {}) {
      const rows =
        'plan' in projection
          ? [{ id: 41, plan: 'pro', selectedRoles: [], selectedSkills: [], modelDataRegion: 'cn' }]
          : 'count' in projection
            ? [{ count: 0 }]
            : Object.keys(projection).length === 1 && 'id' in projection
              ? [{ id: 41 }]
              : [];
      const query = {
        where: () => query,
        orderBy: () => query,
        limit: async () => rows,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return { from: () => query };
    },
    insert: () => ({ values: async () => [] }),
    async transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      return await operation(db);
    },
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  return {
    db,
    logger,
    userId,
    req: {},
    res: {},
    planner: {},
    playwrightExecutor: null,
    executionRouter: null,
    browserPool: pool,
    taskQueue: null,
  } as unknown as Context;
}

const intent = '把这个页面的标题和价格整理一下';

let terminal: MockInstance<TaskRepository['persistVisionOutcome']>;
let consume: MockInstance<QuotaService['tryConsume']>;

beforeEach(() => {
  script.run = null;
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    AGENT_MODE: 'legacy',
    QWEN_CORE_ALLOWLIST: `${USER},${OTHER}`,
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ENABLED_LANES: 'browser',
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: 'synthetic-cn',
    DASHSCOPE_API_KEY: '',
    BROWSER_HOME_ENABLED: true,
    BROWSER_HOME_ALLOWLIST: '',
  });
  // Even a classifier that says "write it" never moves a cloud-browser task off the browser lane.
  vi.spyOn(classifier, 'explainExecutionMode').mockResolvedValue({
    mode: 'generate',
    source: 'test',
  });
  consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
  vi.spyOn(TaskRepository.prototype, 'isTaskCancelled').mockResolvedValue(false);
  vi.spyOn(TaskRepository.prototype, 'persistAwaitingUser').mockResolvedValue({ persisted: true });
  terminal = vi
    .spyOn(TaskRepository.prototype, 'persistVisionOutcome')
    .mockResolvedValue({ persisted: true });
  vi.spyOn(extensionWs, 'broadcastToUser').mockImplementation(() => 0);
  const metadata = {
    provider: 'alibaba-model-studio',
    model: 'qwen-fixture',
    region: 'cn',
    deploymentScope: 'china_mainland',
    endpointKind: 'public',
    protocol: 'messages',
  } as const;
  vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
    metadata,
    async create() {
      return {
        id: 'skip',
        metadata,
        stopReason: 'end_turn',
        content: [{ type: 'text', text: '{"skip":true}' }],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          complete: true,
        },
      };
    },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  reloadFeatureFlagsForTest();
  Object.assign(env, original);
  vi.restoreAllMocks();
});

/** The stream route the /browser page keeps using: `bhs_<userId>`. */
function streamFor(pool: BrowserPool, userId = USER) {
  return pickInstanceForRoute({
    urlArg: `bhs_${userId}`,
    callerUserId: userId,
    peek: (id) => pool.peek(id),
    peekActiveForUser: (id) => pool.peekActiveForUser(id),
    browserHomeAllowed: () => true,
    peekBrowserHome: (id) => pool.peekBrowserHome(id),
  });
}

const outcomes: Record<string, () => SupercarOutcome> = {
  completed: () => ({
    status: 'completed',
    summary: '标题：Item 1；价格：¥99',
    iterations: 2,
    toolsUsed: [],
  }),
  partial: () => ({
    status: 'completed',
    summary: '1. Item 1 ¥99',
    iterations: 2,
    toolsUsed: [],
    partial: { found: 1, wanted: 3 },
  }),
  failed: () => ({ status: 'failed', reason: '页面打不开', iterations: 1, toolsUsed: [] }),
  cancelled: () => ({ status: 'cancelled', iterations: 1, toolsUsed: [] }),
  timeout: () => ({ status: 'timeout', reason: '超时', iterations: 1, toolsUsed: [] }),
  // The wait for the person's reply ran out: the runner ends while the task still asks.
  'awaiting-user timeout': () => ({
    status: 'awaiting_user',
    question: '请先登录',
    iterations: 1,
    toolsUsed: [],
  }),
};

describe('tasks.create browserHomeSession — hand-over and hand-back', () => {
  it.each([...Object.keys(outcomes), 'runner throws'])(
    'runs in the open browser from its page, and gives it back: %s',
    async (kind) => {
      const { pool, spawn } = makePool();
      const home = await openHome(pool);
      const seen: Array<Record<string, unknown>> = [];
      script.run = async (args) => {
        seen.push({
          taskKey: pool.peek(args.taskId),
          sessionKey: pool.peek(`bhs_${USER}`),
          executor: args.executor,
          preserveExistingPage: args.preserveExistingPage,
          holder: pool.browserHomeHolder(USER),
          stream: streamFor(pool),
        });
        if (kind === 'runner throws') throw new Error('runner exploded');
        return outcomes[kind]!();
      };

      const result = await tasksRouter
        .createCaller(makeCtx(pool))
        .create({ intent, browserHomeSession: true, mode: 'auto', expertMode: 'normal' });

      expect(result.status).toBe('executing');
      expect(result.executionMode).toBe('browser');
      await vi.waitFor(() => expect(pool.peek(`bhs_${USER}`)).toBe(home), { timeout: 10_000 });

      // While it ran: the task held the very same browser, kept its page, the stream followed it.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        taskKey: home,
        sessionKey: null,
        executor: home.executor,
        preserveExistingPage: true,
        holder: result.taskId,
        stream: { kind: 'instance', instance: home },
      });
      expect(home.executor.resetPageForTask).not.toHaveBeenCalled();

      // After: back in the session with its 15-minute idle; the task key is gone; nothing spawned.
      expect(pool.peek(result.taskId)).toBeNull();
      expect(home.taskId).toBe(`bhs_${USER}`);
      expect(home.idleTimeoutMs).toBe(BROWSER_HOME_IDLE_TIMEOUT_MS);
      expect(home.retainedUntil).toBeUndefined();
      expect(pool.browserHomeHolder(USER)).toBeNull();
      expect(streamFor(pool)).toEqual({ kind: 'instance', instance: home });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(consume).toHaveBeenCalledTimes(1);
      if (kind !== 'awaiting-user timeout')
        await vi.waitFor(() => expect(terminal).toHaveBeenCalled());
    },
    20_000,
  );

  it('a second send while one runs is refused, and the running task keeps the browser', async () => {
    const { pool } = makePool();
    const home = await openHome(pool);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    script.run = async () => {
      started();
      await gate;
      return outcomes.completed!();
    };
    const caller = tasksRouter.createCaller(makeCtx(pool));
    const first = await caller.create({ intent, browserHomeSession: true });
    await running;

    await expect(caller.create({ intent, browserHomeSession: true })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: '云浏览器里已有一个任务在执行，请等它结束后再发送。',
    });
    expect(pool.browserHomeHolder(USER)).toBe(first.taskId);
    expect(consume).toHaveBeenCalledTimes(1);

    finish();
    await vi.waitFor(() => expect(pool.peek(`bhs_${USER}`)).toBe(home), { timeout: 10_000 });
    // And once it is back, the next send runs.
    script.run = async () => outcomes.completed!();
    const next = await caller.create({ intent, browserHomeSession: true });
    expect(next.status).toBe('executing');
    await vi.waitFor(() => expect(pool.peek(`bhs_${USER}`)).toBe(home), { timeout: 10_000 });
  });

  it("another user's send never reaches this browser", async () => {
    const { pool } = makePool();
    const home = await openHome(pool);
    script.run = async () => outcomes.completed!();
    await expect(
      tasksRouter.createCaller(makeCtx(pool, OTHER)).create({ intent, browserHomeSession: true }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: '云浏览器还没有打开，请先打开云浏览器再发送任务。',
    });
    expect(pool.peek(`bhs_${USER}`)).toBe(home);
    expect(pool.browserHomeHolder(USER)).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });

  it('flag off (or not on the allowlist): refused before anything is created or charged', async () => {
    const { pool } = makePool();
    await openHome(pool);
    const insert = vi.mocked(TaskRepository.prototype.insertTask);
    Object.assign(env, { BROWSER_HOME_ENABLED: false });
    await expect(
      tasksRouter.createCaller(makeCtx(pool)).create({ intent, browserHomeSession: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: '云浏览器暂未开放，任务没有发送。' });
    Object.assign(env, { BROWSER_HOME_ENABLED: true, BROWSER_HOME_ALLOWLIST: 'usr_someone_else' });
    await expect(
      tasksRouter.createCaller(makeCtx(pool)).create({ intent, browserHomeSession: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(insert).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(pool.browserHomeHolder(USER)).toBeNull();
  });

  it('no open cloud browser: refused', async () => {
    const { pool } = makePool();
    await expect(
      tasksRouter.createCaller(makeCtx(pool)).create({ intent, browserHomeSession: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(consume).not.toHaveBeenCalled();
  });

  it.each([
    ['replyToTaskId', { replyToTaskId: 'tsk_parent' }],
    [
      'localChrome',
      {
        localChrome: {
          extensionClientId: '48a8a099-0987-40e3-aa14-fb4545f9a003',
          tabId: 42,
          expectedUrl: 'https://work.example',
          selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
        },
      },
    ],
    ['publicCloudContinuationOf', { publicCloudContinuationOf: 'tsk_original' }],
  ])('combined with %s: refused', async (_name, extra) => {
    const { pool } = makePool();
    await openHome(pool);
    await expect(
      tasksRouter
        .createCaller(makeCtx(pool))
        .create({ intent, browserHomeSession: true, ...extra }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|BAD_REQUEST/) });
    expect(consume).not.toHaveBeenCalled();
    expect(pool.browserHomeHolder(USER)).toBeNull();
  });

  it('closed while the task holds it: nothing is given back, the task finishes normally', async () => {
    const { pool } = makePool();
    const home = await openHome(pool);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    script.run = async () => {
      started();
      await gate;
      return outcomes.completed!();
    };
    const first = await tasksRouter
      .createCaller(makeCtx(pool))
      .create({ intent, browserHomeSession: true });
    await running;
    expect(pool.endBrowserHomeLoan(USER)).toBe(first.taskId);
    finish();
    await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 10_000 });
    await vi.waitFor(() => expect(pool.peek(first.taskId)?.retainedUntil).toBeDefined());
    expect(pool.peek(`bhs_${USER}`)).toBeNull();
    expect(pool.peek(first.taskId)).toBe(home);
  });

  it('ordinary tasks are untouched: no browserHomeSession, the classifier still routes', async () => {
    const { pool } = makePool();
    const home = await openHome(pool);
    vi.mocked(classifier.explainExecutionMode).mockResolvedValue({
      mode: 'browser',
      source: 'test',
    });
    script.run = async (args) => {
      expect(pool.peek(args.taskId)).not.toBe(home);
      return outcomes.completed!();
    };
    const result = await tasksRouter.createCaller(makeCtx(pool)).create({ intent });
    await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 10_000 });
    expect(pool.peek(`bhs_${USER}`)).toBe(home);
    expect(pool.peek(result.taskId)).not.toBe(home);
  });

  it('watchdog on a wedged run: the browser is released, never handed to the person (P1-1)', async () => {
    // The watchdog fires SUPERCAR_TIMEOUT_MS + 30 s after the run starts: here ~100 ms.
    vi.stubEnv('SUPERCAR_TIMEOUT_MS', String(-30_000 + 100));
    const { pool } = makePool();
    const home = await openHome(pool);
    const release = vi.spyOn(pool, 'release');
    let unstick!: () => void;
    const stuck = new Promise<void>((resolve) => {
      unstick = resolve;
    });
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    // A run that ignores the abort and keeps going.
    script.run = async () => {
      started();
      await stuck;
      return outcomes.completed!();
    };
    const result = await tasksRouter
      .createCaller(makeCtx(pool))
      .create({ intent, browserHomeSession: true });
    await running;
    await vi.waitFor(
      () => expect(release).toHaveBeenCalledWith(result.taskId, 'watchdog-force-release'),
      { timeout: 5_000 },
    );
    expect(pool.peek(`bhs_${USER}`)).toBeNull();
    expect(pool.browserHomeHolder(USER)).toBeNull();
    expect(streamFor(pool)).not.toMatchObject({ kind: 'instance' });

    // The wedged run ends later: still nothing goes back to the person.
    unstick();
    await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pool.peek(`bhs_${USER}`)).toBeNull();
    expect(home.taskId).toBe(result.taskId);
  });

  it("a task sent while the person's own action is in flight waits for it, then runs (P2-6)", async () => {
    const { pool } = makePool();
    const home = await openHome(pool);
    const review = browserControlSessions.review(home);
    let finishAction!: () => void;
    const action = review.control.runHuman(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
      'navigate',
    );
    const starts: Array<string> = [];
    script.run = async (args) => {
      const factory = (args as { browserControlFactory?: () => { finish(): void } })
        .browserControlFactory;
      try {
        factory?.().finish();
        starts.push('started');
      } catch (error) {
        starts.push(error instanceof Error ? error.message : String(error));
      }
      return outcomes.completed!();
    };
    const result = await tasksRouter
      .createCaller(makeCtx(pool))
      .create({ intent, browserHomeSession: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(starts).toEqual([]);
    finishAction();
    await action;
    await vi.waitFor(() => expect(starts).toEqual(['started']), { timeout: 10_000 });
    await vi.waitFor(() => expect(pool.peek(`bhs_${USER}`)).toBe(home), { timeout: 10_000 });
    expect(result.status).toBe('executing');
  });
});

describe('lendBrowserHomeToTask — the person still acting (P2-6)', () => {
  it('fails with a clear Chinese message when the action does not settle in time; nothing lent', async () => {
    const { pool } = makePool();
    const home = await openHome(pool);
    const review = browserControlSessions.review(home);
    let finishAction!: () => void;
    const action = review.control.runHuman(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
      'navigate',
    );
    const claim = { handOver: vi.fn(), release: vi.fn(), settle: vi.fn() };
    await expect(
      lendBrowserHomeToTask({ pool, userId: USER, taskId: 'tsk_busy', claim, settleMs: 50 }),
    ).rejects.toThrow('你在云浏览器里的操作还没有完成，任务没有执行。请稍后再发送。');
    expect(claim.release).toHaveBeenCalled();
    expect(pool.peek(`bhs_${USER}`)).toBe(home);
    expect(pool.browserHomeHolder(USER)).toBeNull();
    finishAction();
    await action;
    // Settled: lent at once.
    await expect(
      lendBrowserHomeToTask({ pool, userId: USER, taskId: 'tsk_now', claim: null, settleMs: 50 }),
    ).resolves.toBe(home);
  });
});
