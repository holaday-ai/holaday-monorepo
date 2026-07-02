import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import type { PartnerMembership } from '../db/schema/partner.js';
import {
  PartnerMembershipService,
  PartnerMembershipSourceConflictError,
  computeMembershipExpiry,
} from './membership-service.js';

class FakeMembershipDb {
  readonly rows: PartnerMembership[];
  readonly insertedValues: Array<Omit<PartnerMembership, 'id' | 'createdAt' | 'updatedAt'>> = [];
  readonly wherePredicateTexts: string[] = [];
  readonly orderByTexts: string[] = [];
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
        where: (predicate: unknown) => {
          const predicateText = inspect(predicate, { depth: 6, getters: true });
          this.wherePredicateTexts.push(predicateText);
          let orderByText: string | null = null;
          const chain = {
            orderBy: (...expressions: unknown[]) => {
              orderByText = expressions
                .map((expression) => inspect(expression, { depth: 6, getters: true }))
                .join('\n');
              this.orderByTexts.push(orderByText);
              return chain;
            },
            limit: async (count: number) => this.selectRows(predicateText, orderByText).slice(0, count),
            then: (
              onFulfilled?: ((value: PartnerMembership[]) => unknown) | null,
              onRejected?: ((reason: unknown) => unknown) | null,
            ) => Promise.resolve(this.selectRows(predicateText, orderByText)).then(onFulfilled, onRejected),
          };
          return chain;
        },
      }),
    };
  }

  private selectRows(predicateText: string, orderByText: string | null): PartnerMembership[] {
    let rows = [...this.rows];
    const sourcePaymentExternalIds = rows.flatMap((row) =>
      row.sourcePaymentExternalId === null ? [] : [row.sourcePaymentExternalId],
    );
    const matchingSourcePaymentExternalId = sourcePaymentExternalIds.find((sourcePaymentExternalId) =>
      predicateText.includes(sourcePaymentExternalId),
    );
    const matchingExternalId = rows
      .map((row) => row.externalId)
      .find((externalId) => predicateText.includes(externalId));

    if (matchingSourcePaymentExternalId !== undefined) {
      rows = rows.filter((row) => row.sourcePaymentExternalId === matchingSourcePaymentExternalId);
    } else if (matchingExternalId !== undefined) {
      rows = rows.filter((row) => row.externalId === matchingExternalId);
    } else if (predicateText.includes('user_id')) {
      rows = rows.filter((row) => predicateText.includes(String(row.userId)));
    }

    if (predicateText.includes('status') && predicateText.includes('active')) {
      rows = rows.filter((row) => row.status === 'active');
    }

    const [nowText] = predicateText.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/) ?? [];
    if (nowText && predicateText.includes('starts_at')) {
      const now = new Date(nowText).getTime();
      rows = rows.filter((row) => row.startsAt.getTime() <= now);
    }
    if (nowText && predicateText.includes('expires_at')) {
      const now = new Date(nowText).getTime();
      rows = rows.filter((row) => row.expiresAt.getTime() > now);
    }

    if (orderByText?.includes('expires_at')) {
      rows.sort((left, right) => right.expiresAt.getTime() - left.expiresAt.getTime());
    }

    return rows;
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

  it('adds exactly 365 days across leap-year boundaries', () => {
    expect(computeMembershipExpiry(new Date('2027-03-01T00:00:00.000Z')).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
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
    expect(fakeDb.wherePredicateTexts[0]).toContain('user_id');
    expect(fakeDb.wherePredicateTexts[0]).toContain('status');
    expect(fakeDb.wherePredicateTexts[0]).toContain('starts_at');
    expect(fakeDb.wherePredicateTexts[0]).toContain('expires_at');
    expect(fakeDb.orderByTexts[0]).toContain('expires_at');
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

  it('does not treat a future-dated active row as active', async () => {
    const fakeDb = new FakeMembershipDb([
      fakeMembership({
        userId: 123,
        status: 'active',
        startsAt: new Date('2026-07-03T00:00:00.000Z'),
        expiresAt: new Date('2027-07-03T00:00:00.000Z'),
      }),
    ]);
    const service = new PartnerMembershipService(fakeDb.asDB());

    await expect(service.getActiveMembership(123, new Date('2026-07-02T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('does not treat a row expiring exactly now as active', async () => {
    const fakeDb = new FakeMembershipDb([
      fakeMembership({
        userId: 123,
        status: 'active',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
    ]);
    const service = new PartnerMembershipService(fakeDb.asDB());

    await expect(service.getActiveMembership(123, new Date('2026-07-02T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('treats a row starting exactly now as active', async () => {
    const fakeDb = new FakeMembershipDb([
      fakeMembership({
        userId: 123,
        status: 'active',
        startsAt: new Date('2026-07-02T00:00:00.000Z'),
        expiresAt: new Date('2027-07-02T00:00:00.000Z'),
      }),
    ]);
    const service = new PartnerMembershipService(fakeDb.asDB());

    const membership = await service.getActiveMembership(123, new Date('2026-07-02T00:00:00.000Z'));

    expect(membership?.id).toBe(1);
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
    expect(fakeDb.wherePredicateTexts.some((predicateText) => predicateText.includes('source_payment_external_id'))).toBe(
      true,
    );
  });

  it('returns an existing membership for the same source payment and same user without inserting', async () => {
    const existing = fakeMembership({
      userId: 123,
      sourcePaymentExternalId: 'pay_source',
      metadata: { original: true },
    });
    const fakeDb = new FakeMembershipDb([existing]);
    const service = new PartnerMembershipService(fakeDb.asDB());

    const membership = await service.activate({
      userId: 123,
      sourcePaymentExternalId: 'pay_source',
      now: new Date('2026-07-02T00:00:00.000Z'),
    });

    expect(membership).toBe(existing);
    expect(fakeDb.insertedValues).toHaveLength(0);
    expect(fakeDb.wherePredicateTexts[0]).toContain('source_payment_external_id');
  });

  it('throws a source conflict for the same source payment and a different user', async () => {
    const fakeDb = new FakeMembershipDb([
      fakeMembership({
        userId: 999,
        sourcePaymentExternalId: 'pay_source',
      }),
    ]);
    const service = new PartnerMembershipService(fakeDb.asDB());

    await expect(
      service.activate({
        userId: 123,
        sourcePaymentExternalId: 'pay_source',
        now: new Date('2026-07-02T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(PartnerMembershipSourceConflictError);
    expect(fakeDb.insertedValues).toHaveLength(0);
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
    await expect(
      service.activate({
        userId: 123,
        sourcePaymentExternalId: '   ',
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
