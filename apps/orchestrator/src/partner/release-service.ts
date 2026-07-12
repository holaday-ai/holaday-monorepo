import { PARTNER_RELEASE_MONTHS, newExternalId } from '@holaday/shared-types';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import {
  partnerLots,
  partnerMonthlyReleases,
  type PartnerLot,
  type PartnerMonthlyRelease,
} from '../db/schema/partner.js';
import { CreditLedgerService } from './credit-ledger-service.js';
import { calculateReleaseSlice } from './partner-rules.js';

function assertNonNegativeSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeReleaseMonth(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) {
    throw new RangeError('releaseMonth must be YYYY-MM');
  }

  const [yearText, monthText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || year < 1000 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('releaseMonth must be a valid calendar month');
  }

  return value;
}

function normalizeDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function monthBoundsUtc(releaseMonth: string): { start: Date; end: Date } {
  const [yearText, monthText] = releaseMonth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

function dateToUtcMonth(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function isLotEligibleForReleaseMonth(lot: PartnerLot, releaseMonth: string): boolean {
  if (lot.riskStatus !== 'normal') return false;
  if (lot.status !== 'release_pending' && lot.status !== 'releasing') return false;

  return dateToUtcMonth(lot.releaseStartsAt) <= releaseMonth && releaseMonth <= dateToUtcMonth(lot.releaseEndsAt);
}

function releaseTotal(row: Pick<PartnerMonthlyRelease, 'principalCreditCents' | 'bonusCreditCents'>): number {
  return row.principalCreditCents + row.bonusCreditCents;
}

function latestReleaseRow(rows: readonly PartnerMonthlyRelease[]): PartnerMonthlyRelease | undefined {
  return [...rows].sort((a, b) => {
    const byMonth = a.releaseMonth.localeCompare(b.releaseMonth);
    if (byMonth !== 0) return byMonth;
    return a.id - b.id;
  }).at(-1);
}

function canProgressLotStatus(status: string): boolean {
  return status === 'accumulating' || status === 'release_pending' || status === 'releasing';
}

export interface MonthlyReleaseSummary {
  releaseMonth: string;
  eligibleLotCount: number;
  releaseCount: number;
  totalReleasedCreditCents: number;
  remainingBudgetCreditCents: number;
}

export function calculateMonthlyReleaseWithBudget(input: {
  targetCreditCents: number;
  budgetCreditCents: number;
}) {
  const targetCreditCents = assertNonNegativeSafeInteger(input.targetCreditCents, 'targetCreditCents');
  const budgetCreditCents = assertNonNegativeSafeInteger(input.budgetCreditCents, 'budgetCreditCents');
  const releasedCreditCents = Math.min(targetCreditCents, budgetCreditCents);

  return {
    releasedCreditCents,
    carryForwardCreditCents: targetCreditCents - releasedCreditCents,
  };
}

export class ReleaseService {
  private readonly ledger: Pick<CreditLedgerService, 'postEntry'>;

  constructor(
    private readonly db: DB,
    deps: { ledger?: Pick<CreditLedgerService, 'postEntry'> } = {},
  ) {
    this.ledger = deps.ledger ?? new CreditLedgerService(db);
  }

  private async readEligibleLots(releaseMonth: string): Promise<PartnerLot[]> {
    const { start, end } = monthBoundsUtc(releaseMonth);
    const lots = await this.db
      .select()
      .from(partnerLots)
      .where(
        and(
          inArray(partnerLots.status, ['release_pending', 'releasing']),
          eq(partnerLots.riskStatus, 'normal'),
          lte(partnerLots.releaseStartsAt, end),
          gte(partnerLots.releaseEndsAt, start),
        ),
      );

    return lots
      .filter((lot) => isLotEligibleForReleaseMonth(lot, releaseMonth))
      .sort((a, b) => a.id - b.id);
  }

  private async readLot(lotId: number): Promise<PartnerLot | undefined> {
    const [lot] = await this.db.select().from(partnerLots).where(eq(partnerLots.id, lotId)).limit(1);
    return lot;
  }

  private async readReleasesForMonth(releaseMonth: string): Promise<PartnerMonthlyRelease[]> {
    return this.db
      .select()
      .from(partnerMonthlyReleases)
      .where(eq(partnerMonthlyReleases.releaseMonth, releaseMonth));
  }

  private async readReleasesForLot(lotId: number): Promise<PartnerMonthlyRelease[]> {
    const rows = await this.db
      .select()
      .from(partnerMonthlyReleases)
      .where(eq(partnerMonthlyReleases.lotId, lotId));
    return [...rows].sort((a, b) => {
      const byMonth = a.releaseMonth.localeCompare(b.releaseMonth);
      if (byMonth !== 0) return byMonth;
      return a.id - b.id;
    });
  }

  private async readReleaseByLotMonth(
    lotId: number,
    releaseMonth: string,
  ): Promise<PartnerMonthlyRelease | undefined> {
    const [row] = await this.db
      .select()
      .from(partnerMonthlyReleases)
      .where(and(eq(partnerMonthlyReleases.lotId, lotId), eq(partnerMonthlyReleases.releaseMonth, releaseMonth)))
      .limit(1);
    return row;
  }

  private async postLedgerEntries(lot: PartnerLot, release: PartnerMonthlyRelease): Promise<void> {
    if (release.principalCreditCents > 0) {
      await this.ledger.postEntry({
        userId: lot.userId,
        lotId: lot.id,
        entryType: 'monthly_release_principal',
        direction: 'credit',
        bucket: 'withdrawable',
        amountCreditCents: release.principalCreditCents,
        idempotencyKey: `monthly_release_principal:${release.releaseMonth}:${release.lotId}`,
        metadata: {
          releaseId: release.id,
          releaseMonth: release.releaseMonth,
        },
      });
    }

    if (release.bonusCreditCents > 0) {
      await this.ledger.postEntry({
        userId: lot.userId,
        lotId: lot.id,
        entryType: 'monthly_release_bonus',
        direction: 'credit',
        bucket: 'withdrawable',
        amountCreditCents: release.bonusCreditCents,
        idempotencyKey: `monthly_release_bonus:${release.releaseMonth}:${release.lotId}`,
        metadata: {
          releaseId: release.id,
          releaseMonth: release.releaseMonth,
        },
      });
    }
  }

  private async reconcileLotSummaries(lotId: number): Promise<void> {
    const rows = await this.readReleasesForLot(lotId);
    const lot = await this.readLot(lotId);
    if (!lot) return;
    const latest = latestReleaseRow(rows);
    const releasedPrincipalCreditCents = rows.reduce((sum, row) => sum + row.principalCreditCents, 0);
    const releasedBonusCreditCents = rows.reduce((sum, row) => sum + row.bonusCreditCents, 0);
    const status =
      canProgressLotStatus(lot.status) && rows.length > 0
        ? releasedPrincipalCreditCents >= lot.principalCreditCents &&
          releasedBonusCreditCents >= lot.lockedBonusCreditCents
          ? 'completed'
          : 'releasing'
        : lot.status;

    await this.db
      .update(partnerLots)
      .set({
        ...(status === lot.status ? {} : { status }),
        releasedPrincipalCreditCents,
        releasedBonusCreditCents,
        carryForwardCreditCents: latest?.carryForwardCreditCents ?? 0,
      })
      .where(eq(partnerLots.id, lotId));
  }

  async transitionAccumulatedLotsToReleasePending(input: { now?: Date } = {}): Promise<number> {
    const now = normalizeDate(input.now ?? new Date(), 'now');
    const result = await this.db
      .update(partnerLots)
      .set({ status: 'release_pending' })
      .where(
        and(
          eq(partnerLots.status, 'accumulating'),
          eq(partnerLots.riskStatus, 'normal'),
          lte(partnerLots.accumulationEndsAt, now),
        ),
      );
    return readAffectedRows(result);
  }

  async releaseEligibleLots(input: {
    releaseMonth: string;
    budgetCreditCents: number;
  }): Promise<MonthlyReleaseSummary> {
    const releaseMonth = normalizeReleaseMonth(input.releaseMonth);
    const budgetCreditCents = assertNonNegativeSafeInteger(input.budgetCreditCents, 'budgetCreditCents');
    await this.transitionAccumulatedLotsToReleasePending({ now: monthBoundsUtc(releaseMonth).end });
    const existingReleasesForMonth = await this.readReleasesForMonth(releaseMonth);
    const existingReleaseByLotId = new Map(existingReleasesForMonth.map((row) => [row.lotId, row]));
    const lotIdsToReconcile = new Set(existingReleasesForMonth.map((row) => row.lotId));
    const eligibleLots = await this.readEligibleLots(releaseMonth);

    let releaseCount = existingReleasesForMonth.length;
    let totalReleasedCreditCents = existingReleasesForMonth.reduce((sum, row) => sum + releaseTotal(row), 0);
    let remainingBudgetCreditCents = Math.max(0, budgetCreditCents - totalReleasedCreditCents);

    for (const release of existingReleasesForMonth) {
      const lot = await this.readLot(release.lotId);
      if (lot) {
        await this.postLedgerEntries(lot, release);
      }
    }

    for (const lot of eligibleLots) {
      if (existingReleaseByLotId.has(lot.id)) continue;

      const allReleases = await this.readReleasesForLot(lot.id);
      const priorReleases = allReleases.filter((row) => row.releaseMonth < releaseMonth);
      if (allReleases.length > 0) {
        lotIdsToReconcile.add(lot.id);
      }

      const priorReleasedPrincipalCreditCents = priorReleases.reduce(
        (sum, row) => sum + row.principalCreditCents,
        0,
      );
      const priorReleasedBonusCreditCents = priorReleases.reduce((sum, row) => sum + row.bonusCreditCents, 0);
      const totalReleasedPrincipalCreditCents = allReleases.reduce(
        (sum, row) => sum + row.principalCreditCents,
        0,
      );
      const totalReleasedBonusCreditCents = allReleases.reduce((sum, row) => sum + row.bonusCreditCents, 0);
      const latestCarryForwardCreditCents = latestReleaseRow(priorReleases)?.carryForwardCreditCents ?? 0;
      const remainingPrincipalCreditCents = Math.max(
        0,
        lot.principalCreditCents - totalReleasedPrincipalCreditCents,
      );
      const remainingBonusCreditCents = Math.max(0, lot.lockedBonusCreditCents - totalReleasedBonusCreditCents);
      const remainingReleaseMonths = Math.max(1, PARTNER_RELEASE_MONTHS - priorReleases.length);
      const slice = calculateReleaseSlice({
        principalCreditCents: lot.principalCreditCents,
        lockedBonusCreditCents: lot.lockedBonusCreditCents,
        releasedPrincipalCreditCents: priorReleasedPrincipalCreditCents,
        releasedBonusCreditCents: priorReleasedBonusCreditCents,
        remainingReleaseMonths,
      });
      const requestedTargetCreditCents = slice.totalCreditCents + latestCarryForwardCreditCents;
      const targetCreditCents = Math.min(
        requestedTargetCreditCents,
        remainingPrincipalCreditCents + remainingBonusCreditCents,
      );
      const { releasedCreditCents } = calculateMonthlyReleaseWithBudget({
        targetCreditCents,
        budgetCreditCents: remainingBudgetCreditCents,
      });
      const principalCapacityCreditCents = Math.min(
        remainingPrincipalCreditCents,
        slice.principalCreditCents + latestCarryForwardCreditCents,
      );
      const principalCreditCents = Math.min(
        releasedCreditCents,
        principalCapacityCreditCents,
      );
      const bonusCreditCents = Math.min(
        releasedCreditCents - principalCreditCents,
        Math.min(slice.bonusCreditCents, remainingBonusCreditCents),
      );
      const actualReleasedCreditCents = principalCreditCents + bonusCreditCents;
      const carryForwardCreditCents = Math.max(0, targetCreditCents - actualReleasedCreditCents);

      if (actualReleasedCreditCents === 0) continue;

      await this.db
        .insert(partnerMonthlyReleases)
        .values({
          externalId: newExternalId('payment'),
          lotId: lot.id,
          releaseMonth,
          principalCreditCents,
          bonusCreditCents,
          carryForwardCreditCents,
          status: 'posted',
          idempotencyKey: `monthly_release:${releaseMonth}:${lot.id}`,
          metadata: null,
        })
        .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

      const release = await this.readReleaseByLotMonth(lot.id, releaseMonth);
      if (!release) {
        throw new Error('partner monthly release vanished after idempotent insert');
      }

      await this.postLedgerEntries(lot, release);
      lotIdsToReconcile.add(lot.id);
      releaseCount += 1;
      totalReleasedCreditCents += releaseTotal(release);
      remainingBudgetCreditCents = Math.max(0, budgetCreditCents - totalReleasedCreditCents);
    }

    for (const lotId of lotIdsToReconcile) {
      await this.reconcileLotSummaries(lotId);
    }

    return {
      releaseMonth,
      eligibleLotCount: eligibleLots.length,
      releaseCount,
      totalReleasedCreditCents,
      remainingBudgetCreditCents,
    };
  }
}
