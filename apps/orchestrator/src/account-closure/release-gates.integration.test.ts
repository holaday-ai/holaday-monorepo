import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateApiKey } from '../api-keys/api-key-service.js';
import { resolveApiKey } from '../api-keys/webhook-handler.js';
import type { PrivateEmailSender } from '../auth/email-code.js';
import { authenticateAccessTokenSession } from '../auth/middleware.js';
import { hashPassword } from '../auth/password.js';
import { AuthService } from '../auth/service.js';
import { DATA_CATEGORY_IDS, type DataCategoryId } from '../data-governance/types.js';
import { accountClosureRequests, accountClosureSteps } from '../db/schema/account-closures.js';
import { apiKeys } from '../db/schema/api-keys.js';
import { evidenceArtifacts } from '../db/schema/evidence-artifacts.js';
import * as schema from '../db/schema/index.js';
import { notificationChannels } from '../db/schema/notifications.js';
import { plannedTasks } from '../db/schema/planned-tasks.js';
import { sessions } from '../db/schema/sessions.js';
import { taskFiles } from '../db/schema/task-files.js';
import { taskQuotas } from '../db/schema/task-quotas.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import type { StorageProvider } from '../files/storage-provider.js';
import { AccountClosureChallengeService } from './challenge-service.js';
import type { AccountClosureHandler } from './handler-contract.js';
import { ACCOUNT_CLOSURE_HANDLERS } from './handler-registry.js';
import { createDatabaseReceiptService, serializeCompletionReceipt } from './receipt-service.js';
import { ACCOUNT_CLOSURE_LEASE_MS, claimNextClosureStep } from './repository.js';
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
    const challengeCodes: string[] = [];
    const challengeEmailSender: PrivateEmailSender = {
      privateDelivery: true,
      isAvailable: () => true,
      send: vi.fn(async (message) => {
        const code = /\b(\d{6})\b/.exec(message.text)?.[1];
        if (!code) throw new Error('challenge code missing');
        challengeCodes.push(code);
      }),
    };
    const challengeLogger = { error: vi.fn() };
    const challenge = new AccountClosureChallengeService(db, {
      emailSender: challengeEmailSender,
      smsGateway: { sendAccountClosureCode: vi.fn(async () => undefined) },
      logger: challengeLogger,
    });
    const serviceLogger = { error: vi.fn() };
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
      logger: serviceLogger,
      config: { enabled: true, allowlist: new Set([user.externalId]) },
    });

    await expect(service.preview(user.externalId)).resolves.toMatchObject({
      graceEndsAt: new Date(REQUESTED_AT.getTime() + 168 * 60 * 60 * 1_000).toISOString(),
      plan: { name: 'pro', expiresAt: ORIGINAL_EXPIRY.toISOString() },
      counts: { activeTasks: 1, futureTasks: 1, files: 205, notificationChannels: 1 },
      automaticRefund: false,
    });
    const authService = new AuthService(db);
    const login = await authService.login({ email: OLD_EMAIL, password: user.password });
    if (!('accessToken' in login)) throw new Error('Expected ordinary access token');
    expect(await authenticateAccessTokenSession(db, login.accessToken)).toMatchObject({
      userId: user.externalId,
    });
    expect(await resolveApiKey(user.apiKey, db)).toMatchObject({ ok: true });

    const firstChallenge = await service.requestVerification(user.externalId);
    const firstApplication = await service.begin(
      user.externalId,
      beginInput(firstChallenge.challengeId, challengeCodes.at(-1) ?? ''),
    );
    await expectFrozenAndStopped(user.id);
    expect(await authenticateAccessTokenSession(db, login.accessToken)).toBeNull();
    expect((await resolveApiKey(user.apiKey, db)).ok).toBe(false);

    const cancelChallenge = await service.requestCancellationVerification(
      firstApplication.recoveryToken,
    );
    await service.cancel(firstApplication.recoveryToken, {
      challengeId: cancelChallenge.challengeId,
      code: challengeCodes.at(-1) ?? '',
    });
    await expectExactlyRestored(user.id);

    liveNow = new Date(REQUESTED_AT.getTime() + 1_000);
    const secondChallenge = await service.requestVerification(user.externalId);
    const secondApplication = await service.begin(
      user.externalId,
      beginInput(secondChallenge.challengeId, challengeCodes.at(-1) ?? ''),
    );
    const applicationReceipt = await service.applicationReceipt(secondApplication.recoveryToken);
    expect(applicationReceipt.receiptNumber).not.toBe(firstApplication.receipt.receiptNumber);

    liveNow = new Date(secondApplication.graceEndsAt);
    expect(liveNow.getTime() - (REQUESTED_AT.getTime() + 1_000)).toBe(168 * 60 * 60 * 1_000);
    const secondClaims = recoveryClaims.get(secondApplication.recoveryToken);
    if (!secondClaims) throw new Error('Expected second recovery claims');

    const competitor = await createCompetingDueRequest(liveNow);
    const databaseUrl = process.env.DATABASE_URL ?? '';
    const firstClaimPool = createPool({ uri: databaseUrl, connectionLimit: 1 });
    const secondClaimPool = createPool({ uri: databaseUrl, connectionLimit: 1 });
    try {
      const firstClaimDb = drizzle(firstClaimPool, { schema, mode: 'default' }) as typeof db;
      const secondClaimDb = drizzle(secondClaimPool, { schema, mode: 'default' }) as typeof db;
      const leaseUntil = new Date(liveNow.getTime() + ACCOUNT_CLOSURE_LEASE_MS);
      const concurrentClaims = await Promise.all([
        claimNextClosureStep(firstClaimDb, {
          workerId: 'release-worker-a',
          now: liveNow,
          leaseUntil,
        }),
        claimNextClosureStep(secondClaimDb, {
          workerId: 'release-worker-b',
          now: liveNow,
          leaseUntil,
        }),
      ]);
      expect(concurrentClaims.filter(Boolean)).toHaveLength(1);
      const winner = concurrentClaims.find(Boolean);
      expect(winner).toMatchObject({ requestExternalId: secondClaims.requestId });
      if (!winner || winner.kind !== 'handler') throw new Error('Expected handler claim');
      await db
        .update(accountClosureSteps)
        .set({ leaseUntil: new Date(liveNow.getTime() - 1) })
        .where(eq(accountClosureSteps.id, winner.stepId));
    } finally {
      await firstClaimPool.end();
      await secondClaimPool.end();
      await db
        .delete(accountClosureSteps)
        .where(eq(accountClosureSteps.requestId, competitor.requestId));
      await db
        .delete(accountClosureRequests)
        .where(eq(accountClosureRequests.id, competitor.requestId));
      await db.delete(users).where(eq(users.id, competitor.userId));
    }

    const storageObjects = new Set([
      ...Array.from({ length: 205 }, (_, index) => `objects/task11/${index + 1}`),
      'objects/task11/evidence.png',
    ]);
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
    const handlers = new Map<DataCategoryId, AccountClosureHandler>(
      ACCOUNT_CLOSURE_HANDLERS.map((handler) => {
        const wrapped: AccountClosureHandler = {
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
        };
        return [handler.categoryId, wrapped] as const;
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
    let completed = false;
    const previousFeedbackGate = process.env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED;
    const previousAnalyticsGate = process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED;
    process.env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED = 'true';
    process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED = 'true';

    for (let tick = 0; tick < 80; tick += 1) {
      const workerId = 'task11-single-worker';
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
    restoreProcessEnv('ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED', previousFeedbackGate);
    restoreProcessEnv('ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED', previousAnalyticsGate);

    expect(completed).toBe(true);
    expect(storageFailedOnce).toBe(true);
    expect(storageDelete).toHaveBeenCalledTimes(207);
    expect(storageObjects.size).toBe(0);
    expect(maxActivePages).toBe(1);
    expect(acceptedReceiptNumbers).toHaveLength(1);
    expect(acceptedReceiptNumbers[0]).toMatch(/^ACR-/);

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
    expect(
      JSON.stringify({
        worker: logLines,
        service: serviceLogger.error.mock.calls,
        challenge: challengeLogger.error.mock.calls,
      }),
    ).not.toContain(SENTINEL);

    const [closed] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    expect(closed).toMatchObject({ status: 'closed', email: null, phone: null, plan: 'free' });

    const emailRegistration = await authService.register({
      email: OLD_EMAIL,
      password: 'task11-synthetic-password',
    });
    const phoneRegistration = await authService.loginOrRegisterByPhone(OLD_PHONE);
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
    const password = 'task11-synthetic-password';
    const generatedApiKey = generateApiKey();
    const [insert] = await db.insert(users).values({
      externalId: 'usr_task11_release',
      email: OLD_EMAIL,
      phone: OLD_PHONE,
      passwordHash: await hashPassword(password),
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
      keyPrefix: generatedApiKey.displayPrefix,
      keyHash: generatedApiKey.hash,
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
    await db.insert(evidenceArtifacts).values({
      externalId: 'eva_task11_release',
      ownerUserId: id,
      taskId,
      artifactKind: 'screenshot',
      purpose: 'task_evidence',
      r2Bucket: 'task11-test',
      r2Key: 'objects/task11/evidence.png',
      contentType: 'image/png',
      sizeBytes: 1,
      sha256: 'b'.repeat(64),
      capturedAt: REQUESTED_AT,
      collectorLane: 'task11-release-gate',
      rawExcerpt: SENTINEL,
      retentionPolicy: 'task_30d',
    });
    return {
      id,
      externalId: 'usr_task11_release',
      password,
      apiKey: generatedApiKey.plaintext,
    };
  }

  async function createCompetingDueRequest(now: Date) {
    const [userInsert] = await db.insert(users).values({
      externalId: 'usr_task11_competing',
      email: 'task11-competing@example.test',
      passwordHash: await hashPassword('task11-competing-password'),
      status: 'closure_pending',
    });
    const userId = Number(userInsert.insertId);
    const [requestInsert] = await db.insert(accountClosureRequests).values({
      externalId: 'acl_task11_competing',
      userId,
      activeUserId: userId,
      status: 'pending_grace',
      requestedAt: new Date(now.getTime() - 168 * 60 * 60 * 1_000),
      graceEndsAt: now,
    });
    const requestId = Number(requestInsert.insertId);
    await db.insert(accountClosureSteps).values(
      DATA_CATEGORY_IDS.map((categoryId) => ({
        requestId,
        categoryId,
        handlerVersion: 1,
        status: 'pending' as const,
      })),
    );
    return { requestId, userId };
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

function beginInput(challengeId: string, code: string) {
  return {
    challengeId,
    code,
    reasonCode: 'privacy' as const,
    acknowledgements: {
      immediateSignOut: true as const,
      runningWorkStops: true as const,
      noAutomaticRefund: true as const,
    },
  };
}

function restoreProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}
