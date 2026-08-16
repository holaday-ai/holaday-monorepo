import {
  type EnergyAnalyticsConfig,
  addUtcDaysFromDate,
  addUtcHours,
  hashEnergyVisitor,
  normalizeEnergyBucket,
  utcDate,
} from './analytics-bucket.js';
import type { EnergyEventInput } from './analytics-contract.js';
import type { EnergyAnalyticsStore } from './analytics-store.js';

interface AnalyticsLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface RecordEnergyEventOptions {
  store: EnergyAnalyticsStore;
  input: EnergyEventInput;
  userId: string;
  now?: Date;
  config: EnergyAnalyticsConfig;
  logger: AnalyticsLogger;
}

export interface RecordEnergyEventResult {
  ok: true;
  duplicate: boolean;
  visitorRecorded: boolean;
}

let missingVisitorSecretWarningEmitted = false;

export async function recordEnergyEvent({
  store,
  input,
  userId,
  now = new Date(),
  config,
  logger,
}: RecordEnergyEventOptions): Promise<RecordEnergyEventResult> {
  if (!config.enabled) {
    return { ok: true, duplicate: false, visitorRecorded: false };
  }

  const metricDate = utcDate(now);
  const bucket = normalizeEnergyBucket(input, now, config.metricRetentionDays);
  let visitorHash: string | undefined;

  if (input.type === 'energy_home_viewed') {
    if (config.hmacSecret) {
      visitorHash = hashEnergyVisitor(config.hmacSecret, userId);
    } else if (!missingVisitorSecretWarningEmitted) {
      missingVisitorSecretWarningEmitted = true;
      logger.warn(
        { feature: 'energy_analytics_visitors' },
        'energy analytics visitor HMAC secret missing; visitor metrics skipped',
      );
    }
  }

  return store.transaction(async (tx) => {
    if (input.eventId) {
      const claimed = await tx.claimReceipt(
        input.eventId,
        addUtcHours(now, config.receiptRetentionHours),
      );
      if (!claimed) {
        return { ok: true, duplicate: true, visitorRecorded: false };
      }
    }

    await tx.incrementMetric(bucket);
    const visitorRecorded = visitorHash
      ? await tx.insertVisitor(
          metricDate,
          visitorHash,
          addUtcDaysFromDate(metricDate, config.visitorRetentionDays),
        )
      : false;

    return { ok: true, duplicate: false, visitorRecorded };
  });
}
