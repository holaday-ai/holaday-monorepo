import { existsSync, readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, type MySqlTable } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

function exportedTable(name: string): MySqlTable | undefined {
  return (schema as Record<string, unknown>)[name] as MySqlTable | undefined;
}

function indexNames(table: MySqlTable): string[] {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe('energy analytics schema', () => {
  it('stores aggregate buckets without identity or payload columns', () => {
    const table = exportedTable('energyDailyMetrics');
    expect(table).toBeDefined();
    if (!table) return;

    const columns = Object.keys(getTableColumns(table));
    expect(columns).toEqual([
      'id',
      'metricDate',
      'bucketHash',
      'eventType',
      'experienceId',
      'modeId',
      'energyNeed',
      'durationBucket',
      'outcome',
      'sectionId',
      'targetType',
      'sourceKind',
      'contentId',
      'rangeKey',
      'taskStatus',
      'batchCount',
      'eventCount',
      'expiresAt',
      'createdAt',
      'updatedAt',
    ]);
    expect(columns).not.toEqual(
      expect.arrayContaining(['userId', 'eventId', 'payload', 'answerText', 'providerBody']),
    );
    expect(indexNames(table)).toEqual(
      expect.arrayContaining([
        'uk_energy_daily_metrics_bucket',
        'ix_energy_daily_metrics_expires_at',
        'ix_energy_daily_metrics_date_type',
      ]),
    );
  });

  it('keeps visitor rows purpose-limited and independently expiring', () => {
    const table = exportedTable('energyDailyVisitors');
    expect(table).toBeDefined();
    if (!table) return;

    expect(Object.keys(getTableColumns(table))).toEqual([
      'id',
      'activityDate',
      'visitorHash',
      'expiresAt',
      'createdAt',
    ]);
    expect(indexNames(table)).toEqual(
      expect.arrayContaining([
        'uk_energy_daily_visitors_day_hash',
        'ix_energy_daily_visitors_expires_at',
      ]),
    );
  });

  it('keeps retry receipts free of user, event type and metric links', () => {
    const table = exportedTable('energyEventReceipts');
    expect(table).toBeDefined();
    if (!table) return;

    expect(Object.keys(getTableColumns(table))).toEqual(['eventId', 'expiresAt', 'createdAt']);
    expect(indexNames(table)).toContain('ix_energy_event_receipts_expires_at');
  });

  it('ships a purely additive numbered migration', () => {
    const migrationUrl = new URL('../../../drizzle/0046_energy_analytics.sql', import.meta.url);
    expect(existsSync(migrationUrl)).toBe(true);
    if (!existsSync(migrationUrl)) return;

    const migration = readFileSync(migrationUrl, 'utf8');
    expect(migration.match(/\bCREATE TABLE\b/g)).toHaveLength(3);
    expect(migration).toContain('UNIQUE KEY `uk_energy_daily_metrics_bucket`');
    expect(migration).toContain('UNIQUE KEY `uk_energy_daily_visitors_day_hash`');
    expect(migration).toContain('PRIMARY KEY (`event_id`)');
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE|RENAME)\b/i);
    expect(migration).not.toMatch(/^\s*(?:DELETE|UPDATE)\b/im);
  });
});
