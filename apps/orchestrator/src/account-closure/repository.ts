import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lte, ne, sql } from 'drizzle-orm';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import {
  type AccountClosureRequest,
  accountClosureRequests,
  accountClosureSteps,
} from '../db/schema/account-closures.js';
import { apiKeys } from '../db/schema/api-keys.js';
import { sessions } from '../db/schema/sessions.js';
import { users } from '../db/schema/users.js';
import { restoreImmediateClosureEffectsInTransaction } from './immediate-effects.js';
import { closureGraceEndsAt } from './state-machine.js';
import type { AccountClosureReasonCode } from './types.js';

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
