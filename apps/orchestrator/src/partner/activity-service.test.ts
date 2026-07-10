import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { partnerActivityEvents, type PartnerActivityEvent } from '../db/schema/partner.js';
import { calculateActivityFactorBps, PartnerActivityService } from './activity-service.js';

type FakeActivityInsert = Omit<PartnerActivityEvent, 'id' | 'createdAt'>;

class FakeActivityDb {
  readonly rows: PartnerActivityEvent[];
  readonly insertAttempts: FakeActivityInsert[] = [];
  private nextId: number;

  constructor(rows: PartnerActivityEvent[] = []) {
    this.rows = [...rows];
    this.nextId = Math.max(0, ...this.rows.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  insert(table: unknown) {
    return {
      values: (values: FakeActivityInsert) => {
        if (table !== partnerActivityEvents) {
          throw new Error('unexpected insert table');
        }
        this.insertAttempts.push(values);
        return {
          onDuplicateKeyUpdate: async (_config: unknown) => {
            const existing = this.rows.find(
              (row) =>
                row.idempotencyKey === values.idempotencyKey ||
                (row.userId === values.userId &&
                  row.activityDate === values.activityDate &&
                  row.eventType === values.eventType),
            );
            if (existing) return;
            this.rows.push({
              id: this.nextId,
              createdAt: new Date('2026-07-03T00:00:00.000Z'),
              ...values,
            });
            this.nextId += 1;
          },
        };
      },
    };
  }

  select() {
    return {
      from: (table: unknown) => ({
        where: async (_predicate: unknown) => {
          if (table !== partnerActivityEvents) return [];
          return [...this.rows];
        },
      }),
    };
  }
}

function fakeActivity(overrides: Partial<PartnerActivityEvent> = {}): PartnerActivityEvent {
  return {
    id: 1,
    externalId: 'payment_activity_1',
    userId: 123,
    activityDate: '2026-07-01',
    eventType: 'daily_checkin',
    points: 1,
    idempotencyKey: 'activity:daily_checkin:123:2026-07-01',
    metadata: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('partner activity service rules', () => {
  it('keeps inactive users at 1.00x', () => {
    expect(calculateActivityFactorBps({ loginDays: 0, completedTasks: 0, validInvites: 0 })).toBe(10_000);
  });

  it('caps activity boost at 1.10x', () => {
    expect(calculateActivityFactorBps({ loginDays: 7, completedTasks: 20, validInvites: 5 })).toBe(11_000);
  });

  it('uses activity as weight only, not direct credit issuance', () => {
    expect(calculateActivityFactorBps({ loginDays: 1, completedTasks: 1, validInvites: 0 })).toBe(10_200);
  });

  it('normalizes malformed activity inputs conservatively', () => {
    expect(calculateActivityFactorBps({ loginDays: -1, completedTasks: 1.5, validInvites: Number.NaN })).toBe(10_000);
  });
});

describe('PartnerActivityService daily check-in', () => {
  it('records one daily check-in per user/day without creating credit', async () => {
    const db = new FakeActivityDb();
    const service = new PartnerActivityService(db.asDB());

    const first = await service.recordDailyCheckIn({
      userId: 123,
      now: new Date('2026-07-03T12:34:56.000Z'),
    });
    const second = await service.recordDailyCheckIn({
      userId: 123,
      now: new Date('2026-07-03T23:59:59.000Z'),
    });

    expect(first).toMatchObject({
      userId: 123,
      activityDate: '2026-07-03',
      eventType: 'daily_checkin',
      points: 1,
      idempotencyKey: 'activity:daily_checkin:123:2026-07-03',
      metadata: {
        checkedInAt: '2026-07-03T12:34:56.000Z',
        directCreditCents: 0,
      },
    });
    expect(second).toBe(first);
    expect(db.rows).toHaveLength(1);
    expect(db.insertAttempts).toHaveLength(2);
  });

  it('calculates login activity from recent distinct check-in days', async () => {
    const db = new FakeActivityDb([
      fakeActivity({ id: 1, activityDate: '2026-06-26', idempotencyKey: 'old' }),
      fakeActivity({ id: 2, activityDate: '2026-07-01', idempotencyKey: 'd1' }),
      fakeActivity({ id: 3, activityDate: '2026-07-02', idempotencyKey: 'd2' }),
      fakeActivity({ id: 4, activityDate: '2026-07-03', idempotencyKey: 'd3' }),
      fakeActivity({ id: 5, userId: 456, activityDate: '2026-07-03', idempotencyKey: 'other-user' }),
    ]);
    const service = new PartnerActivityService(db.asDB());

    await expect(service.getActivitySummary(123, new Date('2026-07-03T04:00:00.000Z'))).resolves.toMatchObject({
      activityDate: '2026-07-03',
      checkedInToday: true,
      loginDays: 3,
      completedTasks: 0,
      validInvites: 0,
      activityFactorBps: 10_300,
    });
    await expect(service.getActivityFactorBps(123, new Date('2026-07-03T04:00:00.000Z'))).resolves.toBe(10_300);
  });
});
