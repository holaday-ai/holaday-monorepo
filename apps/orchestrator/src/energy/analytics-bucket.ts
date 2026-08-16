import { createHash, createHmac } from 'node:crypto';
import type { EnergyEventInput } from './analytics-contract.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export interface NormalizedEnergyBucket {
  metricDate: string;
  bucketHash: string;
  eventType: string;
  experienceId: string;
  modeId: string;
  energyNeed: string;
  durationBucket: string;
  outcome: string;
  sectionId: string;
  targetType: string;
  sourceKind: string;
  contentId: string;
  rangeKey: string;
  taskStatus: string;
  batchCount: number;
  expiresAt: Date;
}

export interface EnergyAnalyticsConfig {
  enabled: boolean;
  hmacSecret: string;
  visitorRetentionDays: number;
  metricRetentionDays: number;
  receiptRetentionHours: number;
}

interface EnergyAnalyticsEnvSource {
  ENERGY_ANALYTICS_ENABLED: boolean;
  ENERGY_ANALYTICS_HMAC_SECRET: string;
  ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS: number;
  ENERGY_ANALYTICS_METRIC_RETENTION_DAYS: number;
  ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS: number;
}

export function utcDate(now: Date): string {
  assertValidDate(now, 'now');
  return now.toISOString().slice(0, 10);
}

export function addUtcHours(now: Date, hours: number): Date {
  assertValidDate(now, 'now');
  assertPositiveInteger(hours, 'hours');
  return new Date(now.getTime() + hours * HOUR_MS);
}

export function addUtcDaysFromDate(date: string, days: number): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('date must use YYYY-MM-DD');
  assertPositiveInteger(days, 'days');
  const start = new Date(`${date}T00:00:00.000Z`);
  assertValidDate(start, 'date');
  return new Date(start.getTime() + days * DAY_MS);
}

export function hashEnergyVisitor(secret: string, userId: string): string {
  return createHmac('sha256', secret).update(userId, 'utf8').digest('hex');
}

export function energyAnalyticsConfigFromEnv(
  source: EnergyAnalyticsEnvSource,
): EnergyAnalyticsConfig {
  return {
    enabled: source.ENERGY_ANALYTICS_ENABLED,
    hmacSecret: source.ENERGY_ANALYTICS_HMAC_SECRET,
    visitorRetentionDays: source.ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS,
    metricRetentionDays: source.ENERGY_ANALYTICS_METRIC_RETENTION_DAYS,
    receiptRetentionHours: source.ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS,
  };
}

export function normalizeEnergyBucket(
  input: EnergyEventInput,
  now: Date,
  metricRetentionDays: number,
): NormalizedEnergyBucket {
  const event = input as Record<string, unknown>;
  const metricDate = utcDate(now);
  const dimensions = {
    eventType: canonicalEventType(input.type),
    experienceId: stringDimension(event.experienceId),
    modeId: stringDimension(event.modeId ?? event.mode ?? event.testId),
    energyNeed: stringDimension(event.energyNeed),
    durationBucket: stringDimension(event.durationBucket),
    outcome: stringDimension(event.outcome),
    sectionId: stringDimension(event.section),
    targetType: stringDimension(event.targetType),
    sourceKind: stringDimension(event.fromKind),
    contentId: stringDimension(event.contentId),
    rangeKey: stringDimension(event.range),
    taskStatus: stringDimension(event.taskStatus),
    batchCount: numberDimension(event.batchCount),
  };
  const bucketHash = createHash('sha256')
    .update(JSON.stringify(dimensions), 'utf8')
    .digest('hex');

  return {
    metricDate,
    bucketHash,
    ...dimensions,
    expiresAt: addUtcDaysFromDate(metricDate, metricRetentionDays),
  };
}

function canonicalEventType(type: EnergyEventInput['type']): string {
  if (type === 'started') return 'energy_experience_started';
  if (type === 'completed') return 'energy_experience_completed';
  if (type === 'replayed') return 'energy_experience_replayed';
  if (type === 'failed') return 'energy_experience_failed';
  return type;
}

function stringDimension(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberDimension(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${field} must be a valid Date`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}
