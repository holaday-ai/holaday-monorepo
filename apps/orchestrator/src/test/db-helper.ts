import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Apply every numbered drizzle migration (drizzle/NNNN_*.sql) in order to
 * the configured DATABASE_URL. Resets tables named in 0000 first so reruns
 * are deterministic, then replays the full chain.
 *
 * Skips `drizzle/manual/` — those are MySQL-only features (RANGE partitioning,
 * EVENT scheduler) that are applied by operators out-of-band; CI runs against
 * MariaDB where some of them are not accepted.
 */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  try {
    const migrationsDir = resolve(__dirname, '../../drizzle');
    const files = (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    if (files.length === 0) throw new Error('no migrations found');

    // Reset every CREATE TABLE target from the whole chain so reruns are clean.
    const all = await Promise.all(files.map((f) => readFile(resolve(migrationsDir, f), 'utf8')));
    const combined = all.join('\n');
    const tableNames = [...combined.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of tableNames) {
      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    for (const file of files) {
      const raw = await readFile(resolve(migrationsDir, file), 'utf8');
      const statements = raw
        .split(/--> statement-breakpoint/g)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await conn.query(stmt);
      }
    }
  } finally {
    await conn.end();
  }
}
