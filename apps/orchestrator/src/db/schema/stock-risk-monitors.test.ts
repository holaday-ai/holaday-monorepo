import { existsSync, readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { notifications } from './notifications.js';
import { plannedTaskRuns } from './planned-tasks.js';
import { stockRiskMonitors } from './stock-risk-monitors.js';

describe('stock risk monitor schema', () => {
  it('stores one compact monitor state per user stock and planned task', () => {
    expect(Object.keys(getTableColumns(stockRiskMonitors))).toEqual([
      'id',
      'externalId',
      'userId',
      'plannedTaskId',
      'symbol',
      'name',
      'market',
      'riskKeysJson',
      'lastEvaluatedDataAsOf',
      'lastSignalsJson',
      'lastUnavailableChecksJson',
      'lastNotificationFingerprint',
      'createdAt',
      'updatedAt',
    ]);

    const indexes = getTableConfig(stockRiskMonitors).indexes.map((index) => index.config.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'uk_stock_risk_monitors_external_id',
      'uk_stock_risk_monitors_user_symbol',
      'uk_stock_risk_monitors_plan',
    ]));
    expect(Object.keys(getTableColumns(stockRiskMonitors))).not.toEqual(
      expect.arrayContaining(['prompt', 'income', 'assets', 'riskTolerance', 'freeText']),
    );
  });

  it('adds nullable structured result and planned-task notification links', () => {
    expect(getTableColumns(plannedTaskRuns).resultJson.notNull).toBe(false);
    expect(getTableColumns(notifications).plannedTaskId.notNull).toBe(false);
  });

  it('ships the additive numbered migration with the three uniqueness boundaries', () => {
    const migrationUrl = new URL('../../../drizzle/0049_stock_risk_monitors.sql', import.meta.url);
    expect(existsSync(migrationUrl)).toBe(true);
    if (!existsSync(migrationUrl)) return;

    const migration = readFileSync(migrationUrl, 'utf8');
    expect(migration).toContain('UNIQUE KEY `uk_stock_risk_monitors_external_id`');
    expect(migration).toContain('UNIQUE KEY `uk_stock_risk_monitors_user_symbol`');
    expect(migration).toContain('UNIQUE KEY `uk_stock_risk_monitors_plan`');
    expect(migration).toMatch(/ADD COLUMN `result_json` JSON NULL/);
    expect(migration).toMatch(/ADD COLUMN `planned_task_id` BIGINT UNSIGNED NULL/);
    expect(migration).toContain('ON DELETE SET NULL');
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/i);
    expect(migration).not.toMatch(/^\s*(?:DELETE|UPDATE)\b/im);
  });
});
