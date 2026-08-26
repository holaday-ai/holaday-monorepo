import { describe, expect, it } from 'vitest';
import { accountClosureSteps } from '../../db/schema/account-closures.js';
import {
  partnerKycLedgerClosureHandler,
  sanitizePartnerMetadataForClosure,
} from './partner-kyc-ledger.js';
import {
  RETAINED_PAYMENT_METADATA_KEYS,
  paymentsEntitlementsClosureHandler,
  sanitizePaymentMetadataForClosure,
} from './payments-entitlements.js';

describe('financial account-closure retention', () => {
  it('exposes a trusted step retention outcome instead of deriving it from receipts', () => {
    expect(accountClosureSteps.retentionOutcome).toBeDefined();
  });

  it('keeps exactly the nine reviewed payment keys with safe scalar values', () => {
    const sanitized = sanitizePaymentMetadataForClosure({
      provider: 'paypal',
      environment: 'live',
      cycle: 'monthly',
      packId: 'pack_20',
      providerStatus: 'COMPLETED',
      currency: 'USD',
      settledAt: '2026-08-26T00:00:00.000Z',
      refundedAt: null,
      disputeStatus: 'open',
      payerEmail: 'person@example.test',
      approveUrl: 'https://provider.example/approve?token=secret',
      rawProviderPayload: { payer: { email: 'person@example.test' } },
      billingAddress: { line1: 'private street' },
      note: 'free text from payer',
    });

    expect(RETAINED_PAYMENT_METADATA_KEYS).toEqual([
      'provider',
      'environment',
      'cycle',
      'packId',
      'providerStatus',
      'currency',
      'settledAt',
      'refundedAt',
      'disputeStatus',
    ]);
    expect(sanitized).toEqual({
      provider: 'paypal',
      environment: 'live',
      cycle: 'monthly',
      packId: 'pack_20',
      providerStatus: 'COMPLETED',
      currency: 'USD',
      settledAt: '2026-08-26T00:00:00.000Z',
      refundedAt: null,
      disputeStatus: 'open',
    });
    expect(Object.keys(sanitized)).toHaveLength(9);
  });

  it('drops nested, array, non-finite, executable, and overlong allowlisted values', () => {
    expect(
      sanitizePaymentMetadataForClosure({
        provider: { name: 'paypal', payerEmail: 'person@example.test' },
        environment: ['live'],
        cycle: Number.NaN,
        packId: () => 'pack_20',
        providerStatus: 'x'.repeat(257),
        currency: 'USD',
        settledAt: new Date('2026-08-26T00:00:00.000Z'),
        refundedAt: undefined,
        disputeStatus: true,
      }),
    ).toEqual({ currency: 'USD' });
    expect(sanitizePaymentMetadataForClosure(null)).toEqual({});
    expect(sanitizePaymentMetadataForClosure('provider payload')).toEqual({});
  });

  it('keeps only reviewed partner reconciliation identifiers and drops notes/blobs', () => {
    expect(
      sanitizePartnerMetadataForClosure('withdrawal', {
        providerPayoutId: 'payout_123',
        paidAt: '2026-08-26T00:00:00.000Z',
        paidByUserId: 42,
        approvalNote: 'free reviewer note',
        returnedReason: 'free text reason',
        payerEmail: 'person@example.test',
        rawPayload: { token: 'private' },
      }),
    ).toEqual({
      closureRestricted: true,
      providerPayoutId: 'payout_123',
      paidAt: '2026-08-26T00:00:00.000Z',
      paidByUserId: 42,
    });
    expect(
      sanitizePartnerMetadataForClosure('kyc', {
        providerRef: 'kyc_reconcile_123',
        bankCardHashUpdatedAt: '2026-08-20T00:00:00.000Z',
        reviewerUserId: 7,
        note: 'document mismatch free text',
        nested: { address: 'private' },
      }),
    ).toEqual({
      closureRestricted: true,
      providerRef: 'kyc_reconcile_123',
      bankCardHashUpdatedAt: '2026-08-20T00:00:00.000Z',
      reviewerUserId: 7,
    });
  });

  it('registers real Task 8 handlers instead of deferred placeholders', async () => {
    for (const handler of [paymentsEntitlementsClosureHandler, partnerKycLedgerClosureHandler]) {
      const categoryId = handler.categoryId;
      expect(handler).toMatchObject({ categoryId, version: 1 });
      await expect(handler.run({} as never)).rejects.not.toMatchObject({
        code: 'HANDLER_DEFERRED',
      });
    }
  });
});
