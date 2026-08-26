import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { AccountClosureRecoveryClaims } from '../auth/jwt.js';
import { signAccountClosureRecoveryToken, verifyAccountClosureRecoveryToken } from '../auth/jwt.js';
import type { MfaService } from '../auth/mfa-service.js';
import type { DB } from '../db/client.js';
import { accountClosureRequests } from '../db/schema/account-closures.js';
import { notificationChannels } from '../db/schema/notifications.js';
import { plannedTasks } from '../db/schema/planned-tasks.js';
import { scheduledTasks } from '../db/schema/scheduled-tasks.js';
import { stockRiskMonitors } from '../db/schema/stock-risk-monitors.js';
import { taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { TASK_ACTIVE_STATUSES } from '../task-status.js';
import type { AccountClosureChallengeService } from './challenge-service.js';
import { applyImmediateClosureEffects } from './immediate-effects.js';
import type { AccountClosureReceiptService, ApplicationClosureReceipt } from './receipt-service.js';
import {
  AccountClosureRepositoryError,
  type FrozenAccountClosure,
  freezeAccountForClosure,
  withdrawAccountClosureRequest,
} from './repository.js';
import { closureGraceEndsAt } from './state-machine.js';
import type {
  AccountClosureReasonCode,
  AccountClosureRequestStatus,
  AccountClosureUserStatus,
} from './types.js';

const RETAINED_CATEGORY_IDS = ['payments_entitlements', 'partner_kyc_ledger'] as const;

export interface ClosurePreview {
  graceEndsAt: string;
  plan: { name: string; expiresAt: string | null };
  counts: {
    activeTasks: number;
    futureTasks: number;
    files: number;
    stockItems: number;
    notificationChannels: number;
  };
  retainedCategoryIds: (typeof RETAINED_CATEGORY_IDS)[number][];
  automaticRefund: false;
}

export interface ClosureUserSubject {
  id: number;
  externalId: string;
  status: AccountClosureUserStatus;
  authVersion: number;
  mfaEnabled: boolean;
  plan: string;
  planExpiresAt: Date | null;
}

export interface ClosureRecoverySubject {
  userId: number;
  userExternalId: string;
  authVersion: number;
  mfaEnabled: boolean;
  plan: string;
  planExpiresAt: Date | null;
  userStatus: AccountClosureUserStatus;
  requestId: number;
  requestExternalId: string;
  requestStatus: AccountClosureRequestStatus;
  requestedAt: Date;
  graceEndsAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

type VisibleClosureRecoverySubject = Omit<ClosureRecoverySubject, 'requestStatus'> & {
  requestStatus: Exclude<AccountClosureRequestStatus, 'cancelled'>;
};

export interface ClosureServiceRepository {
  findUser(userExternalId: string): Promise<ClosureUserSubject | null>;
  previewCounts(userId: number): Promise<ClosurePreview['counts']>;
  freeze(input: {
    userId: number;
    userExternalId: string;
    expectedAuthVersion: number;
    requestedAt: Date;
    reasonCode?: AccountClosureReasonCode;
  }): Promise<FrozenAccountClosure>;
  applyImmediateEffects(input: {
    requestId: number;
    userId: number;
    userExternalId: string;
  }): Promise<void>;
  findRecoverySubject(
    requestExternalId: string,
    userExternalId: string,
  ): Promise<ClosureRecoverySubject | null>;
  withdraw(input: { requestId: number; userId: number; now: Date }): Promise<void>;
}

export interface AccountClosureServiceDependencies {
  repository: ClosureServiceRepository;
  challenge: Pick<AccountClosureChallengeService, 'createChallenge' | 'verifyChallenge'>;
  mfa: Pick<MfaService, 'verifyUserFactor'>;
  receipts: Pick<
    AccountClosureReceiptService,
    'createApplicationReceipt' | 'getApplicationReceipt'
  >;
  verifyRecoveryToken(token: string): Promise<AccountClosureRecoveryClaims | null>;
  signRecoveryToken(claims: Omit<AccountClosureRecoveryClaims, 'aud'>): Promise<string>;
  now(): Date;
  logger: Pick<Logger, 'error'>;
  config: {
    enabled: boolean;
    allowlist: Set<string>;
  };
}

export type AccountClosureServiceErrorCode =
  | 'UNAVAILABLE'
  | 'VERIFICATION_FAILED'
  | 'INVALID_RECOVERY'
  | 'DEADLINE_PASSED_OR_PROCESSING'
  | 'RECEIPT_UNAVAILABLE';

export class AccountClosureServiceError extends Error {
  constructor(public readonly code: AccountClosureServiceErrorCode) {
    super('Account closure operation could not be completed');
    this.name = 'AccountClosureServiceError';
  }
}

export interface BeginClosureInput {
  challengeId: string;
  code: string;
  mfaCode?: string;
  reasonCode?: AccountClosureReasonCode;
  acknowledgements: {
    immediateSignOut: true;
    runningWorkStops: true;
    noAutomaticRefund: true;
  };
}

export interface CancelClosureInput {
  challengeId: string;
  code: string;
  mfaCode?: string;
}

export class AccountClosureService {
  constructor(private readonly deps: AccountClosureServiceDependencies) {}

  async preview(userExternalId: string): Promise<ClosurePreview> {
    const user = await this.requireApplicationUser(userExternalId);
    return {
      graceEndsAt: closureGraceEndsAt(this.deps.now()).toISOString(),
      plan: {
        name: user.plan,
        expiresAt: user.planExpiresAt?.toISOString() ?? null,
      },
      counts: await this.deps.repository.previewCounts(user.id),
      retainedCategoryIds: [...RETAINED_CATEGORY_IDS],
      automaticRefund: false,
    };
  }

  async requestVerification(userExternalId: string) {
    const user = await this.requireApplicationUser(userExternalId);
    const delivery = await this.deps.challenge.createChallenge({
      userId: user.id,
      action: 'begin',
    });
    return serializeChallengeDelivery(delivery);
  }

  async begin(userExternalId: string, input: BeginClosureInput) {
    const user = await this.requireApplicationUser(userExternalId);
    if (user.mfaEnabled && !input.mfaCode) {
      throw new AccountClosureServiceError('VERIFICATION_FAILED');
    }
    try {
      await this.deps.challenge.verifyChallenge({
        userId: user.id,
        action: 'begin',
        challengeId: input.challengeId,
        code: input.code,
      });
      if (user.mfaEnabled) {
        await this.deps.mfa.verifyUserFactor(user.externalId, input.mfaCode as string);
      }
    } catch {
      throw new AccountClosureServiceError('VERIFICATION_FAILED');
    }

    const requestedAt = this.deps.now();
    let frozen: FrozenAccountClosure;
    try {
      frozen = await this.deps.repository.freeze({
        userId: user.id,
        userExternalId: user.externalId,
        expectedAuthVersion: user.authVersion,
        requestedAt,
        reasonCode: input.reasonCode,
      });
    } catch {
      throw new AccountClosureServiceError('VERIFICATION_FAILED');
    }

    let receipt: ApplicationClosureReceipt | null = null;
    try {
      receipt = await this.deps.receipts.createApplicationReceipt({
        requestId: frozen.requestId,
        userId: user.id,
        issuedAt: frozen.requestedAt,
        completedCategoryIds: [],
        restrictedCategoryIds: RETAINED_CATEGORY_IDS,
      });
    } catch {
      this.deps.logger.error(
        {
          kind: 'account_closure_application_receipt',
          requestId: frozen.requestId,
          errorCode: 'persistence_failed',
        },
        'account closure application receipt persistence failed',
      );
    }

    try {
      await this.deps.repository.applyImmediateEffects({
        requestId: frozen.requestId,
        userId: user.id,
        userExternalId: user.externalId,
      });
    } catch {
      // The account is already frozen and credentials are revoked. A later
      // retry continues from durable request/effect state; never reopen here.
      this.deps.logger.error(
        {
          kind: 'account_closure_immediate_effects',
          requestId: frozen.requestId,
          errorCode: 'retryable',
        },
        'account closure immediate effects require retry',
      );
    }

    if (!receipt) throw new AccountClosureServiceError('RECEIPT_UNAVAILABLE');

    return {
      recoveryToken: await this.deps.signRecoveryToken({
        sub: user.externalId,
        requestId: frozen.requestExternalId,
        authVersion: frozen.authVersion,
      }),
      requestStatus: 'pending_grace' as const,
      graceEndsAt: frozen.graceEndsAt.toISOString(),
      receipt: { receiptNumber: receipt.receiptNumber },
    };
  }

  async status(recoveryToken: string) {
    const subject = await this.requireRecoverySubject(recoveryToken);
    return {
      requestStatus: subject.requestStatus,
      requestedAt: subject.requestedAt.toISOString(),
      graceEndsAt: subject.graceEndsAt.toISOString(),
      completedAt: subject.completedAt?.toISOString() ?? null,
      cancelledAt: subject.cancelledAt?.toISOString() ?? null,
      canCancel:
        subject.requestStatus === 'pending_grace' &&
        this.deps.now().getTime() < subject.graceEndsAt.getTime(),
      plan: {
        name: subject.plan,
        expiresAt: subject.planExpiresAt?.toISOString() ?? null,
      },
      mfaRequired: subject.mfaEnabled,
    };
  }

  async requestCancellationVerification(recoveryToken: string) {
    const subject = await this.requireCancellableRecoverySubject(recoveryToken);
    const delivery = await this.deps.challenge.createChallenge({
      userId: subject.userId,
      requestId: subject.requestId,
      action: 'cancel',
    });
    return serializeChallengeDelivery(delivery);
  }

  async cancel(recoveryToken: string, input: CancelClosureInput): Promise<{ cancelled: true }> {
    const subject = await this.requireCancellableRecoverySubject(recoveryToken);
    if (subject.mfaEnabled && !input.mfaCode) {
      throw new AccountClosureServiceError('VERIFICATION_FAILED');
    }
    try {
      await this.deps.challenge.verifyChallenge({
        userId: subject.userId,
        requestId: subject.requestId,
        action: 'cancel',
        challengeId: input.challengeId,
        code: input.code,
      });
      if (subject.mfaEnabled) {
        await this.deps.mfa.verifyUserFactor(subject.userExternalId, input.mfaCode as string);
      }
      await this.deps.repository.withdraw({
        requestId: subject.requestId,
        userId: subject.userId,
        now: this.deps.now(),
      });
    } catch (error) {
      if (
        error instanceof AccountClosureRepositoryError &&
        error.code === 'DEADLINE_PASSED_OR_PROCESSING'
      ) {
        throw new AccountClosureServiceError('DEADLINE_PASSED_OR_PROCESSING');
      }
      throw new AccountClosureServiceError('VERIFICATION_FAILED');
    }
    return { cancelled: true };
  }

  async applicationReceipt(recoveryToken: string): Promise<ApplicationClosureReceipt> {
    const subject = await this.requireRecoverySubject(recoveryToken);
    const existing = await this.deps.receipts.getApplicationReceipt(
      subject.requestId,
      subject.userId,
    );
    if (existing) return existing;

    // Heal a transient post-freeze persistence failure idempotently. The
    // receipt service's unique (request, kind) boundary preserves immutability.
    try {
      return await this.deps.receipts.createApplicationReceipt({
        requestId: subject.requestId,
        userId: subject.userId,
        issuedAt: subject.requestedAt,
        completedCategoryIds: [],
        restrictedCategoryIds: RETAINED_CATEGORY_IDS,
      });
    } catch {
      throw new AccountClosureServiceError('RECEIPT_UNAVAILABLE');
    }
  }

  private async requireApplicationUser(userExternalId: string): Promise<ClosureUserSubject> {
    if (!this.deps.config.enabled || !this.deps.config.allowlist.has(userExternalId)) {
      throw new AccountClosureServiceError('UNAVAILABLE');
    }
    const user = await this.deps.repository.findUser(userExternalId);
    if (!user || user.status !== 'active') {
      throw new AccountClosureServiceError('VERIFICATION_FAILED');
    }
    return user;
  }

  private async requireRecoverySubject(
    recoveryToken: string,
  ): Promise<VisibleClosureRecoverySubject> {
    const claims = await this.deps.verifyRecoveryToken(recoveryToken);
    if (!claims || claims.aud !== 'account-closure-recovery') {
      throw new AccountClosureServiceError('INVALID_RECOVERY');
    }
    const subject = await this.deps.repository.findRecoverySubject(claims.requestId, claims.sub);
    if (
      !subject ||
      subject.requestExternalId !== claims.requestId ||
      subject.userExternalId !== claims.sub ||
      subject.authVersion !== claims.authVersion ||
      !isValidRecoveryState(subject)
    ) {
      throw new AccountClosureServiceError('INVALID_RECOVERY');
    }
    return subject as VisibleClosureRecoverySubject;
  }

  private async requireCancellableRecoverySubject(
    recoveryToken: string,
  ): Promise<VisibleClosureRecoverySubject> {
    const subject = await this.requireRecoverySubject(recoveryToken);
    if (
      subject.requestStatus !== 'pending_grace' ||
      subject.userStatus !== 'closure_pending' ||
      this.deps.now().getTime() >= subject.graceEndsAt.getTime()
    ) {
      throw new AccountClosureServiceError('DEADLINE_PASSED_OR_PROCESSING');
    }
    return subject;
  }
}

export class DatabaseClosureServiceRepository implements ClosureServiceRepository {
  constructor(private readonly db: DB) {}

  async findUser(userExternalId: string): Promise<ClosureUserSubject | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        externalId: users.externalId,
        status: users.status,
        authVersion: users.authVersion,
        mfaEnabled: users.mfaEnabled,
        plan: users.plan,
        planExpiresAt: users.planExpiresAt,
      })
      .from(users)
      .where(eq(users.externalId, userExternalId))
      .limit(1);
    return row ?? null;
  }

  async previewCounts(userId: number): Promise<ClosurePreview['counts']> {
    const [activeTasks, planned, scheduled, files, stockItems, channels] = await Promise.all([
      this.count(
        tasks,
        and(eq(tasks.userId, userId), inArray(tasks.status, [...TASK_ACTIVE_STATUSES])),
      ),
      this.count(
        plannedTasks,
        and(eq(plannedTasks.userId, userId), inArray(plannedTasks.status, ['active', 'running'])),
      ),
      this.count(
        scheduledTasks,
        and(
          eq(scheduledTasks.userId, userId),
          inArray(scheduledTasks.status, ['active', 'running']),
        ),
      ),
      this.count(taskFiles, and(eq(taskFiles.userId, userId), eq(taskFiles.status, 'active'))),
      this.count(stockRiskMonitors, eq(stockRiskMonitors.userId, userId)),
      this.count(
        notificationChannels,
        and(eq(notificationChannels.userId, userId), eq(notificationChannels.enabled, true)),
      ),
    ]);
    return {
      activeTasks,
      futureTasks: planned + scheduled,
      files,
      stockItems,
      notificationChannels: channels,
    };
  }

  async freeze(input: {
    userId: number;
    userExternalId: string;
    expectedAuthVersion: number;
    requestedAt: Date;
    reasonCode?: AccountClosureReasonCode;
  }): Promise<FrozenAccountClosure> {
    return freezeAccountForClosure(this.db, {
      userId: input.userId,
      expectedAuthVersion: input.expectedAuthVersion,
      requestedAt: input.requestedAt,
      reasonCode: input.reasonCode,
    });
  }

  async applyImmediateEffects(input: {
    requestId: number;
    userId: number;
    userExternalId: string;
  }): Promise<void> {
    await applyImmediateClosureEffects(this.db, input);
  }

  async findRecoverySubject(
    requestExternalId: string,
    userExternalId: string,
  ): Promise<ClosureRecoverySubject | null> {
    const [row] = await this.db
      .select({
        userId: users.id,
        userExternalId: users.externalId,
        authVersion: users.authVersion,
        mfaEnabled: users.mfaEnabled,
        plan: users.plan,
        planExpiresAt: users.planExpiresAt,
        userStatus: users.status,
        requestId: accountClosureRequests.id,
        requestExternalId: accountClosureRequests.externalId,
        requestStatus: accountClosureRequests.status,
        requestedAt: accountClosureRequests.requestedAt,
        graceEndsAt: accountClosureRequests.graceEndsAt,
        completedAt: accountClosureRequests.completedAt,
        cancelledAt: accountClosureRequests.cancelledAt,
      })
      .from(accountClosureRequests)
      .innerJoin(users, eq(users.id, accountClosureRequests.userId))
      .where(
        and(
          eq(accountClosureRequests.externalId, requestExternalId),
          eq(users.externalId, userExternalId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async withdraw(input: { requestId: number; userId: number; now: Date }): Promise<void> {
    await withdrawAccountClosureRequest(this.db, input);
  }

  private async count(
    table:
      | typeof tasks
      | typeof plannedTasks
      | typeof scheduledTasks
      | typeof taskFiles
      | typeof stockRiskMonitors
      | typeof notificationChannels,
    where: ReturnType<typeof and> | ReturnType<typeof eq>,
  ): Promise<number> {
    const [row] = await this.db.select({ count: sql<number>`COUNT(*)` }).from(table).where(where);
    return Number(row?.count ?? 0);
  }
}

export function createAccountClosureService(
  deps: AccountClosureServiceDependencies,
): AccountClosureService {
  return new AccountClosureService(deps);
}

export function defaultAccountClosureServiceDependencies(input: {
  db: DB;
  challenge: Pick<AccountClosureChallengeService, 'createChallenge' | 'verifyChallenge'>;
  mfa: Pick<MfaService, 'verifyUserFactor'>;
  receipts: Pick<
    AccountClosureReceiptService,
    'createApplicationReceipt' | 'getApplicationReceipt'
  >;
  logger: Pick<Logger, 'error'>;
  enabled: boolean;
  allowlist: string;
}): AccountClosureServiceDependencies {
  return {
    repository: new DatabaseClosureServiceRepository(input.db),
    challenge: input.challenge,
    mfa: input.mfa,
    receipts: input.receipts,
    verifyRecoveryToken: verifyAccountClosureRecoveryToken,
    signRecoveryToken: signAccountClosureRecoveryToken,
    now: () => new Date(),
    logger: input.logger,
    config: {
      enabled: input.enabled,
      allowlist: parseAllowlist(input.allowlist),
    },
  };
}

function parseAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function serializeChallengeDelivery(input: {
  challengeId: string;
  channel: 'email' | 'sms';
  maskedDestination: string;
  expiresAt: Date;
}) {
  return {
    challengeId: input.challengeId,
    channel: input.channel,
    maskedDestination: input.maskedDestination,
    expiresAt: input.expiresAt.toISOString(),
  };
}

function isValidRecoveryState(subject: ClosureRecoverySubject): boolean {
  if (subject.requestStatus === 'pending_grace') {
    return subject.userStatus === 'closure_pending';
  }
  if (subject.requestStatus === 'processing' || subject.requestStatus === 'needs_attention') {
    return subject.userStatus === 'closure_processing';
  }
  return subject.requestStatus === 'completed' && subject.userStatus === 'closed';
}
