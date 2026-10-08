import { createServer } from 'node:http';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { eq } from 'drizzle-orm';
import express from 'express';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Context } from '../context.js';

/** Local HTTP + real MySQL/storage/parser/dispatcher. Paid provider execution is a fixture. */
describe('acceptance generation, cancel and refund flows', () => {
  let close: () => Promise<void>;
  beforeAll(async () => {
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
    process.env.JWT_SECRET ??= 'integration-fixture-secret-at-least-32-characters';
    const { applyMigrations } = await import('../../test/db-helper.js');
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('Dedicated test database required');
    await applyMigrations(databaseUrl);
    const { pool } = await import('../../db/client.js');
    close = () => pool.end();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await close?.();
  });
  async function user() {
    const { db } = await import('../../db/client.js');
    const { users } = await import('../../db/schema/users.js');
    const { newExternalId } = await import('@holaday/shared-types');
    const externalId = newExternalId('user');
    await db.insert(users).values({
      externalId,
      email: `${externalId}@example.test`,
      passwordHash: '',
      plan: 'pro',
      modelDataRegion: 'cn',
    });
    const [row] = await db.select().from(users).where(eq(users.externalId, externalId));
    if (!row) throw new Error('Fixture user was not created');
    return row;
  }
  it('HTTP create → real owner-scoped image parse → generate → durable settlement; retry retains the same fileId', async () => {
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { tasksRouter } = await import('./tasks.js');
    const { FileService } = await import('../../files/file-service.js');
    const { env } = await import('../../config/env.js');
    const flags = await import('../../execution/feature-flags.js');
    const planning = await import('../../agent/core-task-plan.js');
    const generation = await import('../../agent/generate-runner.js');
    const { CoreTaskRepository } = await import('../../agent/core-task-repository.js');
    const admission = vi.spyOn(CoreTaskRepository.prototype, 'admit');
    const actor = await user();
    const oldEnv = { ...env };
    flags.setFeatureFlagsForTest({
      EVIDENCE_LEDGER: true,
      EXECUTION_CONTRACT: true,
      EXECUTION_VERIFIER: true,
    });
    Object.assign(env, {
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ALLOWLIST: actor.externalId,
      QWEN_CORE_ENABLED_LANES: 'plan,generate,scrape',
      QWEN_RESPONSES_ADAPTER_ENABLED: true,
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'synthetic-only',
    });
    vi.spyOn(planning, 'prepareCoreTaskPlan').mockResolvedValue('1. 读取配图\n2. 写作');
    const generate = vi.spyOn(generation, 'runGenerateTask').mockResolvedValue({
      status: 'completed',
      generation: { completeness: 'complete', stopReason: 'end_turn' },
      summary: '小猫安静地坐在窗前。此结果来自本地测试写作适配器。',
      inputTokens: 10,
      outputTokens: 10,
      durationMs: 1,
    });
    const logger = pino({ level: 'silent' });
    const fileService = new FileService(db, logger);
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=',
      'base64',
    );
    const file = await fileService.storeUpload({
      userIdInternal: actor.id,
      userExternalId: actor.externalId,
      filename: 'cat.png',
      mimetype: 'image/png',
      buffer: image,
    });
    const app = express();
    app.use(express.json());
    app.use(
      '/trpc',
      createExpressMiddleware({
        router: tasksRouter,
        createContext: () =>
          ({
            db,
            logger,
            userId: actor.externalId,
            taskOrigin: 'user',
            req: {},
            res: {},
            firecrawl: null,
            browserPool: null,
            taskQueue: null,
            planner: {},
            executionRouter: null,
            playwrightExecutor: null,
            paypalAdapter: null,
            downloadManager: null,
          }) as unknown as Context,
      }),
    );
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('local test server unavailable');
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(`http://127.0.0.1:${address.port}/trpc/create`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            intent:
              '用我上传的 cat.png 写一篇350字温暖短文，并提供可下载文章。不要调用图片生成、浏览器或网页搜索。',
            fileIds: [file.externalId],
            expertMode: 'normal',
          }),
        });
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.result.data.executionMode).toBe('generate');
        const taskId = body.result.data.taskId;
        await vi.waitFor(async () => {
          const [task] = await db.select().from(tasks).where(eq(tasks.externalId, taskId));
          expect(task?.status).toBe('completed');
        });
        const input = generate.mock.calls[attempt]?.[0];
        expect(input?.verificationContext).toMatchObject({ phase: 'direct' });
        expect(admission.mock.calls[attempt]?.[0].requirements.fileIds).toEqual([file.externalId]);
        expect(input?.verificationContext?.materials).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'image',
              source: 'file',
              data: image.toString('base64'),
            }),
          ]),
        );
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fileService.deleteForUser(file.externalId, actor.id);
      Object.assign(env, oldEnv);
      flags.reloadFeatureFlagsForTest();
    }
  });
  it('existing pet i2v quotes and confirms a 5s/1080p photo without fal or a clone clip', async () => {
    const { db } = await import('../../db/client.js');
    const { tasksRouter } = await import('./tasks.js');
    const { FileService } = await import('../../files/file-service.js');
    const { env } = await import('../../config/env.js');
    const actor = await user();
    const oldEnv = { ...env };
    Object.assign(env, {
      VIDEO_CREATION_ENABLED: true,
      VIDEO_CREATION_ALLOWLIST: actor.externalId,
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ALLOWLIST: actor.externalId,
      QWEN_CORE_ENABLED_LANES: 'plan,generate,scrape,verifier',
      QWEN_RESPONSES_ADAPTER_ENABLED: true,
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'synthetic-only',
      DASHSCOPE_API_KEY: 'synthetic-only',
      FAL_KEY: '',
    });
    const background = await import('./media-task-background.js');
    const queued = vi.spyOn(background, 'runMediaTaskBackground').mockResolvedValue(undefined);
    const logger = pino({ level: 'silent' });
    const files = new FileService(db, logger);
    const file = await files.storeUpload({
      userIdInternal: actor.id,
      userExternalId: actor.externalId,
      filename: 'pet.png',
      mimetype: 'image/png',
      buffer: Buffer.from('fixture photo'),
    });
    const caller = tasksRouter.createCaller({
      db,
      userId: actor.externalId,
      taskOrigin: 'user',
      logger,
      req: {},
      res: {},
      browserPool: null,
    } as unknown as Context);
    try {
      const quote = await caller.create({
        intent: '轻轻眨眼',
        videoOptions: {
          tab: 'pet',
          petImageFileId: file.externalId,
          petModel: 'wan_i2v',
          durationSeconds: 5,
          resolution: '1080p',
          aspectRatio: '9:16',
        },
      });
      expect(quote.status).toBe('awaiting_user');
      expect(queued).not.toHaveBeenCalled();
      const confirmed = await caller.confirmVideo({
        taskId: quote.taskId,
        choice: 'confirm_video',
      });
      expect(confirmed).toMatchObject({ status: 'executing' });
      expect(queued).toHaveBeenCalledTimes(1);
      const { quotaRefunds } = await import('../../db/schema/quota-refunds.js');
      const { QuotaService } = await import('../../quota/quota-service.js');
      const { refundTaskOnce } = await import('../../quota/platform-failure-refunds.js');
      const { TaskRepository } = await import('../../agent/task-repository.js');
      const quota = new QuotaService(db);
      const chargedBalance = (await quota.snapshot(actor.id, 'pro')).tasksRemaining;
      const [charge] = await db.select().from(quotaRefunds).where(eq(quotaRefunds.taskExternalId, confirmed.taskId));
      expect(charge).toMatchObject({ userId: actor.id, refundedAt: null });
      await new TaskRepository(db).persistVisionOutcome(confirmed.taskId, {
        status: 'failed', errorCode: 'MEDIA_VIDEO_QUALITY_REJECTED', reason: 'quality fixture', tickCount: 1,
      });
      expect(await refundTaskOnce(db, quota, confirmed.taskId, 'MEDIA_VIDEO_QUALITY_REJECTED')).toBe(true);
      expect(await refundTaskOnce(db, quota, confirmed.taskId, 'MEDIA_VIDEO_QUALITY_REJECTED')).toBe(false);
      expect((await quota.snapshot(actor.id, 'pro')).tasksRemaining).toBe(chargedBalance + 1);

    } finally {
      await files.deleteForUser(file.externalId, actor.id);
      Object.assign(env, oldEnv);
    }
  });
  it('persists future Qwen and rejected media render costs and exposes their task total to admins', async () => {
    const { db } = await import('../../db/client.js');
    const { users } = await import('../../db/schema/users.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { llmCalls } = await import('../../db/schema/llm-calls.js');
    const { DrizzleLlmCallRecorder } = await import('../../agent/llm-call-recorder.js');
    const { adminFinanceRouter } = await import('./admin-finance.js');
    const { newExternalId } = await import('@holaday/shared-types');
    const actor = await user();
    const taskId = newExternalId('task');
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, actor.id));
    await db.insert(tasks).values({
      externalId: taskId,
      userId: actor.id,
      intent: 'future cost fixture',
      status: 'failed',
      errorCode: 'MEDIA_VIDEO_QUALITY_REJECTED',
    });
    const recorder = new DrizzleLlmCallRecorder(db, {
      onError: (error) => {
        throw error;
      },
    });
    const identity = {
      userExternalId: actor.externalId,
      taskExternalId: taskId,
      latencyMs: 1,
      status: 'ok' as const,
    };
    await recorder.record({
      ...identity,
      provider: 'alibaba-model-studio',
      model: 'qwen3.8-max',
      region: 'cn',
      purpose: 'supercar.turn',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    for (let i = 0; i < 2; i++)
      await recorder.record({
        ...identity,
        provider: 'fal',
        model: 'fal-ai/veo3.1/fast',
        providerRequestId: `fixture-${i}`,
        purpose: 'media.video',
        inputTokens: null,
        outputTokens: null,
        mediaUsage: {
          unit: 'second',
          quantity: 8,
          resolution: '1080p',
          audio: false,
          basis: 'request',
        },
      });
    const records = await db.select().from(llmCalls).where(eq(llmCalls.userId, actor.id));
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.costStatus === 'estimated' && r.costUsd !== null)).toBe(true);
    const costs = await adminFinanceRouter
      .createCaller({
        db,
        userId: actor.externalId,
        taskOrigin: 'user',
        logger: pino({ level: 'silent' }),
      } as unknown as Context)
      .topCostlyTasks();
    const admin = adminFinanceRouter.createCaller({
      db,
      userId: actor.externalId,
      taskOrigin: 'user',
      logger: pino({ level: 'silent' }),
    } as unknown as Context);
    const detail = await admin.taskCost({ taskId });
    expect(detail).toMatchObject({
      callCount: 3,
      unknownCostCalls: 0,
      accounting: 'official_list_estimate',
    });
    expect(detail.totalCostUsd).toBeCloseTo(1.6021451, 6);
    const total = costs.tasks.find((t) => t.taskId === taskId);
    expect(total).toMatchObject({ callCount: 3, unknownCostCalls: 0, incompleteUsageCalls: 0 });
    expect(total?.costUsd).toBeCloseTo(1.6021451, 6);
    // A pending provider charge keeps the total unknown; it is never silently $0.
    await recorder.record({
      ...identity,
      status: 'error',
      provider: 'fal',
      model: 'fal-ai/veo3.1/fast',
      purpose: 'media.video',
      inputTokens: null,
      outputTokens: null,
    });
    const partial = await adminFinanceRouter
      .createCaller({
        db,
        userId: actor.externalId,
        taskOrigin: 'user',
        logger: pino({ level: 'silent' }),
      } as unknown as Context)
      .topCostlyTasks();
    expect(partial.tasks.find((t) => t.taskId === taskId)).toMatchObject({
      callCount: 4,
      unknownCostCalls: 1,
      costUsd: null,
    });
    expect(await admin.taskCost({ taskId })).toMatchObject({
      unknownCostCalls: 1,
      costCnyCents: null,
    });
    const nonAdmin = await user();
    await expect(
      adminFinanceRouter
        .createCaller({ db, userId: nonAdmin.externalId, taskOrigin: 'user' } as unknown as Context)
        .taskCost({ taskId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('one abort durably cancels awaiting_user even while a live runtime handle still exists', async () => {
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { tasksRouter } = await import('./tasks.js');
    const { localChromeTaskSessions } = await import(
      '../../agent/supercar/local-chrome-task-session.js'
    );
    const { newExternalId } = await import('@holaday/shared-types');
    const actor = await user();
    const taskId = newExternalId('task');
    await db.insert(tasks).values({
      externalId: taskId,
      userId: actor.id,
      intent: 'cancel fixture',
      status: 'awaiting_user',
      origin: 'user',
    });
    const handle = localChromeTaskSessions.start(
      actor.externalId,
      taskId,
      {
        extensionClientId: 'residual-test',
        tabId: 42,
        expectedUrl: 'https://work.example',
        selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
      },
      async () => ({ ok: false }),
    );
    try {
      const result = await tasksRouter
        .createCaller({
          db,
          userId: actor.externalId,
          taskOrigin: 'user',
          logger: pino({ level: 'silent' }),
          browserPool: null,
        } as unknown as Context)
        .abort({ taskId });
      expect(result).toMatchObject({ ok: true, state: 'cancelled' });
      const [task] = await db.select().from(tasks).where(eq(tasks.externalId, taskId));
      expect(task?.status).toBe('cancelled');
      expect(handle.cancellation.signal.aborted).toBe(true);
    } finally {
      await localChromeTaskSessions.finish(actor.externalId, taskId);
    }
  });
  it('quality rejection refunds exactly once, including retry after a quota database error', async () => {
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { quotaRefunds } = await import('../../db/schema/quota-refunds.js');
    const { taskQuotas } = await import('../../db/schema/task-quotas.js');
    const { QuotaService } = await import('../../quota/quota-service.js');
    const { recordQuotaCharge, refundTaskOnce, sweepPlatformFailureRefunds } = await import(
      '../../quota/platform-failure-refunds.js'
    );
    const { newExternalId } = await import('@holaday/shared-types');
    const actor = await user();
    const taskId = newExternalId('task');
    const quota = new QuotaService(db);
    expect(await quota.tryConsume(actor.id, 'pro', false)).toMatchObject({ ok: true });
    await db.insert(tasks).values({
      externalId: taskId,
      userId: actor.id,
      intent: 'quality fixture',
      status: 'failed',
      errorCode: 'MEDIA_VIDEO_QUALITY_REJECTED',
    });
    await recordQuotaCharge(db, {
      taskExternalId: taskId,
      userId: actor.id,
      plan: 'pro',
      isOpus: false,
    });
    const error = vi
      .spyOn(QuotaService.prototype, 'refundInTransaction')
      .mockRejectedValueOnce(new Error('fixture database write failed'));
    await expect(refundTaskOnce(db, quota, taskId, 'MEDIA_VIDEO_QUALITY_REJECTED')).rejects.toThrow(
      'fixture database write failed',
    );
    const [pending] = await db
      .select()
      .from(quotaRefunds)
      .where(eq(quotaRefunds.taskExternalId, taskId));
    expect(pending?.refundedAt).toBeNull();
    error.mockRestore();
    expect(await sweepPlatformFailureRefunds(db, quota)).toBe(1);
    expect(await refundTaskOnce(db, quota, taskId, 'MEDIA_VIDEO_QUALITY_REJECTED')).toBe(false);
    const [balance] = await db.select().from(taskQuotas).where(eq(taskQuotas.userId, actor.id));
    expect(balance?.tasksUsed).toBe(0);
  });
});
