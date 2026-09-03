import { existsSync, readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { organizations } from './organizations.js';
import { users } from './users.js';

describe('model data region schema', () => {
  it.each([
    ['users', users, 'ck_users_model_data_region'],
    ['organizations', organizations, 'ck_organizations_model_data_region'],
  ] as const)('stores a nullable bounded region on %s', (_name, table, checkName) => {
    const column = getTableColumns(table).modelDataRegion;

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
    expect(column?.getSQLType()).toBe('varchar(8)');
    expect(getTableConfig(table).checks.map((check) => check.name)).toContain(checkName);
  });

  it('ships a purely additive migration without guessing existing rows', () => {
    const migrationUrl = new URL('../../../drizzle/0058_model_data_regions.sql', import.meta.url);
    expect(existsSync(migrationUrl)).toBe(true);
    if (!existsSync(migrationUrl)) return;

    const migration = readFileSync(migrationUrl, 'utf8');
    expect(migration.match(/ALTER TABLE/g)).toHaveLength(2);
    expect(migration).toMatch(
      /ALTER TABLE `users`[\s\S]*ADD COLUMN `model_data_region` varchar\(8\) NULL[\s\S]*CONSTRAINT `ck_users_model_data_region`[\s\S]*CHECK \(`model_data_region` IS NULL OR `model_data_region` IN \('cn', 'intl'\)\)/,
    );
    expect(migration).toMatch(
      /ALTER TABLE `organizations`[\s\S]*ADD COLUMN `model_data_region` varchar\(8\) NULL[\s\S]*CONSTRAINT `ck_organizations_model_data_region`[\s\S]*CHECK \(`model_data_region` IS NULL OR `model_data_region` IN \('cn', 'intl'\)\)/,
    );
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE|DROP|TRUNCATE|RENAME)\b/im);
  });

  it('requires both regional columns in the production schema verifier', () => {
    const verifier = readFileSync(
      new URL('../../../scripts/verify-db-schema.ts', import.meta.url),
      'utf8',
    );

    expect(verifier).toMatch(/organizations:\s*\[[\s\S]*?'model_data_region'/);
    expect(verifier).toMatch(/users:\s*\[[\s\S]*?'model_data_region'/);
  });
});
