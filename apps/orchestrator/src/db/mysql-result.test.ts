/**
 * affectedRows / insertId envelope readers + anti-regression hygiene.
 *
 * mysql2/drizzle UPDATE/DELETE resolves to an ARRAY `[ResultSetHeader,
 * fields]` — the real count lives at `result[0].affectedRows`, NOT a
 * top-level `result.affectedRows`. Reading the top level returns
 * `undefined`, which silently broke quota `tryConsume` (universal 429)
 * and payment capture (charge-but-no-grant). `readAffectedRows`
 * handles both the array envelope and a bare header object; the hygiene
 * test bans the inline top-level cast from creeping back in.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAffectedRows, readInsertId } from './mysql-result.js';

describe('readAffectedRows', () => {
  it('reads from the mysql2/drizzle array envelope [header, fields]', () => {
    // This is the REAL runtime shape (verified by probing drizzle 0.38.4).
    expect(readAffectedRows([{ affectedRows: 1 }, null])).toBe(1);
    expect(readAffectedRows([{ affectedRows: 0 }, null])).toBe(0);
    expect(readAffectedRows([{ affectedRows: 5 }, []])).toBe(5);
  });

  it('falls back to a bare header object (defensive — other drivers/shapes)', () => {
    expect(readAffectedRows({ affectedRows: 1 })).toBe(1);
    expect(readAffectedRows({ affectedRows: 0 })).toBe(0);
  });

  it('returns 0 when absent / malformed', () => {
    expect(readAffectedRows(undefined)).toBe(0);
    expect(readAffectedRows(null)).toBe(0);
    expect(readAffectedRows([])).toBe(0);
    expect(readAffectedRows([{}, null])).toBe(0);
    expect(readAffectedRows({})).toBe(0);
  });
});

describe('readInsertId', () => {
  it('reads insertId from the array envelope (number + bigint)', () => {
    expect(readInsertId([{ insertId: 7 }, null])).toBe(7);
    expect(readInsertId([{ insertId: 9n }, null])).toBe(9);
  });

  it('throws when no insertId is present', () => {
    expect(() => readInsertId([])).toThrow();
    expect(() => readInsertId(undefined)).toThrow();
    expect(() => readInsertId([{}, null])).toThrow();
  });
});

function tsFilesExcludingTests(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsFilesExcludingTests(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('affectedRows read hygiene (anti-regression)', () => {
  it('no inline top-level affectedRows cast — call readAffectedRows() instead', () => {
    // Built by concatenation so this assertion is not itself an "offender"
    // string. The exact pattern removed across the 16 fixed sites.
    const NEEDLE = `as unknown as { ${'affectedRows'}?: number }).affectedRows`;
    const offenders = tsFilesExcludingTests(join(process.cwd(), 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes(NEEDLE))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});
