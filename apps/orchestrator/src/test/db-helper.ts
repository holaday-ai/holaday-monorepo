import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACCOUNT_CLOSURE_RESET_TABLES = [
  'account_closure_receipts',
  'account_closure_challenges',
  'account_closure_effects',
  'account_closure_steps',
  'account_closure_requests',
];

export function assertDestructiveTestDatabaseAllowed(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.ALLOW_DESTRUCTIVE_TEST_DB_RESET !== '1') {
    throw new Error(
      'Destructive test database reset refused: set ALLOW_DESTRUCTIVE_TEST_DB_RESET=1 explicitly',
    );
  }

  let databaseName = '';
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    // Keep the error below credential-free. Never include the supplied URL.
  }

  if (!/_(?:test|integration)$/.test(databaseName)) {
    throw new Error(
      'Destructive test database reset refused: use a dedicated database ending in _test or _integration',
    );
  }
}

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
  assertDestructiveTestDatabaseAllowed(databaseUrl);
  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  try {
    const migrationsDir = resolve(__dirname, '../../drizzle');
    const files = (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    if (files.length === 0) throw new Error('no migrations found');

    // Reset every CREATE TABLE target from the whole chain so reruns are clean.
    const all = await Promise.all(files.map((f) => readFile(resolve(migrationsDir, f), 'utf8')));
    const combined = all.join('\n');
    const migrationTableNames = [...combined.matchAll(/CREATE TABLE `([^`]+)`/g)]
      .map((m) => m[1])
      .filter((name): name is string => name != null);
    const tableNames = [
      ...ACCOUNT_CLOSURE_RESET_TABLES,
      ...migrationTableNames.filter((name) => !ACCOUNT_CLOSURE_RESET_TABLES.includes(name)),
    ];
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
