import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import {
  accountClosureReceipts,
  accountClosureRequests,
  accountClosureSteps,
} from '../db/schema/account-closures.js';
import { partnerMemberships } from '../db/schema/partner.js';
import { taskQuotas } from '../db/schema/task-quotas.js';
import { users } from '../db/schema/users.js';

export type TombstoneFinalizationErrorCode =
  | 'FINALIZATION_PRECONDITION_FAILED'
  | 'INVALID_HMAC_SECRET'
  | 'IDENTITY_DIGEST_MISMATCH';

export class TombstoneFinalizationError extends Error {
  constructor(public readonly code: TombstoneFinalizationErrorCode) {
    super(code);
    this.name = 'TombstoneFinalizationError';
  }
}

export async function finalizeUserTombstone(input: {
  db: DB;
  requestId: number;
  userId: number;
  hmacSecret: string;
}): Promise<void> {
  if (!Number.isSafeInteger(input.requestId) || input.requestId <= 0) {
    throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
  }
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
  }
  if (input.hmacSecret.trim().length < 32) {
    throw new TombstoneFinalizationError('INVALID_HMAC_SECRET');
  }

  await input.db.transaction(async (tx) => {
    const [request] = await tx
      .select({
        id: accountClosureRequests.id,
        userId: accountClosureRequests.userId,
        activeUserId: accountClosureRequests.activeUserId,
        status: accountClosureRequests.status,
      })
      .from(accountClosureRequests)
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.userId, input.userId),
        ),
      )
      .limit(1)
      .for('update');
    if (!request || request.status !== 'processing' || request.activeUserId !== input.userId) {
      throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
    }

    const steps = await tx
      .select({
        categoryId: accountClosureSteps.categoryId,
        status: accountClosureSteps.status,
        handlerVersion: accountClosureSteps.handlerVersion,
        retentionOutcome: accountClosureSteps.retentionOutcome,
      })
      .from(accountClosureSteps)
      .where(eq(accountClosureSteps.requestId, input.requestId))
      .for('update');
    const stepCategories = new Set(steps.map((step) => step.categoryId));
    if (
      steps.length !== DATA_CATEGORY_IDS.length ||
      stepCategories.size !== DATA_CATEGORY_IDS.length ||
      steps.some(
        (step) =>
          step.status !== 'succeeded' ||
          step.handlerVersion !== 1 ||
          step.retentionOutcome === null,
      ) ||
      DATA_CATEGORY_IDS.some((categoryId) => !stepCategories.has(categoryId))
    ) {
      throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
    }
    const restrictedStepCategories = DATA_CATEGORY_IDS.filter((categoryId) =>
      steps.some(
        (step) => step.categoryId === categoryId && step.retentionOutcome === 'restricted',
      ),
    );

    const [receipt] = await tx
      .select({
        userId: accountClosureReceipts.userId,
        subjectDigest: accountClosureReceipts.subjectDigest,
        completedCategoryIds: accountClosureReceipts.completedCategoryIds,
        restrictedCategoryIds: accountClosureReceipts.restrictedCategoryIds,
        notificationStatus: accountClosureReceipts.notificationStatus,
        completedAt: accountClosureReceipts.completedAt,
      })
      .from(accountClosureReceipts)
      .where(
        and(
          eq(accountClosureReceipts.requestId, input.requestId),
          eq(accountClosureReceipts.kind, 'completion'),
        ),
      )
      .limit(1)
      .for('update');
    if (
      !receipt ||
      receipt.userId !== input.userId ||
      receipt.notificationStatus !== 'accepted' ||
      receipt.completedAt === null ||
      !hasExactCategoryCoverage(receipt.completedCategoryIds) ||
      !hasExactRestrictedCategories(receipt.restrictedCategoryIds, restrictedStepCategories)
    ) {
      throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
    }

    const [user] = await tx
      .select({
        externalId: users.externalId,
        email: users.email,
        phone: users.phone,
        googleId: users.googleId,
        plan: users.plan,
        planExpiresAt: users.planExpiresAt,
        avatarUrl: users.avatarUrl,
        qwenVoiceId: users.qwenVoiceId,
        baseVideoFileId: users.baseVideoFileId,
        videoSelfUseAuthorizedAt: users.videoSelfUseAuthorizedAt,
      })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.status, 'closure_processing')))
      .limit(1)
      .for('update');
    if (
      !user ||
      user.plan !== 'free' ||
      user.planExpiresAt !== null ||
      user.avatarUrl !== null ||
      user.qwenVoiceId !== null ||
      user.baseVideoFileId !== null ||
      user.videoSelfUseAuthorizedAt !== null
    ) {
      throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
    }

    const [quota] = await tx
      .select({
        invalidCount: sql<number>`SUM(CASE WHEN ${taskQuotas.periodEnd} > CURRENT_TIMESTAMP(3) OR ${taskQuotas.bonusTasks} <> 0 OR ${taskQuotas.bonusOpus} <> 0 THEN 1 ELSE 0 END)`,
      })
      .from(taskQuotas)
      .where(eq(taskQuotas.userId, input.userId));
    const [membership] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(partnerMemberships)
      .where(eq(partnerMemberships.userId, input.userId));
    const objectAssociationCount = await readObjectAssociationCount(tx, input.userId);
    if (
      Number(quota?.invalidCount ?? 0) !== 0 ||
      Number(membership?.count ?? 0) !== 0 ||
      objectAssociationCount !== 0
    ) {
      throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
    }

    const identityDigest = computeAccountClosureSubjectDigest(input.hmacSecret, {
      externalId: user.externalId,
      email: user.email,
      phone: user.phone,
      googleId: user.googleId,
    });
    if (!digestMatches(receipt.subjectDigest, identityDigest)) {
      throw new TombstoneFinalizationError('IDENTITY_DIGEST_MISMATCH');
    }

    const closeUser = await tx
      .update(users)
      .set({
        email: null,
        phone: null,
        googleId: null,
        displayName: null,
        avatarUrl: null,
        qwenVoiceId: null,
        baseVideoFileId: null,
        videoSelfUseAuthorizedAt: null,
        emailVerified: false,
        phoneVerified: false,
        passwordHash: '',
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaSetupCreatedAt: null,
        mfaLastUsedStep: null,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        selectedRoles: null,
        selectedSkills: null,
        roleChangesThisMonth: 0,
        roleChangesPeriodStart: null,
        plan: 'free',
        planExpiresAt: null,
        role: 'user',
        authVersion: sql`${users.authVersion} + 1`,
        status: 'closed',
      })
      .where(and(eq(users.id, input.userId), eq(users.status, 'closure_processing')));
    if (readAffectedRows(closeUser) !== 1) {
      throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
    }

    const completeRequest = await tx
      .update(accountClosureRequests)
      .set({
        activeUserId: null,
        status: 'completed',
        completedAt: receipt.completedAt,
        completionLeaseOwner: null,
        completionLeaseUntil: null,
        completionNextAttemptAt: null,
        completionLastErrorCode: null,
      })
      .where(
        and(
          eq(accountClosureRequests.id, input.requestId),
          eq(accountClosureRequests.userId, input.userId),
          eq(accountClosureRequests.activeUserId, input.userId),
          eq(accountClosureRequests.status, 'processing'),
        ),
      );
    if (readAffectedRows(completeRequest) !== 1) {
      throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
    }
  });
}

async function readObjectAssociationCount(
  tx: Parameters<Parameters<DB['transaction']>[0]>[0],
  userId: number,
): Promise<number> {
  const result = await tx.execute(sql`
    SELECT (
      (SELECT COUNT(*) FROM task_files WHERE user_id = ${userId}) +
      (SELECT COUNT(*)
       FROM evidence_artifacts AS artifact
       LEFT JOIN tasks AS owner_task ON owner_task.id = artifact.task_id
       LEFT JOIN sites AS owner_site ON owner_site.id = artifact.site_id
       LEFT JOIN exploration_runs AS owner_run ON owner_run.id = artifact.exploration_run_id
       LEFT JOIN sites AS owner_run_site ON owner_run_site.id = owner_run.site_id
       WHERE artifact.owner_user_id = ${userId}
          OR owner_task.user_id = ${userId}
          OR owner_site.owner_user_id = ${userId}
          OR owner_run_site.owner_user_id = ${userId})
    ) AS association_count
  `);
  const rows = Array.isArray(result) ? result[0] : null;
  const count = Array.isArray(rows)
    ? Number(
        (rows[0] as { association_count?: number | bigint | string } | undefined)
          ?.association_count,
      )
    : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TombstoneFinalizationError('FINALIZATION_PRECONDITION_FAILED');
  }
  return count;
}

function hasExactCategoryCoverage(value: unknown): boolean {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return false;
  const categories = new Set(value);
  return (
    value.length === DATA_CATEGORY_IDS.length &&
    categories.size === DATA_CATEGORY_IDS.length &&
    DATA_CATEGORY_IDS.every((categoryId) => categories.has(categoryId))
  );
}

function hasExactRestrictedCategories(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return false;
  const categories = new Set(value);
  return (
    categories.size === value.length &&
    categories.size === expected.length &&
    expected.every((categoryId) => categories.has(categoryId))
  );
}

export function computeAccountClosureSubjectDigest(
  hmacSecret: string,
  identity: {
    externalId: string;
    email: string | null;
    phone: string | null;
    googleId: string | null;
  },
): string {
  if (hmacSecret.trim().length < 32) {
    throw new TombstoneFinalizationError('INVALID_HMAC_SECRET');
  }
  return createHmac('sha256', hmacSecret)
    .update(
      JSON.stringify([
        'account-closure-subject-v1',
        identity.externalId,
        identity.email,
        identity.phone,
        identity.googleId,
      ]),
    )
    .digest('hex');
}

function digestMatches(stored: string | null, supplied: string): boolean {
  if (!stored || !/^[a-f0-9]{64}$/i.test(stored)) return false;
  return timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(supplied, 'hex'));
}
