import { and, eq, like, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrivateEmailSender } from '../auth/email-code.js';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import {
  accountClosureReceipts,
  accountClosureRequests,
  accountClosureSteps,
} from '../db/schema/account-closures.js';
import { users } from '../db/schema/users.js';
import type { StorageProvider } from '../files/storage-provider.js';
import type { AccountClosureHandler } from './handler-contract.js';
import {
  AccountClosureReceiptLeaseLostError,
  createDatabaseReceiptService,
} from './receipt-service.js';
import {
  ACCOUNT_CLOSURE_LEASE_MS,
  claimNextClosureStep,
  freezeAccountForClosure,
} from './repository.js';
import { runAccountClosureWorkerTick } from './worker.js';

const HMAC_SECRET = 'task9-worker-dedicated-hmac-secret-minimum-32';
const logger = pino({ enabled: false });
const storage = {} as StorageProvider;
const baseNow = new Date('2026-08-26T12:00:00.000Z');

describe.sequential('account closure worker durability', () => {
  let db: typeof import('../db/client.js').db;
  let closePool: () => Promise<void> = async () => {};
  let sequence = 0;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(databaseUrl);
    const client = await import('../db/client.js');
    db = client.db;
    closePool = () => client.pool.end();
  });

  afterEach(async () => {
    await db.delete(accountClosureReceipts);
    await db.delete(accountClosureSteps);
    await db.delete(accountClosureRequests);
    await db.delete(users).where(like(users.externalId, 'usr_task9_%'));
  });

  afterAll(async () => {
    await closePool();
  });

  it('holds the global decision across commit so two due requests yield one live lease', async () => {
    await createDueClosure('global-a');
    await createDueClosure('global-b');

    const results = await Promise.all([
      claimNextClosureStep(db, {
        workerId: 'worker-global-a',
        now: baseNow,
        leaseUntil: new Date(baseNow.getTime() + ACCOUNT_CLOSURE_LEASE_MS),
      }),
      claimNextClosureStep(db, {
        workerId: 'worker-global-b',
        now: baseNow,
        leaseUntil: new Date(baseNow.getTime() + ACCOUNT_CLOSURE_LEASE_MS),
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const running = await db
      .select({ id: accountClosureSteps.id, owner: accountClosureSteps.leaseOwner })
      .from(accountClosureSteps)
      .where(eq(accountClosureSteps.status, 'running'));
    expect(running).toHaveLength(1);

    const first = results.find(Boolean);
    expect(first?.kind).toBe('handler');
    if (!first || first.kind !== 'handler') throw new Error('handler claim missing');
    await db
      .update(accountClosureSteps)
      .set({ leaseUntil: new Date(baseNow.getTime() - 1) })
      .where(eq(accountClosureSteps.id, first.stepId));
    const takeover = await claimNextClosureStep(db, {
      workerId: 'worker-takeover',
      now: baseNow,
      leaseUntil: new Date(baseNow.getTime() + ACCOUNT_CLOSURE_LEASE_MS),
    });
    expect(takeover).toMatchObject({
      kind: 'handler',
      stepId: first.stepId,
      leaseOwner: 'worker-takeover',
    });
  });

  it('recovers after claim and checkpoint crash boundaries without running two pages', async () => {
    const subject = await createDueClosure('checkpoint');
    const first = await claimNextClosureStep(db, {
      workerId: 'crashed-after-claim',
      now: baseNow,
      leaseUntil: new Date(baseNow.getTime() + 1_000),
    });
    expect(first?.kind).toBe('handler');

    const page = vi.fn<AccountClosureHandler['run']>().mockResolvedValue({
      kind: 'continue',
      checkpoint: { cursor: 100, processedCount: 100 },
      processed: 100,
    });
    const handler: AccountClosureHandler = {
      categoryId: 'account_security',
      version: 1,
      run: page,
    };
    const restartAt = new Date(baseNow.getTime() + 1_001);
    expect(
      await runAccountClosureWorkerTick({
        db,
        handlers: new Map([[handler.categoryId, handler]]),
        workerId: 'restart-after-claim',
        now: () => restartAt,
        rssBytes: () => 1,
        enabled: true,
        logger,
        storage,
      }),
    ).toBe('progress');
    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));

    const [saved] = await db
      .select()
      .from(accountClosureSteps)
      .where(
        and(
          eq(accountClosureSteps.requestId, subject.requestId),
          eq(accountClosureSteps.categoryId, 'account_security'),
        ),
      )
      .limit(1);
    expect(saved).toMatchObject({
      status: 'pending',
      checkpoint: { cursor: 100, processedCount: 100 },
      processedCount: 100,
      leaseOwner: null,
      leaseUntil: null,
    });

    vi.mocked(page).mockResolvedValueOnce({
      kind: 'complete',
      processed: 101,
      retention: 'deleted',
    });
    expect(
      await runAccountClosureWorkerTick({
        db,
        handlers: new Map([[handler.categoryId, handler]]),
        workerId: 'restart-after-checkpoint',
        now: () => new Date(restartAt.getTime() + 1),
        rssBytes: () => 1,
        enabled: true,
        logger,
        storage,
      }),
    ).toBe('progress');
    expect(page).toHaveBeenLastCalledWith(
      expect.objectContaining({ checkpoint: { cursor: 100, processedCount: 100 } }),
    );
    const [completed] = await db
      .select()
      .from(accountClosureSteps)
      .where(eq(accountClosureSteps.id, saved?.id ?? 0))
      .limit(1);
    expect(completed).toMatchObject({
      status: 'succeeded',
      processedCount: 101,
      retentionOutcome: 'deleted',
    });
  });

  it('retries idempotently after object deletion succeeds but checkpoint persistence crashes', async () => {
    const subject = await createDueClosure('object-crash');
    const claimed = await claimNextClosureStep(db, {
      workerId: 'object-delete-crash',
      now: baseNow,
      leaseUntil: new Date(baseNow.getTime() + 1_000),
    });
    if (!claimed || claimed.kind !== 'handler') throw new Error('handler claim missing');

    const objects = new Set(['object-1']);
    let successfulDeletes = 0;
    const deleteObject = () => {
      if (objects.delete('object-1')) successfulDeletes += 1;
    };
    deleteObject();
    // Simulated hard crash: the successful provider result is deliberately
    // not passed to markStepSucceeded and the running lease is left intact.

    const retryHandler: AccountClosureHandler = {
      categoryId: claimed.categoryId,
      version: 1,
      async run() {
        deleteObject(); // explicit provider not-found is idempotent success
        return { kind: 'complete', processed: 1, retention: 'deleted' };
      },
    };
    const retryAt = new Date(baseNow.getTime() + 1_001);
    expect(
      await runAccountClosureWorkerTick({
        db,
        handlers: new Map([[retryHandler.categoryId, retryHandler]]),
        workerId: 'object-delete-retry',
        now: () => retryAt,
        rssBytes: () => 1,
        enabled: true,
        logger,
        storage,
      }),
    ).toBe('progress');
    expect(successfulDeletes).toBe(1);
    expect(objects.size).toBe(0);
    const [step] = await db
      .select({ status: accountClosureSteps.status, outcome: accountClosureSteps.retentionOutcome })
      .from(accountClosureSteps)
      .where(eq(accountClosureSteps.id, claimed.stepId));
    expect(step).toEqual({ status: 'succeeded', outcome: 'deleted' });
    expect(subject.requestId).toBe(claimed.requestId);
  });

  it('reuses one receipt after notification failure and clears identity only after acceptance', async () => {
    const subject = await createDueClosure('completion');
    await db
      .update(accountClosureRequests)
      .set({ status: 'processing', processingStartedAt: baseNow })
      .where(eq(accountClosureRequests.id, subject.requestId));
    await db
      .update(users)
      .set({ status: 'closure_processing' })
      .where(eq(users.id, subject.userId));
    await db
      .update(accountClosureSteps)
      .set({ status: 'succeeded', retentionOutcome: 'not_present', finishedAt: baseNow })
      .where(eq(accountClosureSteps.requestId, subject.requestId));

    const receiptNumbers: string[] = [];
    let releaseAcceptedDelivery!: () => void;
    const acceptedDelivery = new Promise<void>((resolve) => {
      releaseAcceptedDelivery = resolve;
    });
    const send = vi
      .fn<PrivateEmailSender['send']>()
      .mockImplementationOnce(async (message) => {
        receiptNumbers.push(message.idempotencyKey ?? '');
        throw new Error('accepted state was not persisted');
      })
      .mockImplementationOnce(async (message) => {
        receiptNumbers.push(message.idempotencyKey ?? '');
        await acceptedDelivery;
      });
    const emailSender: PrivateEmailSender = {
      privateDelivery: true,
      isAvailable: () => true,
      send,
    };
    const first = await runAccountClosureWorkerTick({
      db,
      handlers: new Map(),
      workerId: 'completion-worker-a',
      now: () => baseNow,
      rssBytes: () => 1,
      enabled: true,
      logger,
      storage,
      hmacSecret: HMAC_SECRET,
      notification: {
        emailSender,
        smsGateway: { sendAccountClosureComplete: vi.fn() },
      },
    });
    expect(first).toBe('progress');
    expect(await completionReceiptCount(subject.requestId)).toBe(1);
    const [pendingReceipt] = await db
      .select({ completedAt: accountClosureReceipts.completedAt })
      .from(accountClosureReceipts)
      .where(
        and(
          eq(accountClosureReceipts.requestId, subject.requestId),
          eq(accountClosureReceipts.kind, 'completion'),
        ),
      );
    expect(pendingReceipt?.completedAt).toBeNull();
    const [stillIdentified] = await db
      .select({ email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, subject.userId));
    expect(stillIdentified).toMatchObject({
      email: subject.email,
      status: 'closure_processing',
    });

    const retryAt = new Date(baseNow.getTime() + 60_001);
    let liveNow = retryAt;
    const completing = runAccountClosureWorkerTick({
      db,
      handlers: new Map(),
      workerId: 'completion-worker-b',
      now: () => liveNow,
      rssBytes: () => 1,
      enabled: true,
      logger,
      storage,
      hmacSecret: HMAC_SECRET,
      notification: {
        emailSender,
        smsGateway: { sendAccountClosureComplete: vi.fn() },
      },
      leaseHeartbeatMs: 10,
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    liveNow = new Date(retryAt.getTime() + ACCOUNT_CLOSURE_LEASE_MS + 1_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stolen = await claimNextClosureStep(db, {
      workerId: 'completion-takeover-refused',
      now: liveNow,
      leaseUntil: new Date(liveNow.getTime() + ACCOUNT_CLOSURE_LEASE_MS),
    });
    expect(stolen).toBeNull();
    releaseAcceptedDelivery();
    expect(await completing).toBe('progress');
    expect(receiptNumbers).toHaveLength(2);
    expect(receiptNumbers[0]).toBe(receiptNumbers[1]);
    expect(receiptNumbers[0]).toMatch(/^ACR-/);
    expect(await completionReceiptCount(subject.requestId)).toBe(1);
    const [closed] = await db
      .select({ email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, subject.userId));
    expect(closed).toEqual({ email: null, status: 'closed' });
    const [request] = await db
      .select({
        status: accountClosureRequests.status,
        completedAt: accountClosureRequests.completedAt,
      })
      .from(accountClosureRequests)
      .where(eq(accountClosureRequests.id, subject.requestId));
    expect(request?.status).toBe('completed');
    const [completedReceipt] = await db
      .select({ completedAt: accountClosureReceipts.completedAt })
      .from(accountClosureReceipts)
      .where(
        and(
          eq(accountClosureReceipts.requestId, subject.requestId),
          eq(accountClosureReceipts.kind, 'completion'),
        ),
      );
    expect(completedReceipt?.completedAt).toEqual(liveNow);
    expect(request?.completedAt).toEqual(liveNow);
  });

  it('does not resend an accepted notification after a crash before final user update', async () => {
    const subject = await createDueClosure('post-receipt-crash');
    await db
      .update(accountClosureRequests)
      .set({ status: 'processing', processingStartedAt: baseNow })
      .where(eq(accountClosureRequests.id, subject.requestId));
    await db
      .update(users)
      .set({ status: 'closure_processing', plan: 'pro' })
      .where(eq(users.id, subject.userId));
    await db
      .update(accountClosureSteps)
      .set({ status: 'succeeded', retentionOutcome: 'not_present', finishedAt: baseNow })
      .where(eq(accountClosureSteps.requestId, subject.requestId));
    const send = vi.fn<PrivateEmailSender['send']>().mockResolvedValue(undefined);
    const notification = {
      emailSender: {
        privateDelivery: true as const,
        isAvailable: () => true,
        send,
      },
      smsGateway: { sendAccountClosureComplete: vi.fn() },
    };

    expect(
      await runAccountClosureWorkerTick({
        db,
        handlers: new Map(),
        workerId: 'post-receipt-a',
        now: () => baseNow,
        rssBytes: () => 1,
        enabled: true,
        logger,
        storage,
        hmacSecret: HMAC_SECRET,
        notification,
      }),
    ).toBe('progress');
    expect(send).toHaveBeenCalledTimes(1);
    const [accepted] = await db
      .select({ status: accountClosureReceipts.notificationStatus })
      .from(accountClosureReceipts)
      .where(
        and(
          eq(accountClosureReceipts.requestId, subject.requestId),
          eq(accountClosureReceipts.kind, 'completion'),
        ),
      );
    expect(accepted?.status).toBe('accepted');
    const [notClosed] = await db
      .select({ status: users.status, email: users.email })
      .from(users)
      .where(eq(users.id, subject.userId));
    expect(notClosed).toEqual({ status: 'closure_processing', email: subject.email });

    await db.update(users).set({ plan: 'free' }).where(eq(users.id, subject.userId));
    const retryAt = new Date(baseNow.getTime() + 60_001);
    expect(
      await runAccountClosureWorkerTick({
        db,
        handlers: new Map(),
        workerId: 'post-receipt-b',
        now: () => retryAt,
        rssBytes: () => 1,
        enabled: true,
        logger,
        storage,
        hmacSecret: HMAC_SECRET,
        notification,
      }),
    ).toBe('progress');
    expect(send).toHaveBeenCalledTimes(1);
    const [closed] = await db
      .select({ status: users.status, email: users.email })
      .from(users)
      .where(eq(users.id, subject.userId));
    expect(closed).toEqual({ status: 'closed', email: null });
  });

  it('does not create a completion receipt for a stale lease owner', async () => {
    const subject = await createDueClosure('receipt-create-lease');
    await db
      .update(accountClosureRequests)
      .set({
        status: 'processing',
        processingStartedAt: baseNow,
        completionLeaseOwner: 'receipt-current-owner',
        completionLeaseUntil: new Date(baseNow.getTime() + ACCOUNT_CLOSURE_LEASE_MS),
      })
      .where(eq(accountClosureRequests.id, subject.requestId));
    const receipts = createDatabaseReceiptService(db);

    await expect(
      receipts.createCompletionReceipt({
        requestId: subject.requestId,
        userId: subject.userId,
        subjectDigest: 'a'.repeat(64),
        completedCategoryIds: DATA_CATEGORY_IDS,
        restrictedCategoryIds: [],
        expectedLeaseOwner: 'receipt-stale-owner',
        now: baseNow,
      }),
    ).rejects.toBeInstanceOf(AccountClosureReceiptLeaseLostError);
    expect(await completionReceiptCount(subject.requestId)).toBe(0);
  });

  it('keeps notification status pending when ownership changes after provider acceptance', async () => {
    const subject = await createDueClosure('receipt-status-lease');
    await db
      .update(accountClosureRequests)
      .set({ status: 'processing', processingStartedAt: baseNow })
      .where(eq(accountClosureRequests.id, subject.requestId));
    await db
      .update(users)
      .set({ status: 'closure_processing' })
      .where(eq(users.id, subject.userId));
    await db
      .update(accountClosureSteps)
      .set({ status: 'succeeded', retentionOutcome: 'not_present', finishedAt: baseNow })
      .where(eq(accountClosureSteps.requestId, subject.requestId));

    const idempotencyKeys: string[] = [];
    const send = vi
      .fn<PrivateEmailSender['send']>()
      .mockImplementationOnce(async (message) => {
        idempotencyKeys.push(message.idempotencyKey ?? '');
        await db
          .update(accountClosureRequests)
          .set({
            completionLeaseOwner: 'receipt-intervening-owner',
            completionLeaseUntil: new Date(baseNow.getTime() + 1_000),
          })
          .where(
            and(
              eq(accountClosureRequests.id, subject.requestId),
              eq(accountClosureRequests.completionLeaseOwner, 'receipt-status-a'),
            ),
          );
      })
      .mockImplementationOnce(async (message) => {
        idempotencyKeys.push(message.idempotencyKey ?? '');
      });
    const notification = {
      emailSender: {
        privateDelivery: true as const,
        isAvailable: () => true,
        send,
      },
      smsGateway: { sendAccountClosureComplete: vi.fn() },
    };

    expect(
      await runAccountClosureWorkerTick({
        db,
        handlers: new Map(),
        workerId: 'receipt-status-a',
        now: () => baseNow,
        rssBytes: () => 1,
        enabled: true,
        logger,
        storage,
        hmacSecret: HMAC_SECRET,
        notification,
      }),
    ).toBe('idle');
    const [pending] = await db
      .select({
        notificationStatus: accountClosureReceipts.notificationStatus,
        attemptCount: accountClosureRequests.completionAttemptCount,
        userStatus: users.status,
      })
      .from(accountClosureReceipts)
      .innerJoin(
        accountClosureRequests,
        eq(accountClosureRequests.id, accountClosureReceipts.requestId),
      )
      .innerJoin(users, eq(users.id, accountClosureRequests.userId))
      .where(eq(accountClosureReceipts.requestId, subject.requestId));
    expect(pending).toEqual({
      notificationStatus: 'pending',
      attemptCount: 0,
      userStatus: 'closure_processing',
    });

    const takeoverAt = new Date(baseNow.getTime() + 1_001);
    expect(
      await runAccountClosureWorkerTick({
        db,
        handlers: new Map(),
        workerId: 'receipt-status-b',
        now: () => takeoverAt,
        rssBytes: () => 1,
        enabled: true,
        logger,
        storage,
        hmacSecret: HMAC_SECRET,
        notification,
      }),
    ).toBe('progress');
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    const [closed] = await db
      .select({ status: users.status, email: users.email })
      .from(users)
      .where(eq(users.id, subject.userId));
    expect(closed).toEqual({ status: 'closed', email: null });
  });

  async function createDueClosure(label: string) {
    sequence += 1;
    const externalId = `usr_task9_${sequence}_${label}`.slice(0, 32);
    const email = `task9-${sequence}-${label}@example.test`;
    const [insert] = await db.insert(users).values({
      externalId,
      email,
      passwordHash: 'non-authenticating-test-hash',
      emailVerified: true,
    });
    const userId = Number(insert.insertId);
    const frozen = await freezeAccountForClosure(db, {
      userId,
      expectedAuthVersion: 0,
      requestExternalId: `acl_task9_${sequence}_${label}`.slice(0, 32),
      requestedAt: new Date(baseNow.getTime() - 8 * 24 * 60 * 60 * 1_000),
    });
    return { userId, email, requestId: frozen.requestId };
  }

  async function completionReceiptCount(requestId: number): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(accountClosureReceipts)
      .where(
        and(
          eq(accountClosureReceipts.requestId, requestId),
          eq(accountClosureReceipts.kind, 'completion'),
        ),
      );
    return Number(row?.count ?? 0);
  }
});
