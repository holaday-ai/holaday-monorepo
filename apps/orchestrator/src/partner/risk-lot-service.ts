import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  partnerLots,
  partnerRiskEvents,
  type PartnerLot,
  type NewPartnerRiskEvent,
} from '../db/schema/partner.js';

const REVIEW_NOTE_MAX_LENGTH = 1000;
const CLOSE_RESOLUTION_REF_MAX_LENGTH = 128;
const CLOSE_RESOLUTION_KINDS = ['manual', 'refund', 'fraud'] as const;

export type PartnerRiskLotTransitionReason = 'not_found' | 'not_frozen' | 'closed';
export type PartnerRiskLotCloseResolutionKind = (typeof CLOSE_RESOLUTION_KINDS)[number];

export interface FreezePartnerRiskLotInput {
  lotExternalId: string;
  reviewerUserId: number;
  reason: string;
  now?: Date;
}

export interface ResumePartnerRiskLotInput {
  lotExternalId: string;
  reviewerUserId: number;
  note?: string;
  now?: Date;
}

export interface ClosePartnerRiskLotInput {
  lotExternalId: string;
  reviewerUserId: number;
  reason: string;
  resolutionKind?: PartnerRiskLotCloseResolutionKind;
  resolutionRef?: string;
  now?: Date;
}

export class PartnerRiskLotTransitionError extends Error {
  constructor(readonly reason: PartnerRiskLotTransitionReason) {
    super(`Partner risk lot transition failed: ${reason}`);
    this.name = 'PartnerRiskLotTransitionError';
    Object.setPrototypeOf(this, PartnerRiskLotTransitionError.prototype);
  }
}

export class PartnerRiskLotService {
  constructor(private readonly db: DB) {}

  async freezeLot(input: FreezePartnerRiskLotInput): Promise<PartnerLot> {
    const lotExternalId = normalizeNonEmptyText(input.lotExternalId, 'lotExternalId');
    const reviewerUserId = normalizePositiveSafeInteger(input.reviewerUserId, 'reviewerUserId');
    const reason = normalizeNonEmptyText(input.reason, 'reason', REVIEW_NOTE_MAX_LENGTH);
    const now = normalizeDate(input.now ?? new Date(), 'now');

    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;
      const lot = await readLotByExternalId(txDb, lotExternalId);
      if (!lot) {
        throw new PartnerRiskLotTransitionError('not_found');
      }
      if (lot.status === 'closed') {
        return lot;
      }
      if (lot.status === 'frozen' || lot.riskStatus === 'frozen') {
        return lot;
      }

      const metadata = {
        ...metadataRecord(lot.metadata),
        riskFrozenByUserId: reviewerUserId,
        riskFrozenAt: now.toISOString(),
        riskFreezeReason: reason,
        statusBeforeFreeze: normalizeRestorableLotStatus(lot.status) ?? 'accumulating',
        riskStatusBeforeFreeze: normalizeRestorableRiskStatus(lot.riskStatus) ?? 'normal',
      };
      const updatedLot = {
        ...lot,
        status: 'frozen',
        riskStatus: 'frozen',
        metadata,
        updatedAt: now,
      };

      await txDb
        .update(partnerLots)
        .set({
          status: updatedLot.status,
          riskStatus: updatedLot.riskStatus,
          metadata,
          updatedAt: now,
        })
        .where(eq(partnerLots.externalId, lotExternalId));
      await insertRiskEvent(txDb, {
        lot,
        eventType: 'lot_frozen',
        severity: 'high',
        status: 'open',
        now,
        metadata: {
          reviewerUserId,
          reason,
          lotExternalId,
        },
      });

      return updatedLot;
    });
  }

  async resumeLot(input: ResumePartnerRiskLotInput): Promise<PartnerLot> {
    const lotExternalId = normalizeNonEmptyText(input.lotExternalId, 'lotExternalId');
    const reviewerUserId = normalizePositiveSafeInteger(input.reviewerUserId, 'reviewerUserId');
    const note = normalizeOptionalText(input.note, 'note', REVIEW_NOTE_MAX_LENGTH);
    const now = normalizeDate(input.now ?? new Date(), 'now');

    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;
      const lot = await readLotByExternalId(txDb, lotExternalId);
      if (!lot) {
        throw new PartnerRiskLotTransitionError('not_found');
      }
      if (lot.status === 'closed') {
        throw new PartnerRiskLotTransitionError('closed');
      }
      if (lot.status !== 'frozen' && lot.riskStatus !== 'frozen') {
        throw new PartnerRiskLotTransitionError('not_frozen');
      }

      const existingMetadata = metadataRecord(lot.metadata);
      const restoredStatus = normalizeRestorableLotStatus(existingMetadata.statusBeforeFreeze) ?? 'accumulating';
      const restoredRiskStatus = normalizeRestorableRiskStatus(existingMetadata.riskStatusBeforeFreeze) ?? 'normal';
      const metadata = {
        ...existingMetadata,
        riskResumedByUserId: reviewerUserId,
        riskResumedAt: now.toISOString(),
        ...(note ? { riskResumeNote: note } : {}),
      };
      const updatedLot = {
        ...lot,
        status: restoredStatus,
        riskStatus: restoredRiskStatus,
        metadata,
        updatedAt: now,
      };

      await txDb
        .update(partnerLots)
        .set({
          status: restoredStatus,
          riskStatus: restoredRiskStatus,
          metadata,
          updatedAt: now,
        })
        .where(eq(partnerLots.externalId, lotExternalId));
      await insertRiskEvent(txDb, {
        lot,
        eventType: 'lot_resumed',
        severity: 'medium',
        status: 'closed',
        now,
        metadata: {
          reviewerUserId,
          ...(note ? { note } : {}),
          lotExternalId,
          restoredStatus,
          restoredRiskStatus,
        },
      });

      return updatedLot;
    });
  }

  async closeLot(input: ClosePartnerRiskLotInput): Promise<PartnerLot> {
    const lotExternalId = normalizeNonEmptyText(input.lotExternalId, 'lotExternalId');
    const reviewerUserId = normalizePositiveSafeInteger(input.reviewerUserId, 'reviewerUserId');
    const reason = normalizeNonEmptyText(input.reason, 'reason', REVIEW_NOTE_MAX_LENGTH);
    const resolutionKind = normalizeCloseResolutionKind(input.resolutionKind);
    const resolutionRef = normalizeOptionalText(input.resolutionRef, 'resolutionRef', CLOSE_RESOLUTION_REF_MAX_LENGTH);
    const now = normalizeDate(input.now ?? new Date(), 'now');

    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;
      const lot = await readLotByExternalId(txDb, lotExternalId);
      if (!lot) {
        throw new PartnerRiskLotTransitionError('not_found');
      }
      if (lot.status === 'closed') {
        return lot;
      }
      if (lot.status !== 'frozen' && lot.riskStatus !== 'frozen') {
        throw new PartnerRiskLotTransitionError('not_frozen');
      }

      const metadata = {
        ...metadataRecord(lot.metadata),
        riskClosedByUserId: reviewerUserId,
        riskClosedAt: now.toISOString(),
        riskCloseReason: reason,
        riskCloseResolutionKind: resolutionKind,
        ...(resolutionRef ? { riskCloseResolutionRef: resolutionRef } : {}),
        statusBeforeClose: lot.status,
        riskStatusBeforeClose: lot.riskStatus,
      };
      const updatedLot = {
        ...lot,
        status: 'closed',
        riskStatus: 'frozen',
        metadata,
        updatedAt: now,
      };

      await txDb
        .update(partnerLots)
        .set({
          status: updatedLot.status,
          riskStatus: updatedLot.riskStatus,
          metadata,
          updatedAt: now,
        })
        .where(eq(partnerLots.externalId, lotExternalId));
      await insertRiskEvent(txDb, {
        lot,
        eventType: 'lot_closed',
        severity: 'high',
        status: 'closed',
        now,
        metadata: {
          reviewerUserId,
          reason,
          resolutionKind,
          ...(resolutionRef ? { resolutionRef } : {}),
          lotExternalId,
        },
      });

      return updatedLot;
    });
  }
}

async function readLotByExternalId(db: DB, lotExternalId: string): Promise<PartnerLot | null> {
  const [row] = await db
    .select()
    .from(partnerLots)
    .where(eq(partnerLots.externalId, lotExternalId))
    .limit(1);
  return row ?? null;
}

async function insertRiskEvent(
  db: DB,
  input: {
    lot: PartnerLot;
    eventType: string;
    severity: string;
    status: string;
    now: Date;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const event: NewPartnerRiskEvent = {
    externalId: newExternalId('payment'),
    userId: input.lot.userId,
    lotId: input.lot.id,
    eventType: input.eventType,
    severity: input.severity,
    status: input.status,
    metadata: input.metadata,
    createdAt: input.now,
    updatedAt: input.now,
  };
  await db.insert(partnerRiskEvents).values(event);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRestorableLotStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return ['accumulating', 'release_pending', 'releasing', 'completed', 'closed'].includes(value)
    ? value
    : undefined;
}

function normalizeRestorableRiskStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return ['normal', 'review', 'review_required'].includes(value) ? value : undefined;
}

function normalizeNonEmptyText(value: string, field: string, maxLength = 128): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new RangeError(`${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw new RangeError(`${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new RangeError(`${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeCloseResolutionKind(value: PartnerRiskLotCloseResolutionKind | undefined): PartnerRiskLotCloseResolutionKind {
  if (value === undefined) return 'manual';
  if (CLOSE_RESOLUTION_KINDS.includes(value)) return value;
  throw new RangeError('resolutionKind must be manual, refund, or fraud');
}

function normalizePositiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function normalizeDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${field} must be a valid Date`);
  }
  return value;
}
