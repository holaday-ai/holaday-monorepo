import type { PartnerKycStatus } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerKycProfiles } from '../db/schema/partner.js';

const KNOWN_KYC_STATUSES: readonly PartnerKycStatus[] = [
  'not_started',
  'pending',
  'passed',
  'review_required',
  'rejected',
];

function normalizePositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

export function normalizeKycStatus(status: string): PartnerKycStatus {
  if (KNOWN_KYC_STATUSES.includes(status as PartnerKycStatus)) {
    return status as PartnerKycStatus;
  }
  return 'review_required';
}

export function canRechargeWithKycStatus(status: PartnerKycStatus): boolean {
  return status === 'passed';
}

export function canWithdrawWithKycStatus(status: PartnerKycStatus): boolean {
  return status === 'passed';
}

export class KycService {
  constructor(private readonly db: DB) {}

  async getStatus(userId: number): Promise<PartnerKycStatus> {
    const normalizedUserId = normalizePositiveSafeInteger(userId, 'userId');

    const rows = await this.db
      .select({
        userId: partnerKycProfiles.userId,
        status: partnerKycProfiles.status,
      })
      .from(partnerKycProfiles)
      .where(eq(partnerKycProfiles.userId, normalizedUserId));
    const row = rows.find((profile) => profile.userId === normalizedUserId);

    if (!row) return 'not_started';
    return normalizeKycStatus(row.status);
  }
}
