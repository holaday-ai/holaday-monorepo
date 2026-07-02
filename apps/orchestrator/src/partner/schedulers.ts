import { API_UNITS_PER_HOLA_CREDIT, HOLA_CREDIT_CNY_CENTS } from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import type { ApiCostPoolEvent } from '../db/schema/partner.js';
import { AllocationService, type DailyLockedBonusSummary } from './allocation-service.js';
import { partnerConfig } from './partner-config.js';
import { ReleaseService, type MonthlyReleaseSummary } from './release-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PartnerAllocationService = Pick<
  AllocationService,
  'buildDailyCostPool' | 'allocateDailyLockedBonus'
>;

export type PartnerReleaseService = Pick<ReleaseService, 'releaseEligibleLots'>;

export interface RunPartnerDailyJobsInput {
  db?: DB;
  day?: string;
  fxBps?: number;
  allocationBudgetCreditCents?: number;
  now?: Date;
  allocationService?: PartnerAllocationService;
}

export interface RunPartnerMonthlyReleaseInput {
  db?: DB;
  releaseMonth?: string;
  budgetCreditCents?: number;
  now?: Date;
  releaseService?: PartnerReleaseService;
}

export interface PartnerCostPoolSummary {
  id: number;
  externalId: string;
  eventDate: string;
  source: string;
  costUsdMicros: number;
  fxBps: number;
  apiUnits: number;
  idempotencyKey: string;
}

export interface PartnerDailyJobSummary {
  day: string;
  fxBps: number;
  costPool: PartnerCostPoolSummary;
  allocationBudgetCreditCents: number;
  allocation: DailyLockedBonusSummary;
}

export interface PartnerMonthlyReleaseJobSummary {
  releaseMonth: string;
  budgetCreditCents: number;
  release: MonthlyReleaseSummary;
}

function assertDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatUtcDay(value: Date): string {
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

function formatUtcMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}`;
}

function defaultPreviousUtcDay(now: Date): string {
  const normalizedNow = assertDate(now, 'now');
  return formatUtcDay(new Date(normalizedNow.getTime() - DAY_MS));
}

function defaultPreviousUtcMonth(now: Date): string {
  const normalizedNow = assertDate(now, 'now');
  return formatUtcMonth(new Date(Date.UTC(normalizedNow.getUTCFullYear(), normalizedNow.getUTCMonth() - 1, 1)));
}

function parseYearMonthDay(value: string, fieldName: string): { year: number; month: number; day: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${fieldName} must be YYYY-MM-DD`);
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || year < 1000) {
    throw new RangeError(`${fieldName} must be a valid calendar date`);
  }

  return { year, month, day };
}

export function normalizePartnerDailyDay(value: string): string {
  const { year, month, day } = parseYearMonthDay(value, 'day');
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError('day must be a valid calendar date');
  }

  return value;
}

export function normalizePartnerReleaseMonth(value: string): string {
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

function assertNonNegativeSafeInteger(value: number | undefined, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function assertPositiveSafeInteger(value: number | undefined, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function toSafeInteger(value: bigint, fieldName: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${fieldName} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

function deriveAllocationBudgetCreditCents(apiUnits: number): number {
  const safeApiUnits = BigInt(assertNonNegativeSafeInteger(apiUnits, 'apiUnits'));
  return toSafeInteger(
    (safeApiUnits * BigInt(HOLA_CREDIT_CNY_CENTS)) / BigInt(API_UNITS_PER_HOLA_CREDIT),
    'allocationBudgetCreditCents',
  );
}

function summarizeCostPool(costPool: ApiCostPoolEvent): PartnerCostPoolSummary {
  return {
    id: costPool.id,
    externalId: costPool.externalId,
    eventDate: costPool.eventDate,
    source: costPool.source,
    costUsdMicros: costPool.costUsdMicros,
    fxBps: costPool.fxBps,
    apiUnits: costPool.apiUnits,
    idempotencyKey: costPool.idempotencyKey,
  };
}

function allocationServiceFor(input: RunPartnerDailyJobsInput): PartnerAllocationService {
  if (input.allocationService) return input.allocationService;
  if (!input.db) throw new RangeError('db is required when allocationService is omitted');
  return new AllocationService(input.db);
}

function releaseServiceFor(input: RunPartnerMonthlyReleaseInput): PartnerReleaseService {
  if (input.releaseService) return input.releaseService;
  if (!input.db) throw new RangeError('db is required when releaseService is omitted');
  return new ReleaseService(input.db);
}

export async function runPartnerDailyJobs(input: RunPartnerDailyJobsInput = {}): Promise<PartnerDailyJobSummary> {
  const day = normalizePartnerDailyDay(input.day ?? defaultPreviousUtcDay(input.now ?? new Date()));
  const fxBps = assertPositiveSafeInteger(input.fxBps ?? partnerConfig().fxBps, 'fxBps');
  const explicitAllocationBudgetCreditCents =
    input.allocationBudgetCreditCents === undefined
      ? undefined
      : assertNonNegativeSafeInteger(input.allocationBudgetCreditCents, 'allocationBudgetCreditCents');
  const allocationService = allocationServiceFor(input);

  const costPool = await allocationService.buildDailyCostPool({ day, fxBps });
  const allocationBudgetCreditCents =
    explicitAllocationBudgetCreditCents === undefined
      ? deriveAllocationBudgetCreditCents(costPool.apiUnits)
      : explicitAllocationBudgetCreditCents;
  const allocation = await allocationService.allocateDailyLockedBonus({
    day,
    budgetCreditCents: allocationBudgetCreditCents,
  });

  return {
    day,
    fxBps,
    costPool: summarizeCostPool(costPool),
    allocationBudgetCreditCents,
    allocation,
  };
}

export async function runPartnerMonthlyRelease(
  input: RunPartnerMonthlyReleaseInput = {},
): Promise<PartnerMonthlyReleaseJobSummary> {
  const releaseMonth = normalizePartnerReleaseMonth(
    input.releaseMonth ?? defaultPreviousUtcMonth(input.now ?? new Date()),
  );
  if (input.budgetCreditCents === undefined) {
    throw new RangeError('budgetCreditCents is required');
  }
  const budgetCreditCents = assertNonNegativeSafeInteger(input.budgetCreditCents, 'budgetCreditCents');
  const releaseService = releaseServiceFor(input);
  const release = await releaseService.releaseEligibleLots({ releaseMonth, budgetCreditCents });

  return {
    releaseMonth,
    budgetCreditCents,
    release,
  };
}
