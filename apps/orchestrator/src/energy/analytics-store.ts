import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
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

export interface EnergyMetricReadRow {
  metricDate: string;
  eventType: string;
  experienceId: string;
  eventCount: number;
}

export interface EnergyDailyAudienceRow {
  activityDate: string;
  dau: number;
  d1Returning: number;
}

export interface EnergyAnalyticsReadStore {
  readMetricRows(startDate: string, endDate: string): Promise<EnergyMetricReadRow[]>;
  readDailyAudience(startDate: string, endDate: string): Promise<EnergyDailyAudienceRow[]>;
}

export interface EnergyAnalyticsDatabaseStore
  extends EnergyAnalyticsStore,
    EnergyAnalyticsReadStore {}

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

export function createEnergyAnalyticsStore(database: DB): EnergyAnalyticsDatabaseStore {
  return {
    transaction: (callback) => database.transaction((tx) => callback(createTransaction(tx))),

    async readMetricRows(startDate, endDate) {
      const rows = await database
        .select({
          metricDate: energyDailyMetrics.metricDate,
          eventType: energyDailyMetrics.eventType,
          experienceId: energyDailyMetrics.experienceId,
          eventCount: energyDailyMetrics.eventCount,
        })
        .from(energyDailyMetrics)
        .where(
          and(
            gte(energyDailyMetrics.metricDate, startDate),
            lte(energyDailyMetrics.metricDate, endDate),
          ),
        );
      return rows.map((row) => ({ ...row, eventCount: Number(row.eventCount) }));
    },

    async readDailyAudience(startDate, endDate) {
      const nextVisitor = alias(energyDailyVisitors, 'next_energy_daily_visitors');
      const rows = await database
        .select({
          activityDate: energyDailyVisitors.activityDate,
          dau: sql<number>`COUNT(${energyDailyVisitors.id})`,
          d1Returning: sql<number>`COUNT(${nextVisitor.id})`,
        })
        .from(energyDailyVisitors)
        .leftJoin(
          nextVisitor,
          and(
            eq(nextVisitor.visitorHash, energyDailyVisitors.visitorHash),
            sql`${nextVisitor.activityDate} = DATE_ADD(${energyDailyVisitors.activityDate}, INTERVAL 1 DAY)`,
          ),
        )
        .where(
          and(
            gte(energyDailyVisitors.activityDate, startDate),
            lte(energyDailyVisitors.activityDate, endDate),
          ),
        )
        .groupBy(energyDailyVisitors.activityDate);
      return rows.map((row) => ({
        activityDate: row.activityDate,
        dau: Number(row.dau),
        d1Returning: Number(row.d1Returning),
      }));
    },
  };
}
