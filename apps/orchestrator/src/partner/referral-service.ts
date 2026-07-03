import { HOLA_CREDIT_CNY_CENTS, newExternalId } from '@holaday/shared-types';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerReferrals, type PartnerReferral } from '../db/schema/partner.js';
import { CreditLedgerService } from './credit-ledger-service.js';

const REFERRAL_RECHARGE_REWARD_BPS = 2_000;
const ASSISTED_RECHARGE_REWARD_BPS = 1_000;

type ReferralLedgerPoster = Pick<CreditLedgerService, 'postEntry'>;

export interface ReferralServiceDeps {
  ledger?: ReferralLedgerPoster;
}

export class PartnerReferralConflictError extends Error {
  constructor(message = 'Partner referral attribution conflict') {
    super(message);
    this.name = 'PartnerReferralConflictError';
    Object.setPrototypeOf(this, PartnerReferralConflictError.prototype);
  }
}

function normalizePositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function normalizeWholeCnyAmount(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  if (value % HOLA_CREDIT_CNY_CENTS !== 0) {
    throw new RangeError(`${fieldName} must be a whole CNY amount`);
  }
  return value;
}

function normalizeDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function normalizeAssisted(value: unknown): 0 | 1 {
  if (value === undefined || value === false) return 0;
  if (value === true) return 1;
  throw new RangeError('assisted must be a boolean when provided');
}

function rewardRateBpsForAssisted(value: number): number {
  if (value === 0) return REFERRAL_RECHARGE_REWARD_BPS;
  if (value === 1) return ASSISTED_RECHARGE_REWARD_BPS;
  throw new RangeError('stored assisted value must be 0 or 1');
}

function calculateRewardCreditCents(amountCnyCents: number, rewardRateBps: number): number {
  return Math.floor((amountCnyCents * rewardRateBps) / 10_000);
}

function assertInvitePayloadMatches(
  row: PartnerReferral,
  input: { inviterUserId: number; inviteeUserId: number; assisted: 0 | 1 },
): void {
  if (
    row.inviterUserId !== input.inviterUserId ||
    row.inviteeUserId !== input.inviteeUserId ||
    row.assisted !== input.assisted
  ) {
    throw new PartnerReferralConflictError();
  }
}

export class ReferralService {
  private readonly ledger: ReferralLedgerPoster;

  constructor(private readonly db: DB, deps: ReferralServiceDeps = {}) {
    this.ledger = deps.ledger ?? new CreditLedgerService(db);
  }

  async recordInvite(input: {
    inviterUserId: number;
    inviteeUserId: number;
    assisted?: boolean;
    now?: Date;
  }): Promise<PartnerReferral> {
    const inviterUserId = normalizePositiveSafeInteger(input.inviterUserId, 'inviterUserId');
    const inviteeUserId = normalizePositiveSafeInteger(input.inviteeUserId, 'inviteeUserId');
    const assisted = normalizeAssisted(input.assisted);
    if (inviterUserId === inviteeUserId) {
      throw new RangeError('inviteeUserId must differ from inviterUserId');
    }

    await this.db
      .insert(partnerReferrals)
      .values({
        externalId: newExternalId('payment'),
        inviterUserId,
        inviteeUserId,
        rechargeOrderId: null,
        status: 'pending',
        rewardCreditCents: 0,
        rewardRateBps: 0,
        assisted,
        metadata: {
          recordedAt: normalizeDate(input.now ?? new Date(), 'now').toISOString(),
        },
      })
      .onDuplicateKeyUpdate({ set: { inviteeUserId: sql`invitee_user_id` } });

    const row = await this.readByInviteeUserId(this.db, inviteeUserId);
    if (!row) {
      throw new Error('partner referral vanished after idempotent insert');
    }
    assertInvitePayloadMatches(row, { inviterUserId, inviteeUserId, assisted });
    return row;
  }

  async settleRechargeReward(input: {
    inviteeUserId: number;
    rechargeOrderId: number;
    amountCnyCents: number;
    now?: Date;
  }): Promise<PartnerReferral | null> {
    const inviteeUserId = normalizePositiveSafeInteger(input.inviteeUserId, 'inviteeUserId');
    const rechargeOrderId = normalizePositiveSafeInteger(input.rechargeOrderId, 'rechargeOrderId');
    const amountCnyCents = normalizeWholeCnyAmount(input.amountCnyCents, 'amountCnyCents');
    const now = normalizeDate(input.now ?? new Date(), 'now');

    // Referral attribution must exist before payment confirmation; late attribution is not backfilled.
    const referral = await this.readByInviteeUserId(this.db, inviteeUserId);
    if (!referral) return null;

    const rewardRateBps = rewardRateBpsForAssisted(referral.assisted);
    const rewardCreditCents = calculateRewardCreditCents(amountCnyCents, rewardRateBps);

    if (referral.status !== 'pending' && referral.status !== 'rewarded') {
      throw new PartnerReferralConflictError(`Partner referral cannot be rewarded from status ${referral.status}`);
    }

    await this.ledger.postEntry({
      userId: referral.inviterUserId,
      lotId: null,
      entryType: 'referral_recharge_reward',
      direction: 'credit',
      bucket: 'available',
      amountCreditCents: rewardCreditCents,
      idempotencyKey: `referral:recharge_reward:${referral.id}:${rechargeOrderId}`,
      metadata: {
        referralId: referral.id,
        referralExternalId: referral.externalId,
        inviteeUserId: referral.inviteeUserId,
        rechargeOrderId,
        rechargeAmountCnyCents: amountCnyCents,
        rewardRateBps,
        settledAt: now.toISOString(),
      },
    });

    return referral;
  }

  private async readByInviteeUserId(db: DB, inviteeUserId: number): Promise<PartnerReferral | null> {
    const [row] = await db
      .select()
      .from(partnerReferrals)
      .where(eq(partnerReferrals.inviteeUserId, inviteeUserId))
      .limit(1);
    return row ?? null;
  }
}
