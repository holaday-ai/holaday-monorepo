import { describe, expect, it } from 'vitest';
import { summarizeLedgerEntries } from './credit-ledger-service.js';

describe('CreditLedgerService pure summary', () => {
  it('summarizes credit buckets from posted ledger rows only', () => {
    const summary = summarizeLedgerEntries([
      { bucket: 'locked', direction: 'credit', amountCreditCents: 10_000_00, status: 'posted' },
      { bucket: 'locked', direction: 'debit', amountCreditCents: 1_500_00, status: 'posted' },
      { bucket: 'available', direction: 'credit', amountCreditCents: 1_500_00, status: 'posted' },
      { bucket: 'available', direction: 'credit', amountCreditCents: 99_00, status: 'voided' },
    ]);
    expect(summary).toEqual({
      availableCreditCents: 1_500_00,
      lockedCreditCents: 8_500_00,
      withdrawableCreditCents: 0,
      pendingWithdrawalCreditCents: 0,
      frozenCreditCents: 0,
    });
  });

  it('ignores unknown buckets', () => {
    const summary = summarizeLedgerEntries([
      { bucket: 'toString', direction: 'credit', amountCreditCents: 42_00, status: 'posted' },
    ]);
    expect(summary).toEqual({
      availableCreditCents: 0,
      lockedCreditCents: 0,
      withdrawableCreditCents: 0,
      pendingWithdrawalCreditCents: 0,
      frozenCreditCents: 0,
    });
  });
});
