import { existsSync, readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { stockPreferenceProfiles, stockPreferenceSignals } from './stock-preferences.js';

describe('stock preference schema', () => {
  it('stores one user-controlled profile without suitability fields', () => {
    expect(Object.keys(getTableColumns(stockPreferenceProfiles))).toEqual([
      'id',
      'userId',
      'enabled',
      'manualPreferencesJson',
      'clearedAt',
      'createdAt',
      'updatedAt',
    ]);

    const indexes = getTableConfig(stockPreferenceProfiles).indexes.map((index) => index.config.name);
    expect(indexes).toContain('uk_stock_preference_profiles_user');
    expect(Object.keys(getTableColumns(stockPreferenceProfiles))).not.toEqual(
      expect.arrayContaining(['riskTolerance', 'income', 'assets', 'debt', 'suitability']),
    );
  });

  it('stores bounded canonical evidence with per-user deduplication', () => {
    expect(Object.keys(getTableColumns(stockPreferenceSignals))).toEqual([
      'id',
      'userId',
      'kind',
      'dedupeHash',
      'payloadJson',
      'dataAsOf',
      'occurredAt',
      'createdAt',
    ]);

    const indexes = getTableConfig(stockPreferenceSignals).indexes.map((index) => index.config.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'uk_stock_preference_signals_user_hash',
      'ix_stock_preference_signals_user_time',
    ]));
    expect(Object.keys(getTableColumns(stockPreferenceSignals))).not.toEqual(
      expect.arrayContaining(['prompt', 'candidateJson', 'note', 'freeText']),
    );
  });

  it('ships a purely additive numbered migration with cascading user cleanup', () => {
    const migrationUrl = new URL('../../../drizzle/0048_stock_preference_profiles.sql', import.meta.url);
    expect(existsSync(migrationUrl)).toBe(true);
    if (!existsSync(migrationUrl)) return;

    const migration = readFileSync(migrationUrl, 'utf8');
    expect(migration.match(/\bCREATE TABLE\b/g)).toHaveLength(2);
    expect(migration).toContain('UNIQUE KEY `uk_stock_preference_profiles_user`');
    expect(migration).toContain('UNIQUE KEY `uk_stock_preference_signals_user_hash`');
    expect(migration).toContain('KEY `ix_stock_preference_signals_user_time`');
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(2);
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE|RENAME)\b/i);
    expect(migration).not.toMatch(/^\s*(?:DELETE|UPDATE)\b/im);
  });

  it('requires both preference tables and their privacy-bounded columns at release time', () => {
    const verifierUrl = new URL('../../../scripts/verify-db-schema.ts', import.meta.url);
    const verifier = readFileSync(verifierUrl, 'utf8');

    expect(verifier).toContain("'stock_preference_profiles'");
    expect(verifier).toContain("'stock_preference_signals'");
    expect(verifier).toContain("stock_preference_profiles: ['user_id', 'enabled', 'manual_preferences_json', 'cleared_at']");
    expect(verifier).toContain("stock_preference_signals: ['user_id', 'kind', 'dedupe_hash', 'payload_json', 'data_as_of', 'occurred_at']");
  });
});
