import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Apply the generated initial migration against the configured DATABASE_URL.
 * Drops & recreates every table named in the migration first so reruns are
 * deterministic. Designed for the integration test config.
 *
 * NOTE: this intentionally does NOT apply the manual partition migrations
 * (0001 / 0002). Those are MySQL-only DDL features; integration tests run
 * fine without them, and CI can run on MariaDB which doesn't accept the
 * exact same `PARTITION BY RANGE (TO_DAYS(...))` syntax for our PK shape.
 */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  try {
    const sqlPath = resolve(__dirname, '../../drizzle/0000_initial.sql');
    const raw = await readFile(sqlPath, 'utf8');
    // drizzle-kit emits "--> statement-breakpoint" between statements.
    const statements = raw
      .split(/--> statement-breakpoint/g)
      .map((s) => s.trim())
      .filter(Boolean);

    // Reset every CREATE TABLE target so reruns are deterministic.
    const tableNames = [...raw.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of tableNames) {
      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    for (const stmt of statements) {
      await conn.query(stmt);
    }
  } finally {
    await conn.end();
  }
}
