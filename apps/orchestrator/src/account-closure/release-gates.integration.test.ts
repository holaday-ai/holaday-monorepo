import { and, eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/service.js';
import { DATA_CATEGORY_IDS, type DataCategoryId } from '../data-governance/types.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { accountClosureRequests, accountClosureSteps } from '../db/schema/account-closures.js';
import { apiKeys } from '../db/schema/api-keys.js';
import { notificationChannels } from '../db/schema/notifications.js';
import { plannedTasks } from '../db/schema/planned-tasks.js';
import { sessions } from '../db/schema/sessions.js';
import { taskFiles } from '../db/schema/task-files.js';
import { taskQuotas } from '../db/schema/task-quotas.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { type StorageProvider, deleteStorageObjectForClosure } from '../files/storage-provider.js';
import type { AccountClosureHandler } from './handler-contract.js';
import { paymentsEntitlementsClosureHandler } from './handlers/payments-entitlements.js';
import { createDatabaseReceiptService, serializeCompletionReceipt } from './receipt-service.js';
import { AccountClosureService, DatabaseClosureServiceRepository } from './service.js';
import { runAccountClosureWorkerTick } from './worker.js';

const HMAC_SECRET = 'task11-release-gate-hmac-secret-at-least-32-bytes';
const SENTINEL = 'task11-private-sentinel';
const OLD_EMAIL = `${SENTINEL}@example.test`;
const OLD_PHONE = '13800138111';
const REQUESTED_AT = new Date('2026-08-26T08:00:00.000Z');
const ORIGINAL_EXPIRY = new Date('2027-02-03T04:05:06.000Z');

describe.sequential('account closure synthetic release gate', () => {
  let db: typeof import('../db/client.js').db;
  let closePool: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(databaseUrl);
    const client = await import('../db/client.js');
    db = client.db;
    closePool = () => client.pool.end();
  });

  afterAll(async () => {
    await closePool();
  });

  it('submits, restores, retries object cleanup, closes, and releases an unlinked identity', async () => {
    const user = await createLargeSyntheticAccount();
    let liveNow = REQUESTED_AT;
    const recoveryClaims = new Map<
      string,
      {
        sub: string;
        requestId: string;
        authVersion: number;
        aud: 'account-closure-recovery';
      }
    >();
    const challenge = {
      createChallenge: vi.fn(async () => ({
        challengeId: `ach-${challenge.createChallenge.mock.calls.length + 1}`,
        channel: 'email' as const,
        maskedDestination: 't***l@example.test',
        expiresAt: new Date(liveNow.getTime() + 600_000),
      })),
      verifyChallenge: vi.fn(async () => undefined),
    };
    const receipts = createDatabaseReceiptService(db);
    const service = new AccountClosureService({
      repository: new DatabaseClosureServiceRepository(db),
      challenge,
      mfa: { verifyUserFactor: vi.fn(async () => undefined) },
      receipts,
      verifyRecoveryToken: async (token) => recoveryClaims.get(token) ?? null,
      signRecoveryToken: async (claims) => {
        const token = `recovery-${claims.requestId}`;
        recoveryClaims.set(token, { ...claims, aud: 'account-closure-recovery' });
        return token;
      },
      now: () => liveNow,
      logger: { error: vi.fn() },
      config: { enabled: true, allowlist: new Set([user.externalId]) },
    });

    await expect(service.preview(user.externalId)).resolves.toMatchObject({
      graceEndsAt: new Date(REQUESTED_AT.getTime() + 168 * 60 * 60 * 1_000).toISOString(),
      plan: { name: 'pro', expiresAt: ORIGINAL_EXPIRY.toISOString() },
      counts: { activeTasks: 1, futureTasks: 1, files: 205, notificationChannels: 1 },
      automaticRefund: false,
    });
    await service.requestVerification(user.externalId);
    const firstApplication = await service.begin(user.externalId, beginInput('ach-1'));
    expect(challenge.verifyChallenge).toHaveBeenCalled();
    await expectFrozenAndStopped(user.id);

    await service.requestCancellationVerification(firstApplication.recoveryToken);
    await service.cancel(firstApplication.recoveryToken, {
      challengeId: 'ach-2',
      code: '482901',
    });
    await expectExactlyRestored(user.id);

    liveNow = new Date(REQUESTED_AT.getTime() + 1_000);
    await service.requestVerification(user.externalId);
    const secondApplication = await service.begin(user.externalId, beginInput('ach-3'));
    const applicationReceipt = await service.applicationReceipt(secondApplication.recoveryToken);
    expect(applicationReceipt.receiptNumber).not.toBe(firstApplication.receipt.receiptNumber);

    liveNow = new Date(secondApplication.graceEndsAt);
    expect(liveNow.getTime() - (REQUESTED_AT.getTime() + 1_000)).toBe(168 * 60 * 60 * 1_000);

    const storageObjects = new Set(
      Array.from({ length: 205 }, (_, index) => `objects/task11/${index + 1}`),
    );
    let storageFailedOnce = false;
    const storageDelete = vi.fn(async (path: string) => {
      if (!storageFailedOnce) {
        storageFailedOnce = true;
        throw new Error('synthetic storage unavailable');
      }
      storageObjects.delete(path);
    });
    const storage = { delete: storageDelete } as unknown as StorageProvider;
    let activePages = 0;
    let maxActivePages = 0;
    const mediaHandler = createReleaseMediaHandler();
    const handlers = new Map<DataCategoryId, AccountClosureHandler>(
      DATA_CATEGORY_IDS.map((categoryId) => {
        const handler =
          categoryId === 'media_assets'
            ? mediaHandler
            : categoryId === 'payments_entitlements'
              ? paymentsEntitlementsClosureHandler
              : noContentHandler(categoryId);
        return [
          categoryId,
          {
            ...handler,
            async run(context) {
              activePages += 1;
              maxActivePages = Math.max(maxActivePages, activePages);
              try {
                return await handler.run(context);
              } finally {
                activePages -= 1;
              }
            },
          },
        ];
      }),
    );
    const logLines: string[] = [];
    const logger = pino({ level: 'info' }, {
      write: (message: string) => logLines.push(message),
    } as never);
    const acceptedReceiptNumbers: string[] = [];
    const notification = {
      emailSender: {
        privateDelivery: true as const,
        isAvailable: () => true,
        send: vi.fn(async (message: { idempotencyKey?: string }) => {
          acceptedReceiptNumbers.push(message.idempotencyKey ?? '');
        }),
      },
      smsGateway: { sendAccountClosureComplete: vi.fn(async () => undefined) },
    };
    const observedWorkerIds = new Set<string>();
    let peakRss = process.memoryUsage().rss;
    let completed = false;

    for (let tick = 0; tick < 40; tick += 1) {
      const workerId = 'task11-single-worker';
      observedWorkerIds.add(workerId);
      await runAccountClosureWorkerTick({
        db,
        handlers,
        workerId,
        now: () => liveNow,
        rssBytes: () => process.memoryUsage().rss,
        enabled: true,
        logger,
        storage,
        hmacSecret: HMAC_SECRET,
        notification,
      });
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      const [request] = await db
        .select({ status: accountClosureRequests.status })
        .from(accountClosureRequests)
        .where(
          eq(
            accountClosureRequests.externalId,
            recoveryClaims.get(secondApplication.recoveryToken)?.requestId ?? '',
          ),
        )
        .limit(1);
      if (request?.status === 'completed') {
        completed = true;
        break;
      }
      liveNow = new Date(liveNow.getTime() + 60_001);
    }

    expect(completed).toBe(true);
    expect(storageFailedOnce).toBe(true);
    expect(storageDelete).toHaveBeenCalledTimes(206);
    expect(storageObjects.size).toBe(0);
    expect(observedWorkerIds).toEqual(new Set(['task11-single-worker']));
    expect(maxActivePages).toBe(1);
    expect(peakRss).toBeLessThan(512 * 1024 * 1024);
    expect(acceptedReceiptNumbers).toHaveLength(1);
    expect(acceptedReceiptNumbers[0]).toMatch(/^ACR-/);

    const secondClaims = recoveryClaims.get(secondApplication.recoveryToken);
    if (!secondClaims) throw new Error('Expected second recovery claims');
    const [request] = await db
      .select({ id: accountClosureRequests.id, status: accountClosureRequests.status })
      .from(accountClosureRequests)
      .where(eq(accountClosureRequests.externalId, secondClaims.requestId))
      .limit(1);
    if (!request) throw new Error('Expected completed request');
    const stepRows = await db
      .select({ status: accountClosureSteps.status, outcome: accountClosureSteps.retentionOutcome })
      .from(accountClosureSteps)
      .where(eq(accountClosureSteps.requestId, request.id));
    expect(stepRows).toHaveLength(13);
    expect(stepRows.every((step) => step.status === 'succeeded' && step.outcome !== null)).toBe(
      true,
    );
    const completionRecord = await receipts.getCompletionReceiptRecord(request.id, user.id);
    if (!completionRecord) throw new Error('Expected completion receipt');
    const publicReceipts = JSON.stringify({
      applicationReceipt,
      completion: serializeCompletionReceipt(completionRecord),
    });
    expect(publicReceipts).not.toContain(SENTINEL);
    expect(logLines.join('\n')).not.toContain(SENTINEL);

    const [closed] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    expect(closed).toMatchObject({ status: 'closed', email: null, phone: null, plan: 'free' });

    const auth = new AuthService(db);
    const emailRegistration = await auth.register({
      email: OLD_EMAIL,
      password: 'task11-synthetic-password',
    });
    const phoneRegistration = await auth.loginOrRegisterByPhone(OLD_PHONE);
    expect(emailRegistration.user.externalId).not.toBe(user.externalId);
    expect(phoneRegistration.user.externalId).not.toBe(user.externalId);
    const newUsers = await db
      .select({ id: users.id, externalId: users.externalId, plan: users.plan })
      .from(users)
      .where(sql`${users.email} = ${OLD_EMAIL} OR ${users.phone} = ${OLD_PHONE}`);
    expect(newUsers).toHaveLength(2);
    expect(newUsers.every((row) => row.id !== user.id && row.plan === 'free')).toBe(true);
    const inheritedTasks = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(tasks)
      .where(
        sql`${tasks.userId} IN (${sql.join(
          newUsers.map((row) => sql`${row.id}`),
          sql`, `,
        )})`,
      );
    expect(Number(inheritedTasks[0]?.count ?? -1)).toBe(0);
  });

  async function createLargeSyntheticAccount() {
    const [insert] = await db.insert(users).values({
      externalId: 'usr_task11_release',
      email: OLD_EMAIL,
      phone: OLD_PHONE,
      passwordHash: 'synthetic-non-authenticating-hash',
      plan: 'pro',
      planExpiresAt: ORIGINAL_EXPIRY,
      emailVerified: true,
      phoneVerified: true,
      displayName: SENTINEL,
    });
    const id = Number(insert.insertId);
    await db.insert(sessions).values({
      externalId: 'ses_task11_release',
      userId: id,
      status: 'connected',
    });
    await db.insert(apiKeys).values({
      externalId: 'key_task11_release',
      userId: id,
      name: 'release gate key',
      keyPrefix: 'hd_live_t11',
      keyHash: 'a'.repeat(64),
    });
    const [taskInsert] = await db.insert(tasks).values({
      externalId: 'tsk_task11_release',
      userId: id,
      status: 'executing',
      intent: `${SENTINEL} task body`,
    });
    const taskId = Number(taskInsert.insertId);
    const future = new Date('2027-01-01T00:00:00.000Z');
    await db.insert(plannedTasks).values({
      externalId: 'pln_task11_release',
      userId: id,
      title: 'release gate plan',
      instruction: `${SENTINEL} plan body`,
      firstRunAt: future,
      nextRunAt: future,
      status: 'active',
    });
    await db.insert(notificationChannels).values({
      externalId: 'nch_task11_release',
      userId: id,
      platform: 'custom',
      webhookUrl: 'https://example.test/task11-hook',
      enabled: true,
    });
    await db.insert(taskQuotas).values({
      userId: id,
      period: 'month',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      tasksUsed: 7,
      opusUsed: 2,
      bonusTasks: 11,
      bonusOpus: 3,
    });
    await db.insert(taskFiles).values(
      Array.from({ length: 205 }, (_, index) => ({
        externalId: `fil_t11_${String(index + 1).padStart(4, '0')}`,
        userId: id,
        taskId,
        kind: 'input',
        filename: `${SENTINEL}-${index + 1}.png`,
        mimetype: 'image/png',
        sizeBytes: 1,
        storagePath: `objects/task11/${index + 1}`,
      })),
    );
    return { id, externalId: 'usr_task11_release' };
  }

  async function expectFrozenAndStopped(userId: number) {
    const [state] = await db
      .select({
        userStatus: users.status,
        sessionStatus: sessions.status,
        keyRevokedAt: apiKeys.revokedAt,
        taskStatus: tasks.status,
        planStatus: plannedTasks.status,
        channelEnabled: notificationChannels.enabled,
      })
      .from(users)
      .innerJoin(sessions, eq(sessions.userId, users.id))
      .innerJoin(apiKeys, eq(apiKeys.userId, users.id))
      .innerJoin(tasks, eq(tasks.userId, users.id))
      .innerJoin(plannedTasks, eq(plannedTasks.userId, users.id))
      .innerJoin(notificationChannels, eq(notificationChannels.userId, users.id))
      .where(eq(users.id, userId));
    expect(state).toMatchObject({
      userStatus: 'closure_pending',
      sessionStatus: 'disconnected',
      taskStatus: 'cancelled',
      planStatus: 'paused',
      channelEnabled: false,
    });
    expect(state?.keyRevokedAt).toBeInstanceOf(Date);
  }

  async function expectExactlyRestored(userId: number) {
    const [state] = await db
      .select({
        status: users.status,
        plan: users.plan,
        planExpiresAt: users.planExpiresAt,
        taskStatus: tasks.status,
        planStatus: plannedTasks.status,
        channelEnabled: notificationChannels.enabled,
        bonusTasks: taskQuotas.bonusTasks,
        bonusOpus: taskQuotas.bonusOpus,
      })
      .from(users)
      .innerJoin(tasks, eq(tasks.userId, users.id))
      .innerJoin(plannedTasks, eq(plannedTasks.userId, users.id))
      .innerJoin(notificationChannels, eq(notificationChannels.userId, users.id))
      .innerJoin(taskQuotas, eq(taskQuotas.userId, users.id))
      .where(eq(users.id, userId));
    expect(state).toEqual({
      status: 'active',
      plan: 'pro',
      planExpiresAt: ORIGINAL_EXPIRY,
      taskStatus: 'cancelled',
      planStatus: 'active',
      channelEnabled: true,
      bonusTasks: 11,
      bonusOpus: 3,
    });
  }
});

function beginInput(challengeId: string) {
  return {
    challengeId,
    code: '482901',
    reasonCode: 'privacy' as const,
    acknowledgements: {
      immediateSignOut: true as const,
      runningWorkStops: true as const,
      noAutomaticRefund: true as const,
    },
  };
}

function noContentHandler(categoryId: DataCategoryId): AccountClosureHandler {
  return {
    categoryId,
    version: 1,
    async run(context) {
      context.signal.throwIfAborted();
      return { kind: 'complete', processed: 0, retention: 'not_present' };
    },
  };
}

function createReleaseMediaHandler(): AccountClosureHandler {
  return {
    categoryId: 'media_assets',
    version: 1,
    async run(context) {
      context.signal.throwIfAborted();
      const previousProcessed = context.checkpoint?.processedCount ?? 0;
      const afterId = context.checkpoint?.cursor ?? 0;
      const rows = await context.db
        .select({ id: taskFiles.id, storagePath: taskFiles.storagePath })
        .from(taskFiles)
        .where(and(eq(taskFiles.userId, context.request.userId), sql`${taskFiles.id} > ${afterId}`))
        .orderBy(taskFiles.id)
        .limit(context.pageSize);
      for (const row of rows) {
        context.signal.throwIfAborted();
        await deleteStorageObjectForClosure(context.storage, row.storagePath, {
          signal: context.signal,
        });
        context.signal.throwIfAborted();
        const removed = await context.db
          .delete(taskFiles)
          .where(and(eq(taskFiles.id, row.id), eq(taskFiles.userId, context.request.userId)));
        if (readAffectedRows(removed) !== 1) throw new Error('owned file row was not removed');
      }
      const processed = previousProcessed + rows.length;
      if (rows.length === context.pageSize) {
        return {
          kind: 'continue',
          checkpoint: { cursor: rows.at(-1)?.id ?? afterId, processedCount: processed },
          processed,
        };
      }
      return {
        kind: 'complete',
        processed,
        retention: processed === 0 ? 'not_present' : 'deleted',
      };
    },
  };
}
