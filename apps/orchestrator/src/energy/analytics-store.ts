import { sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  energyDailyMetrics,
  energyDailyVisitors,
  energyEventReceipts,
} from '../db/schema/energy-analytics.js';
import type { NormalizedEnergyBucket } from './analytics-bucket.js';

export interface EnergyAnalyticsTransaction {
  claimReceipt(eventId: string, expiresAt: Date): Promise<boolean>;
  incrementMetric(bucket: NormalizedEnergyBucket): Promise<void>;
  insertVisitor(activityDate: string, visitorHash: string, expiresAt: Date): Promise<boolean>;
}

export interface EnergyAnalyticsStore {
  transaction<T>(callback: (tx: EnergyAnalyticsTransaction) => Promise<T>): Promise<T>;
}

type DBTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

function createTransaction(tx: DBTransaction): EnergyAnalyticsTransaction {
  return {
    async claimReceipt(eventId, expiresAt) {
      try {
        await tx.insert(energyEventReceipts).values({ eventId, expiresAt });
        return true;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },

    async incrementMetric(bucket) {
      await tx
        .insert(energyDailyMetrics)
        .values({ ...bucket, eventCount: 1 })
        .onDuplicateKeyUpdate({
          set: {
            eventCount: sql`${energyDailyMetrics.eventCount} + 1`,
            updatedAt: new Date(),
          },
        });
    },

    async insertVisitor(activityDate, visitorHash, expiresAt) {
      try {
        await tx.insert(energyDailyVisitors).values({ activityDate, visitorHash, expiresAt });
        return true;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },
  };
}

export function createEnergyAnalyticsStore(database: DB): EnergyAnalyticsStore {
  return {
    transaction: (callback) => database.transaction((tx) => callback(createTransaction(tx))),
  };
}
