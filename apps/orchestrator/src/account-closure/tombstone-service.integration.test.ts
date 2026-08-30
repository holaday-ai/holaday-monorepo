import { createHmac, randomBytes } from 'node:crypto';
import { type SQL, eq, sql } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/service.js';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import {
  accountClosureReceipts,
  accountClosureRequests,
  accountClosureSteps,
} from '../db/schema/account-closures.js';
import { evidenceArtifacts } from '../db/schema/evidence-artifacts.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import {
  holaCreditLedgerEntries,
  partnerActivityEvents,
  partnerDailyAllocations,
  partnerKycProfiles,
  partnerLots,
  partnerMemberships,
  partnerMonthlyReleases,
  partnerRechargeOrders,
  partnerReferrals,
  partnerRiskEvents,
  partnerWithdrawalRequests,
} from '../db/schema/partner.js';
import { payments } from '../db/schema/payments.js';
import { taskFiles } from '../db/schema/task-files.js';
import { taskQuotas } from '../db/schema/task-quotas.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { watchlists } from '../db/schema/watchlists.js';
import type { StorageProvider } from '../files/storage-provider.js';
import { completePaymentInTransaction, lockSettlementContext } from '../trpc/routers/payment.js';
import type {
  AccountClosureHandler,
  ClosureCheckpoint,
  ClosureHandlerContext,
  ClosureHandlerResult,
} from './handler-contract.js';
import { createMediaAssetsClosureHandler } from './handlers/media-assets.js';
import { partnerKycLedgerClosureHandler } from './handlers/partner-kyc-ledger.js';
import { paymentsEntitlementsClosureHandler } from './handlers/payments-entitlements.js';
import { stockPreferenceProfileClosureHandler } from './handlers/stock-preference-profile.js';
import { taskExecutionClosureHandler } from './handlers/task-execution.js';
import { finalizeUserTombstone } from './tombstone-service.js';

const HMAC_SECRET = 'task8-review-hmac-secret-32-bytes-minimum';
const OTHER_HMAC_SECRET = 'task8-review-other-secret-32-bytes-minimum';
const FINALIZATION_LEASE_OWNER = 'task8-finalizer-worker';
const logger = pino({ enabled: false });

describe.sequential('account closure tombstone finalization', () => {
  let cleanup: () => Promise<void> = async () => {};
  let db: typeof import('../db/client.js').db;
  let sequence = 0;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(databaseUrl);
    const client = await import('../db/client.js');
    db = client.db;
    cleanup = () => client.pool.end();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('minimizes financial records, finalizes only the old tombstone, and permits clean identity reuse', async () => {
    const oldIdentity = {
      email: 'task8-reuse@example.test',
      phone: '13800008001',
      googleId: 'google-task8-old',
    };
    const target = await createUser('target', {
      ...oldIdentity,
      plan: 'pro',
      role: 'admin',
      status: 'closure_processing',
      displayName: 'Target Person',
      media: true,
      mfa: true,
    });
    const other = await createUser('other', { plan: 'pro', role: 'admin' });
    const otherInvitee = await createUser('invitee');
    const targetTaskId = await createTaskWithFile(target.id, 'target');
    await db.insert(watchlists).values({
      externalId: uniqueId('wl_target'),
      userId: target.id,
      symbol: '600519',
      displayName: 'private stock name',
      note: 'private preference note',
    });
    await db.insert(taskQuotas).values({
      userId: target.id,
      period: 'month',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      tasksUsed: 5,
      opusUsed: 2,
      bonusTasks: 20,
      bonusOpus: 4,
    });
    await db.insert(taskQuotas).values({
      userId: other.id,
      period: 'month',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      bonusTasks: 9,
      bonusOpus: 3,
    });

    const targetPaymentId = await createPayment(target.externalId, 'target', 'refunded');
    await createPayment(other.externalId, 'other', 'completed');
    const targetPartner = await createPartnerGraph(target.id, 'target', true);
    const otherPartner = await createPartnerGraph(other.id, 'other');
    await db.insert(partnerReferrals).values({
      externalId: uniqueId('pref_target'),
      inviterUserId: target.id,
      inviteeUserId: other.id,
      rechargeOrderId: targetPartner.orderId,
      status: 'qualified',
      rewardCreditCents: 500,
      rewardRateBps: 100,
      assisted: 1,
      metadata: {
        ...sensitiveMetadata('target referral'),
        closureRestricted: true,
        rewardedAt: '2026-08-15T00:00:00.000Z',
      },
    });
    await db.insert(partnerReferrals).values({
      externalId: uniqueId('pref_other'),
      inviterUserId: other.id,
      inviteeUserId: otherInvitee.id,
      rechargeOrderId: otherPartner.orderId,
      status: 'pending',
      rewardCreditCents: 200,
      rewardRateBps: 50,
      metadata: sensitiveMetadata('other referral'),
    });

    const deletedObjects: string[] = [];
    const storage = fakeStorage(deletedObjects);
    await runToCompletion(
      createMediaAssetsClosureHandler({ deleteVoiceClone: vi.fn(async () => undefined) }),
      target,
      storage,
    );
    await runToCompletion(taskExecutionClosureHandler, target, storage);
    await runToCompletion(stockPreferenceProfileClosureHandler, target, storage);
    const paymentResult = await runToCompletion(
      paymentsEntitlementsClosureHandler,
      target,
      storage,
    );
    const partnerResult = await runToCompletion(partnerKycLedgerClosureHandler, target, storage);
    expect(paymentResult.retention).toBe('restricted');
    expect(partnerResult.retention).toBe('restricted');
    expect(deletedObjects).toContain(`objects/task8-target-${targetTaskId}.pdf`);

    // Simulate a crash after minimization but before checkpoint persistence.
    const freshPaymentRetry = await runToCompletion(
      paymentsEntitlementsClosureHandler,
      target,
      storage,
    );
    expect(freshPaymentRetry).toMatchObject({ kind: 'complete', retention: 'restricted' });
    const freshPartnerRetry = await runToCompletion(
      partnerKycLedgerClosureHandler,
      target,
      storage,
    );
    expect(freshPartnerRetry).toMatchObject({ kind: 'complete', retention: 'restricted' });

    const [targetPayment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, targetPaymentId))
      .limit(1);
    expect(targetPayment).toMatchObject({
      status: 'refunded',
      metadata: {
        provider: 'paypal',
        environment: 'live',
        cycle: 'monthly',
        packId: 'pack_20',
        providerStatus: 'REFUNDED',
        currency: 'USD',
        settledAt: '2026-08-01T00:00:00.000Z',
        refundedAt: '2026-08-10T00:00:00.000Z',
        disputeStatus: 'open',
      },
    });
    const [otherPayment] = await db
      .select()
      .from(payments)
      .where(eq(payments.userExternalId, other.externalId))
      .limit(1);
    expect(otherPayment?.metadata).toMatchObject({ payerEmail: 'other@example.test' });

    const [targetBeforeFinalization] = await db
      .select()
      .from(users)
      .where(eq(users.id, target.id))
      .limit(1);
    expect(targetBeforeFinalization).toMatchObject({
      plan: 'free',
      planExpiresAt: null,
      avatarUrl: null,
      qwenVoiceId: null,
      baseVideoFileId: null,
      videoSelfUseAuthorizedAt: null,
    });
    const [targetQuota] = await db
      .select()
      .from(taskQuotas)
      .where(eq(taskQuotas.userId, target.id))
      .limit(1);
    expect(targetQuota?.periodEnd.getTime()).toBeLessThanOrEqual(Date.now());
    expect(targetQuota).toMatchObject({ bonusTasks: 0, bonusOpus: 0 });
    const [otherQuota] = await db
      .select()
      .from(taskQuotas)
      .where(eq(taskQuotas.userId, other.id))
      .limit(1);
    expect(otherQuota).toMatchObject({ bonusTasks: 9, bonusOpus: 3 });

    expect(await countRows(partnerMemberships, eq(partnerMemberships.userId, target.id))).toBe(0);
    expect(
      await countRows(partnerActivityEvents, eq(partnerActivityEvents.userId, target.id)),
    ).toBe(0);
    expect(await countRows(partnerMemberships, eq(partnerMemberships.userId, other.id))).toBe(1);
    expect(await countRows(partnerActivityEvents, eq(partnerActivityEvents.userId, other.id))).toBe(
      1,
    );
    await expectRestrictedPartnerGraph(target, targetPartner);
    const [otherKyc] = await db
      .select()
      .from(partnerKycProfiles)
      .where(eq(partnerKycProfiles.userId, other.id))
      .limit(1);
    expect(otherKyc).toMatchObject({
      status: 'approved',
      metadata: expect.objectContaining({ freeText: 'other kyc' }),
    });

    expect(await countRows(tasks, eq(tasks.userId, target.id))).toBe(0);
    expect(await countRows(taskFiles, eq(taskFiles.userId, target.id))).toBe(0);
    expect(await countRows(watchlists, eq(watchlists.userId, target.id))).toBe(0);

    const requestId = await createFinalizationRequest(target.id, {
      notificationStatus: 'accepted',
    });
    const oldExternalId = target.externalId;
    const oldAuthVersion = targetBeforeFinalization?.authVersion ?? 0;
    await finalizeRequest(requestId, target.id);

    const [closed] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(closed).toMatchObject({
      id: target.id,
      externalId: oldExternalId,
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
      selectedRoles: null,
      selectedSkills: null,
      role: 'user',
      plan: 'free',
      planExpiresAt: null,
      status: 'closed',
      authVersion: oldAuthVersion + 1,
    });
    const [completedRequest] = await db
      .select()
      .from(accountClosureRequests)
      .where(eq(accountClosureRequests.id, requestId))
      .limit(1);
    expect(completedRequest).toMatchObject({ status: 'completed', activeUserId: null });

    // Tombstoning does not delete or rewrite financial truth.
    expect(await countRows(payments, eq(payments.userExternalId, oldExternalId))).toBe(1);
    expect(
      await countRows(partnerRechargeOrders, eq(partnerRechargeOrders.userId, target.id)),
    ).toBe(1);
    expect(await countRows(partnerLots, eq(partnerLots.userId, target.id))).toBe(1);
    expect(
      await countRows(holaCreditLedgerEntries, eq(holaCreditLedgerEntries.userId, target.id)),
    ).toBe(1);

    const registration = await new AuthService(db).register({
      email: oldIdentity.email,
      password: 'new-account-password',
      displayName: 'New account',
    });
    const [fresh] = await db
      .select()
      .from(users)
      .where(eq(users.externalId, registration.user.externalId))
      .limit(1);
    if (!fresh) throw new Error('fresh registration was not persisted');
    await db
      .update(users)
      .set({ phone: oldIdentity.phone, phoneVerified: true })
      .where(eq(users.id, fresh.id));
    expect(fresh.id).not.toBe(target.id);
    expect(fresh.externalId).not.toBe(oldExternalId);
    expect(await countRows(tasks, eq(tasks.userId, fresh.id))).toBe(0);
    expect(await countRows(taskFiles, eq(taskFiles.userId, fresh.id))).toBe(0);
    expect(await countRows(watchlists, eq(watchlists.userId, fresh.id))).toBe(0);
    expect(await countRows(taskQuotas, eq(taskQuotas.userId, fresh.id))).toBe(0);
    expect(await countRows(payments, eq(payments.userExternalId, fresh.externalId))).toBe(0);
    expect(await countRows(partnerRechargeOrders, eq(partnerRechargeOrders.userId, fresh.id))).toBe(
      0,
    );

    const [otherAfter] = await db.select().from(users).where(eq(users.id, other.id)).limit(1);
    expect(otherAfter).toMatchObject({ status: 'active', plan: 'pro', role: 'admin' });
  });

  it('fails closed for incomplete steps, an unaccepted receipt, or a mismatched digest', async () => {
    const incomplete = await createUser('incomplete', { status: 'closure_processing' });
    const incompleteRequest = await createFinalizationRequest(incomplete.id, {
      notificationStatus: 'accepted',
      incompleteCategory: 'analytics_logs',
    });
    await expect(finalizeRequest(incompleteRequest, incomplete.id)).rejects.toMatchObject({
      code: 'FINALIZATION_PRECONDITION_FAILED',
    });

    const unaccepted = await createUser('unaccepted', { status: 'closure_processing' });
    const unacceptedRequest = await createFinalizationRequest(unaccepted.id, {
      notificationStatus: 'pending',
    });
    await expect(finalizeRequest(unacceptedRequest, unaccepted.id)).rejects.toMatchObject({
      code: 'FINALIZATION_PRECONDITION_FAILED',
    });

    const mismatch = await createUser('mismatch', { status: 'closure_processing' });
    const mismatchRequest = await createFinalizationRequest(mismatch.id, {
      notificationStatus: 'accepted',
    });
    await expect(
      finalizeRequest(mismatchRequest, mismatch.id, OTHER_HMAC_SECRET),
    ).rejects.toMatchObject({ code: 'IDENTITY_DIGEST_MISMATCH' });

    const arbitraryReceipt = await createUser('arbitrary-receipt', {
      status: 'closure_processing',
    });
    const arbitraryReceiptRequest = await createFinalizationRequest(arbitraryReceipt.id, {
      notificationStatus: 'accepted',
      digestOverride: 'ab'.repeat(32),
    });
    await expect(
      finalizeRequest(arbitraryReceiptRequest, arbitraryReceipt.id),
    ).rejects.toMatchObject({ code: 'IDENTITY_DIGEST_MISMATCH' });

    for (const subject of [incomplete, unaccepted, mismatch, arbitraryReceipt]) {
      const [unchanged] = await db.select().from(users).where(eq(users.id, subject.id)).limit(1);
      expect(unchanged).toMatchObject({ status: 'closure_processing', email: subject.email });
    }
  });

  it('fails closed before tombstoning when team-workspace responsibility reappears', async () => {
    const subject = await createUser('team-residue', { status: 'closure_processing' });
    const replacement = await createUser('team-residue-replacement');
    const requestId = await createFinalizationRequest(subject.id, {
      notificationStatus: 'accepted',
    });
    const [organizationInsert] = await db.insert(organizations).values({
      externalId: uniqueId('org_tombstone_residue'),
      name: 'Tombstone residue fixture',
      ownerUserId: subject.id,
      status: 'active',
      teamProjectsEnabled: true,
    });
    const organizationId = Number(organizationInsert.insertId);
    await db.insert(organizationMembers).values([
      {
        externalId: uniqueId('omem_tombstone_subject'),
        organizationId,
        userId: subject.id,
        role: 'owner',
        status: 'active',
      },
      {
        externalId: uniqueId('omem_tombstone_replacement'),
        organizationId,
        userId: replacement.id,
        role: 'owner',
        status: 'active',
      },
    ]);

    try {
      await expect(finalizeRequest(requestId, subject.id)).rejects.toMatchObject({
        code: 'FINALIZATION_PRECONDITION_FAILED',
      });
      const [unchanged] = await db.select().from(users).where(eq(users.id, subject.id)).limit(1);
      expect(unchanged).toMatchObject({ status: 'closure_processing', email: subject.email });
    } finally {
      await db
        .delete(organizationMembers)
        .where(eq(organizationMembers.organizationId, organizationId));
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });

  it('rejects a stale finalizer after the completion lease is taken over', async () => {
    const subject = await createUser('lease-takeover', { status: 'closure_processing' });
    const requestId = await createFinalizationRequest(subject.id, {
      notificationStatus: 'accepted',
    });
    const authoritativeNow = new Date();
    await db
      .update(accountClosureRequests)
      .set({
        completionLeaseOwner: 'new-worker',
        completionLeaseUntil: new Date(authoritativeNow.getTime() + 60_000),
      })
      .where(eq(accountClosureRequests.id, requestId));

    await expect(
      finalizeUserTombstone({
        db,
        requestId,
        userId: subject.id,
        hmacSecret: HMAC_SECRET,
        expectedLeaseOwner: 'stale-worker',
        now: authoritativeNow,
      }),
    ).rejects.toMatchObject({ code: 'FINALIZATION_PRECONDITION_FAILED' });
    const [unchanged] = await db.select().from(users).where(eq(users.id, subject.id)).limit(1);
    expect(unchanged).toMatchObject({ status: 'closure_processing', email: subject.email });
  });

  it('requires trusted step outcomes and an exact restricted-category receipt set', async () => {
    const missingOutcome = await createUser('missing-outcome', { status: 'closure_processing' });
    const missingOutcomeRequest = await createFinalizationRequest(missingOutcome.id, {
      notificationStatus: 'accepted',
      missingOutcomeCategory: 'payments_entitlements',
    });
    await expect(finalizeRequest(missingOutcomeRequest, missingOutcome.id)).rejects.toMatchObject({
      code: 'FINALIZATION_PRECONDITION_FAILED',
    });

    const omitted = await createUser('omitted-restricted', { status: 'closure_processing' });
    await createPayment(omitted.externalId, 'omitted-restricted', 'completed');
    await createPartnerGraph(omitted.id, 'omitted-restricted', true);
    await runToCompletion(paymentsEntitlementsClosureHandler, omitted, fakeStorage([]));
    await runToCompletion(partnerKycLedgerClosureHandler, omitted, fakeStorage([]));
    await expect(
      partnerKycLedgerClosureHandler.run(closureContext(omitted, fakeStorage([]), null)),
    ).resolves.toMatchObject({ kind: 'complete', retention: 'restricted' });
    const omittedRequest = await createFinalizationRequest(omitted.id, {
      notificationStatus: 'accepted',
      restrictedCategoryIds: ['partner_kyc_ledger'],
    });
    await expect(finalizeRequest(omittedRequest, omitted.id)).rejects.toMatchObject({
      code: 'FINALIZATION_PRECONDITION_FAILED',
    });

    const extra = await createUser('extra-restricted', { status: 'closure_processing' });
    const extraRequest = await createFinalizationRequest(extra.id, {
      notificationStatus: 'accepted',
      restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger', 'media_assets'],
    });
    await expect(finalizeRequest(extraRequest, extra.id)).rejects.toMatchObject({
      code: 'FINALIZATION_PRECONDITION_FAILED',
    });

    const retainedMedia = await createUser('retained-media', { status: 'closure_processing' });
    const retainedMediaTaskId = await createTaskWithFile(retainedMedia.id, 'retained-media');
    await createAuthorizationEvidence(retainedMedia.id, retainedMediaTaskId, 'retained-media');
    const retainedMediaResult = await runToCompletion(
      createMediaAssetsClosureHandler({ deleteVoiceClone: vi.fn(async () => undefined) }),
      retainedMedia,
      fakeStorage([]),
    );
    expect(retainedMediaResult.retention).toBe('restricted');
    await runToCompletion(taskExecutionClosureHandler, retainedMedia, fakeStorage([]));
    const retainedMediaRequest = await createFinalizationRequest(retainedMedia.id, {
      notificationStatus: 'accepted',
      restrictedOutcomeCategoryIds: ['media_assets'],
      restrictedCategoryIds: [],
    });
    await expect(finalizeRequest(retainedMediaRequest, retainedMedia.id)).rejects.toMatchObject({
      code: 'FINALIZATION_PRECONDITION_FAILED',
    });

    for (const subject of [missingOutcome, omitted, extra, retainedMedia]) {
      const [unchanged] = await db.select().from(users).where(eq(users.id, subject.id)).limit(1);
      expect(unchanged).toMatchObject({ status: 'closure_processing', email: subject.email });
    }
  });

  it('does not mask unfinished entitlement, membership, or object handlers', async () => {
    const subject = await createUser('unfinished', {
      status: 'closure_processing',
      plan: 'pro',
    });
    await db.insert(taskQuotas).values({
      userId: subject.id,
      period: 'month',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      bonusTasks: 1,
    });
    await db.insert(partnerMemberships).values({
      externalId: uniqueId('pmem_pending'),
      userId: subject.id,
      status: 'active',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date('2027-08-01T00:00:00.000Z'),
    });
    await db.insert(taskFiles).values({
      externalId: uniqueId('file_pending'),
      userId: subject.id,
      kind: 'output',
      filename: 'still-owned.png',
      mimetype: 'image/png',
      sizeBytes: 10,
      storagePath: 'objects/still-owned.png',
    });
    const requestId = await createFinalizationRequest(subject.id, {
      notificationStatus: 'accepted',
    });

    await expect(finalizeRequest(requestId, subject.id)).rejects.toMatchObject({
      code: 'FINALIZATION_PRECONDITION_FAILED',
    });

    const [unchanged] = await db.select().from(users).where(eq(users.id, subject.id)).limit(1);
    expect(unchanged).toMatchObject({ status: 'closure_processing', plan: 'pro' });
    expect(await countRows(taskFiles, eq(taskFiles.userId, subject.id))).toBe(1);
    expect(await countRows(partnerMemberships, eq(partnerMemberships.userId, subject.id))).toBe(1);
  });

  it('rejects a mismatched payment identity tuple before touching either account', async () => {
    const internalOwner = await createUser('tuple-internal', { status: 'closure_processing' });
    const externalOwner = await createUser('tuple-external', { status: 'closure_processing' });
    await createPayment(externalOwner.externalId, 'tuple-external', 'completed');
    const storage = fakeStorage([]);

    await expect(
      paymentsEntitlementsClosureHandler.run({
        ...closureContext(internalOwner, storage, null),
        request: {
          ...closureContext(internalOwner, storage, null).request,
          userExternalId: externalOwner.externalId,
        },
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });

    const [untouched] = await db
      .select()
      .from(payments)
      .where(eq(payments.userExternalId, externalOwner.externalId))
      .limit(1);
    expect(untouched?.metadata).toMatchObject({ payerEmail: 'tuple-external@example.test' });
  });

  it('retains late settlements without entitlement after cleanup and after tombstoning', async () => {
    const processing = await createUser('late-processing', { status: 'closure_processing' });
    const processingPaymentId = await createPendingPayment(
      processing.externalId,
      'late-processing',
    );
    await expect(settlePendingPayment(processingPaymentId)).resolves.toBe('retained_only');

    const [processingAfter] = await db
      .select()
      .from(users)
      .where(eq(users.id, processing.id))
      .limit(1);
    expect(processingAfter).toMatchObject({ status: 'closure_processing', plan: 'free' });
    await expectMinimizedSettlement(processingPaymentId);

    const closed = await createUser('late-closed', { status: 'closed' });
    await db
      .update(users)
      .set({ email: null, phone: null, googleId: null, displayName: null })
      .where(eq(users.id, closed.id));
    const closedPaymentId = await createPendingPayment(closed.externalId, 'late-closed');
    await expect(settlePendingPayment(closedPaymentId)).resolves.toBe('retained_only');
    const [closedAfter] = await db.select().from(users).where(eq(users.id, closed.id)).limit(1);
    expect(closedAfter).toMatchObject({ status: 'closed', plan: 'free', email: null });
    await expectMinimizedSettlement(closedPaymentId);
  });

  it('serializes a late settlement against finalization on the locked user row', async () => {
    const subject = await createUser('settlement-race', { status: 'closure_processing' });
    const paymentId = await createPendingPayment(subject.externalId, 'settlement-race');
    const requestId = await createFinalizationRequest(subject.id, {
      notificationStatus: 'accepted',
      restrictedOutcomeCategoryIds: ['payments_entitlements'],
      restrictedCategoryIds: ['payments_entitlements'],
    });

    let releaseSettlement = () => {};
    const settlementGate = new Promise<void>((resolve) => {
      releaseSettlement = resolve;
    });
    let reportUserLocked = () => {};
    const userLocked = new Promise<void>((resolve) => {
      reportUserLocked = resolve;
    });
    const settlement = db.transaction(async (tx) => {
      const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (!row) throw new Error('race payment missing');
      const context = await lockSettlementContext(tx, row);
      const [lockedRow] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1)
        .for('update');
      if (!lockedRow) throw new Error('race payment vanished');
      reportUserLocked();
      await settlementGate;
      return completePaymentInTransaction(tx, lockedRow, context, {
        captureId: uniqueId('cap_race'),
        captureStatus: 'COMPLETED',
      });
    });
    await userLocked;
    const finalization = finalizeRequest(requestId, subject.id);
    await expect(
      Promise.race([
        finalization.then(() => 'completed'),
        new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 50)),
      ]),
    ).resolves.toBe('waiting');

    releaseSettlement();
    await expect(settlement).resolves.toBe('retained_only');
    await expect(finalization).resolves.toBeUndefined();
    const [closed] = await db.select().from(users).where(eq(users.id, subject.id)).limit(1);
    expect(closed).toMatchObject({ status: 'closed', plan: 'free', email: null });
    await expectMinimizedSettlement(paymentId);
  });

  async function createUser(
    label: string,
    options: {
      email?: string;
      phone?: string;
      googleId?: string;
      plan?: string;
      role?: string;
      status?: 'active' | 'closure_processing' | 'closed';
      displayName?: string;
      media?: boolean;
      mfa?: boolean;
    } = {},
  ) {
    const suffix = randomBytes(4).toString('hex');
    const externalId = uniqueId(`usr_${label}`);
    const email = options.email ?? `${label}-${suffix}@example.test`;
    const [result] = await db.insert(users).values({
      externalId,
      email,
      phone: options.phone ?? null,
      googleId: options.googleId ?? null,
      passwordHash: 'not-a-real-password',
      plan: options.plan ?? 'free',
      role: options.role ?? 'user',
      planExpiresAt: options.plan === 'pro' ? new Date('2027-08-01T00:00:00.000Z') : null,
      status: options.status ?? 'active',
      authVersion: 7,
      displayName: options.displayName ?? `Display ${label}`,
      emailVerified: true,
      phoneVerified: Boolean(options.phone),
      avatarUrl: options.media ? 'https://profiles.example/target.png' : null,
      qwenVoiceId: options.media ? 'voice_task8_target' : null,
      baseVideoFileId: options.media ? 'file_task8_base' : null,
      videoSelfUseAuthorizedAt: options.media ? new Date('2026-08-01T00:00:00.000Z') : null,
      mfaEnabled: options.mfa ?? false,
      mfaSecretEncrypted: options.mfa ? 'synthetic-envelope' : null,
      mfaSetupCreatedAt: options.mfa ? new Date('2026-08-01T00:00:00.000Z') : null,
      mfaLastUsedStep: options.mfa ? 123 : null,
      selectedRoles: ['researcher'],
      selectedSkills: ['stock-research'],
      roleChangesThisMonth: 2,
      roleChangesPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
    });
    return { id: Number(result.insertId), externalId, email };
  }

  async function createTaskWithFile(userId: number, label: string): Promise<number> {
    const [taskResult] = await db.insert(tasks).values({
      externalId: uniqueId(`tsk_${label}`),
      userId,
      status: 'cancelled',
      intent: 'synthetic Task 8 private task',
    });
    const taskId = Number(taskResult.insertId);
    await db.insert(taskFiles).values({
      externalId: uniqueId(`file_${label}`),
      userId,
      taskId,
      kind: 'output',
      filename: 'private.pdf',
      mimetype: 'application/pdf',
      sizeBytes: 10,
      storagePath: `objects/task8-${label}-${taskId}.pdf`,
    });
    return taskId;
  }

  async function createAuthorizationEvidence(
    userId: number,
    taskId: number,
    label: string,
  ): Promise<void> {
    await db.insert(evidenceArtifacts).values({
      externalId: uniqueId(`evidence_${label}`),
      ownerUserId: userId,
      taskId,
      artifactKind: 'document',
      purpose: 'authorization',
      r2Bucket: 'synthetic-test',
      r2Key: `evidence/${label}/authorization`,
      contentType: 'application/pdf',
      sizeBytes: 10,
      sha256: 'ab'.repeat(32),
      capturedAt: new Date('2026-08-01T00:00:00.000Z'),
      collectorLane: 'task8-review-test',
      retentionPolicy: 'manual_hold',
      metadataJson: { privateNote: 'must be removed' },
    });
  }

  async function createPayment(userExternalId: string, label: string, status: string) {
    const [result] = await db.insert(payments).values({
      externalId: uniqueId(`pay_${label}`),
      userExternalId,
      provider: 'paypal',
      providerOrderId: uniqueId(`ord_${label}`),
      providerCaptureId: uniqueId(`cap_${label}`),
      plan: 'pro',
      kind: 'subscription',
      amountCents: 1999,
      currency: 'USD',
      status,
      completedAt: new Date('2026-08-01T00:00:00.000Z'),
      metadata: {
        provider: 'paypal',
        environment: 'live',
        cycle: 'monthly',
        packId: 'pack_20',
        providerStatus: status.toUpperCase(),
        currency: 'USD',
        settledAt: '2026-08-01T00:00:00.000Z',
        refundedAt: status === 'refunded' ? '2026-08-10T00:00:00.000Z' : null,
        disputeStatus: status === 'refunded' ? 'open' : 'none',
        payerEmail: `${label}@example.test`,
        approveUrl: 'https://provider.example/private-token',
        address: { line1: 'private street' },
        rawPayload: { nested: { secret: true } },
        freeText: `${label} payment note`,
      },
    });
    return Number(result.insertId);
  }

  async function createPendingPayment(userExternalId: string, label: string): Promise<number> {
    const [result] = await db.insert(payments).values({
      externalId: uniqueId(`pay_${label}`),
      userExternalId,
      provider: 'paypal',
      providerOrderId: uniqueId(`ord_${label}`),
      plan: 'pro',
      kind: 'subscription',
      amountCents: 1999,
      currency: 'USD',
      status: 'pending',
      metadata: {
        environment: 'live',
        cycle: 'monthly',
        payerEmail: `${label}@example.test`,
        approveUrl: 'https://provider.example/private-token',
        rawPayload: { secret: true },
      },
    });
    return Number(result.insertId);
  }

  async function settlePendingPayment(paymentId: number) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (!row) throw new Error('payment fixture missing');
      const context = await lockSettlementContext(tx, row);
      const [lockedRow] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1)
        .for('update');
      if (!lockedRow) throw new Error('payment fixture vanished');
      return completePaymentInTransaction(tx, lockedRow, context, {
        captureId: uniqueId('cap_late'),
        captureStatus: 'COMPLETED',
      });
    });
  }

  async function expectMinimizedSettlement(paymentId: number): Promise<void> {
    const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    expect(row).toMatchObject({
      status: 'completed',
      metadata: {
        provider: 'paypal',
        environment: 'live',
        cycle: 'monthly',
        providerStatus: 'COMPLETED',
        currency: 'USD',
        settledAt: expect.any(String),
      },
    });
    expect(row?.metadata).not.toHaveProperty('payerEmail');
    expect(row?.metadata).not.toHaveProperty('approveUrl');
    expect(row?.metadata).not.toHaveProperty('rawPayload');
  }

  async function createPartnerGraph(userId: number, label: string, preMarked = false) {
    const now = new Date('2026-08-01T00:00:00.000Z');
    await db.insert(partnerMemberships).values({
      externalId: uniqueId(`pmem_${label}`),
      userId,
      status: 'active',
      startsAt: now,
      expiresAt: new Date('2027-08-01T00:00:00.000Z'),
      metadata: sensitiveMetadata(`${label} membership`, preMarked),
    });
    await db.insert(partnerKycProfiles).values({
      externalId: uniqueId(`pkyc_${label}`),
      userId,
      status: 'approved',
      country: 'CN',
      realNameHash: uniqueId(`real_${label}`),
      idNumberHash: uniqueId(`idnum_${label}`),
      bankCardHash: uniqueId(`bank_${label}`),
      phoneHash: uniqueId(`phone_${label}`),
      provider: 'synthetic-kyc',
      providerRef: uniqueId(`kycref_${label}`),
      reviewedAt: now,
      metadata: {
        ...sensitiveMetadata(`${label} kyc`, preMarked),
        providerRef: uniqueId(`kycrefmeta_${label}`),
        bankCardHashUpdatedAt: '2026-08-01T00:00:00.000Z',
        reviewerUserId: 9,
      },
    });
    const [orderResult] = await db.insert(partnerRechargeOrders).values({
      externalId: uniqueId(`pord_${label}`),
      userId,
      provider: 'wechat',
      providerOrderId: uniqueId(`pordp_${label}`),
      providerCaptureId: uniqueId(`pcap_${label}`),
      amountCnyCents: 10_000,
      status: 'completed',
      orderKind: 'recharge',
      idempotencyKey: uniqueId(`pordkey_${label}`),
      metadata: sensitiveMetadata(`${label} order`, preMarked),
    });
    const orderId = Number(orderResult.insertId);
    const [lotResult] = await db.insert(partnerLots).values({
      externalId: uniqueId(`plot_${label}`),
      userId,
      rechargeOrderId: orderId,
      status: 'releasing',
      riskStatus: 'held',
      principalCreditCents: 10_000,
      tierMultiplierBps: 100,
      apiUnits: 10_000,
      bonusCapCreditCents: 1_000,
      lockedBonusCreditCents: 500,
      accumulationStartsAt: now,
      accumulationEndsAt: new Date('2026-09-01T00:00:00.000Z'),
      releaseStartsAt: new Date('2026-09-01T00:00:00.000Z'),
      releaseEndsAt: new Date('2027-09-01T00:00:00.000Z'),
      metadata: sensitiveMetadata(`${label} lot`, preMarked),
    });
    const lotId = Number(lotResult.insertId);
    await db.insert(holaCreditLedgerEntries).values({
      externalId: uniqueId(`pled_${label}`),
      userId,
      lotId,
      entryType: 'monthly_release',
      direction: 'credit',
      bucket: 'principal',
      amountCreditCents: 100,
      status: 'posted',
      idempotencyKey: uniqueId(`pledkey_${label}`),
      metadata: {
        ...sensitiveMetadata(`${label} ledger`, preMarked),
        releaseId: 44,
        releaseMonth: '2026-08',
      },
    });
    await db.insert(partnerWithdrawalRequests).values({
      externalId: uniqueId(`pwd_${label}`),
      userId,
      amountCreditCents: 500,
      status: 'paid',
      reviewDueAt: new Date('2026-08-30T00:00:00.000Z'),
      bankAccountFingerprint: uniqueId(`fp_${label}`),
      riskScore: 60,
      idempotencyKey: uniqueId(`pwdkey_${label}`),
      rejectionReason: `${label} private reviewer free text`,
      metadata: {
        ...sensitiveMetadata(`${label} withdrawal`, preMarked),
        paidByUserId: 11,
        providerPayoutId: uniqueId(`payout_${label}`),
        paidAt: '2026-08-20T00:00:00.000Z',
      },
    });
    await db.insert(partnerRiskEvents).values({
      externalId: uniqueId(`prisk_${label}`),
      userId,
      lotId,
      eventType: 'risk_hold',
      severity: 'high',
      status: 'open',
      metadata: sensitiveMetadata(`${label} risk`, preMarked),
    });
    await db.insert(partnerActivityEvents).values({
      externalId: uniqueId(`pact_${label}`),
      userId,
      activityDate: '2026-08-01',
      eventType: 'marketing_display',
      points: 5,
      idempotencyKey: uniqueId(`pactkey_${label}`),
      metadata: sensitiveMetadata(`${label} activity`, preMarked),
    });
    await db.insert(partnerDailyAllocations).values({
      externalId: uniqueId(`pday_${label}`),
      lotId,
      allocationDate: '2026-08-01',
      lockedBonusCreditCents: 50,
      apiUnitsWeight: 100,
      idempotencyKey: uniqueId(`pdaykey_${label}`),
      metadata: sensitiveMetadata(`${label} allocation`, preMarked),
    });
    await db.insert(partnerMonthlyReleases).values({
      externalId: uniqueId(`pmonth_${label}`),
      lotId,
      releaseMonth: '2026-08',
      principalCreditCents: 100,
      bonusCreditCents: 10,
      status: 'posted',
      idempotencyKey: uniqueId(`pmonkey_${label}`),
      metadata: sensitiveMetadata(`${label} release`, preMarked),
    });
    return { orderId, lotId };
  }

  async function expectRestrictedPartnerGraph(
    target: { id: number },
    graph: { orderId: number; lotId: number },
  ) {
    const restricted = { closureRestricted: true };
    const [kyc] = await db
      .select()
      .from(partnerKycProfiles)
      .where(eq(partnerKycProfiles.userId, target.id))
      .limit(1);
    expect(kyc?.status).toBe('approved');
    expect(kyc?.metadata).toEqual({
      ...restricted,
      providerRef: expect.any(String),
      bankCardHashUpdatedAt: '2026-08-01T00:00:00.000Z',
      reviewerUserId: 9,
    });
    const [order] = await db
      .select()
      .from(partnerRechargeOrders)
      .where(eq(partnerRechargeOrders.id, graph.orderId))
      .limit(1);
    expect(order?.status).toBe('completed');
    expect(order?.metadata).toEqual(restricted);
    const [lot] = await db
      .select()
      .from(partnerLots)
      .where(eq(partnerLots.id, graph.lotId))
      .limit(1);
    expect(lot).toMatchObject({ status: 'releasing', riskStatus: 'held' });
    expect(lot?.metadata).toEqual(restricted);
    const [ledger] = await db
      .select()
      .from(holaCreditLedgerEntries)
      .where(eq(holaCreditLedgerEntries.userId, target.id))
      .limit(1);
    expect(ledger?.status).toBe('posted');
    expect(ledger?.metadata).toEqual({ ...restricted, releaseId: 44, releaseMonth: '2026-08' });
    const [withdrawal] = await db
      .select()
      .from(partnerWithdrawalRequests)
      .where(eq(partnerWithdrawalRequests.userId, target.id))
      .limit(1);
    expect(withdrawal).toMatchObject({ status: 'paid', rejectionReason: null });
    expect(withdrawal?.metadata).toEqual({
      ...restricted,
      paidByUserId: 11,
      providerPayoutId: expect.any(String),
      paidAt: '2026-08-20T00:00:00.000Z',
    });
    const [risk] = await db
      .select()
      .from(partnerRiskEvents)
      .where(eq(partnerRiskEvents.userId, target.id))
      .limit(1);
    expect(risk?.status).toBe('open');
    expect(risk?.metadata).toEqual(restricted);
    const [referral] = await db
      .select()
      .from(partnerReferrals)
      .where(eq(partnerReferrals.inviterUserId, target.id))
      .limit(1);
    expect(referral?.status).toBe('qualified');
    expect(referral?.metadata).toEqual({
      ...restricted,
      rewardedAt: '2026-08-15T00:00:00.000Z',
    });
    const [allocation] = await db
      .select()
      .from(partnerDailyAllocations)
      .where(eq(partnerDailyAllocations.lotId, graph.lotId))
      .limit(1);
    expect(allocation?.metadata).toEqual(restricted);
    const [release] = await db
      .select()
      .from(partnerMonthlyReleases)
      .where(eq(partnerMonthlyReleases.lotId, graph.lotId))
      .limit(1);
    expect(release?.status).toBe('posted');
    expect(release?.metadata).toEqual(restricted);
  }

  async function createFinalizationRequest(
    userId: number,
    options: {
      notificationStatus: 'pending' | 'accepted';
      incompleteCategory?: (typeof DATA_CATEGORY_IDS)[number];
      missingOutcomeCategory?: (typeof DATA_CATEGORY_IDS)[number];
      restrictedOutcomeCategoryIds?: (typeof DATA_CATEGORY_IDS)[number][];
      restrictedCategoryIds?: (typeof DATA_CATEGORY_IDS)[number][];
      digestOverride?: string;
    },
  ): Promise<number> {
    const now = new Date();
    const [requestResult] = await db.insert(accountClosureRequests).values({
      externalId: uniqueId('acl_req'),
      userId,
      activeUserId: userId,
      status: 'processing',
      requestedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
      graceEndsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      processingStartedAt: new Date(now.getTime() - 60_000),
      completionLeaseOwner: FINALIZATION_LEASE_OWNER,
      completionLeaseUntil: new Date(now.getTime() + 60 * 60 * 1_000),
    });
    const requestId = Number(requestResult.insertId);
    await db.insert(accountClosureSteps).values(
      DATA_CATEGORY_IDS.map((categoryId) => ({
        requestId,
        categoryId,
        handlerVersion: 1,
        status:
          categoryId === options.incompleteCategory
            ? ('retryable' as const)
            : ('succeeded' as const),
        retentionOutcome:
          categoryId === options.incompleteCategory || categoryId === options.missingOutcomeCategory
            ? null
            : (
                  options.restrictedOutcomeCategoryIds ?? [
                    'payments_entitlements',
                    'partner_kyc_ledger',
                  ]
                ).includes(categoryId)
              ? ('restricted' as const)
              : ('deleted' as const),
        finishedAt: categoryId === options.incompleteCategory ? null : now,
      })),
    );
    const [identity] = await db
      .select({
        externalId: users.externalId,
        email: users.email,
        phone: users.phone,
        googleId: users.googleId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!identity) throw new Error('identity fixture missing');
    await db.insert(accountClosureReceipts).values({
      requestId,
      userId,
      receiptNumber: uniqueId('acl_rcpt'),
      kind: 'completion',
      subjectDigest: options.digestOverride ?? testSubjectDigest(HMAC_SECRET, identity),
      completedCategoryIds: [...DATA_CATEGORY_IDS],
      restrictedCategoryIds: options.restrictedCategoryIds ?? [
        'payments_entitlements',
        'partner_kyc_ledger',
      ],
      notificationStatus: options.notificationStatus,
      issuedAt: now,
      completedAt: null,
    });
    return requestId;
  }

  function finalizeRequest(
    requestId: number,
    userId: number,
    hmacSecret = HMAC_SECRET,
  ): Promise<void> {
    return finalizeUserTombstone({
      db,
      requestId,
      userId,
      hmacSecret,
      expectedLeaseOwner: FINALIZATION_LEASE_OWNER,
      now: new Date(),
    });
  }

  async function runToCompletion(
    handler: AccountClosureHandler,
    user: { id: number; externalId: string },
    storage: StorageProvider,
  ): Promise<Extract<ClosureHandlerResult, { kind: 'complete' }>> {
    let checkpoint: ClosureCheckpoint = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = await handler.run(closureContext(user, storage, checkpoint));
      if (result.kind === 'complete') return result;
      checkpoint = result.checkpoint;
    }
    throw new Error(`handler ${handler.categoryId} did not converge`);
  }

  function closureContext(
    user: { id: number; externalId: string },
    storage: StorageProvider,
    checkpoint: ClosureCheckpoint,
  ): ClosureHandlerContext {
    return {
      db,
      logger,
      storage,
      signal: new AbortController().signal,
      request: {
        id: 10_000 + user.id,
        externalId: uniqueId('acl_context'),
        userId: user.id,
        userExternalId: user.externalId,
      },
      checkpoint,
      pageSize: 100,
    };
  }

  function uniqueId(prefix: string): string {
    sequence += 1;
    return `${prefix}_${sequence}_${randomBytes(2).toString('hex')}`.slice(0, 32);
  }
});

function testSubjectDigest(
  secret: string,
  identity: {
    externalId: string;
    email: string | null;
    phone: string | null;
    googleId: string | null;
  },
): string {
  return createHmac('sha256', secret)
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

function sensitiveMetadata(freeText: string, preMarked = false) {
  return {
    ...(preMarked ? { closureRestricted: true } : {}),
    freeText,
    payerEmail: 'person@example.test',
    marketingDisplay: 'private campaign',
    address: { line1: 'private street' },
    rawPayload: { nested: { token: 'private' } },
  };
}

function fakeStorage(deleted: string[]): StorageProvider {
  return {
    pathFor: vi.fn(() => 'unused'),
    put: vi.fn(async () => ({ storagePath: 'unused' })),
    putFile: vi.fn(async () => ({ storagePath: 'unused' })),
    get: vi.fn(async () => null),
    delete: vi.fn(async (path: string) => {
      deleted.push(path);
    }),
    getSignedUrl: vi.fn(async () => null),
    getSignedPutUrl: vi.fn(async () => null),
    stat: vi.fn(async () => null),
  };
}

async function countRows(table: MySqlTable, condition: SQL): Promise<number> {
  const client = await import('../db/client.js');
  const [row] = await client.db
    .select({ count: sql<number>`COUNT(*)` })
    .from(table)
    .where(condition);
  return Number(row?.count ?? 0);
}
