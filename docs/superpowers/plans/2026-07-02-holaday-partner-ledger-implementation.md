# Holaday Partner Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated partner ledger system for HOLA Credit, API Units, partner lots, 120-day accumulation, a 12-month total cycle with 8 monthly release windows, KYC/risk gates, withdrawal requests, and referral rewards without changing the existing plan/add-on payment behavior.

**Architecture:** Add a new partner domain beside the current payment/quota code. Keep money-like changes append-only through a credit ledger, keep recharges as immutable lots, gate all release/withdrawal behavior behind budget and risk services, and expose a new `partner.*` tRPC router plus separate partner pages. Use dark-ship defaults so the backend can land before the UI is publicly linked.

**Tech Stack:** TypeScript, Drizzle MySQL schema/migrations, tRPC, Express internal endpoints, Vitest, React/Vite, existing PayPal/CN payment patterns, existing `llm_calls.cost_usd` cost data.

---

## MVP Defaults Locked For This Plan

These defaults resolve the design spec's open decisions for a first implementation. Keep them configurable in code so product can adjust without schema churn.

- Platform partner recharge pool cap: `¥1,000,000`.
- Per-user annual recharge cap: `¥1,000,000`.
- Single recharge range: `¥10,000` to `¥200,000`.
- Per-user monthly recharge cap: `¥500,000`.
- Withdrawal minimum: `¥500`.
- Withdrawal review: normal `T+7`, high-risk `T+15`.
- Annual partner membership: `¥999`, purchasable before KYC2.
- Recharge: requires KYC2.
- Withdrawal: requires KYC2, same-name bank, risk pass, and release eligibility.
- Referral reward: locked HOLA Credit only in MVP; not immediately withdrawable.
- HOLA Credit usage: partner dashboard and future partner flows only in MVP, not existing plans/add-ons.
- API cost pool: `llm_calls` only in MVP; image/video/manual API costs enter through `api_cost_pool_events` rows but are not wired to providers in this plan.
- Feature flag: `PARTNER_LEDGER_ENABLED=false` by default.

## File Structure

### Shared Types

- Create `packages/shared-types/src/partner.ts`
  - Partner constants, tier functions, lot math helpers, public statuses.
- Modify `packages/shared-types/src/index.ts`
  - Export `partner.ts`.

### Orchestrator Schema

- Create `apps/orchestrator/src/db/schema/partner.ts`
  - All partner tables in one focused schema file for the first pass.
- Modify `apps/orchestrator/src/db/schema/index.ts`
  - Export the partner schema.
- Create a generated Drizzle migration under `apps/orchestrator/drizzle/`
  - Generated after schema file lands.

### Orchestrator Domain

- Create `apps/orchestrator/src/partner/partner-config.ts`
  - Constants and environment-derived defaults.
- Create `apps/orchestrator/src/partner/partner-rules.ts`
  - Pure math for tiers, caps, dates, release slices, weights.
- Create `apps/orchestrator/src/partner/credit-ledger-service.ts`
  - Append-only ledger writes and balance snapshots.
- Create `apps/orchestrator/src/partner/membership-service.ts`
  - Annual partner membership lifecycle.
- Create `apps/orchestrator/src/partner/kyc-service.ts`
  - MVP automated/manual KYC status abstraction with mock provider boundary.
- Create `apps/orchestrator/src/partner/recharge-service.ts`
  - Recharge order validation, lot creation, tier adjustments.
- Create `apps/orchestrator/src/partner/allocation-service.ts`
  - Daily API cost pool and locked bonus accumulation.
- Create `apps/orchestrator/src/partner/release-service.ts`
  - Monthly releases and carry-forward.
- Create `apps/orchestrator/src/partner/withdrawal-service.ts`
  - Withdrawal request validation and lifecycle.
- Create `apps/orchestrator/src/partner/referral-service.ts`
  - Invitation reward bookkeeping.
- Create `apps/orchestrator/src/partner/risk-service.ts`
  - Risk score/freeze/review-required decisions.
- Create `apps/orchestrator/src/partner/index.ts`
  - Re-export services and rules.

### Orchestrator API

- Create `apps/orchestrator/src/trpc/routers/partner.ts`
  - User-facing partner queries and mutations.
- Modify `apps/orchestrator/src/trpc/router.ts`
  - Mount `partner: partnerRouter`.
- Modify `apps/orchestrator/src/http.ts`
  - Add internal partner payment confirmation endpoint for CN payment callback reuse.
- Create `apps/orchestrator/src/partner/schedulers.ts`
  - Explicit functions for daily/monthly jobs; no automatic background loop in MVP.
- Create `apps/orchestrator/scripts/partner-run-daily.ts`
  - Operator script to run daily accumulation.
- Create `apps/orchestrator/scripts/partner-run-monthly.ts`
  - Operator script to run monthly releases.

### Web Workbench

- Create `apps/web-workbench/src/lib/partner-page-state.ts`
  - Pure frontend state mapping and copy helpers.
- Create `apps/web-workbench/src/pages/PartnerPage.tsx`
  - Partner dashboard entry.
- Create `apps/web-workbench/src/pages/PartnerRechargePage.tsx`
  - Recharge slider, tier preview, KYC gate state.
- Create `apps/web-workbench/src/pages/PartnerLedgerPage.tsx`
  - HOLA Credit ledger, lots, release schedule.
- Create `apps/web-workbench/src/pages/PartnerWithdrawPage.tsx`
  - Withdrawal request UI.
- Modify `apps/web-workbench/src/App.tsx`
  - Add routes under `/partner`.
- Modify `apps/web-workbench/src/pages/PageShell.tsx`
  - Add a gated navigation entry only when partner status endpoint enables it.
- Do not modify `apps/web-workbench/src/pages/BillingPage.tsx` in MVP
  - Keep subscription billing and partner ledger visually separate for the first launch.

### Tests

- Create `apps/orchestrator/src/partner/partner-rules.test.ts`
- Create `apps/orchestrator/src/partner/schema-contract.test.ts`
- Create `apps/orchestrator/src/partner/credit-ledger-service.test.ts`
- Create `apps/orchestrator/src/partner/recharge-service.test.ts`
- Create `apps/orchestrator/src/partner/allocation-service.test.ts`
- Create `apps/orchestrator/src/partner/release-service.test.ts`
- Create `apps/orchestrator/src/partner/withdrawal-service.test.ts`
- Create `apps/orchestrator/src/partner/activity-service.test.ts`
- Create `apps/orchestrator/src/trpc/routers/partner.test.ts`
- Create `apps/web-workbench/src/lib/partner-page-state.test.ts`

---

## Task 1: Shared Partner Constants And Pure Rules

**Files:**
- Create: `packages/shared-types/src/partner.ts`
- Modify: `packages/shared-types/src/index.ts`
- Create: `apps/orchestrator/src/partner/partner-config.ts`
- Create: `apps/orchestrator/src/partner/index.ts`
- Test: `apps/orchestrator/src/partner/partner-rules.test.ts`
- Create: `apps/orchestrator/src/partner/partner-rules.ts`

- [ ] **Step 1: Write failing pure-rule tests**

Create `apps/orchestrator/src/partner/partner-rules.test.ts` with these cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  calculateApiUnits,
  calculateLotCaps,
  calculateReleaseSlice,
  selectRechargeTier,
} from './partner-rules.js';

describe('partner rules', () => {
  it('selects the rolling 30-day recharge tier', () => {
    expect(selectRechargeTier(10_000_00).multiplierBps).toBe(10_500);
    expect(selectRechargeTier(50_001_00).multiplierBps).toBe(10_800);
    expect(selectRechargeTier(100_001_00).multiplierBps).toBe(11_200);
    expect(selectRechargeTier(200_001_00).multiplierBps).toBe(11_600);
    expect(selectRechargeTier(400_001_00).multiplierBps).toBe(12_000);
  });

  it('calculates API Units from principal credit cents and tier basis points', () => {
    expect(calculateApiUnits(10_000_00, 10_500)).toBe(10_500_000);
    expect(calculateApiUnits(200_000_00, 11_600)).toBe(232_000_000);
  });

  it('caps total lot release at 120 percent of principal', () => {
    expect(calculateLotCaps(10_000_00)).toEqual({
      principalCreditCents: 10_000_00,
      bonusCapCreditCents: 2_000_00,
      totalClaimCapCreditCents: 12_000_00,
    });
  });

  it('splits full 120 percent claim into eight equal monthly releases', () => {
    expect(calculateReleaseSlice({ principalCreditCents: 10_000_00, lockedBonusCreditCents: 2_000_00 })).toEqual({
      principalCreditCents: 1_250_00,
      bonusCreditCents: 250_00,
      totalCreditCents: 1_500_00,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/partner-rules.test.ts
```

Expected: FAIL because `apps/orchestrator/src/partner/partner-rules.ts` does not exist.

- [ ] **Step 3: Add shared constants**

Create `packages/shared-types/src/partner.ts`:

```ts
export const PARTNER_MEMBERSHIP_PRICE_CNY_CENTS = 999_00;
export const HOLA_CREDIT_CNY_CENTS = 100;
export const API_UNITS_PER_HOLA_CREDIT = 1_000;

export const PARTNER_RECHARGE_MIN_CNY_CENTS = 10_000_00;
export const PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS = 200_000_00;
export const PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS = 500_000_00;
export const PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS = 1_000_000_00;
export const PARTNER_PLATFORM_POOL_CAP_CNY_CENTS = 1_000_000_00;

export const PARTNER_ACCUMULATION_DAYS = 120;
export const PARTNER_RELEASE_MONTHS = 8;
export const PARTNER_TOTAL_RELEASE_BPS = 12_000;
export const PARTNER_BONUS_BPS = 2_000;

export const PARTNER_RECHARGE_TIERS = [
  { minCnyCents: 10_000_00, maxCnyCents: 50_000_00, multiplierBps: 10_500 },
  { minCnyCents: 50_001_00, maxCnyCents: 100_000_00, multiplierBps: 10_800 },
  { minCnyCents: 100_001_00, maxCnyCents: 200_000_00, multiplierBps: 11_200 },
  { minCnyCents: 200_001_00, maxCnyCents: 400_000_00, multiplierBps: 11_600 },
  { minCnyCents: 400_001_00, maxCnyCents: 500_000_00, multiplierBps: 12_000 },
] as const;

export type PartnerMembershipStatus = 'active' | 'expired' | 'cancelled';
export type PartnerKycStatus = 'not_started' | 'pending' | 'passed' | 'review_required' | 'rejected';
export type PartnerLotStatus = 'accumulating' | 'release_pending' | 'releasing' | 'completed' | 'frozen' | 'closed';
export type PartnerLedgerEntryStatus = 'pending' | 'posted' | 'voided';
export type PartnerWithdrawalStatus = 'requested' | 'reviewing' | 'approved' | 'paid' | 'rejected' | 'returned';
```

Modify `packages/shared-types/src/index.ts`:

```ts
export * from './partner.js';
```

- [ ] **Step 4: Add pure rules**

Create `apps/orchestrator/src/partner/partner-rules.ts`:

```ts
import {
  API_UNITS_PER_HOLA_CREDIT,
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_BONUS_BPS,
  PARTNER_RECHARGE_TIERS,
  PARTNER_RELEASE_MONTHS,
  PARTNER_TOTAL_RELEASE_BPS,
} from '@holaday/shared-types';

export function selectRechargeTier(rollingThirtyDayCnyCents: number) {
  const tier = [...PARTNER_RECHARGE_TIERS]
    .reverse()
    .find((candidate) => rollingThirtyDayCnyCents >= candidate.minCnyCents);
  return tier ?? PARTNER_RECHARGE_TIERS[0];
}

export function calculateApiUnits(principalCreditCents: number, multiplierBps: number): number {
  return Math.floor((principalCreditCents / HOLA_CREDIT_CNY_CENTS) * API_UNITS_PER_HOLA_CREDIT * (multiplierBps / 10_000));
}

export function calculateLotCaps(principalCreditCents: number) {
  return {
    principalCreditCents,
    bonusCapCreditCents: Math.floor((principalCreditCents * PARTNER_BONUS_BPS) / 10_000),
    totalClaimCapCreditCents: Math.floor((principalCreditCents * PARTNER_TOTAL_RELEASE_BPS) / 10_000),
  };
}

export function calculateReleaseSlice(input: {
  principalCreditCents: number;
  lockedBonusCreditCents: number;
}) {
  const principalCreditCents = Math.floor(input.principalCreditCents / PARTNER_RELEASE_MONTHS);
  const bonusCreditCents = Math.floor(input.lockedBonusCreditCents / PARTNER_RELEASE_MONTHS);
  return {
    principalCreditCents,
    bonusCreditCents,
    totalCreditCents: principalCreditCents + bonusCreditCents,
  };
}
```

- [ ] **Step 5: Add partner config and domain index**

Create `apps/orchestrator/src/partner/partner-config.ts`:

```ts
import {
  PARTNER_PLATFORM_POOL_CAP_CNY_CENTS,
  PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS,
  PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS,
  PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS,
  PARTNER_RECHARGE_MIN_CNY_CENTS,
} from '@holaday/shared-types';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function partnerConfig() {
  return {
    enabled: process.env.PARTNER_LEDGER_ENABLED === 'true',
    fxBps: intEnv('PARTNER_FX_BPS', 72_000),
    platformPoolCapCnyCents: intEnv('PARTNER_PLATFORM_POOL_CAP_CNY_CENTS', PARTNER_PLATFORM_POOL_CAP_CNY_CENTS),
    annualRechargeCapCnyCents: intEnv('PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS', PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS),
    monthlyRechargeCapCnyCents: intEnv('PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS', PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS),
    singleRechargeMinCnyCents: intEnv('PARTNER_RECHARGE_MIN_CNY_CENTS', PARTNER_RECHARGE_MIN_CNY_CENTS),
    singleRechargeMaxCnyCents: intEnv('PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS', PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS),
    withdrawalMinCreditCents: intEnv('PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS', 500_00),
  };
}
```

Create `apps/orchestrator/src/partner/index.ts`:

```ts
export * from './partner-config.js';
export * from './partner-rules.js';
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/partner-rules.test.ts
pnpm --filter @holaday/shared-types typecheck
pnpm --filter @holaday/orchestrator typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/partner.ts packages/shared-types/src/index.ts apps/orchestrator/src/partner/partner-config.ts apps/orchestrator/src/partner/index.ts apps/orchestrator/src/partner/partner-rules.ts apps/orchestrator/src/partner/partner-rules.test.ts
git commit -m "feat: add partner ledger rules"
```

## Task 2: Add Partner Database Schema And Migration

**Files:**
- Create: `apps/orchestrator/src/db/schema/partner.ts`
- Modify: `apps/orchestrator/src/db/schema/index.ts`
- Create: `apps/orchestrator/drizzle/00XX_partner_ledger.sql`
- Test: `apps/orchestrator/src/partner/schema-contract.test.ts`

- [ ] **Step 1: Write schema contract test**

Create `apps/orchestrator/src/partner/schema-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  apiCostPoolEvents,
  holaCreditLedgerEntries,
  partnerKycProfiles,
  partnerLots,
  partnerMemberships,
  partnerRechargeOrders,
  partnerWithdrawalRequests,
} from '../db/schema/partner.js';

describe('partner schema exports', () => {
  it('exports all money-like partner tables', () => {
    expect(partnerMemberships).toBeDefined();
    expect(partnerKycProfiles).toBeDefined();
    expect(partnerRechargeOrders).toBeDefined();
    expect(partnerLots).toBeDefined();
    expect(holaCreditLedgerEntries).toBeDefined();
    expect(apiCostPoolEvents).toBeDefined();
    expect(partnerWithdrawalRequests).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/schema-contract.test.ts
```

Expected: FAIL because `../db/schema/partner.js` does not exist.

- [ ] **Step 3: Add schema file**

Create `apps/orchestrator/src/db/schema/partner.ts` with these tables:

```ts
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

const timestamps = {
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdate(() => new Date()),
};

export const partnerMemberships = mysqlTable('partner_memberships', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 24 }).notNull().default('active'),
  startsAt: datetime('starts_at', { mode: 'date', fsp: 3 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  sourcePaymentExternalId: varchar('source_payment_external_id', { length: 32 }),
  metadata: json('metadata'),
  ...timestamps,
}, (t) => [
  uniqueIndex('uk_partner_memberships_external_id').on(t.externalId),
  index('ix_partner_memberships_user_status').on(t.userId, t.status),
  index('ix_partner_memberships_expires_at').on(t.expiresAt),
]);

export const partnerKycProfiles = mysqlTable('partner_kyc_profiles', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  ...timestamps,
}, (t) => [
  uniqueIndex('uk_partner_kyc_external_id').on(t.externalId),
  uniqueIndex('uk_partner_kyc_user').on(t.userId),
  index('ix_partner_kyc_status').on(t.status),
]);

export const partnerRechargeOrders = mysqlTable('partner_recharge_orders', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 24 }).notNull(),
  providerOrderId: varchar('provider_order_id', { length: 128 }),
  providerCaptureId: varchar('provider_capture_id', { length: 128 }),
  amountCnyCents: int('amount_cny_cents', { unsigned: true }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  orderKind: varchar('order_kind', { length: 32 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  metadata: json('metadata'),
  ...timestamps,
}, (t) => [
  uniqueIndex('uk_partner_recharge_orders_external_id').on(t.externalId),
  uniqueIndex('uk_partner_recharge_orders_idempotency').on(t.idempotencyKey),
  uniqueIndex('uk_partner_recharge_provider_capture').on(t.provider, t.providerCaptureId),
  index('ix_partner_recharge_user_status').on(t.userId, t.status),
]);

export const partnerLots = mysqlTable('partner_lots', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  rechargeOrderId: bigint('recharge_order_id', { mode: 'number', unsigned: true }).references(() => partnerRechargeOrders.id, { onDelete: 'restrict' }),
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
  ...timestamps,
}, (t) => [
  uniqueIndex('uk_partner_lots_external_id').on(t.externalId),
  index('ix_partner_lots_user_status').on(t.userId, t.status),
  index('ix_partner_lots_release').on(t.releaseStartsAt, t.status),
]);

export const holaCreditLedgerEntries = mysqlTable('hola_credit_ledger_entries', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  lotId: bigint('lot_id', { mode: 'number', unsigned: true }).references(() => partnerLots.id, { onDelete: 'set null' }),
  entryType: varchar('entry_type', { length: 48 }).notNull(),
  direction: varchar('direction', { length: 8 }).notNull(),
  bucket: varchar('bucket', { length: 32 }).notNull(),
  amountCreditCents: int('amount_credit_cents', { unsigned: true }).notNull().default(0),
  amountApiUnits: bigint('amount_api_units', { mode: 'number', unsigned: true }).notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('posted'),
  idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
  metadata: json('metadata'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, (t) => [
  uniqueIndex('uk_hola_credit_ledger_external_id').on(t.externalId),
  uniqueIndex('uk_hola_credit_ledger_idempotency').on(t.idempotencyKey),
  index('ix_hola_credit_ledger_user_created').on(t.userId, t.createdAt),
  index('ix_hola_credit_ledger_lot').on(t.lotId),
]);

export const apiCostPoolEvents = mysqlTable('api_cost_pool_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  eventDate: varchar('event_date', { length: 10 }).notNull(),
  source: varchar('source', { length: 32 }).notNull(),
  costUsdMicros: bigint('cost_usd_micros', { mode: 'number', unsigned: true }).notNull().default(0),
  fxBps: int('fx_bps', { unsigned: true }).notNull(),
  apiUnits: bigint('api_units', { mode: 'number', unsigned: true }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
  metadata: json('metadata'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, (t) => [
  uniqueIndex('uk_api_cost_pool_external_id').on(t.externalId),
  uniqueIndex('uk_api_cost_pool_idempotency').on(t.idempotencyKey),
  index('ix_api_cost_pool_date').on(t.eventDate),
]);

export const partnerWithdrawalRequests = mysqlTable('partner_withdrawal_requests', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountCreditCents: int('amount_credit_cents', { unsigned: true }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('requested'),
  reviewDueAt: datetime('review_due_at', { mode: 'date', fsp: 3 }).notNull(),
  bankAccountFingerprint: varchar('bank_account_fingerprint', { length: 128 }).notNull(),
  riskScore: int('risk_score', { unsigned: true }).notNull().default(0),
  rejectionReason: text('rejection_reason'),
  metadata: json('metadata'),
  ...timestamps,
}, (t) => [
  uniqueIndex('uk_partner_withdrawals_external_id').on(t.externalId),
  index('ix_partner_withdrawals_user_status').on(t.userId, t.status),
  index('ix_partner_withdrawals_review_due').on(t.reviewDueAt, t.status),
]);
```

Add these companion tables in the same file:

```ts
export const partnerRiskEvents = mysqlTable('partner_risk_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  lotId: bigint('lot_id', { mode: 'number', unsigned: true }).references(() => partnerLots.id, { onDelete: 'set null' }),
  eventType: varchar('event_type', { length: 48 }).notNull(),
  severity: varchar('severity', { length: 16 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('open'),
  metadata: json('metadata'),
  ...timestamps,
}, (t) => [
  uniqueIndex('uk_partner_risk_events_external_id').on(t.externalId),
  index('ix_partner_risk_user_status').on(t.userId, t.status),
  index('ix_partner_risk_lot').on(t.lotId),
]);

export const partnerReferrals = mysqlTable('partner_referrals', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  inviterUserId: bigint('inviter_user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  inviteeUserId: bigint('invitee_user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  rechargeOrderId: bigint('recharge_order_id', { mode: 'number', unsigned: true }).references(() => partnerRechargeOrders.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  rewardCreditCents: int('reward_credit_cents', { unsigned: true }).notNull().default(0),
  rewardRateBps: int('reward_rate_bps', { unsigned: true }).notNull().default(0),
  assisted: int('assisted', { unsigned: true }).notNull().default(0),
  metadata: json('metadata'),
  ...timestamps,
}, (t) => [
  uniqueIndex('uk_partner_referrals_external_id').on(t.externalId),
  uniqueIndex('uk_partner_referrals_invitee').on(t.inviteeUserId),
  index('ix_partner_referrals_inviter_status').on(t.inviterUserId, t.status),
]);

export const partnerDailyAllocations = mysqlTable('partner_daily_allocations', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  lotId: bigint('lot_id', { mode: 'number', unsigned: true }).notNull().references(() => partnerLots.id, { onDelete: 'cascade' }),
  allocationDate: varchar('allocation_date', { length: 10 }).notNull(),
  lockedBonusCreditCents: int('locked_bonus_credit_cents', { unsigned: true }).notNull(),
  apiUnitsWeight: bigint('api_units_weight', { mode: 'number', unsigned: true }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
  metadata: json('metadata'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, (t) => [
  uniqueIndex('uk_partner_daily_allocations_external_id').on(t.externalId),
  uniqueIndex('uk_partner_daily_allocations_idempotency').on(t.idempotencyKey),
  index('ix_partner_daily_allocations_lot').on(t.lotId),
  index('ix_partner_daily_allocations_date').on(t.allocationDate),
]);

export const partnerMonthlyReleases = mysqlTable('partner_monthly_releases', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalId: varchar('external_id', { length: 32 }).notNull(),
  lotId: bigint('lot_id', { mode: 'number', unsigned: true }).notNull().references(() => partnerLots.id, { onDelete: 'cascade' }),
  releaseMonth: varchar('release_month', { length: 7 }).notNull(),
  principalCreditCents: int('principal_credit_cents', { unsigned: true }).notNull().default(0),
  bonusCreditCents: int('bonus_credit_cents', { unsigned: true }).notNull().default(0),
  carryForwardCreditCents: int('carry_forward_credit_cents', { unsigned: true }).notNull().default(0),
  status: varchar('status', { length: 24 }).notNull().default('posted'),
  idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
  metadata: json('metadata'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, (t) => [
  uniqueIndex('uk_partner_monthly_releases_external_id').on(t.externalId),
  uniqueIndex('uk_partner_monthly_releases_idempotency').on(t.idempotencyKey),
  index('ix_partner_monthly_releases_lot').on(t.lotId),
  index('ix_partner_monthly_releases_month').on(t.releaseMonth),
]);
```

- [ ] **Step 4: Export schema**

Modify `apps/orchestrator/src/db/schema/index.ts`:

```ts
export * from './partner.js';
```

- [ ] **Step 5: Generate migration**

Run:

```bash
pnpm --filter @holaday/orchestrator db:generate
```

Expected: a new SQL migration under `apps/orchestrator/drizzle/` that only creates new partner tables and indexes.

- [ ] **Step 6: Verify schema test and typecheck**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/schema-contract.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/orchestrator/src/db/schema/partner.ts apps/orchestrator/src/db/schema/index.ts apps/orchestrator/drizzle apps/orchestrator/src/partner/schema-contract.test.ts
git commit -m "feat: add partner ledger schema"
```

## Task 3: Credit Ledger Service

**Files:**
- Create: `apps/orchestrator/src/partner/credit-ledger-service.ts`
- Test: `apps/orchestrator/src/partner/credit-ledger-service.test.ts`

- [ ] **Step 1: Write failing ledger tests**

Create `apps/orchestrator/src/partner/credit-ledger-service.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/credit-ledger-service.test.ts
```

Expected: FAIL because `credit-ledger-service.ts` does not exist.

- [ ] **Step 3: Implement pure summary and service shell**

Create `apps/orchestrator/src/partner/credit-ledger-service.ts`:

```ts
import { newExternalId } from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import { holaCreditLedgerEntries } from '../db/schema/partner.js';

export type CreditBucket = 'available' | 'locked' | 'withdrawable' | 'pending_withdrawal' | 'frozen';
export type LedgerDirection = 'credit' | 'debit';

export interface LedgerSummaryInput {
  bucket: string;
  direction: string;
  amountCreditCents: number;
  status: string;
}

export function summarizeLedgerEntries(entries: LedgerSummaryInput[]) {
  const totals = {
    availableCreditCents: 0,
    lockedCreditCents: 0,
    withdrawableCreditCents: 0,
    pendingWithdrawalCreditCents: 0,
    frozenCreditCents: 0,
  };
  for (const entry of entries) {
    if (entry.status !== 'posted') continue;
    const sign = entry.direction === 'debit' ? -1 : 1;
    const amount = sign * entry.amountCreditCents;
    if (entry.bucket === 'available') totals.availableCreditCents += amount;
    if (entry.bucket === 'locked') totals.lockedCreditCents += amount;
    if (entry.bucket === 'withdrawable') totals.withdrawableCreditCents += amount;
    if (entry.bucket === 'pending_withdrawal') totals.pendingWithdrawalCreditCents += amount;
    if (entry.bucket === 'frozen') totals.frozenCreditCents += amount;
  }
  return totals;
}

export class CreditLedgerService {
  constructor(private readonly db: DB) {}

  async postEntry(input: {
    userId: number;
    lotId?: number | null;
    entryType: string;
    direction: LedgerDirection;
    bucket: CreditBucket;
    amountCreditCents?: number;
    amountApiUnits?: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.insert(holaCreditLedgerEntries).ignore().values({
      externalId: newExternalId('payment'),
      userId: input.userId,
      ...(input.lotId ? { lotId: input.lotId } : {}),
      entryType: input.entryType,
      direction: input.direction,
      bucket: input.bucket,
      amountCreditCents: input.amountCreditCents ?? 0,
      amountApiUnits: input.amountApiUnits ?? 0,
      status: 'posted',
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? null,
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/credit-ledger-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/partner/credit-ledger-service.ts apps/orchestrator/src/partner/credit-ledger-service.test.ts
git commit -m "feat: add hola credit ledger service"
```

## Task 4: Membership And KYC Gates

**Files:**
- Create: `apps/orchestrator/src/partner/membership-service.ts`
- Create: `apps/orchestrator/src/partner/kyc-service.ts`
- Test: `apps/orchestrator/src/partner/membership-service.test.ts`
- Test: `apps/orchestrator/src/partner/kyc-service.test.ts`

- [ ] **Step 1: Write failing membership/KYC tests**

Create `apps/orchestrator/src/partner/membership-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeMembershipExpiry } from './membership-service.js';

describe('membership service rules', () => {
  it('expires annual membership after 365 days', () => {
    const startsAt = new Date('2026-07-02T00:00:00.000Z');
    expect(computeMembershipExpiry(startsAt).toISOString()).toBe('2027-07-02T00:00:00.000Z');
  });
});
```

Create `apps/orchestrator/src/partner/kyc-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canRechargeWithKycStatus, canWithdrawWithKycStatus } from './kyc-service.js';

describe('KYC gate rules', () => {
  it('allows membership before KYC but blocks recharge and withdrawal until KYC2 passes', () => {
    expect(canRechargeWithKycStatus('not_started')).toBe(false);
    expect(canRechargeWithKycStatus('review_required')).toBe(false);
    expect(canRechargeWithKycStatus('passed')).toBe(true);
    expect(canWithdrawWithKycStatus('passed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/membership-service.test.ts src/partner/kyc-service.test.ts
```

Expected: FAIL because services do not exist.

- [ ] **Step 3: Implement service rule functions and DB service shells**

Create `apps/orchestrator/src/partner/membership-service.ts`:

```ts
import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerMemberships } from '../db/schema/partner.js';

export function computeMembershipExpiry(startsAt: Date): Date {
  const expiresAt = new Date(startsAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 365);
  return expiresAt;
}

export class PartnerMembershipService {
  constructor(private readonly db: DB) {}

  async getActiveMembership(userId: number, now = new Date()) {
    const [row] = await this.db
      .select()
      .from(partnerMemberships)
      .where(eq(partnerMemberships.userId, userId))
      .limit(1);
    if (!row || row.status !== 'active' || row.expiresAt <= now) return null;
    return row;
  }

  async activate(input: { userId: number; sourcePaymentExternalId?: string; now?: Date }) {
    const startsAt = input.now ?? new Date();
    const expiresAt = computeMembershipExpiry(startsAt);
    await this.db.insert(partnerMemberships).values({
      externalId: newExternalId('payment'),
      userId: input.userId,
      status: 'active',
      startsAt,
      expiresAt,
      sourcePaymentExternalId: input.sourcePaymentExternalId ?? null,
    });
  }
}
```

Create `apps/orchestrator/src/partner/kyc-service.ts`:

```ts
import type { PartnerKycStatus } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerKycProfiles } from '../db/schema/partner.js';

export function canRechargeWithKycStatus(status: PartnerKycStatus): boolean {
  return status === 'passed';
}

export function canWithdrawWithKycStatus(status: PartnerKycStatus): boolean {
  return status === 'passed';
}

export class KycService {
  constructor(private readonly db: DB) {}

  async getStatus(userId: number): Promise<PartnerKycStatus> {
    const [row] = await this.db
      .select({ status: partnerKycProfiles.status })
      .from(partnerKycProfiles)
      .where(eq(partnerKycProfiles.userId, userId))
      .limit(1);
    return (row?.status as PartnerKycStatus | undefined) ?? 'not_started';
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/membership-service.test.ts src/partner/kyc-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/partner/membership-service.ts apps/orchestrator/src/partner/kyc-service.ts apps/orchestrator/src/partner/membership-service.test.ts apps/orchestrator/src/partner/kyc-service.test.ts
git commit -m "feat: add partner membership and kyc gates"
```

## Task 5: Recharge Orders, Lots, And Tier Adjustments

**Files:**
- Create: `apps/orchestrator/src/partner/recharge-service.ts`
- Test: `apps/orchestrator/src/partner/recharge-service.test.ts`

- [ ] **Step 1: Write failing recharge validation tests**

Create `apps/orchestrator/src/partner/recharge-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateRechargeAmount } from './recharge-service.js';

describe('recharge service rules', () => {
  it('enforces single recharge min and max', () => {
    expect(validateRechargeAmount(9_999_00).ok).toBe(false);
    expect(validateRechargeAmount(10_000_00).ok).toBe(true);
    expect(validateRechargeAmount(200_000_00).ok).toBe(true);
    expect(validateRechargeAmount(200_001_00).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/recharge-service.test.ts
```

Expected: FAIL because `recharge-service.ts` does not exist.

- [ ] **Step 3: Implement validation and lot creation shell**

Create `apps/orchestrator/src/partner/recharge-service.ts`:

```ts
import {
  PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS,
  PARTNER_RECHARGE_MIN_CNY_CENTS,
  newExternalId,
} from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import { partnerLots, partnerRechargeOrders } from '../db/schema/partner.js';
import { calculateApiUnits, calculateLotCaps, selectRechargeTier } from './partner-rules.js';

export function validateRechargeAmount(amountCnyCents: number): { ok: true } | { ok: false; reason: string } {
  if (amountCnyCents < PARTNER_RECHARGE_MIN_CNY_CENTS) return { ok: false, reason: 'below_minimum' };
  if (amountCnyCents > PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS) return { ok: false, reason: 'above_single_maximum' };
  return { ok: true };
}

export class RechargeService {
  constructor(private readonly db: DB) {}

  async createPendingOrder(input: {
    userId: number;
    provider: string;
    amountCnyCents: number;
    orderKind: 'membership' | 'recharge';
    idempotencyKey: string;
  }) {
    await this.db.insert(partnerRechargeOrders).ignore().values({
      externalId: newExternalId('payment'),
      userId: input.userId,
      provider: input.provider,
      amountCnyCents: input.amountCnyCents,
      orderKind: input.orderKind,
      status: 'pending',
      idempotencyKey: input.idempotencyKey,
    });
  }

  async createLotForCapturedRecharge(input: {
    userId: number;
    rechargeOrderId: number;
    amountCnyCents: number;
    rollingThirtyDayCnyCents: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const tier = selectRechargeTier(input.rollingThirtyDayCnyCents);
    const caps = calculateLotCaps(input.amountCnyCents);
    const apiUnits = calculateApiUnits(input.amountCnyCents, tier.multiplierBps);
    const accumulationEndsAt = new Date(now);
    accumulationEndsAt.setUTCDate(accumulationEndsAt.getUTCDate() + 120);
    const releaseStartsAt = new Date(accumulationEndsAt);
    releaseStartsAt.setUTCDate(releaseStartsAt.getUTCDate() + 1);
    const releaseEndsAt = new Date(releaseStartsAt);
    releaseEndsAt.setUTCMonth(releaseEndsAt.getUTCMonth() + 8);

    await this.db.insert(partnerLots).values({
      externalId: newExternalId('payment'),
      userId: input.userId,
      rechargeOrderId: input.rechargeOrderId,
      status: 'accumulating',
      principalCreditCents: caps.principalCreditCents,
      tierMultiplierBps: tier.multiplierBps,
      apiUnits,
      bonusCapCreditCents: caps.bonusCapCreditCents,
      accumulationStartsAt: now,
      accumulationEndsAt,
      releaseStartsAt,
      releaseEndsAt,
    });
  }
}
```

- [ ] **Step 4: Add integration tests for captured recharge**

Extend `recharge-service.test.ts` with DB-backed tests using the same test DB pattern as existing orchestrator service tests. Assert:

```ts
expect(lot.principalCreditCents).toBe(10_000_00);
expect(lot.tierMultiplierBps).toBe(10_500);
expect(lot.apiUnits).toBe(10_500_000);
expect(lot.bonusCapCreditCents).toBe(2_000_00);
expect(lot.status).toBe('accumulating');
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/recharge-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/partner/recharge-service.ts apps/orchestrator/src/partner/recharge-service.test.ts
git commit -m "feat: add partner recharge lots"
```

## Task 6: Daily API Cost Pool And Locked Bonus Allocation

**Files:**
- Create: `apps/orchestrator/src/partner/allocation-service.ts`
- Test: `apps/orchestrator/src/partner/allocation-service.test.ts`

- [ ] **Step 1: Write failing allocation tests**

Create `apps/orchestrator/src/partner/allocation-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateApiUnitsFromUsdCost, calculateLotWeight, capDailyBonus } from './allocation-service.js';

describe('allocation service rules', () => {
  it('converts USD cost to API Units using FX basis points', () => {
    expect(calculateApiUnitsFromUsdCost({ costUsdMicros: 1_000_000, fxBps: 72_000 })).toBe(7_200);
  });

  it('calculates weighted lot share inputs', () => {
    expect(calculateLotWeight({ apiUnits: 10_500_000, ageFactorBps: 10_000, activityFactorBps: 10_500, riskFactorBps: 10_000 })).toBe(11_025_000);
  });

  it('caps daily bonus by remaining lot bonus cap', () => {
    expect(capDailyBonus({ targetCreditCents: 1_667, remainingBonusCreditCents: 1_000 })).toBe(1_000);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/allocation-service.test.ts
```

Expected: FAIL because `allocation-service.ts` does not exist.

- [ ] **Step 3: Implement pure allocation functions and job shell**

Create `apps/orchestrator/src/partner/allocation-service.ts`:

```ts
import { and, gte, lt, sql } from 'drizzle-orm';
import { newExternalId, PARTNER_ACCUMULATION_DAYS } from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import { llmCalls } from '../db/schema/llm-calls.js';
import { apiCostPoolEvents, partnerDailyAllocations, partnerLots } from '../db/schema/partner.js';

export function calculateApiUnitsFromUsdCost(input: { costUsdMicros: number; fxBps: number }): number {
  return Math.floor((input.costUsdMicros / 1_000_000) * (input.fxBps / 10_000) * 1_000);
}

export function calculateLotWeight(input: {
  apiUnits: number;
  ageFactorBps: number;
  activityFactorBps: number;
  riskFactorBps: number;
}): number {
  return Math.floor(input.apiUnits * (input.ageFactorBps / 10_000) * (input.activityFactorBps / 10_000) * (input.riskFactorBps / 10_000));
}

export function capDailyBonus(input: { targetCreditCents: number; remainingBonusCreditCents: number }): number {
  return Math.max(0, Math.min(input.targetCreditCents, input.remainingBonusCreditCents));
}

export class AllocationService {
  constructor(private readonly db: DB) {}

  async buildDailyCostPool(input: { day: string; fxBps: number }) {
    const start = new Date(`${input.day}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const [row] = await this.db
      .select({ sumUsd: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(and(gte(llmCalls.createdAt, start), lt(llmCalls.createdAt, end)));
    const costUsdMicros = Math.round(Number(row?.sumUsd ?? '0') * 1_000_000);
    const apiUnits = calculateApiUnitsFromUsdCost({ costUsdMicros, fxBps: input.fxBps });
    await this.db.insert(apiCostPoolEvents).ignore().values({
      externalId: newExternalId('payment'),
      eventDate: input.day,
      source: 'llm_calls',
      costUsdMicros,
      fxBps: input.fxBps,
      apiUnits,
      idempotencyKey: `llm_calls:${input.day}`,
    });
    return { costUsdMicros, apiUnits };
  }

  async allocateDailyLockedBonus(input: { day: string; budgetCreditCents: number }) {
    const lots = await this.db.select().from(partnerLots);
    const eligible = lots.filter((lot) => lot.status === 'accumulating' && lot.riskStatus === 'normal');
    const totalWeight = eligible.reduce((sum, lot) => sum + calculateLotWeight({
      apiUnits: lot.apiUnits,
      ageFactorBps: 10_000,
      activityFactorBps: 10_000,
      riskFactorBps: 10_000,
    }), 0);
    for (const lot of eligible) {
      const targetDaily = Math.floor(lot.bonusCapCreditCents / PARTNER_ACCUMULATION_DAYS);
      const remaining = lot.bonusCapCreditCents - lot.lockedBonusCreditCents;
      const budgetShare = totalWeight === 0 ? 0 : Math.floor(input.budgetCreditCents * (lot.apiUnits / totalWeight));
      const locked = capDailyBonus({ targetCreditCents: Math.min(targetDaily, budgetShare), remainingBonusCreditCents: remaining });
      if (locked <= 0) continue;
      await this.db.insert(partnerDailyAllocations).ignore().values({
        externalId: newExternalId('payment'),
        lotId: lot.id,
        allocationDate: input.day,
        lockedBonusCreditCents: locked,
        apiUnitsWeight: lot.apiUnits,
        idempotencyKey: `daily:${input.day}:${lot.id}`,
      });
    }
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/allocation-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/partner/allocation-service.ts apps/orchestrator/src/partner/allocation-service.test.ts
git commit -m "feat: add partner daily allocation rules"
```

## Task 7: Monthly Release Service

**Files:**
- Create: `apps/orchestrator/src/partner/release-service.ts`
- Test: `apps/orchestrator/src/partner/release-service.test.ts`

- [ ] **Step 1: Write failing release tests**

Create `apps/orchestrator/src/partner/release-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateMonthlyReleaseWithBudget } from './release-service.js';

describe('release service rules', () => {
  it('releases full monthly slice when budget is enough', () => {
    expect(calculateMonthlyReleaseWithBudget({ targetCreditCents: 1_500_00, budgetCreditCents: 2_000_00 })).toEqual({
      releasedCreditCents: 1_500_00,
      carryForwardCreditCents: 0,
    });
  });

  it('carries forward unreleased amount when budget is short', () => {
    expect(calculateMonthlyReleaseWithBudget({ targetCreditCents: 1_500_00, budgetCreditCents: 900_00 })).toEqual({
      releasedCreditCents: 900_00,
      carryForwardCreditCents: 600_00,
    });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/release-service.test.ts
```

Expected: FAIL because `release-service.ts` does not exist.

- [ ] **Step 3: Implement release calculations and service shell**

Create `apps/orchestrator/src/partner/release-service.ts`:

```ts
import { newExternalId } from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import { partnerLots, partnerMonthlyReleases } from '../db/schema/partner.js';
import { CreditLedgerService } from './credit-ledger-service.js';
import { calculateReleaseSlice } from './partner-rules.js';

export function calculateMonthlyReleaseWithBudget(input: { targetCreditCents: number; budgetCreditCents: number }) {
  const releasedCreditCents = Math.max(0, Math.min(input.targetCreditCents, input.budgetCreditCents));
  return {
    releasedCreditCents,
    carryForwardCreditCents: input.targetCreditCents - releasedCreditCents,
  };
}

export class ReleaseService {
  constructor(
    private readonly db: DB,
    private readonly ledger = new CreditLedgerService(db),
  ) {}

  async releaseEligibleLots(input: { releaseMonth: string; budgetCreditCents: number }) {
    const lots = await this.db.select().from(partnerLots);
    let remainingBudget = input.budgetCreditCents;
    for (const lot of lots.filter((row) => row.status === 'release_pending' || row.status === 'releasing')) {
      if (remainingBudget <= 0) break;
      if (lot.riskStatus !== 'normal') continue;
      const slice = calculateReleaseSlice({
        principalCreditCents: lot.principalCreditCents,
        lockedBonusCreditCents: lot.lockedBonusCreditCents,
      });
      const target = slice.totalCreditCents + lot.carryForwardCreditCents;
      const release = calculateMonthlyReleaseWithBudget({ targetCreditCents: target, budgetCreditCents: remainingBudget });
      if (release.releasedCreditCents <= 0) continue;
      await this.db.insert(partnerMonthlyReleases).ignore().values({
        externalId: newExternalId('payment'),
        lotId: lot.id,
        releaseMonth: input.releaseMonth,
        principalCreditCents: Math.min(slice.principalCreditCents, release.releasedCreditCents),
        bonusCreditCents: Math.max(0, release.releasedCreditCents - slice.principalCreditCents),
        carryForwardCreditCents: release.carryForwardCreditCents,
        status: 'posted',
        idempotencyKey: `monthly:${input.releaseMonth}:${lot.id}`,
      });
      await this.ledger.postEntry({
        userId: lot.userId,
        lotId: lot.id,
        entryType: 'release_principal',
        direction: 'debit',
        bucket: 'locked',
        amountCreditCents: Math.min(slice.principalCreditCents, release.releasedCreditCents),
        idempotencyKey: `ledger:release:locked:${input.releaseMonth}:${lot.id}`,
      });
      await this.ledger.postEntry({
        userId: lot.userId,
        lotId: lot.id,
        entryType: 'release_principal',
        direction: 'credit',
        bucket: 'available',
        amountCreditCents: release.releasedCreditCents,
        idempotencyKey: `ledger:release:available:${input.releaseMonth}:${lot.id}`,
      });
      remainingBudget -= release.releasedCreditCents;
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/release-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/partner/release-service.ts apps/orchestrator/src/partner/release-service.test.ts
git commit -m "feat: add partner monthly release rules"
```

## Task 8: Withdrawal And Risk Services

**Files:**
- Create: `apps/orchestrator/src/partner/risk-service.ts`
- Create: `apps/orchestrator/src/partner/withdrawal-service.ts`
- Test: `apps/orchestrator/src/partner/withdrawal-service.test.ts`

- [ ] **Step 1: Write failing withdrawal tests**

Create `apps/orchestrator/src/partner/withdrawal-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeWithdrawalReviewDueAt, validateWithdrawalRequest } from './withdrawal-service.js';

describe('withdrawal service rules', () => {
  it('enforces minimum withdrawal amount', () => {
    expect(validateWithdrawalRequest({ amountCreditCents: 499_00, availableCreditCents: 1_000_00 }).ok).toBe(false);
    expect(validateWithdrawalRequest({ amountCreditCents: 500_00, availableCreditCents: 1_000_00 }).ok).toBe(true);
  });

  it('uses T+7 for normal and T+15 for high risk', () => {
    const now = new Date('2026-07-02T00:00:00.000Z');
    expect(computeWithdrawalReviewDueAt({ now, highRisk: false }).toISOString()).toBe('2026-07-09T00:00:00.000Z');
    expect(computeWithdrawalReviewDueAt({ now, highRisk: true }).toISOString()).toBe('2026-07-17T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/withdrawal-service.test.ts
```

Expected: FAIL because `withdrawal-service.ts` does not exist.

- [ ] **Step 3: Implement withdrawal and risk functions**

Create `apps/orchestrator/src/partner/risk-service.ts`:

```ts
export interface RiskDecision {
  status: 'normal' | 'review_required' | 'frozen';
  score: number;
  reasons: string[];
}

export function evaluatePartnerRisk(input: {
  kycPassed: boolean;
  sameNameBank: boolean;
  amountCreditCents: number;
  referralConcentration: boolean;
  accountFrozen: boolean;
}): RiskDecision {
  if (input.accountFrozen) return { status: 'frozen', score: 100, reasons: ['account_frozen'] };
  const reasons: string[] = [];
  if (!input.kycPassed) reasons.push('kyc_not_passed');
  if (!input.sameNameBank) reasons.push('bank_name_mismatch');
  if (input.amountCreditCents >= 50_000_00) reasons.push('large_amount');
  if (input.referralConcentration) reasons.push('referral_concentration');
  if (reasons.length > 0) return { status: 'review_required', score: Math.min(99, reasons.length * 25), reasons };
  return { status: 'normal', score: 0, reasons: [] };
}
```

Create `apps/orchestrator/src/partner/withdrawal-service.ts`:

```ts
import { newExternalId } from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import { partnerWithdrawalRequests } from '../db/schema/partner.js';

const WITHDRAWAL_MIN_CREDIT_CENTS = 500_00;

export function validateWithdrawalRequest(input: { amountCreditCents: number; availableCreditCents: number }): { ok: true } | { ok: false; reason: string } {
  if (input.amountCreditCents < WITHDRAWAL_MIN_CREDIT_CENTS) return { ok: false, reason: 'below_minimum' };
  if (input.amountCreditCents > input.availableCreditCents) return { ok: false, reason: 'insufficient_available_credit' };
  return { ok: true };
}

export function computeWithdrawalReviewDueAt(input: { now: Date; highRisk: boolean }): Date {
  const dueAt = new Date(input.now);
  dueAt.setUTCDate(dueAt.getUTCDate() + (input.highRisk ? 15 : 7));
  return dueAt;
}

export class WithdrawalService {
  constructor(private readonly db: DB) {}

  async requestWithdrawal(input: {
    userId: number;
    amountCreditCents: number;
    bankAccountFingerprint: string;
    highRisk: boolean;
    riskScore: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.db.insert(partnerWithdrawalRequests).values({
      externalId: newExternalId('payment'),
      userId: input.userId,
      amountCreditCents: input.amountCreditCents,
      status: input.highRisk ? 'reviewing' : 'requested',
      reviewDueAt: computeWithdrawalReviewDueAt({ now, highRisk: input.highRisk }),
      bankAccountFingerprint: input.bankAccountFingerprint,
      riskScore: input.riskScore,
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/withdrawal-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/partner/risk-service.ts apps/orchestrator/src/partner/withdrawal-service.ts apps/orchestrator/src/partner/withdrawal-service.test.ts
git commit -m "feat: add partner withdrawal risk rules"
```

## Task 9: Partner tRPC Router

**Files:**
- Create: `apps/orchestrator/src/trpc/routers/partner.ts`
- Modify: `apps/orchestrator/src/trpc/router.ts`
- Test: `apps/orchestrator/src/trpc/routers/partner.test.ts`

- [ ] **Step 1: Write router tests**

Create `apps/orchestrator/src/trpc/routers/partner.test.ts` with tests for:

```ts
describe('partner router', () => {
  it('returns disabled status when PARTNER_LEDGER_ENABLED is not true');
  it('blocks recharge preview for users without active membership');
  it('blocks recharge creation before KYC2 passes');
  it('returns lot and ledger summary for active partner users');
});
```

Use `apps/orchestrator/src/trpc/routers/payment.test.ts` for payment-router context fixtures and `apps/orchestrator/src/trpc/routers/usage.ts` for the protected query shape.

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/trpc/routers/partner.test.ts
```

Expected: FAIL because `partnerRouter` does not exist.

- [ ] **Step 3: Implement router**

Create `apps/orchestrator/src/trpc/routers/partner.ts`:

```ts
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import { KycService, canRechargeWithKycStatus } from '../../partner/kyc-service.js';
import { PartnerMembershipService } from '../../partner/membership-service.js';
import { validateRechargeAmount } from '../../partner/recharge-service.js';
import { selectRechargeTier, calculateApiUnits } from '../../partner/partner-rules.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const rechargePreviewInput = z.object({
  amountCnyCents: z.number().int().positive(),
});

export const partnerRouter = router({
  options: publicProcedure.query(() => ({
    enabled: process.env.PARTNER_LEDGER_ENABLED === 'true',
  })),

  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.externalId, ctx.userId!)).limit(1);
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    const membership = await new PartnerMembershipService(ctx.db).getActiveMembership(user.id);
    const kycStatus = await new KycService(ctx.db).getStatus(user.id);
    return {
      enabled: process.env.PARTNER_LEDGER_ENABLED === 'true',
      membership: membership ? { status: membership.status, expiresAt: membership.expiresAt } : null,
      kycStatus,
    };
  }),

  rechargePreview: protectedProcedure.input(rechargePreviewInput).query(async ({ ctx, input }) => {
    const validation = validateRechargeAmount(input.amountCnyCents);
    if (!validation.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: validation.reason });
    const [user] = await ctx.db.select().from(users).where(eq(users.externalId, ctx.userId!)).limit(1);
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    const kycStatus = await new KycService(ctx.db).getStatus(user.id);
    if (!canRechargeWithKycStatus(kycStatus)) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '实名通过后才能充值' });
    const tier = selectRechargeTier(input.amountCnyCents);
    return {
      amountCnyCents: input.amountCnyCents,
      multiplierBps: tier.multiplierBps,
      apiUnits: calculateApiUnits(input.amountCnyCents, tier.multiplierBps),
    };
  }),
});
```

Modify `apps/orchestrator/src/trpc/router.ts`:

```ts
import { partnerRouter } from './routers/partner.js';

export const appRouter = router({
  partner: partnerRouter,
});
```

Keep all existing router entries intact.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator test -- src/trpc/routers/partner.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/trpc/routers/partner.ts apps/orchestrator/src/trpc/router.ts apps/orchestrator/src/trpc/routers/partner.test.ts
git commit -m "feat: add partner router"
```

## Task 10: Partner Payment Confirmation Boundary

**Files:**
- Modify: `apps/orchestrator/src/http.ts`
- Create: `apps/orchestrator/src/partner/payment-confirm-service.ts`
- Test: `apps/orchestrator/src/partner/payment-confirm-service.test.ts`

- [ ] **Step 1: Write failing idempotency tests**

Create `apps/orchestrator/src/partner/payment-confirm-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { partnerPaymentIdempotencyKey } from './payment-confirm-service.js';

describe('partner payment confirm service', () => {
  it('uses provider capture id as idempotency boundary', () => {
    expect(partnerPaymentIdempotencyKey({ provider: 'wechat', providerCaptureId: 'wx-123' })).toBe('partner-payment:wechat:wx-123');
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/payment-confirm-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Add confirm service**

Create `apps/orchestrator/src/partner/payment-confirm-service.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerRechargeOrders } from '../db/schema/partner.js';
import { PartnerMembershipService } from './membership-service.js';
import { RechargeService } from './recharge-service.js';

export function partnerPaymentIdempotencyKey(input: { provider: string; providerCaptureId: string }): string {
  return `partner-payment:${input.provider}:${input.providerCaptureId}`;
}

export class PartnerPaymentConfirmService {
  constructor(private readonly db: DB) {}

  async confirmCapturedOrder(input: {
    orderExternalId: string;
    provider: string;
    providerCaptureId: string;
    amountCnyCents: number;
  }) {
    const [order] = await this.db
      .select()
      .from(partnerRechargeOrders)
      .where(eq(partnerRechargeOrders.externalId, input.orderExternalId))
      .limit(1);
    if (!order || order.status === 'completed') return;

    if (order.orderKind === 'membership') {
      await new PartnerMembershipService(this.db).activate({
        userId: order.userId,
        sourcePaymentExternalId: order.externalId,
      });
    }

    if (order.orderKind === 'recharge') {
      await new RechargeService(this.db).createLotForCapturedRecharge({
        userId: order.userId,
        rechargeOrderId: order.id,
        amountCnyCents: order.amountCnyCents,
        rollingThirtyDayCnyCents: order.amountCnyCents,
      });
    }
  }
}
```

- [ ] **Step 4: Add internal HTTP endpoint**

In `apps/orchestrator/src/http.ts`, add an authenticated internal route near the existing internal payment confirm path:

```ts
app.post('/internal/partner-payment/confirm', async (req, res) => {
  const body = req.body as {
    orderExternalId?: string;
    provider?: string;
    providerCaptureId?: string;
    amountCnyCents?: number;
  };
  if (!body.orderExternalId || !body.provider || !body.providerCaptureId || typeof body.amountCnyCents !== 'number') {
    res.status(400).json({ error: 'invalid_partner_payment_confirm' });
    return;
  }
  await new PartnerPaymentConfirmService(db).confirmCapturedOrder({
    orderExternalId: body.orderExternalId,
    provider: body.provider,
    providerCaptureId: body.providerCaptureId,
    amountCnyCents: body.amountCnyCents,
  });
  res.json({ ok: true });
});
```

Import `PartnerPaymentConfirmService` at the top of `http.ts`.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/payment-confirm-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/partner/payment-confirm-service.ts apps/orchestrator/src/partner/payment-confirm-service.test.ts apps/orchestrator/src/http.ts
git commit -m "feat: add partner payment confirm boundary"
```

## Task 11: Operator Schedulers

**Files:**
- Create: `apps/orchestrator/src/partner/schedulers.ts`
- Create: `apps/orchestrator/scripts/partner-run-daily.ts`
- Create: `apps/orchestrator/scripts/partner-run-monthly.ts`
- Modify: `apps/orchestrator/package.json`
- Test: `apps/orchestrator/src/partner/schedulers.test.ts`

- [ ] **Step 1: Write scheduler tests**

Create `apps/orchestrator/src/partner/schedulers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePartnerDay, parsePartnerMonth } from './schedulers.js';

describe('partner scheduler parsing', () => {
  it('accepts YYYY-MM-DD days', () => {
    expect(parsePartnerDay('2026-07-02')).toBe('2026-07-02');
  });

  it('accepts YYYY-MM months', () => {
    expect(parsePartnerMonth('2026-07')).toBe('2026-07');
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/schedulers.test.ts
```

Expected: FAIL because scheduler module does not exist.

- [ ] **Step 3: Add scheduler functions and scripts**

Create `apps/orchestrator/src/partner/schedulers.ts`:

```ts
import type { DB } from '../db/client.js';
import { AllocationService } from './allocation-service.js';
import { ReleaseService } from './release-service.js';

export function parsePartnerDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('day must be YYYY-MM-DD');
  return value;
}

export function parsePartnerMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('month must be YYYY-MM');
  return value;
}

export async function runPartnerDaily(db: DB, input: { day: string; budgetCreditCents: number; fxBps: number }) {
  const allocation = new AllocationService(db);
  await allocation.buildDailyCostPool({ day: parsePartnerDay(input.day), fxBps: input.fxBps });
  await allocation.allocateDailyLockedBonus({ day: input.day, budgetCreditCents: input.budgetCreditCents });
}

export async function runPartnerMonthly(db: DB, input: { month: string; budgetCreditCents: number }) {
  await new ReleaseService(db).releaseEligibleLots({
    releaseMonth: parsePartnerMonth(input.month),
    budgetCreditCents: input.budgetCreditCents,
  });
}
```

Create scripts that import `db`, parse CLI args, run the function, log JSON, and exit non-zero on error.

Modify `apps/orchestrator/package.json`:

```json
{
  "scripts": {
    "partner:daily": "tsx scripts/partner-run-daily.ts",
    "partner:monthly": "tsx scripts/partner-run-monthly.ts"
  }
}
```

Keep existing scripts intact.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/schedulers.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/partner/schedulers.ts apps/orchestrator/scripts/partner-run-daily.ts apps/orchestrator/scripts/partner-run-monthly.ts apps/orchestrator/package.json apps/orchestrator/src/partner/schedulers.test.ts
git commit -m "feat: add partner scheduler scripts"
```

## Task 12: Frontend State Helpers

**Files:**
- Create: `apps/web-workbench/src/lib/partner-page-state.ts`
- Test: `apps/web-workbench/src/lib/partner-page-state.test.ts`

- [ ] **Step 1: Write failing frontend state tests**

Create `apps/web-workbench/src/lib/partner-page-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { partnerRechargeTierLabel, partnerReleaseNotice } from './partner-page-state';

describe('partner page state', () => {
  it('formats tier multiplier labels', () => {
    expect(partnerRechargeTierLabel(10_500)).toBe('1.05x');
    expect(partnerRechargeTierLabel(12_000)).toBe('1.20x');
  });

  it('uses compliant release copy', () => {
    expect(partnerReleaseNotice()).toContain('前120天为累计观察期');
    expect(partnerReleaseNotice()).toContain('实际释放受平台可分配预算');
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/web-workbench test -- src/lib/partner-page-state.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper**

Create `apps/web-workbench/src/lib/partner-page-state.ts`:

```ts
export function partnerRechargeTierLabel(multiplierBps: number): string {
  return `${(multiplierBps / 10_000).toFixed(2)}x`;
}

export function partnerReleaseNotice(): string {
  return '前120天为累计观察期，期间累计额度仅锁定展示，不支持提现。第121天起进入8个月释放期，按月释放至 HOLA Credit 账户。实际释放受平台可分配预算、账户状态、实名信息及风控规则影响。';
}

export function formatHolaCredit(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? `${whole.toLocaleString('zh-CN')} HOLA Credit` : `${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HOLA Credit`;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @holaday/web-workbench test -- src/lib/partner-page-state.test.ts
pnpm --filter @holaday/web-workbench typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web-workbench/src/lib/partner-page-state.ts apps/web-workbench/src/lib/partner-page-state.test.ts
git commit -m "feat: add partner page state helpers"
```

## Task 13: Frontend Partner Pages And Routes

**Files:**
- Create: `apps/web-workbench/src/pages/PartnerPage.tsx`
- Create: `apps/web-workbench/src/pages/PartnerRechargePage.tsx`
- Create: `apps/web-workbench/src/pages/PartnerLedgerPage.tsx`
- Create: `apps/web-workbench/src/pages/PartnerWithdrawPage.tsx`
- Modify: `apps/web-workbench/src/App.tsx`
- Modify: `apps/web-workbench/src/pages/PageShell.tsx`
- Test: `apps/web-workbench/src/lib/partner-page-state.test.ts`

- [ ] **Step 1: Add page shells using existing layout conventions**

Create pages with existing `PageShell` style and `trpc.partner.*` calls. Initial MVP pages should render:

```tsx
export function PartnerPage() {
  const dashboard = trpc.partner.dashboard.useQuery();
  if (dashboard.isLoading) return <main className="page">加载中...</main>;
  if (!dashboard.data?.enabled) return <main className="page">合伙人计划暂未开放</main>;
  return (
    <main className="page">
      <h1>HOLA Partner</h1>
      <section>
        <h2>HOLA Credit</h2>
        <p>{partnerReleaseNotice()}</p>
      </section>
    </main>
  );
}
```

Use real components/classes already present in neighboring pages instead of introducing a new design system.

- [ ] **Step 2: Add routes**

Modify `apps/web-workbench/src/App.tsx` to add:

```tsx
<Route path="/partner" element={<PartnerPage />} />
<Route path="/partner/recharge" element={<PartnerRechargePage />} />
<Route path="/partner/ledger" element={<PartnerLedgerPage />} />
<Route path="/partner/withdraw" element={<PartnerWithdrawPage />} />
```

Keep all existing routes intact.

- [ ] **Step 3: Add navigation entry**

Modify `apps/web-workbench/src/pages/PageShell.tsx` to add a partner navigation item only when the backend option says enabled. If PageShell cannot call tRPC cleanly, place a static link behind a frontend constant and leave the feature hidden by default.

- [ ] **Step 4: Run tests and build checks**

```bash
pnpm --filter @holaday/web-workbench test -- src/lib/partner-page-state.test.ts
pnpm --filter @holaday/web-workbench typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web-workbench/src/pages/PartnerPage.tsx apps/web-workbench/src/pages/PartnerRechargePage.tsx apps/web-workbench/src/pages/PartnerLedgerPage.tsx apps/web-workbench/src/pages/PartnerWithdrawPage.tsx apps/web-workbench/src/App.tsx apps/web-workbench/src/pages/PageShell.tsx
git commit -m "feat: add partner pages"
```

## Task 14: Referral Reward Bookkeeping

**Files:**
- Create: `apps/orchestrator/src/partner/referral-service.ts`
- Test: `apps/orchestrator/src/partner/referral-service.test.ts`

- [ ] **Step 1: Write failing referral tests**

Create `apps/orchestrator/src/partner/referral-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateReferralReward } from './referral-service.js';

describe('referral service rules', () => {
  it('calculates 20 percent for direct invited recharge', () => {
    expect(calculateReferralReward({ rechargeCreditCents: 10_000_00, assisted: false })).toBe(2_000_00);
  });

  it('calculates 10 percent for assisted recharge', () => {
    expect(calculateReferralReward({ rechargeCreditCents: 10_000_00, assisted: true })).toBe(1_000_00);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/referral-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement referral reward calculation and locked ledger posting**

Create `apps/orchestrator/src/partner/referral-service.ts`:

```ts
import type { DB } from '../db/client.js';
import { CreditLedgerService } from './credit-ledger-service.js';

export function calculateReferralReward(input: { rechargeCreditCents: number; assisted: boolean }): number {
  return Math.floor((input.rechargeCreditCents * (input.assisted ? 1_000 : 2_000)) / 10_000);
}

export class ReferralService {
  constructor(
    private readonly db: DB,
    private readonly ledger = new CreditLedgerService(db),
  ) {}

  async grantLockedReferralReward(input: {
    inviterUserId: number;
    inviteeUserId: number;
    rechargeOrderId: number;
    rechargeCreditCents: number;
    assisted: boolean;
  }) {
    const amount = calculateReferralReward({
      rechargeCreditCents: input.rechargeCreditCents,
      assisted: input.assisted,
    });
    await this.ledger.postEntry({
      userId: input.inviterUserId,
      entryType: 'referral_reward_locked',
      direction: 'credit',
      bucket: 'locked',
      amountCreditCents: amount,
      idempotencyKey: `referral:${input.rechargeOrderId}:${input.inviterUserId}`,
      metadata: {
        inviteeUserId: input.inviteeUserId,
        assisted: input.assisted,
      },
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/referral-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/partner/referral-service.ts apps/orchestrator/src/partner/referral-service.test.ts
git commit -m "feat: add partner referral rewards"
```

## Task 15: Daily Activity Weight MVP

**Files:**
- Create: `apps/orchestrator/src/partner/activity-service.ts`
- Test: `apps/orchestrator/src/partner/activity-service.test.ts`
- Modify: `apps/orchestrator/src/partner/allocation-service.ts`

- [ ] **Step 1: Write failing activity tests**

Create `apps/orchestrator/src/partner/activity-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateActivityFactorBps } from './activity-service.js';

describe('partner activity service rules', () => {
  it('keeps inactive users at 1.00x', () => {
    expect(calculateActivityFactorBps({ loginDays: 0, completedTasks: 0, validInvites: 0 })).toBe(10_000);
  });

  it('caps activity boost at 1.10x', () => {
    expect(calculateActivityFactorBps({ loginDays: 7, completedTasks: 20, validInvites: 5 })).toBe(11_000);
  });

  it('does not grant direct credit from activity', () => {
    expect(calculateActivityFactorBps({ loginDays: 1, completedTasks: 1, validInvites: 0 })).toBe(10_200);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/activity-service.test.ts
```

Expected: FAIL because `activity-service.ts` does not exist.

- [ ] **Step 3: Implement activity factor calculation**

Create `apps/orchestrator/src/partner/activity-service.ts`:

```ts
export function calculateActivityFactorBps(input: {
  loginDays: number;
  completedTasks: number;
  validInvites: number;
}): number {
  const loginBoost = Math.min(300, Math.max(0, input.loginDays) * 100);
  const taskBoost = Math.min(400, Math.max(0, input.completedTasks) * 100);
  const inviteBoost = Math.min(300, Math.max(0, input.validInvites) * 300);
  return Math.min(11_000, 10_000 + loginBoost + taskBoost + inviteBoost);
}

export class PartnerActivityService {
  async getActivityFactorBps(_userId: number, _at: Date): Promise<number> {
    return 10_000;
  }
}
```

- [ ] **Step 4: Wire allocation service to accept activity factor**

Modify the lot weight call in `apps/orchestrator/src/partner/allocation-service.ts` so the current hard-coded `activityFactorBps: 10_000` can later be replaced by `PartnerActivityService`:

```ts
const activityFactorBps = 10_000;
const weight = calculateLotWeight({
  apiUnits: lot.apiUnits,
  ageFactorBps: 10_000,
  activityFactorBps,
  riskFactorBps: 10_000,
});
```

MVP behavior remains neutral `1.00x`; the pure function and service boundary make the daily game safe to turn on after fraud data exists.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner/activity-service.test.ts src/partner/allocation-service.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/partner/activity-service.ts apps/orchestrator/src/partner/activity-service.test.ts apps/orchestrator/src/partner/allocation-service.ts
git commit -m "feat: add partner activity weight"
```

## Task 16: Full Verification And Dark Launch Checklist

**Files:**
- Modify only files changed by prior tasks if verification finds issues.

- [ ] **Step 1: Run focused backend tests**

```bash
pnpm --filter @holaday/orchestrator test -- src/partner src/trpc/routers/partner.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Run focused frontend tests**

```bash
pnpm --filter @holaday/web-workbench test -- src/lib/partner-page-state.test.ts
```

Expected: exit 0.

- [ ] **Step 3: Run typechecks**

```bash
pnpm --filter @holaday/shared-types typecheck
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
```

Expected: all exit 0.

- [ ] **Step 4: Verify existing payment isolation**

Run existing payment tests:

```bash
pnpm --filter @holaday/orchestrator test -- src/trpc/routers/payment.test.ts src/trpc/routers/admin-finance.test.ts
pnpm --filter @holaday/web-workbench test -- src/lib/plan-payment-state.test.ts src/lib/billing-page-state.test.ts
```

Expected: all exit 0. These files exist in the current repo snapshot and cover existing payment, plan payment, and billing behavior.

- [ ] **Step 5: Verify feature flag default**

Start the app in a local/dev environment with `PARTNER_LEDGER_ENABLED` unset and call:

```bash
curl -s http://localhost:3001/healthz
```

Then open the SPA and verify `/partner` either stays hidden in nav or shows the disabled message. Do not expose recharge controls while the flag is off.

- [ ] **Step 6: Commit verification fixes**

Only if Step 1-5 required small fixes limited to partner implementation files:

```bash
git add packages/shared-types/src/partner.ts packages/shared-types/src/index.ts apps/orchestrator/src/db/schema/partner.ts apps/orchestrator/src/db/schema/index.ts apps/orchestrator/src/partner apps/orchestrator/src/trpc/routers/partner.ts apps/orchestrator/src/trpc/router.ts apps/orchestrator/src/http.ts apps/web-workbench/src/lib/partner-page-state.ts apps/web-workbench/src/pages/PartnerPage.tsx apps/web-workbench/src/pages/PartnerRechargePage.tsx apps/web-workbench/src/pages/PartnerLedgerPage.tsx apps/web-workbench/src/pages/PartnerWithdrawPage.tsx apps/web-workbench/src/App.tsx apps/web-workbench/src/pages/PageShell.tsx
git commit -m "fix: harden partner ledger dark launch"
```

## Spec Coverage Checklist

- Naming and sensitive wording: Task 12 and Task 13 keep user-facing copy to HOLA Credit/API Units and avoid restricted terms.
- Independent partner entry: Task 9 adds `partner.*` router; Task 13 adds `/partner` pages separate from plan billing.
- Membership before KYC2: Task 4 implements membership lifecycle and KYC gates.
- Recharge limits and tiers: Task 1 and Task 5 implement tier math and recharge validation.
- API Units valuation: Task 1 implements `1 HOLA Credit = 1,000 API Units`; Task 6 converts `llm_calls.cost_usd` to API Units.
- Immutable lots: Task 2 adds `partner_lots`; Task 5 creates lots from captured recharge orders.
- 120-day accumulation: Task 6 calculates daily locked bonus.
- 12-month total cycle: Task 7 releases principal plus locked bonus with carry-forward after the 120-day accumulation period, across 8 monthly release windows.
- Budget constraints: Task 6 and Task 7 accept budget inputs and cap allocations/releases.
- Append-only ledger: Task 3 writes ledger entries with idempotency keys.
- KYC/risk/withdrawal: Task 4 and Task 8 implement gates, T+7/T+15, and withdrawal request lifecycle.
- Referral rewards: Task 14 grants locked HOLA Credit rewards.
- Daily activity game: Task 15 adds capped activity weight without direct credit issuance.
- Existing payment isolation: Task 10 adds a partner-specific internal confirm endpoint; Task 16 reruns existing payment/billing tests.

## Execution Notes

- Keep each task as its own commit.
- Do not combine schema, services, router, and UI into one commit.
- Keep `PARTNER_LEDGER_ENABLED=false` through backend and UI landing.
- Do not add any user-to-user transfer feature.
- Do not add copy containing "coin", "token", "investment", "guaranteed", "buyback", or "annualized yield".
- Do not modify existing subscription/add-on fulfillment except for clearly isolated imports or routes required by partner payment confirmation.
- Prefer idempotent inserts with stable keys for payment callbacks and scheduler reruns.
- Use internal IDs for FK relationships and external IDs for API responses.
- Hash KYC identity/bank fields; never store raw ID number or bank card in Holaday DB.

## Rollback Plan

- If backend behavior is risky before public launch, set `PARTNER_LEDGER_ENABLED=false`.
- If partner routes cause runtime issues, remove the `partner` router mount and redeploy without dropping data.
- If payment callback behavior is risky, disable `/internal/partner-payment/confirm` at the gateway routing layer and keep existing `/internal/payment/confirm` unchanged.
- If scheduled jobs misbehave, stop running `partner:daily` and `partner:monthly`; ledger history remains append-only for audit.
- Because all schema changes are additive, rollback should prefer feature disable over table drops.
