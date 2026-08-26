import { describe, expect, it } from 'vitest';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import * as schema from '../db/schema/index.js';
import { ACCOUNT_CLOSURE_TABLE_OWNERSHIP } from './table-ownership.js';

const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:Name');

describe('account closure persistence table ownership', () => {
  it('assigns every exported Drizzle table to exactly one canonical closure category', () => {
    const exportedTableNames = Object.values(schema)
      .map((value) => (value as unknown as Record<symbol, unknown> | null)?.[DRIZZLE_TABLE_NAME])
      .filter((value): value is string => typeof value === 'string')
      .sort();
    const registeredTableNames = ACCOUNT_CLOSURE_TABLE_OWNERSHIP.map(
      (entry) => entry.tableName,
    ).sort();

    expect(new Set(registeredTableNames).size).toBe(registeredTableNames.length);
    expect(registeredTableNames).toEqual(exportedTableNames);
    expect(
      ACCOUNT_CLOSURE_TABLE_OWNERSHIP.every((entry) =>
        DATA_CATEGORY_IDS.includes(entry.categoryId),
      ),
    ).toBe(true);
  });
});
