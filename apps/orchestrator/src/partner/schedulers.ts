import { API_UNITS_PER_HOLA_CREDIT, HOLA_CREDIT_CNY_CENTS } from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import type { ApiCostPoolEvent } from '../db/schema/partner.js';
import { AllocationService, type DailyLockedBonusSummary } from './allocation-service.js';
import { assertPartnerLedgerWriteEnabled, partnerConfig } from './partner-config.js';
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

export type PartnerSchedulerCliEnv = Partial<Record<string, string>>;

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

function parseIntegerCliValue(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^-?\d+$/.test(value)) {
    throw new RangeError(`${fieldName} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${fieldName} must be an integer`);
  }
  return parsed;
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

function envValue(env: PartnerSchedulerCliEnv, name: string): string | undefined {
  const value = env[name];
  return value === '' ? undefined : value;
}

function parseCliFlags(args: readonly string[], allowedFlags: readonly string[]): Map<string, string> {
  const allowed = new Set(allowedFlags);
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) {
      throw new RangeError(`Unexpected positional argument: ${arg}`);
    }

    const flagBody = arg.slice(2);
    if (flagBody === '') {
      throw new RangeError('Unexpected empty flag');
    }

    const equalsIndex = flagBody.indexOf('=');
    const flagName = equalsIndex === -1 ? flagBody : flagBody.slice(0, equalsIndex);
    if (!allowed.has(flagName)) {
      throw new RangeError(`Unknown flag: --${flagName}`);
    }
    if (values.has(flagName)) {
      throw new RangeError(`Duplicate flag: --${flagName}`);
    }

    if (equalsIndex !== -1) {
      values.set(flagName, flagBody.slice(equalsIndex + 1));
      continue;
    }

    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new RangeError(`Missing value for --${flagName}`);
    }

    values.set(flagName, next);
    index += 1;
  }

  return values;
}

export function parsePartnerDailyCliArgs(
  args: readonly string[],
  env: PartnerSchedulerCliEnv = process.env,
): Pick<RunPartnerDailyJobsInput, 'day' | 'fxBps' | 'allocationBudgetCreditCents'> {
  const flags = parseCliFlags(args, ['day', 'fx-bps', 'allocation-budget-credit-cents']);
  const day = flags.get('day') ?? envValue(env, 'PARTNER_DAILY_DAY');
  const fxBps = parseIntegerCliValue(flags.get('fx-bps') ?? envValue(env, 'PARTNER_FX_BPS'), 'fxBps');
  const allocationBudgetCreditCents = parseIntegerCliValue(
    flags.get('allocation-budget-credit-cents') ??
      envValue(env, 'PARTNER_DAILY_ALLOCATION_BUDGET_CREDIT_CENTS'),
    'allocationBudgetCreditCents',
  );

  return {
    ...(day === undefined ? {} : { day }),
    ...(fxBps === undefined ? {} : { fxBps }),
    ...(allocationBudgetCreditCents === undefined ? {} : { allocationBudgetCreditCents }),
  };
}

export function parsePartnerMonthlyCliArgs(
  args: readonly string[],
  env: PartnerSchedulerCliEnv = process.env,
): Pick<RunPartnerMonthlyReleaseInput, 'releaseMonth' | 'budgetCreditCents'> {
  const flags = parseCliFlags(args, ['release-month', 'budget-credit-cents']);
  const releaseMonth = flags.get('release-month') ?? envValue(env, 'PARTNER_RELEASE_MONTH');
  const budgetCreditCents = parseIntegerCliValue(
    flags.get('budget-credit-cents') ?? envValue(env, 'PARTNER_MONTHLY_RELEASE_BUDGET_CREDIT_CENTS'),
    'budgetCreditCents',
  );

  return {
    ...(releaseMonth === undefined ? {} : { releaseMonth }),
    ...(budgetCreditCents === undefined ? {} : { budgetCreditCents }),
  };
}

export async function runPartnerDailyJobs(input: RunPartnerDailyJobsInput = {}): Promise<PartnerDailyJobSummary> {
  assertPartnerLedgerWriteEnabled();
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
  assertPartnerLedgerWriteEnabled();
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
