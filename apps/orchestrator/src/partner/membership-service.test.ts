import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import type { PartnerMembership } from '../db/schema/partner.js';
import { PartnerMembershipService, computeMembershipExpiry } from './membership-service.js';

class FakeMembershipDb {
  readonly rows: PartnerMembership[];
  readonly insertedValues: Array<Omit<PartnerMembership, 'id' | 'createdAt' | 'updatedAt'>> = [];
  private nextId: number;

  constructor(rows: PartnerMembership[] = []) {
    this.rows = [...rows];
    this.nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  insert(_table: unknown) {
    return {
      values: async (values: Omit<PartnerMembership, 'id' | 'createdAt' | 'updatedAt'>) => {
        this.insertedValues.push(values);
        this.rows.push({
          id: this.nextId,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          ...values,
        });
        this.nextId += 1;
      },
    };
  }

  select(_selection?: unknown) {
    return {
      from: (_table: unknown) => ({
        where: async (_predicate: unknown) => this.rows,
      }),
    };
  }
}

function fakeMembership(overrides: Partial<PartnerMembership> = {}): PartnerMembership {
  return {
    id: 1,
    externalId: 'pay_existing',
    userId: 123,
    status: 'active',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    sourcePaymentExternalId: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('computeMembershipExpiry', () => {
  it('adds 365 days in UTC', () => {
    expect(computeMembershipExpiry(new Date('2026-07-02T00:00:00.000Z')).toISOString()).toBe(
      '2027-07-02T00:00:00.000Z',
    );
  });

  it('does not mutate the original Date', () => {
    const startsAt = new Date('2026-07-02T00:00:00.000Z');

    computeMembershipExpiry(startsAt);

    expect(startsAt.toISOString()).toBe('2026-07-02T00:00:00.000Z');
  });
});

describe('PartnerMembershipService', () => {
  it('returns the active membership with the latest expiry', async () => {
    const fakeDb = new FakeMembershipDb([
      fakeMembership({
        id: 1,
        userId: 123,
        status: 'active',
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
      fakeMembership({
        id: 2,
        userId: 123,
        status: 'cancelled',
        expiresAt: new Date('2027-12-01T00:00:00.000Z'),
      }),
      fakeMembership({
        id: 3,
        userId: 123,
        status: 'active',
        expiresAt: new Date('2027-07-02T00:00:00.000Z'),
      }),
      fakeMembership({
        id: 4,
        userId: 123,
        status: 'active',
        expiresAt: new Date('2027-08-02T00:00:00.000Z'),
      }),
      fakeMembership({
        id: 5,
        userId: 999,
        status: 'active',
        expiresAt: new Date('2028-01-01T00:00:00.000Z'),
      }),
    ]);
    const service = new PartnerMembershipService(fakeDb.asDB());

    const membership = await service.getActiveMembership(123, new Date('2026-07-02T00:00:00.000Z'));

    expect(membership?.id).toBe(4);
  });

  it('returns null when the user has no active non-expired membership', async () => {
    const fakeDb = new FakeMembershipDb([
      fakeMembership({
        userId: 123,
        status: 'expired',
        expiresAt: new Date('2027-07-02T00:00:00.000Z'),
      }),
    ]);
    const service = new PartnerMembershipService(fakeDb.asDB());

    await expect(service.getActiveMembership(123, new Date('2026-07-02T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('activates a one-year membership from the provided start time', async () => {
    const fakeDb = new FakeMembershipDb();
    const service = new PartnerMembershipService(fakeDb.asDB());
    const now = new Date('2026-07-02T00:00:00.000Z');

    const membership = await service.activate({
      userId: 123,
      sourcePaymentExternalId: 'pay_source',
      now,
    });

    expect(membership).toMatchObject({
      userId: 123,
      status: 'active',
      startsAt: now,
      expiresAt: new Date('2027-07-02T00:00:00.000Z'),
      sourcePaymentExternalId: 'pay_source',
      metadata: null,
    });
    expect(membership.externalId).toMatch(/^pay_/);
    expect(fakeDb.insertedValues).toHaveLength(1);
  });

  it('rejects invalid public inputs', async () => {
    const service = new PartnerMembershipService(new FakeMembershipDb().asDB());

    await expect(service.getActiveMembership(0)).rejects.toBeInstanceOf(RangeError);
    await expect(
      service.activate({
        userId: 123,
        now: new Date(Number.NaN),
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
