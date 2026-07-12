import { readFile } from 'node:fs/promises';
import { getTableConfig, type MySqlTable } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import {
  apiCostPoolEvents,
  holaCreditLedgerEntries,
  partnerDailyAllocations,
  partnerActivityEvents,
  partnerKycProfiles,
  partnerLots,
  partnerMemberships,
  partnerMonthlyReleases,
  partnerRechargeOrders,
  partnerReferrals,
  partnerRiskEvents,
  partnerWithdrawalRequests,
} from '../db/schema/partner.js';
import { partnerDailyAllocations as indexedPartnerDailyAllocations } from '../db/schema/index.js';

function indexConfig(table: MySqlTable, name: string) {
  return getTableConfig(table).indexes.find((idx) => idx.config.name === name)?.config;
}

describe('partner schema contract', () => {
  it('exports partner ledger tables', () => {
    expect(apiCostPoolEvents).toBeDefined();
    expect(holaCreditLedgerEntries).toBeDefined();
    expect(partnerKycProfiles).toBeDefined();
    expect(partnerLots).toBeDefined();
    expect(partnerMemberships).toBeDefined();
    expect(partnerRechargeOrders).toBeDefined();
    expect(partnerWithdrawalRequests).toBeDefined();
  });

  it('exports companion partner tables', () => {
    expect(partnerRiskEvents).toBeDefined();
    expect(partnerReferrals).toBeDefined();
    expect(partnerActivityEvents).toBeDefined();
    expect(partnerDailyAllocations).toBeDefined();
    expect(partnerMonthlyReleases).toBeDefined();
  });

  it('exports partner tables from the schema barrel', () => {
    expect(indexedPartnerDailyAllocations).toBe(partnerDailyAllocations);
  });

  it('pins partner uniqueness indexes', () => {
    expect(indexConfig(partnerActivityEvents, 'uk_partner_activity_events_user_day_type')?.unique).toBe(true);
    expect(indexConfig(partnerDailyAllocations, 'uk_partner_daily_allocations_lot_date')?.unique).toBe(true);
    expect(indexConfig(partnerLots, 'uk_partner_lots_recharge_order')?.unique).toBe(true);
    expect(indexConfig(partnerMonthlyReleases, 'uk_partner_monthly_releases_lot_month')?.unique).toBe(true);
    expect(indexConfig(partnerRechargeOrders, 'uk_partner_recharge_orders_provider_capture')?.unique).toBe(true);
    expect(indexConfig(partnerWithdrawalRequests, 'uk_partner_withdrawal_requests_idempotency_key')?.unique).toBe(
      true,
    );
  });

  it('keeps the partner ledger migration additive', async () => {
    const migration = await readFile(new URL('../../drizzle/0039_partner_ledger.sql', import.meta.url), 'utf8');

    expect(migration.match(/\bCREATE TABLE\b/g)).toHaveLength(11);
    expect(migration).toContain('uk_partner_daily_allocations_lot_date');
    expect(migration).toContain('uk_partner_lots_recharge_order');
    expect(migration).toContain('uk_partner_monthly_releases_lot_month');
    expect(migration).toContain('`idempotency_key` VARCHAR(128) NOT NULL');
    expect(migration).toContain('uk_partner_withdrawal_requests_idempotency_key');
    expect(migration).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/^\s*UPDATE\b/im);
    expect(migration).not.toMatch(/^\s*DELETE\b/im);
  });

  it('keeps the partner activity migration additive', async () => {
    const migration = await readFile(new URL('../../drizzle/0040_partner_activity_events.sql', import.meta.url), 'utf8');

    expect(migration.match(/\bCREATE TABLE\b/g)).toHaveLength(1);
    expect(migration).toContain('partner_activity_events');
    expect(migration).toContain('uk_partner_activity_events_user_day_type');
    expect(migration).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/^\s*UPDATE\b/im);
    expect(migration).not.toMatch(/^\s*DELETE\b/im);
  });
});
