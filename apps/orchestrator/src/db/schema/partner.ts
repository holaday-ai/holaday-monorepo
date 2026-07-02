import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

function idColumn() {
  return bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement();
}

function externalIdColumn() {
  return varchar('external_id', { length: 32 }).notNull();
}

function userIdColumn() {
  return bigint('user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
}

function createdAtColumn() {
  return datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`);
}

function timestamps() {
  return {
    createdAt: createdAtColumn(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  };
}

export const partnerMemberships = mysqlTable(
  'partner_memberships',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    userId: userIdColumn(),
    status: varchar('status', { length: 24 }).notNull().default('active'),
    startsAt: datetime('starts_at', { mode: 'date', fsp: 3 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    sourcePaymentExternalId: varchar('source_payment_external_id', { length: 32 }),
    metadata: json('metadata'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uk_partner_memberships_external_id').on(t.externalId),
    index('ix_partner_memberships_user_status').on(t.userId, t.status),
    index('ix_partner_memberships_expires_at').on(t.expiresAt),
  ],
);

export const partnerKycProfiles = mysqlTable(
  'partner_kyc_profiles',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    userId: userIdColumn(),
    status: varchar('status', { length: 24 }).notNull().default('not_started'),
    country: varchar('country', { length: 8 }).notNull().default('CN'),
    realNameHash: varchar('real_name_hash', { length: 128 }),
    idNumberHash: varchar('id_number_hash', { length: 128 }),
    bankCardHash: varchar('bank_card_hash', { length: 128 }),
    phoneHash: varchar('phone_hash', { length: 128 }),
    provider: varchar('provider', { length: 32 }),
    providerRef: varchar('provider_ref', { length: 128 }),
    reviewedAt: datetime('reviewed_at', { mode: 'date', fsp: 3 }),
    metadata: json('metadata'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uk_partner_kyc_profiles_external_id').on(t.externalId),
    uniqueIndex('uk_partner_kyc_profiles_user').on(t.userId),
    index('ix_partner_kyc_profiles_status').on(t.status),
  ],
);

export const partnerRechargeOrders = mysqlTable(
  'partner_recharge_orders',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    userId: userIdColumn(),
    provider: varchar('provider', { length: 24 }).notNull(),
    providerOrderId: varchar('provider_order_id', { length: 128 }),
    providerCaptureId: varchar('provider_capture_id', { length: 128 }),
    amountCnyCents: int('amount_cny_cents', { unsigned: true }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    orderKind: varchar('order_kind', { length: 32 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    metadata: json('metadata'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uk_partner_recharge_orders_external_id').on(t.externalId),
    uniqueIndex('uk_partner_recharge_orders_idempotency_key').on(t.idempotencyKey),
    uniqueIndex('uk_partner_recharge_orders_provider_capture').on(t.provider, t.providerCaptureId),
    index('ix_partner_recharge_orders_user_status').on(t.userId, t.status),
  ],
);

export const partnerLots = mysqlTable(
  'partner_lots',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    userId: userIdColumn(),
    rechargeOrderId: bigint('recharge_order_id', { mode: 'number', unsigned: true }).references(
      () => partnerRechargeOrders.id,
      { onDelete: 'restrict' },
    ),
    status: varchar('status', { length: 24 }).notNull().default('accumulating'),
    riskStatus: varchar('risk_status', { length: 24 }).notNull().default('normal'),
    principalCreditCents: int('principal_credit_cents', { unsigned: true }).notNull(),
    tierMultiplierBps: int('tier_multiplier_bps', { unsigned: true }).notNull(),
    apiUnits: bigint('api_units', { mode: 'number', unsigned: true }).notNull(),
    bonusCapCreditCents: int('bonus_cap_credit_cents', { unsigned: true }).notNull(),
    lockedBonusCreditCents: int('locked_bonus_credit_cents', { unsigned: true }).notNull().default(0),
    releasedPrincipalCreditCents: int('released_principal_credit_cents', { unsigned: true }).notNull().default(0),
    releasedBonusCreditCents: int('released_bonus_credit_cents', { unsigned: true }).notNull().default(0),
    carryForwardCreditCents: int('carry_forward_credit_cents', { unsigned: true }).notNull().default(0),
    accumulationStartsAt: datetime('accumulation_starts_at', { mode: 'date', fsp: 3 }).notNull(),
    accumulationEndsAt: datetime('accumulation_ends_at', { mode: 'date', fsp: 3 }).notNull(),
    releaseStartsAt: datetime('release_starts_at', { mode: 'date', fsp: 3 }).notNull(),
    releaseEndsAt: datetime('release_ends_at', { mode: 'date', fsp: 3 }).notNull(),
    metadata: json('metadata'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uk_partner_lots_external_id').on(t.externalId),
    index('ix_partner_lots_user_status').on(t.userId, t.status),
    index('ix_partner_lots_release_status').on(t.releaseStartsAt, t.status),
  ],
);

export const holaCreditLedgerEntries = mysqlTable(
  'hola_credit_ledger_entries',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    userId: userIdColumn(),
    lotId: bigint('lot_id', { mode: 'number', unsigned: true }).references(() => partnerLots.id, {
      onDelete: 'set null',
    }),
    entryType: varchar('entry_type', { length: 48 }).notNull(),
    direction: varchar('direction', { length: 8 }).notNull(),
    bucket: varchar('bucket', { length: 32 }).notNull(),
    amountCreditCents: int('amount_credit_cents', { unsigned: true }).notNull().default(0),
    amountApiUnits: bigint('amount_api_units', { mode: 'number', unsigned: true }).notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('posted'),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    metadata: json('metadata'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('uk_hola_credit_ledger_entries_external_id').on(t.externalId),
    uniqueIndex('uk_hola_credit_ledger_entries_idempotency_key').on(t.idempotencyKey),
    index('ix_hola_credit_ledger_entries_user_created').on(t.userId, t.createdAt),
    index('ix_hola_credit_ledger_entries_lot').on(t.lotId),
  ],
);

export const apiCostPoolEvents = mysqlTable(
  'api_cost_pool_events',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    eventDate: varchar('event_date', { length: 10 }).notNull(),
    source: varchar('source', { length: 32 }).notNull(),
    costUsdMicros: bigint('cost_usd_micros', { mode: 'number', unsigned: true }).notNull().default(0),
    fxBps: int('fx_bps', { unsigned: true }).notNull(),
    apiUnits: bigint('api_units', { mode: 'number', unsigned: true }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    metadata: json('metadata'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('uk_api_cost_pool_events_external_id').on(t.externalId),
    uniqueIndex('uk_api_cost_pool_events_idempotency_key').on(t.idempotencyKey),
    index('ix_api_cost_pool_events_event_date').on(t.eventDate),
  ],
);

export const partnerWithdrawalRequests = mysqlTable(
  'partner_withdrawal_requests',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    userId: userIdColumn(),
    amountCreditCents: int('amount_credit_cents', { unsigned: true }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('requested'),
    reviewDueAt: datetime('review_due_at', { mode: 'date', fsp: 3 }).notNull(),
    bankAccountFingerprint: varchar('bank_account_fingerprint', { length: 128 }).notNull(),
    riskScore: int('risk_score', { unsigned: true }).notNull().default(0),
    rejectionReason: text('rejection_reason'),
    metadata: json('metadata'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uk_partner_withdrawal_requests_external_id').on(t.externalId),
    index('ix_partner_withdrawal_requests_user_status').on(t.userId, t.status),
    index('ix_partner_withdrawal_requests_review_status').on(t.reviewDueAt, t.status),
  ],
);

export const partnerRiskEvents = mysqlTable(
  'partner_risk_events',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    userId: userIdColumn(),
    lotId: bigint('lot_id', { mode: 'number', unsigned: true }).references(() => partnerLots.id, {
      onDelete: 'set null',
    }),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('open'),
    metadata: json('metadata'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uk_partner_risk_events_external_id').on(t.externalId),
    index('ix_partner_risk_events_user_status').on(t.userId, t.status),
    index('ix_partner_risk_events_lot').on(t.lotId),
  ],
);

export const partnerReferrals = mysqlTable(
  'partner_referrals',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    inviterUserId: bigint('inviter_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteeUserId: bigint('invitee_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rechargeOrderId: bigint('recharge_order_id', { mode: 'number', unsigned: true }).references(
      () => partnerRechargeOrders.id,
      { onDelete: 'set null' },
    ),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    rewardCreditCents: int('reward_credit_cents', { unsigned: true }).notNull().default(0),
    rewardRateBps: int('reward_rate_bps', { unsigned: true }).notNull().default(0),
    assisted: int('assisted', { unsigned: true }).notNull().default(0),
    metadata: json('metadata'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uk_partner_referrals_external_id').on(t.externalId),
    // MVP first-attribution policy: one invitee maps to one partner referral.
    uniqueIndex('uk_partner_referrals_invitee_user').on(t.inviteeUserId),
    index('ix_partner_referrals_inviter_status').on(t.inviterUserId, t.status),
  ],
);

export const partnerDailyAllocations = mysqlTable(
  'partner_daily_allocations',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    lotId: bigint('lot_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => partnerLots.id, { onDelete: 'cascade' }),
    allocationDate: varchar('allocation_date', { length: 10 }).notNull(),
    lockedBonusCreditCents: int('locked_bonus_credit_cents', { unsigned: true }).notNull(),
    apiUnitsWeight: bigint('api_units_weight', { mode: 'number', unsigned: true }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    metadata: json('metadata'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('uk_partner_daily_allocations_external_id').on(t.externalId),
    uniqueIndex('uk_partner_daily_allocations_idempotency_key').on(t.idempotencyKey),
    uniqueIndex('uk_partner_daily_allocations_lot_date').on(t.lotId, t.allocationDate),
    index('ix_partner_daily_allocations_lot').on(t.lotId),
    index('ix_partner_daily_allocations_date').on(t.allocationDate),
  ],
);

export const partnerMonthlyReleases = mysqlTable(
  'partner_monthly_releases',
  {
    id: idColumn(),
    externalId: externalIdColumn(),
    lotId: bigint('lot_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => partnerLots.id, { onDelete: 'cascade' }),
    releaseMonth: varchar('release_month', { length: 7 }).notNull(),
    principalCreditCents: int('principal_credit_cents', { unsigned: true }).notNull().default(0),
    bonusCreditCents: int('bonus_credit_cents', { unsigned: true }).notNull().default(0),
    carryForwardCreditCents: int('carry_forward_credit_cents', { unsigned: true }).notNull().default(0),
    status: varchar('status', { length: 24 }).notNull().default('posted'),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    metadata: json('metadata'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('uk_partner_monthly_releases_external_id').on(t.externalId),
    uniqueIndex('uk_partner_monthly_releases_idempotency_key').on(t.idempotencyKey),
    uniqueIndex('uk_partner_monthly_releases_lot_month').on(t.lotId, t.releaseMonth),
    index('ix_partner_monthly_releases_lot').on(t.lotId),
    index('ix_partner_monthly_releases_month').on(t.releaseMonth),
  ],
);

export type PartnerMembership = typeof partnerMemberships.$inferSelect;
export type NewPartnerMembership = typeof partnerMemberships.$inferInsert;
export type PartnerKycProfile = typeof partnerKycProfiles.$inferSelect;
export type NewPartnerKycProfile = typeof partnerKycProfiles.$inferInsert;
export type PartnerRechargeOrder = typeof partnerRechargeOrders.$inferSelect;
export type NewPartnerRechargeOrder = typeof partnerRechargeOrders.$inferInsert;
export type PartnerLot = typeof partnerLots.$inferSelect;
export type NewPartnerLot = typeof partnerLots.$inferInsert;
export type HolaCreditLedgerEntry = typeof holaCreditLedgerEntries.$inferSelect;
export type NewHolaCreditLedgerEntry = typeof holaCreditLedgerEntries.$inferInsert;
export type ApiCostPoolEvent = typeof apiCostPoolEvents.$inferSelect;
export type NewApiCostPoolEvent = typeof apiCostPoolEvents.$inferInsert;
export type PartnerWithdrawalRequest = typeof partnerWithdrawalRequests.$inferSelect;
export type NewPartnerWithdrawalRequest = typeof partnerWithdrawalRequests.$inferInsert;
export type PartnerRiskEvent = typeof partnerRiskEvents.$inferSelect;
export type NewPartnerRiskEvent = typeof partnerRiskEvents.$inferInsert;
export type PartnerReferral = typeof partnerReferrals.$inferSelect;
export type NewPartnerReferral = typeof partnerReferrals.$inferInsert;
export type PartnerDailyAllocation = typeof partnerDailyAllocations.$inferSelect;
export type NewPartnerDailyAllocation = typeof partnerDailyAllocations.$inferInsert;
export type PartnerMonthlyRelease = typeof partnerMonthlyReleases.$inferSelect;
export type NewPartnerMonthlyRelease = typeof partnerMonthlyReleases.$inferInsert;
