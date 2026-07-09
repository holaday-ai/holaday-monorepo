import { newExternalId, type PartnerKycStatus } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerKycProfiles, type PartnerKycProfile } from '../db/schema/partner.js';

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

function normalizeBoundedString(value: string, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  return value.trim();
}

function normalizeOptionalBoundedString(
  value: string | null | undefined,
  fieldName: string,
  maxLength: number,
): string | null {
  if (value == null) return null;
  return normalizeBoundedString(value, fieldName, maxLength);
}

function normalizeDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function normalizeUpsertKycStatus(status: PartnerKycStatus): Exclude<PartnerKycStatus, 'not_started'> {
  const normalized = normalizeKycStatus(status);
  if (normalized === 'not_started') {
    throw new RangeError('status cannot be not_started for an explicit KYC profile');
  }
  return normalized;
}

function reviewMetadata(input: {
  reviewerUserId?: number;
  note?: string;
  provider: string;
  providerRef: string | null;
  existingMetadata?: unknown;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...metadataRecord(input.existingMetadata),
    source: input.provider,
  };
  if (input.providerRef) metadata.providerRef = input.providerRef;
  if (input.reviewerUserId != null) {
    metadata.reviewerUserId = normalizePositiveSafeInteger(input.reviewerUserId, 'reviewerUserId');
  }
  if (input.note != null) {
    metadata.note = normalizeBoundedString(input.note, 'note', 1000);
  }
  return metadata;
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

  async getProfile(userId: number): Promise<PartnerKycProfile | null> {
    const normalizedUserId = normalizePositiveSafeInteger(userId, 'userId');

    const rows = await this.db
      .select()
      .from(partnerKycProfiles)
      .where(eq(partnerKycProfiles.userId, normalizedUserId));
    const row = rows.find((profile) => profile.userId === normalizedUserId);

    return row ?? null;
  }

  async getStatus(userId: number): Promise<PartnerKycStatus> {
    const row = await this.getProfile(userId);
    if (!row) return 'not_started';
    return normalizeKycStatus(row.status);
  }

  async upsertStatus(input: {
    userId: number;
    status: PartnerKycStatus;
    provider: string;
    providerRef?: string | null;
    reviewerUserId?: number;
    note?: string;
    country?: string;
    now?: Date;
  }): Promise<PartnerKycProfile> {
    const userId = normalizePositiveSafeInteger(input.userId, 'userId');
    const status = normalizeUpsertKycStatus(input.status);
    const provider = normalizeBoundedString(input.provider, 'provider', 32);
    const existing = await this.getProfile(userId);
    const providerRef =
      input.providerRef === undefined
        ? (existing?.providerRef ?? null)
        : normalizeOptionalBoundedString(input.providerRef, 'providerRef', 128);
    const country = normalizeBoundedString(input.country ?? 'CN', 'country', 8);
    const now = normalizeDate(input.now ?? new Date(), 'now');
    const reviewedAt = status === 'pending' ? null : now;
    const metadata = reviewMetadata({
      reviewerUserId: input.reviewerUserId,
      note: input.note,
      provider,
      providerRef,
      existingMetadata: existing?.metadata,
    });

    await this.db
      .insert(partnerKycProfiles)
      .values({
        externalId: newExternalId('payment'),
        userId,
        status,
        country,
        provider,
        providerRef,
        reviewedAt,
        metadata,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          status,
          country,
          provider,
          providerRef,
          reviewedAt,
          metadata,
          updatedAt: now,
        },
      });

    const rows = await this.db
      .select()
      .from(partnerKycProfiles)
      .where(eq(partnerKycProfiles.userId, userId));
    const row = rows.find((profile) => profile.userId === userId);
    if (!row) {
      throw new Error('partner KYC profile vanished after upsert');
    }
    return row;
  }
}
