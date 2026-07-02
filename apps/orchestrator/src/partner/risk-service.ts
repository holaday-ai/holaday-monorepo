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

function assertBoolean(value: boolean, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RangeError(`${fieldName} must be a boolean`);
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
  const kycPassed = assertBoolean(input.kycPassed, 'kycPassed');
  const sameNameBank = assertBoolean(input.sameNameBank, 'sameNameBank');
  const amountCreditCents = assertNonNegativeSafeInteger(input.amountCreditCents, 'amountCreditCents');
  const referralConcentration = assertBoolean(input.referralConcentration, 'referralConcentration');
  const accountFrozen = assertBoolean(input.accountFrozen, 'accountFrozen');

  if (accountFrozen) {
    return { status: 'frozen', score: 100, reasons: ['account_frozen'] };
  }

  const reasons: string[] = [];
  if (!kycPassed) reasons.push('missing_kyc');
  if (!sameNameBank) reasons.push('bank_name_mismatch');
  if (amountCreditCents >= LARGE_WITHDRAWAL_CREDIT_CENTS) reasons.push('large_amount');
  if (referralConcentration) reasons.push('referral_concentration');

  if (reasons.length === 0) {
    return { status: 'normal', score: 0, reasons };
  }

  return {
    status: 'review_required',
    score: Math.min(99, reasons.length * 25),
    reasons,
  };
}
