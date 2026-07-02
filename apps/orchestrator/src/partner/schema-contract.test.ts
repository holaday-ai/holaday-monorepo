import { describe, expect, it } from 'vitest';
import {
  apiCostPoolEvents,
  holaCreditLedgerEntries,
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

describe('partner schema contract', () => {
  it('exports partner ledger tables', () => {
    expect(apiCostPoolEvents).toBeDefined();
    expect(holaCreditLedgerEntries).toBeDefined();
    expect(partnerKycProfiles).toBeDefined();
    expect(partnerLots).toBeDefined();
    expect(partnerMemberships).toBeDefined();
    expect(partnerRechargeOrders).toBeDefined();
    expect(partnerWithdrawalRequests).toBeDefined();
  });

  it('exports companion partner tables', () => {
    expect(partnerRiskEvents).toBeDefined();
    expect(partnerReferrals).toBeDefined();
    expect(partnerDailyAllocations).toBeDefined();
    expect(partnerMonthlyReleases).toBeDefined();
  });
});
