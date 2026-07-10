import { newExternalId } from '@holaday/shared-types';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerActivityEvents, type PartnerActivityEvent } from '../db/schema/partner.js';

const ACTIVITY_BASE_FACTOR_BPS = 10_000;
const ACTIVITY_MAX_FACTOR_BPS = 11_000;
const DAILY_CHECKIN_EVENT_TYPE = 'daily_checkin';
const ACTIVITY_LOOKBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeActivityCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function assertPositiveSafeInteger(value: number, fieldName: string): number {
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

function dayStringUtc(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(day: string, days: number): string {
  const start = new Date(`${day}T00:00:00.000Z`);
  return dayStringUtc(new Date(start.getTime() + days * DAY_MS));
}

function filterDailyCheckIns(input: {
  rows: readonly PartnerActivityEvent[];
  userId: number;
  startDay: string;
  endDay: string;
}): PartnerActivityEvent[] {
  return input.rows.filter(
    (row) =>
      row.userId === input.userId &&
      row.eventType === DAILY_CHECKIN_EVENT_TYPE &&
      row.activityDate >= input.startDay &&
      row.activityDate <= input.endDay,
  );
}

export function calculateActivityFactorBps(input: {
  loginDays: number;
  completedTasks: number;
  validInvites: number;
}): number {
  const loginDays = normalizeActivityCount(input.loginDays);
  const completedTasks = normalizeActivityCount(input.completedTasks);
  const validInvites = normalizeActivityCount(input.validInvites);
  const loginBoost = Math.min(300, loginDays * 100);
  const taskBoost = Math.min(400, completedTasks * 100);
  const inviteBoost = Math.min(300, validInvites * 300);
  return Math.min(ACTIVITY_MAX_FACTOR_BPS, ACTIVITY_BASE_FACTOR_BPS + loginBoost + taskBoost + inviteBoost);
}

export interface PartnerActivitySummary {
  activityDate: string;
  checkedInToday: boolean;
  loginDays: number;
  completedTasks: number;
  validInvites: number;
  activityFactorBps: number;
}

export class PartnerActivityService {
  constructor(private readonly db?: DB) {}

  private async readDailyCheckIn(userId: number, activityDate: string): Promise<PartnerActivityEvent | undefined> {
    if (!this.db) return undefined;

    const rows = await this.db
      .select()
      .from(partnerActivityEvents)
      .where(
        and(
          eq(partnerActivityEvents.userId, userId),
          eq(partnerActivityEvents.activityDate, activityDate),
          eq(partnerActivityEvents.eventType, DAILY_CHECKIN_EVENT_TYPE),
        ),
      );

    return filterDailyCheckIns({
      rows,
      userId,
      startDay: activityDate,
      endDay: activityDate,
    })[0];
  }

  async recordDailyCheckIn(input: { userId: number; now?: Date }): Promise<PartnerActivityEvent> {
    if (!this.db) {
      throw new RangeError('db is required to record partner activity');
    }

    const userId = assertPositiveSafeInteger(input.userId, 'userId');
    const now = normalizeDate(input.now ?? new Date(), 'now');
    const activityDate = dayStringUtc(now);
    const idempotencyKey = `activity:daily_checkin:${userId}:${activityDate}`;

    await this.db
      .insert(partnerActivityEvents)
      .values({
        externalId: newExternalId('payment'),
        userId,
        activityDate,
        eventType: DAILY_CHECKIN_EVENT_TYPE,
        points: 1,
        idempotencyKey,
        metadata: {
          checkedInAt: now.toISOString(),
          directCreditCents: 0,
        },
      })
      .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

    const row = await this.readDailyCheckIn(userId, activityDate);
    if (!row) {
      throw new Error('partner activity event vanished after idempotent insert');
    }
    return row;
  }

  async getActivitySummary(userId: number, at: Date = new Date()): Promise<PartnerActivitySummary> {
    const normalizedUserId = assertPositiveSafeInteger(userId, 'userId');
    const now = normalizeDate(at, 'at');
    const activityDate = dayStringUtc(now);

    if (!this.db) {
      return {
        activityDate,
        checkedInToday: false,
        loginDays: 0,
        completedTasks: 0,
        validInvites: 0,
        activityFactorBps: ACTIVITY_BASE_FACTOR_BPS,
      };
    }

    const startDay = addUtcDays(activityDate, -(ACTIVITY_LOOKBACK_DAYS - 1));
    const rows = await this.db
      .select()
      .from(partnerActivityEvents)
      .where(
        and(
          eq(partnerActivityEvents.userId, normalizedUserId),
          eq(partnerActivityEvents.eventType, DAILY_CHECKIN_EVENT_TYPE),
          gte(partnerActivityEvents.activityDate, startDay),
          lte(partnerActivityEvents.activityDate, activityDate),
        ),
      );
    const recentRows = filterDailyCheckIns({
      rows,
      userId: normalizedUserId,
      startDay,
      endDay: activityDate,
    });
    const loginDays = new Set(recentRows.map((row) => row.activityDate)).size;
    const checkedInToday = recentRows.some((row) => row.activityDate === activityDate);
    const completedTasks = 0;
    const validInvites = 0;

    return {
      activityDate,
      checkedInToday,
      loginDays,
      completedTasks,
      validInvites,
      activityFactorBps: calculateActivityFactorBps({
        loginDays,
        completedTasks,
        validInvites,
      }),
    };
  }

  async getActivityFactorBps(userId: number, at: Date): Promise<number> {
    return (await this.getActivitySummary(userId, at)).activityFactorBps;
  }
}
