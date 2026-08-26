import { randomBytes } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import type mysql from 'mysql2/promise';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import {
  type AccountClosureRequest,
  accountClosureRequests,
  accountClosureSteps,
} from '../db/schema/account-closures.js';
import { apiKeys } from '../db/schema/api-keys.js';
import * as schema from '../db/schema/index.js';
import { sessions } from '../db/schema/sessions.js';
import { users } from '../db/schema/users.js';
import { restoreImmediateClosureEffectsInTransaction } from './immediate-effects.js';
import { closureGraceEndsAt } from './state-machine.js';
import type { AccountClosureReasonCode } from './types.js';
import {
  type AccountClosureCategoryId,
  type AccountClosureCheckpoint,
  type AccountClosureRetentionOutcome,
  type AccountClosureStepErrorCode,
  parseAccountClosureCheckpoint,
} from './types.js';

export const ACCOUNT_CLOSURE_LEASE_MS = 2 * 60 * 1_000;
const GLOBAL_CLAIM_LOCK = 'holaday:account-closure:global-claim:v1';

export type ClaimedClosureWork =
  | {
      kind: 'handler';
      stepId: number;
      requestId: number;
      requestExternalId: string;
      userId: number;
      userExternalId: string;
      categoryId: AccountClosureCategoryId;
      handlerVersion: number;
      attemptCount: number;
      checkpoint: AccountClosureCheckpoint | null;
      processedCount: number;
      leaseOwner: string;
    }
  | {
      kind: 'completion';
      requestId: number;
      requestExternalId: string;
      userId: number;
      userExternalId: string;
      attemptCount: number;
      leaseOwner: string;
    };

export interface StepLeaseInput {
  stepId: number;
  requestId: number;
  leaseOwner: string;
}

export interface CompletionLeaseInput {
  requestId: number;
  leaseOwner: string;
}

export type WorkerLeaseInput =
  | ({ kind: 'handler' } & StepLeaseInput)
  | ({ kind: 'completion' } & CompletionLeaseInput);

export interface AccountClosureWorkerRepository {
  claimNextStep(input: {
    workerId: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<ClaimedClosureWork | null>;
  renewLease(input: WorkerLeaseInput & { leaseUntil: Date }): Promise<boolean>;
  markStepContinuation(
    input: StepLeaseInput & {
      checkpoint: AccountClosureCheckpoint;
      processedCount: number;
      nextAttemptAt: Date;
    },
  ): Promise<boolean>;
  markStepSucceeded(
    input: StepLeaseInput & {
      processedCount: number;
      retentionOutcome: AccountClosureRetentionOutcome;
      finishedAt: Date;
    },
  ): Promise<boolean>;
  markStepRetryable(
    input: StepLeaseInput & {
      errorCode: AccountClosureStepErrorCode;
      nextAttemptAt: Date;
    },
  ): Promise<boolean>;
  markStepBlocked(
    input: StepLeaseInput & {
      errorCode: AccountClosureStepErrorCode;
      nextAttemptAt: Date;
    },
  ): Promise<boolean>;
  markCompletionRetry(
    input: CompletionLeaseInput & {
      errorCode: AccountClosureStepErrorCode;
      nextAttemptAt: Date;
      blocked: boolean;
    },
  ): Promise<boolean>;
  completeRequest(
    input: CompletionLeaseInput & { now: Date; signal: AbortSignal },
  ): Promise<'completed' | 'retryable'>;
}

export type AccountClosureRepositoryErrorCode =
  | 'ACCOUNT_NOT_ACTIVE'
  | 'REQUEST_NOT_PENDING'
  | 'DEADLINE_PASSED_OR_PROCESSING'
  | 'USER_STATE_CONFLICT';

export class AccountClosureRepositoryError extends Error {
  constructor(public readonly code: AccountClosureRepositoryErrorCode) {
    super(code);
    this.name = 'AccountClosureRepositoryError';
  }
}

export interface FrozenAccountClosure {
  requestId: number;
  requestExternalId: string;
  requestedAt: Date;
  graceEndsAt: Date;
  authVersion: number;
}

export async function freezeAccountForClosure(
  db: DB,
  input: {
    userId: number;
    expectedAuthVersion: number;
    requestExternalId?: string;
    requestedAt?: Date;
    reasonCode?: AccountClosureReasonCode;
  },
): Promise<FrozenAccountClosure> {
  const requestedAt = input.requestedAt ?? new Date();
  const graceEndsAt = closureGraceEndsAt(requestedAt);
  const requestExternalId = input.requestExternalId ?? `acl_${randomBytes(12).toString('hex')}`;

  return db.transaction(async (tx) => {
    const freeze = await tx
      .update(users)
      .set({
        status: 'closure_pending',
        authVersion: sql`${users.authVersion} + 1`,
      })
      .where(
        and(
          eq(users.id, input.userId),
          eq(users.status, 'active'),
          eq(users.authVersion, input.expectedAuthVersion),
        ),
      );
    if (readAffectedRows(freeze) !== 1) {
      throw new AccountClosureRepositoryError('ACCOUNT_NOT_ACTIVE');
    }

    const insert = await tx.insert(accountClosureRequests).values({
      externalId: requestExternalId,
      userId: input.userId,
      activeUserId: input.userId,
      status: 'pending_grace',
      reasonCode: input.reasonCode,
      requestedAt,
      graceEndsAt,
    });
    const requestId = readInsertId(insert);
    await tx.insert(accountClosureSteps).values(
      DATA_CATEGORY_IDS.map((categoryId) => ({
        requestId,
        categoryId,
        handlerVersion: 1,
        status: 'pending' as const,
      })),
    );
    await tx
      .update(sessions)
      .set({ status: 'disconnected', disconnectedAt: requestedAt })
      .where(and(eq(sessions.userId, input.userId), ne(sessions.status, 'disconnected')));
    await tx
      .update(apiKeys)
      .set({ revokedAt: requestedAt })
      .where(and(eq(apiKeys.userId, input.userId), isNull(apiKeys.revokedAt)));

    const [committedUser] = await tx
      .select({ authVersion: users.authVersion })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.status, 'closure_pending')))
      .limit(1);
    if (!committedUser) {
      throw new AccountClosureRepositoryError('USER_STATE_CONFLICT');
    }

    return {
      requestId,
      requestExternalId,
      requestedAt,
      graceEndsAt,
      authVersion: committedUser.authVersion,
    };
  });
}

export async function withdrawAccountClosureRequest(
  db: DB,
  input: { requestId: number; userId: number; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const cancel = await tx
      .update(accountClosureRequests)
      .set({
        status: 'cancelled',
        activeUserId: null,
        cancelledAt: now,
      })
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.userId, input.userId),
          eq(accountClosureRequests.activeUserId, input.userId),
          eq(accountClosureRequests.status, 'pending_grace'),
          gt(accountClosureRequests.graceEndsAt, now),
        ),
      );
    if (readAffectedRows(cancel) !== 1) {
      const [request] = await tx
        .select({
          status: accountClosureRequests.status,
          graceEndsAt: accountClosureRequests.graceEndsAt,
        })
        .from(accountClosureRequests)
        .where(
          and(
            eq(accountClosureRequests.id, input.requestId),
            eq(accountClosureRequests.userId, input.userId),
          ),
        )
        .limit(1);
      if (
        request?.status === 'processing' ||
        request?.status === 'needs_attention' ||
        (request && now.getTime() >= request.graceEndsAt.getTime())
      ) {
        throw new AccountClosureRepositoryError('DEADLINE_PASSED_OR_PROCESSING');
      }
      throw new AccountClosureRepositoryError('REQUEST_NOT_PENDING');
    }

    const reactivate = await tx
      .update(users)
      .set({ status: 'active', authVersion: sql`${users.authVersion} + 1` })
      .where(and(eq(users.id, input.userId), eq(users.status, 'closure_pending')));
    if (readAffectedRows(reactivate) !== 1) {
      throw new AccountClosureRepositoryError('USER_STATE_CONFLICT');
    }
    await restoreImmediateClosureEffectsInTransaction(tx, input);
  });
}

export async function claimClosureRequestForProcessing(
  db: DB,
  input: { requestId: number; userId: number; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const claim = await tx
      .update(accountClosureRequests)
      .set({ status: 'processing', processingStartedAt: now })
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.userId, input.userId),
          eq(accountClosureRequests.activeUserId, input.userId),
          eq(accountClosureRequests.status, 'pending_grace'),
          lte(accountClosureRequests.graceEndsAt, now),
        ),
      );
    if (readAffectedRows(claim) !== 1) return false;
    const processing = await tx
      .update(users)
      .set({ status: 'closure_processing' })
      .where(and(eq(users.id, input.userId), eq(users.status, 'closure_pending')));
    if (readAffectedRows(processing) !== 1) {
      throw new AccountClosureRepositoryError('USER_STATE_CONFLICT');
    }
    return true;
  });
}

export async function accountClosureAllowsExecution(db: DB, userId: number): Promise<boolean> {
  const [user] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.status === 'active';
}

export async function findActiveClosureRequest(
  db: DB,
  userId: number,
): Promise<Pick<AccountClosureRequest, 'id' | 'externalId' | 'status' | 'graceEndsAt'> | null> {
  const [request] = await db
    .select({
      id: accountClosureRequests.id,
      externalId: accountClosureRequests.externalId,
      status: accountClosureRequests.status,
      graceEndsAt: accountClosureRequests.graceEndsAt,
    })
    .from(accountClosureRequests)
    .where(eq(accountClosureRequests.activeUserId, userId))
    .limit(1);
  return request ?? null;
}

/**
 * Moves at most one due grace-period request into processing. Callers that
 * also claim a step should use `claimNextClosureStep`, which performs both
 * decisions under the global advisory lock.
 */
export async function claimDueRequest(
  db: DB,
  input: { now: Date },
): Promise<{ requestId: number; userId: number } | null> {
  return withGlobalClaimTransaction(db, async (tx) => {
    if (await hasActiveGlobalLease(tx, input.now)) return null;
    return activateOneDueRequest(tx, input.now);
  });
}

/** Serializes “no active lease + next claim” across every worker process. */
export async function claimNextClosureStep(
  db: DB,
  input: { workerId: string; now: Date; leaseUntil: Date },
): Promise<ClaimedClosureWork | null> {
  assertLeaseInput(input.workerId, input.now, input.leaseUntil);
  return withGlobalClaimTransaction(db, async (tx) => {
    if (await hasActiveGlobalLease(tx, input.now)) return null;
    await activateOneDueRequest(tx, input.now);

    const completion = await claimReadyCompletion(tx, input);
    if (completion) return completion;

    const [candidate] = await tx
      .select({
        stepId: accountClosureSteps.id,
        requestId: accountClosureRequests.id,
        requestExternalId: accountClosureRequests.externalId,
        userId: accountClosureRequests.userId,
        userExternalId: users.externalId,
        requestStatus: accountClosureRequests.status,
        categoryId: accountClosureSteps.categoryId,
        handlerVersion: accountClosureSteps.handlerVersion,
        attemptCount: accountClosureSteps.attemptCount,
        checkpoint: accountClosureSteps.checkpoint,
        processedCount: accountClosureSteps.processedCount,
      })
      .from(accountClosureSteps)
      .innerJoin(
        accountClosureRequests,
        eq(accountClosureRequests.id, accountClosureSteps.requestId),
      )
      .innerJoin(users, eq(users.id, accountClosureRequests.userId))
      .where(
        and(
          inArray(accountClosureRequests.status, ['processing', 'needs_attention']),
          or(
            and(
              inArray(accountClosureSteps.status, ['pending', 'retryable']),
              or(
                isNull(accountClosureSteps.nextAttemptAt),
                lte(accountClosureSteps.nextAttemptAt, input.now),
              ),
            ),
            and(
              eq(accountClosureSteps.status, 'blocked'),
              eq(accountClosureRequests.status, 'needs_attention'),
              lte(accountClosureSteps.nextAttemptAt, input.now),
            ),
            and(
              eq(accountClosureSteps.status, 'running'),
              lte(accountClosureSteps.leaseUntil, input.now),
            ),
          ),
        ),
      )
      .orderBy(asc(accountClosureRequests.id), asc(accountClosureSteps.id))
      .limit(1)
      .for('update');

    if (candidate) {
      const claimed = await tx
        .update(accountClosureSteps)
        .set({
          status: 'running',
          leaseOwner: input.workerId,
          leaseUntil: input.leaseUntil,
          startedAt: sql`COALESCE(${accountClosureSteps.startedAt}, ${input.now})`,
        })
        .where(
          and(
            eq(accountClosureSteps.id, candidate.stepId),
            eq(accountClosureSteps.requestId, candidate.requestId),
            or(
              inArray(accountClosureSteps.status, ['pending', 'retryable', 'blocked']),
              and(
                eq(accountClosureSteps.status, 'running'),
                lte(accountClosureSteps.leaseUntil, input.now),
              ),
            ),
          ),
        );
      if (readAffectedRows(claimed) !== 1) return null;
      if (candidate.requestStatus === 'needs_attention') {
        await tx
          .update(accountClosureRequests)
          .set({ status: 'processing' })
          .where(
            and(
              eq(accountClosureRequests.id, candidate.requestId),
              eq(accountClosureRequests.status, 'needs_attention'),
            ),
          );
      }
      return {
        kind: 'handler',
        stepId: candidate.stepId,
        requestId: candidate.requestId,
        requestExternalId: candidate.requestExternalId,
        userId: candidate.userId,
        userExternalId: candidate.userExternalId,
        categoryId: candidate.categoryId as AccountClosureCategoryId,
        handlerVersion: candidate.handlerVersion,
        attemptCount: candidate.attemptCount,
        checkpoint: parseAccountClosureCheckpoint(candidate.checkpoint),
        processedCount: candidate.processedCount,
        leaseOwner: input.workerId,
      };
    }

    return null;
  });
}

export async function renewLease(
  db: DB,
  input: WorkerLeaseInput & { leaseUntil: Date },
): Promise<boolean> {
  if (input.kind === 'completion') {
    const result = await db
      .update(accountClosureRequests)
      .set({ completionLeaseUntil: input.leaseUntil })
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.status, 'processing'),
          eq(accountClosureRequests.completionLeaseOwner, input.leaseOwner),
        ),
      );
    return readAffectedRows(result) === 1;
  }
  const result = await db
    .update(accountClosureSteps)
    .set({ leaseUntil: input.leaseUntil })
    .where(
      and(
        eq(accountClosureSteps.id, input.stepId),
        eq(accountClosureSteps.requestId, input.requestId),
        eq(accountClosureSteps.leaseOwner, input.leaseOwner),
      ),
    );
  return readAffectedRows(result) === 1;
}

export async function markStepContinuation(
  db: DB,
  input: StepLeaseInput & {
    checkpoint: AccountClosureCheckpoint;
    processedCount: number;
    nextAttemptAt: Date;
  },
): Promise<boolean> {
  const checkpoint = parseAccountClosureCheckpoint(input.checkpoint);
  if (!checkpoint) throw new Error('Account closure continuation checkpoint required');
  const result = await db
    .update(accountClosureSteps)
    .set({
      status: 'pending',
      checkpoint,
      processedCount: input.processedCount,
      leaseOwner: null,
      leaseUntil: null,
      nextAttemptAt: input.nextAttemptAt,
      lastErrorCode: null,
    })
    .where(activeOwnedStep(input));
  return readAffectedRows(result) === 1;
}

export async function markStepSucceeded(
  db: DB,
  input: StepLeaseInput & {
    processedCount: number;
    retentionOutcome: AccountClosureRetentionOutcome;
    finishedAt: Date;
  },
): Promise<boolean> {
  const result = await db.transaction(async (tx) =>
    tx
      .update(accountClosureSteps)
      .set({
        status: 'succeeded',
        processedCount: input.processedCount,
        retentionOutcome: input.retentionOutcome,
        checkpoint: null,
        leaseOwner: null,
        leaseUntil: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        finishedAt: input.finishedAt,
      })
      .where(activeOwnedStep(input)),
  );
  return readAffectedRows(result) === 1;
}

export async function markStepRetryable(
  db: DB,
  input: StepLeaseInput & { errorCode: AccountClosureStepErrorCode; nextAttemptAt: Date },
): Promise<boolean> {
  const result = await db
    .update(accountClosureSteps)
    .set({
      status: 'retryable',
      attemptCount: sql`${accountClosureSteps.attemptCount} + 1`,
      nextAttemptAt: input.nextAttemptAt,
      lastErrorCode: input.errorCode,
      leaseOwner: null,
      leaseUntil: null,
    })
    .where(activeOwnedStep(input));
  return readAffectedRows(result) === 1;
}

export async function markStepBlocked(
  db: DB,
  input: StepLeaseInput & { errorCode: AccountClosureStepErrorCode; nextAttemptAt: Date },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const step = await tx
      .update(accountClosureSteps)
      .set({
        status: 'blocked',
        attemptCount: sql`${accountClosureSteps.attemptCount} + 1`,
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(activeOwnedStep(input));
    if (readAffectedRows(step) !== 1) return false;
    const request = await tx
      .update(accountClosureRequests)
      .set({ status: 'needs_attention' })
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.status, 'processing'),
        ),
      );
    return readAffectedRows(request) === 1;
  });
}

export async function markCompletionRetry(
  db: DB,
  input: CompletionLeaseInput & {
    errorCode: AccountClosureStepErrorCode;
    nextAttemptAt: Date;
    blocked: boolean;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const requestRetry = await tx
      .update(accountClosureRequests)
      .set({
        completionAttemptCount: sql`${accountClosureRequests.completionAttemptCount} + 1`,
        completionNextAttemptAt: input.nextAttemptAt,
        completionLastErrorCode: input.errorCode,
        completionLeaseOwner: null,
        completionLeaseUntil: null,
        ...(input.blocked ? { status: 'needs_attention' as const } : {}),
      })
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.status, 'processing'),
          eq(accountClosureRequests.completionLeaseOwner, input.leaseOwner),
        ),
      );
    return readAffectedRows(requestRetry) === 1;
  });
}

export class DatabaseAccountClosureWorkerRepository implements AccountClosureWorkerRepository {
  constructor(
    private readonly db: DB,
    private readonly complete: (
      input: CompletionLeaseInput & { now: Date; signal: AbortSignal },
    ) => Promise<'completed' | 'retryable'>,
  ) {}

  claimNextStep(input: { workerId: string; now: Date; leaseUntil: Date }) {
    return claimNextClosureStep(this.db, input);
  }
  renewLease(input: WorkerLeaseInput & { leaseUntil: Date }) {
    return renewLease(this.db, input);
  }
  markStepContinuation(
    input: StepLeaseInput & {
      checkpoint: AccountClosureCheckpoint;
      processedCount: number;
      nextAttemptAt: Date;
    },
  ) {
    return markStepContinuation(this.db, input);
  }
  markStepSucceeded(
    input: StepLeaseInput & {
      processedCount: number;
      retentionOutcome: AccountClosureRetentionOutcome;
      finishedAt: Date;
    },
  ) {
    return markStepSucceeded(this.db, input);
  }
  markStepRetryable(
    input: StepLeaseInput & { errorCode: AccountClosureStepErrorCode; nextAttemptAt: Date },
  ) {
    return markStepRetryable(this.db, input);
  }
  markStepBlocked(
    input: StepLeaseInput & { errorCode: AccountClosureStepErrorCode; nextAttemptAt: Date },
  ) {
    return markStepBlocked(this.db, input);
  }
  markCompletionRetry(
    input: CompletionLeaseInput & {
      errorCode: AccountClosureStepErrorCode;
      nextAttemptAt: Date;
      blocked: boolean;
    },
  ) {
    return markCompletionRetry(this.db, input);
  }
  completeRequest(input: CompletionLeaseInput & { now: Date; signal: AbortSignal }) {
    return this.complete(input);
  }
}

function activeOwnedStep(input: StepLeaseInput) {
  return and(
    eq(accountClosureSteps.id, input.stepId),
    eq(accountClosureSteps.requestId, input.requestId),
    eq(accountClosureSteps.status, 'running'),
    eq(accountClosureSteps.leaseOwner, input.leaseOwner),
  );
}

function assertLeaseInput(workerId: string, now: Date, leaseUntil: Date): void {
  if (!workerId || workerId.length > 64 || leaseUntil.getTime() <= now.getTime()) {
    throw new Error('Invalid account closure lease');
  }
}

async function withGlobalClaimTransaction<T>(
  db: DB,
  work: (tx: Parameters<Parameters<DB['transaction']>[0]>[0]) => Promise<T>,
): Promise<T | null> {
  const client = (db as unknown as { $client?: mysql.Pool }).$client;
  if (!client || typeof client.getConnection !== 'function') {
    throw new Error('Account closure claim requires a pinned MySQL pool connection');
  }
  const connection = await client.getConnection();
  let acquired = false;
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT GET_LOCK(?, 0) AS acquired',
      [GLOBAL_CLAIM_LOCK],
    );
    acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired) return null;
    const pinned = drizzle(connection, {
      schema,
      mode: 'default',
      casing: 'snake_case',
    }) as unknown as DB;
    // `transaction` resolves only after COMMIT. The advisory lock is released
    // afterwards on this same pinned connection, eliminating release/commit races.
    return await pinned.transaction(work);
  } finally {
    if (acquired) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?) AS released', [GLOBAL_CLAIM_LOCK]);
      } catch {
        connection.destroy();
      }
    }
    connection.release();
  }
}

async function hasActiveGlobalLease(
  tx: Parameters<Parameters<DB['transaction']>[0]>[0],
  now: Date,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: accountClosureSteps.id })
    .from(accountClosureSteps)
    .innerJoin(accountClosureRequests, eq(accountClosureRequests.id, accountClosureSteps.requestId))
    .where(
      and(
        inArray(accountClosureRequests.status, ['processing', 'needs_attention']),
        gt(accountClosureSteps.leaseUntil, now),
      ),
    )
    .limit(1);
  if (row) return true;
  const [completion] = await tx
    .select({ id: accountClosureRequests.id })
    .from(accountClosureRequests)
    .where(
      and(
        inArray(accountClosureRequests.status, ['processing', 'needs_attention']),
        gt(accountClosureRequests.completionLeaseUntil, now),
      ),
    )
    .limit(1);
  return Boolean(completion);
}

async function activateOneDueRequest(
  tx: Parameters<Parameters<DB['transaction']>[0]>[0],
  now: Date,
): Promise<{ requestId: number; userId: number } | null> {
  const [due] = await tx
    .select({ id: accountClosureRequests.id, userId: accountClosureRequests.userId })
    .from(accountClosureRequests)
    .where(
      and(
        eq(accountClosureRequests.status, 'pending_grace'),
        lte(accountClosureRequests.graceEndsAt, now),
      ),
    )
    .orderBy(asc(accountClosureRequests.graceEndsAt), asc(accountClosureRequests.id))
    .limit(1)
    .for('update');
  if (!due) return null;
  const request = await tx
    .update(accountClosureRequests)
    .set({ status: 'processing', processingStartedAt: now })
    .where(
      and(
        eq(accountClosureRequests.id, due.id),
        eq(accountClosureRequests.status, 'pending_grace'),
        lte(accountClosureRequests.graceEndsAt, now),
      ),
    );
  if (readAffectedRows(request) !== 1) return null;
  const user = await tx
    .update(users)
    .set({ status: 'closure_processing' })
    .where(and(eq(users.id, due.userId), eq(users.status, 'closure_pending')));
  if (readAffectedRows(user) !== 1) throw new AccountClosureRepositoryError('USER_STATE_CONFLICT');
  return { requestId: due.id, userId: due.userId };
}

async function findReadyCompletion(tx: Parameters<Parameters<DB['transaction']>[0]>[0], now: Date) {
  const [request] = await tx
    .select({
      requestId: accountClosureRequests.id,
      requestExternalId: accountClosureRequests.externalId,
      userId: accountClosureRequests.userId,
      userExternalId: users.externalId,
      requestStatus: accountClosureRequests.status,
      attemptCount: accountClosureRequests.completionAttemptCount,
      nextAttemptAt: accountClosureRequests.completionNextAttemptAt,
      leaseUntil: accountClosureRequests.completionLeaseUntil,
    })
    .from(accountClosureRequests)
    .innerJoin(users, eq(users.id, accountClosureRequests.userId))
    .innerJoin(accountClosureSteps, eq(accountClosureSteps.requestId, accountClosureRequests.id))
    .where(
      and(
        inArray(accountClosureRequests.status, ['processing', 'needs_attention']),
        or(
          isNull(accountClosureRequests.completionNextAttemptAt),
          lte(accountClosureRequests.completionNextAttemptAt, now),
        ),
        or(
          isNull(accountClosureRequests.completionLeaseUntil),
          lte(accountClosureRequests.completionLeaseUntil, now),
        ),
      ),
    )
    .groupBy(
      accountClosureRequests.id,
      accountClosureRequests.externalId,
      accountClosureRequests.userId,
      users.externalId,
      accountClosureRequests.status,
      accountClosureRequests.completionAttemptCount,
      accountClosureRequests.completionNextAttemptAt,
      accountClosureRequests.completionLeaseUntil,
    )
    .having(
      sql`COUNT(*) = ${DATA_CATEGORY_IDS.length}
        AND SUM(CASE WHEN ${accountClosureSteps.status} = 'succeeded' AND ${accountClosureSteps.retentionOutcome} IS NOT NULL THEN 1 ELSE 0 END) = ${DATA_CATEGORY_IDS.length}`,
    )
    .orderBy(asc(accountClosureRequests.id))
    .limit(1);
  return request ?? null;
}

async function claimReadyCompletion(
  tx: Parameters<Parameters<DB['transaction']>[0]>[0],
  input: { workerId: string; now: Date; leaseUntil: Date },
): Promise<Extract<ClaimedClosureWork, { kind: 'completion' }> | null> {
  const completion = await findReadyCompletion(tx, input.now);
  if (!completion) return null;
  const lease = await tx
    .update(accountClosureRequests)
    .set({
      status: 'processing',
      completionLeaseOwner: input.workerId,
      completionLeaseUntil: input.leaseUntil,
    })
    .where(
      and(
        eq(accountClosureRequests.id, completion.requestId),
        inArray(accountClosureRequests.status, ['processing', 'needs_attention']),
        or(
          isNull(accountClosureRequests.completionLeaseUntil),
          lte(accountClosureRequests.completionLeaseUntil, input.now),
        ),
      ),
    );
  if (readAffectedRows(lease) !== 1) return null;
  return {
    kind: 'completion',
    requestId: completion.requestId,
    requestExternalId: completion.requestExternalId,
    userId: completion.userId,
    userExternalId: completion.userExternalId,
    attemptCount: completion.attemptCount,
    leaseOwner: input.workerId,
  };
}
