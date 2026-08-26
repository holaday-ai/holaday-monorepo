import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { PrivateEmailSender } from '../auth/email-code.js';
import { DATA_CATEGORY_IDS, type DataCategoryId } from '../data-governance/types.js';
import type { DB } from '../db/client.js';
import { accountClosureRequests, accountClosureSteps } from '../db/schema/account-closures.js';
import { users } from '../db/schema/users.js';
import {
  ACCOUNT_CLOSURE_STORAGE_DELETE_TIMEOUT_MS,
  type StorageProvider,
} from '../files/storage-provider.js';
import { type AccountClosureHandler, ClosureHandlerError } from './handler-contract.js';
import { createDatabaseReceiptService } from './receipt-service.js';
import {
  ACCOUNT_CLOSURE_LEASE_MS,
  type AccountClosureWorkerRepository,
  type ClaimedClosureWork,
  type CompletionLeaseInput,
  DatabaseAccountClosureWorkerRepository,
  type StepLeaseInput,
  type WorkerLeaseInput,
} from './repository.js';
import type { SmsGatewayClient } from './sms-gateway-client.js';
import {
  TombstoneFinalizationError,
  computeAccountClosureSubjectDigest,
  finalizeUserTombstone,
} from './tombstone-service.js';
import type { AccountClosureStepErrorCode } from './types.js';

export type WorkerTickResult = 'disabled' | 'idle' | 'progress' | 'attention' | 'memory_guard';

export const CLOSURE_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000] as const;
export const ACCOUNT_CLOSURE_ATTENTION_RETRY_MS = 24 * 60 * 60 * 1_000;
export const ACCOUNT_CLOSURE_MEMORY_GUARD_BYTES = 480 * 1024 * 1024;
/**
 * A storage page returns immediately after at most 100 sequential deletes.
 * 100 × 5s = 500s; the remaining 100s is reserved for bounded queries and
 * the durable checkpoint. Voice deletion and completion notification run on
 * mutually exclusive ticks and have lower provider bounds.
 */
export const ACCOUNT_CLOSURE_MAX_PAGE_DURATION_MS =
  100 * ACCOUNT_CLOSURE_STORAGE_DELETE_TIMEOUT_MS + 100_000;
const LEASE_HEARTBEAT_MS = 30_000;

export interface AccountClosureCompletionNotification {
  emailSender: PrivateEmailSender;
  smsGateway: Pick<SmsGatewayClient, 'sendAccountClosureComplete'>;
}

export interface AccountClosureWorkerDeps {
  db: DB;
  handlers: ReadonlyMap<DataCategoryId, AccountClosureHandler>;
  workerId: string;
  now: () => Date;
  rssBytes: () => number;
  enabled?: boolean;
  repository?: AccountClosureWorkerRepository;
  logger?: Logger;
  storage?: StorageProvider;
  hmacSecret?: string;
  notification?: AccountClosureCompletionNotification;
  /** Tests may shorten the interval; production always uses 30 seconds. */
  leaseHeartbeatMs?: number;
}

export async function runAccountClosureWorkerLoop(input: {
  tick: () => Promise<WorkerTickResult>;
  wait: () => Promise<void>;
  shouldStop: () => boolean;
}): Promise<void> {
  while (!input.shouldStop()) {
    await input.tick();
    if (!input.shouldStop()) await input.wait();
  }
}

export interface AccountClosureWorkerSignalSource {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  removeListener(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/** Installs the production signal boundary and drains the current durable page. */
export async function runAccountClosureWorkerRuntime(input: {
  tick: () => Promise<WorkerTickResult>;
  signals: AccountClosureWorkerSignalSource;
  pollMs: number;
  onSignal?: (signal: 'SIGTERM' | 'SIGINT') => void;
}): Promise<void> {
  if (!Number.isSafeInteger(input.pollMs) || input.pollMs <= 0) {
    throw new Error('Invalid account closure worker poll interval');
  }
  let stopping = false;
  const sleeper: { wake: (() => void) | null } = { wake: null };
  const listeners = new Map<'SIGTERM' | 'SIGINT', () => void>();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const listener = () => {
      stopping = true;
      sleeper.wake?.();
      input.onSignal?.(signal);
    };
    listeners.set(signal, listener);
    input.signals.once(signal, listener);
  }
  try {
    await runAccountClosureWorkerLoop({
      tick: input.tick,
      shouldStop: () => stopping,
      wait: () =>
        new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            if (sleeper.wake === finish) sleeper.wake = null;
            resolve();
          };
          const timer = setTimeout(finish, input.pollMs);
          sleeper.wake = finish;
        }),
    });
  } finally {
    sleeper.wake?.();
    for (const [signal, listener] of listeners) {
      input.signals.removeListener(signal, listener);
    }
  }
}

export async function runAccountClosureWorkerTick(
  deps: AccountClosureWorkerDeps,
): Promise<WorkerTickResult> {
  if (deps.enabled === false) return 'disabled';
  if (deps.rssBytes() >= ACCOUNT_CLOSURE_MEMORY_GUARD_BYTES) return 'memory_guard';
  const repository =
    deps.repository ??
    new DatabaseAccountClosureWorkerRepository(deps.db, (input) => completeClaim(deps, input));
  const now = deps.now();
  const claim = await repository.claimNextStep({
    workerId: deps.workerId,
    now,
    leaseUntil: new Date(now.getTime() + ACCOUNT_CLOSURE_LEASE_MS),
  });
  if (!claim) return 'idle';

  const lease = workerLeaseInput(claim);
  const renewed = await repository.renewLease({
    ...lease,
    leaseUntil: new Date(deps.now().getTime() + ACCOUNT_CLOSURE_LEASE_MS),
  });
  if (!renewed) return 'idle';

  if (claim.kind === 'completion') {
    const heartbeat = startLeaseHeartbeat(
      repository,
      claim,
      deps.now,
      deps.leaseHeartbeatMs ?? LEASE_HEARTBEAT_MS,
    );
    try {
      const result = await repository.completeRequest({
        requestId: claim.requestId,
        leaseOwner: claim.leaseOwner,
        now: deps.now(),
        signal: heartbeat.signal,
      });
      await heartbeat.stop();
      if (result !== 'completed' && heartbeat.signal.aborted) return 'idle';
      return result === 'completed' ? 'progress' : 'attention';
    } catch (error) {
      await heartbeat.stop();
      if (heartbeat.signal.aborted) return 'idle';
      return persistCompletionFailure(repository, claim, deps.now(), error);
    }
  }

  const handler = deps.handlers.get(claim.categoryId);
  if (!handler || handler.version !== claim.handlerVersion) {
    await repository.markStepBlocked({
      ...stepLeaseInput(claim),
      errorCode: 'handler_missing',
      nextAttemptAt: new Date(deps.now().getTime() + ACCOUNT_CLOSURE_ATTENTION_RETRY_MS),
    });
    safeLog(deps.logger, 'warn', claim, 'handler_missing');
    return 'attention';
  }
  if (!deps.logger || !deps.storage) {
    throw new Error('Account closure worker dependencies are incomplete');
  }

  const heartbeat = startLeaseHeartbeat(
    repository,
    claim,
    deps.now,
    deps.leaseHeartbeatMs ?? LEASE_HEARTBEAT_MS,
  );
  try {
    const result = await handler.run({
      db: deps.db,
      logger: deps.logger,
      storage: deps.storage,
      signal: heartbeat.signal,
      request: {
        id: claim.requestId,
        externalId: claim.requestExternalId,
        userId: claim.userId,
        userExternalId: claim.userExternalId,
      },
      checkpoint: claim.checkpoint
        ? {
            ...claim.checkpoint,
            processedCount: claim.checkpoint.processedCount ?? claim.processedCount,
          }
        : claim.processedCount > 0
          ? { processedCount: claim.processedCount }
          : null,
      pageSize: 100,
    });
    await heartbeat.stop();
    if (heartbeat.signal.aborted) return 'idle';
    if (result.kind === 'continue') {
      const saved = await repository.markStepContinuation({
        ...stepLeaseInput(claim),
        checkpoint: result.checkpoint,
        processedCount: result.processed,
        nextAttemptAt: deps.now(),
      });
      if (!saved) return 'idle';
      safeLog(deps.logger, 'info', claim, 'page_persisted', result.processed);
      return 'progress';
    }
    const saved = await repository.markStepSucceeded({
      ...stepLeaseInput(claim),
      processedCount: result.processed,
      retentionOutcome: result.retention,
      finishedAt: deps.now(),
    });
    if (!saved) return 'idle';
    safeLog(deps.logger, 'info', claim, 'step_succeeded', result.processed);
    return 'progress';
  } catch (error) {
    await heartbeat.stop();
    if (heartbeat.signal.aborted) return 'idle';
    return persistHandlerFailure(repository, claim, deps.now(), error, deps.logger);
  }
}

async function completeClaim(
  deps: AccountClosureWorkerDeps,
  input: CompletionLeaseInput & { now: Date; signal: AbortSignal },
): Promise<'completed' | 'retryable'> {
  if (!deps.hmacSecret || deps.hmacSecret.trim().length < 32 || !deps.notification) {
    throw new WorkerOperationError('configuration');
  }
  const context = await readCompletionContext(
    deps.db,
    input.requestId,
    input.leaseOwner,
    input.now,
    deps.hmacSecret,
  );
  input.signal.throwIfAborted();
  const receipts = createDatabaseReceiptService(deps.db);
  await receipts.createCompletionReceipt({
    requestId: input.requestId,
    userId: context.userId,
    subjectDigest: context.subjectDigest,
    completedCategoryIds: DATA_CATEGORY_IDS,
    restrictedCategoryIds: context.restrictedCategoryIds,
  });
  let receipt = await receipts.getCompletionReceiptRecord(input.requestId, context.userId);
  if (!receipt) throw new WorkerOperationError('database_unavailable');
  input.signal.throwIfAborted();
  if (receipt.notificationStatus !== 'accepted') {
    try {
      if (context.email && context.emailVerified && deps.notification.emailSender.isAvailable()) {
        await deps.notification.emailSender.send({
          to: context.email,
          subject: 'HOLA DAY 账户关闭完成',
          text: `你的账户关闭已完成。回执编号：${receipt.receiptNumber}`,
          idempotencyKey: receipt.receiptNumber,
          signal: input.signal,
        });
      } else if (context.phone && context.phoneVerified) {
        await deps.notification.smsGateway.sendAccountClosureComplete(
          context.phone,
          receipt.receiptNumber,
          { signal: input.signal },
        );
      } else {
        throw new WorkerOperationError('configuration');
      }
      input.signal.throwIfAborted();
      receipt = await receipts.setCompletionNotificationStatus(
        input.requestId,
        context.userId,
        'accepted',
      );
    } catch (error) {
      if (input.signal.aborted) throw error;
      await receipts.setCompletionNotificationStatus(input.requestId, context.userId, 'failed');
      if (error instanceof WorkerOperationError && error.code === 'configuration') throw error;
      throw new WorkerOperationError('provider_unavailable');
    }
  }
  if (receipt.notificationStatus !== 'accepted') return 'retryable';
  input.signal.throwIfAborted();
  const completedAt = deps.now();
  await finalizeUserTombstone({
    db: deps.db,
    requestId: input.requestId,
    userId: context.userId,
    hmacSecret: deps.hmacSecret,
    expectedLeaseOwner: input.leaseOwner,
    now: completedAt,
  });
  return 'completed';
}

async function readCompletionContext(
  db: DB,
  requestId: number,
  leaseOwner: string,
  now: Date,
  hmacSecret: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        userId: accountClosureRequests.userId,
        requestStatus: accountClosureRequests.status,
        userStatus: users.status,
        externalId: users.externalId,
        email: users.email,
        phone: users.phone,
        googleId: users.googleId,
        emailVerified: users.emailVerified,
        phoneVerified: users.phoneVerified,
      })
      .from(accountClosureRequests)
      .innerJoin(users, eq(users.id, accountClosureRequests.userId))
      .where(
        and(
          eq(accountClosureRequests.id, requestId),
          eq(accountClosureRequests.status, 'processing'),
          eq(accountClosureRequests.completionLeaseOwner, leaseOwner),
        ),
      )
      .limit(1)
      .for('update');
    if (
      !row ||
      row.userStatus !== 'closure_processing' ||
      !(await hasCurrentCompletionLease(tx, requestId, leaseOwner, now))
    ) {
      throw new WorkerOperationError('invariant_violation');
    }
    const steps = await tx
      .select({
        categoryId: accountClosureSteps.categoryId,
        status: accountClosureSteps.status,
        outcome: accountClosureSteps.retentionOutcome,
      })
      .from(accountClosureSteps)
      .where(eq(accountClosureSteps.requestId, requestId))
      .for('update');
    if (
      steps.length !== DATA_CATEGORY_IDS.length ||
      steps.some((step) => step.status !== 'succeeded' || step.outcome === null) ||
      new Set(steps.map((step) => step.categoryId)).size !== DATA_CATEGORY_IDS.length
    ) {
      throw new WorkerOperationError('invariant_violation');
    }
    return {
      userId: row.userId,
      email: row.email,
      phone: row.phone,
      emailVerified: row.emailVerified,
      phoneVerified: row.phoneVerified,
      subjectDigest: computeAccountClosureSubjectDigest(hmacSecret, {
        externalId: row.externalId,
        email: row.email,
        phone: row.phone,
        googleId: row.googleId,
      }),
      restrictedCategoryIds: DATA_CATEGORY_IDS.filter((categoryId) =>
        steps.some((step) => step.categoryId === categoryId && step.outcome === 'restricted'),
      ),
    };
  });
}

async function persistHandlerFailure(
  repository: AccountClosureWorkerRepository,
  claim: Extract<ClaimedClosureWork, { kind: 'handler' }>,
  now: Date,
  error: unknown,
  logger?: Logger,
): Promise<WorkerTickResult> {
  const errorCode = classifyError(error);
  const lease = stepLeaseInput(claim);
  if (claim.attemptCount >= CLOSURE_RETRY_DELAYS_MS.length - 1) {
    await repository.markStepBlocked({
      ...lease,
      errorCode,
      nextAttemptAt: new Date(now.getTime() + ACCOUNT_CLOSURE_ATTENTION_RETRY_MS),
    });
    safeLog(logger, 'warn', claim, errorCode);
    return 'attention';
  }
  await repository.markStepRetryable({
    ...lease,
    errorCode,
    nextAttemptAt: new Date(now.getTime() + retryDelay(claim.attemptCount)),
  });
  safeLog(logger, 'warn', claim, errorCode);
  return 'progress';
}

async function persistCompletionFailure(
  repository: AccountClosureWorkerRepository,
  claim: Extract<ClaimedClosureWork, { kind: 'completion' }>,
  now: Date,
  error: unknown,
): Promise<WorkerTickResult> {
  const blocked = claim.attemptCount >= CLOSURE_RETRY_DELAYS_MS.length - 1;
  await repository.markCompletionRetry({
    requestId: claim.requestId,
    leaseOwner: claim.leaseOwner,
    errorCode: classifyError(error),
    blocked,
    nextAttemptAt: new Date(
      now.getTime() +
        (blocked ? ACCOUNT_CLOSURE_ATTENTION_RETRY_MS : retryDelay(claim.attemptCount)),
    ),
  });
  return blocked ? 'attention' : 'progress';
}

interface LeaseHeartbeat {
  signal: AbortSignal;
  stop(): Promise<void>;
}

function startLeaseHeartbeat(
  repository: AccountClosureWorkerRepository,
  claim: ClaimedClosureWork,
  now: () => Date,
  heartbeatMs: number,
): LeaseHeartbeat {
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0) {
    throw new Error('Invalid account closure heartbeat interval');
  }
  const controller = new AbortController();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let renewal: Promise<void> | null = null;

  const schedule = () => {
    if (stopped || controller.signal.aborted) return;
    timer = setTimeout(() => {
      timer = null;
      renewal = (async () => {
        try {
          const current = now();
          const renewed = await repository.renewLease({
            ...workerLeaseInput(claim),
            leaseUntil: new Date(current.getTime() + ACCOUNT_CLOSURE_LEASE_MS),
          });
          if (!renewed) controller.abort(new Error('account closure lease lost'));
        } catch {
          controller.abort(new Error('account closure lease renewal failed'));
        }
      })().finally(() => {
        renewal = null;
        schedule();
      });
    }, heartbeatMs);
    timer.unref();
  };
  schedule();

  return {
    signal: controller.signal,
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const pending = renewal;
      if (pending) await pending;
    },
  };
}

function workerLeaseInput(claim: ClaimedClosureWork): WorkerLeaseInput {
  if (claim.kind === 'completion') {
    return { kind: 'completion', requestId: claim.requestId, leaseOwner: claim.leaseOwner };
  }
  return {
    kind: 'handler',
    stepId: claim.stepId,
    requestId: claim.requestId,
    leaseOwner: claim.leaseOwner,
  };
}

function stepLeaseInput(claim: Extract<ClaimedClosureWork, { kind: 'handler' }>): StepLeaseInput {
  return {
    stepId: claim.stepId,
    requestId: claim.requestId,
    leaseOwner: claim.leaseOwner,
  };
}

async function hasCurrentCompletionLease(
  tx: Parameters<Parameters<DB['transaction']>[0]>[0],
  requestId: number,
  leaseOwner: string,
  now: Date,
): Promise<boolean> {
  const [lease] = await tx
    .select({ until: accountClosureRequests.completionLeaseUntil })
    .from(accountClosureRequests)
    .where(
      and(
        eq(accountClosureRequests.id, requestId),
        eq(accountClosureRequests.status, 'processing'),
        eq(accountClosureRequests.completionLeaseOwner, leaseOwner),
      ),
    )
    .limit(1)
    .for('update');
  return Boolean(lease?.until && lease.until.getTime() > now.getTime());
}

function classifyError(error: unknown): AccountClosureStepErrorCode {
  if (error instanceof WorkerOperationError) return error.code;
  if (error instanceof TombstoneFinalizationError) return 'invariant_violation';
  if (error instanceof ClosureHandlerError) {
    if (error.code === 'INVARIANT_VIOLATION') return 'invariant_violation';
    if (error.code === 'CAPABILITY_CHANGED') return 'configuration';
    if (error.code === 'HANDLER_DEFERRED') return 'handler_missing';
    return 'provider_unavailable';
  }
  return 'provider_unavailable';
}

class WorkerOperationError extends Error {
  constructor(readonly code: AccountClosureStepErrorCode) {
    super(code);
    this.name = 'WorkerOperationError';
  }
}

function retryDelay(attemptCount: number): number {
  const delay = CLOSURE_RETRY_DELAYS_MS[attemptCount];
  if (delay === undefined) throw new Error('Account closure retry schedule exhausted');
  return delay;
}

function safeLog(
  logger: Logger | undefined,
  level: 'info' | 'warn',
  claim: ClaimedClosureWork,
  status: string,
  processedCount?: number,
): void {
  logger?.[level](
    {
      requestId: claim.requestId,
      categoryId: claim.kind === 'handler' ? claim.categoryId : undefined,
      status,
      attemptCount: claim.attemptCount,
      processedCount,
    },
    'account-closure-worker',
  );
}

export type { AccountClosureWorkerRepository, ClaimedClosureWork } from './repository.js';
