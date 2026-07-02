export type RiskDecision = {
  status: 'normal' | 'review_required' | 'frozen';
  score: number;
  reasons: string[];
};

const LARGE_WITHDRAWAL_CREDIT_CENTS = 50_000_00;

function assertNonNegativeSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

export function evaluatePartnerRisk(input: {
  kycPassed: boolean;
  sameNameBank: boolean;
  amountCreditCents: number;
  referralConcentration: boolean;
  accountFrozen: boolean;
}): RiskDecision {
  const amountCreditCents = assertNonNegativeSafeInteger(input.amountCreditCents, 'amountCreditCents');

  if (input.accountFrozen) {
    return { status: 'frozen', score: 100, reasons: ['account_frozen'] };
  }

  const reasons: string[] = [];
  if (!input.kycPassed) reasons.push('missing_kyc');
  if (!input.sameNameBank) reasons.push('bank_name_mismatch');
  if (amountCreditCents >= LARGE_WITHDRAWAL_CREDIT_CENTS) reasons.push('large_amount');
  if (input.referralConcentration) reasons.push('referral_concentration');

  if (reasons.length === 0) {
    return { status: 'normal', score: 0, reasons };
  }

  return {
    status: 'review_required',
    score: Math.min(99, reasons.length * 25),
    reasons,
  };
}
