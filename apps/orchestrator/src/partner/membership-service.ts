import { newExternalId } from '@holaday/shared-types';
import { and, desc, eq, gt, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerMemberships, type PartnerMembership } from '../db/schema/partner.js';

const MEMBERSHIP_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

function normalizePositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function normalizeDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function normalizeOptionalExternalId(value: string | undefined, fieldName: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 32) {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= 32`);
  }
  return value;
}

export function computeMembershipExpiry(startsAt: Date): Date {
  const normalizedStartsAt = normalizeDate(startsAt, 'startsAt');
  return new Date(normalizedStartsAt.getTime() + MEMBERSHIP_DURATION_MS);
}

export class PartnerMembershipSourceConflictError extends Error {
  constructor(sourcePaymentExternalId: string) {
    super(`partner membership source payment is already linked to another user: ${sourcePaymentExternalId}`);
    this.name = 'PartnerMembershipSourceConflictError';
  }
}

export class PartnerMembershipService {
  constructor(private readonly db: DB) {}

  async getActiveMembership(userId: number, now = new Date()): Promise<PartnerMembership | null> {
    const normalizedUserId = normalizePositiveSafeInteger(userId, 'userId');
    const normalizedNow = normalizeDate(now, 'now');

    const rows = await this.db
      .select()
      .from(partnerMemberships)
      .where(
        and(
          eq(partnerMemberships.userId, normalizedUserId),
          eq(partnerMemberships.status, 'active'),
          lte(partnerMemberships.startsAt, normalizedNow),
          gt(partnerMemberships.expiresAt, normalizedNow),
        ),
      )
      .orderBy(desc(partnerMemberships.expiresAt))
      .limit(1);

    return (
      rows
        .filter(
          (row) =>
            row.userId === normalizedUserId &&
            row.status === 'active' &&
            row.startsAt.getTime() <= normalizedNow.getTime() &&
            row.expiresAt.getTime() > normalizedNow.getTime(),
        )
        .sort((left, right) => right.expiresAt.getTime() - left.expiresAt.getTime())[0] ?? null
    );
  }

  async activate(input: {
    userId: number;
    sourcePaymentExternalId?: string;
    now?: Date;
  }): Promise<PartnerMembership> {
    const userId = normalizePositiveSafeInteger(input.userId, 'userId');
    const startsAt = normalizeDate(input.now ?? new Date(), 'now');
    const expiresAt = computeMembershipExpiry(startsAt);
    const sourcePaymentExternalId = normalizeOptionalExternalId(
      input.sourcePaymentExternalId,
      'sourcePaymentExternalId',
    );

    if (sourcePaymentExternalId !== null) {
      const existingRows = await this.db
        .select()
        .from(partnerMemberships)
        .where(eq(partnerMemberships.sourcePaymentExternalId, sourcePaymentExternalId))
        .limit(1);
      const existing = existingRows.find(
        (membership) => membership.sourcePaymentExternalId === sourcePaymentExternalId,
      );

      if (existing) {
        if (existing.userId !== userId) {
          throw new PartnerMembershipSourceConflictError(sourcePaymentExternalId);
        }
        return existing;
      }
    }

    const externalId = newExternalId('payment');

    await this.db.insert(partnerMemberships).values({
      externalId,
      userId,
      status: 'active',
      startsAt,
      expiresAt,
      sourcePaymentExternalId,
      metadata: null,
    });

    const rows = await this.db
      .select()
      .from(partnerMemberships)
      .where(eq(partnerMemberships.externalId, externalId))
      .limit(1);
    const row = rows.find((membership) => membership.externalId === externalId);

    if (!row) {
      throw new Error('partner membership vanished after insert');
    }
    return row;
  }
}
