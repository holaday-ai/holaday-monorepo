import type { PartnerKycStatus } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { KycService, canRechargeWithKycStatus, canWithdrawWithKycStatus, normalizeKycStatus } from './kyc-service.js';

const KNOWN_STATUSES: readonly PartnerKycStatus[] = [
  'not_started',
  'pending',
  'passed',
  'review_required',
  'rejected',
];

type FakeKycRow = {
  userId: number;
  status: string;
};

class FakeKycDb {
  constructor(private readonly rows: FakeKycRow[] = []) {}

  asDB(): DB {
    return this as unknown as DB;
  }

  select(_selection?: unknown) {
    return {
      from: (_table: unknown) => ({
        where: async (_predicate: unknown) => this.rows,
      }),
    };
  }
}

describe('KYC status gates', () => {
  it('blocks recharge for not_started and review_required, and allows passed', () => {
    expect(canRechargeWithKycStatus('not_started')).toBe(false);
    expect(canRechargeWithKycStatus('review_required')).toBe(false);
    expect(canRechargeWithKycStatus('passed')).toBe(true);
  });

  it('allows withdraw only for passed', () => {
    expect(canWithdrawWithKycStatus('passed')).toBe(true);

    for (const status of KNOWN_STATUSES) {
      expect(canWithdrawWithKycStatus(status)).toBe(status === 'passed');
    }
  });

  it('allows recharge only for passed across all known statuses', () => {
    for (const status of KNOWN_STATUSES) {
      expect(canRechargeWithKycStatus(status)).toBe(status === 'passed');
    }
  });

  it('normalizes unknown database statuses conservatively', () => {
    expect(normalizeKycStatus('provider_surprise')).toBe('review_required');
  });
});

describe('KycService', () => {
  it('returns not_started when the user has no KYC profile', async () => {
    const service = new KycService(new FakeKycDb().asDB());

    await expect(service.getStatus(123)).resolves.toBe('not_started');
  });

  it('returns the normalized status for the user profile', async () => {
    const service = new KycService(
      new FakeKycDb([
        { userId: 999, status: 'passed' },
        { userId: 123, status: 'pending' },
      ]).asDB(),
    );

    await expect(service.getStatus(123)).resolves.toBe('pending');
  });

  it('fails closed for unknown database statuses', async () => {
    const service = new KycService(new FakeKycDb([{ userId: 123, status: 'provider_surprise' }]).asDB());

    await expect(service.getStatus(123)).resolves.toBe('review_required');
  });

  it('rejects invalid public inputs', async () => {
    const service = new KycService(new FakeKycDb().asDB());

    await expect(service.getStatus(0)).rejects.toBeInstanceOf(RangeError);
  });
});
