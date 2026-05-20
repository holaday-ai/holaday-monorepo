import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import mysql from 'mysql2/promise';

function loadDotenvAllowingEmpty(path: string): void {
  const result = loadDotenv({ path, override: false });
  if (!result.parsed) return;
  for (const [key, value] of Object.entries(result.parsed)) {
    if (process.env[key] === '') process.env[key] = value;
  }
}

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const migrationsDir = resolve(appRoot, 'drizzle');

loadDotenvAllowingEmpty(resolve(repoRoot, '.env'));
loadDotenvAllowingEmpty(resolve(repoRoot, '.env.local'));
loadDotenvAllowingEmpty(resolve(appRoot, '.env.local'));

const SKIPPABLE_ERROR_CODES = new Set([
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_FK_DUP_NAME',
  'ER_MULTIPLE_PRI_KEY',
]);

function isSkippableAlreadyAppliedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && SKIPPABLE_ERROR_CODES.has(e.code)) return true;
  const message = e.message ?? '';
  return /already exists|duplicate column|duplicate key name|duplicate foreign key/i.test(
    message,
  );
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/--> statement-breakpoint/g)
    .flatMap((chunk) =>
      chunk.split(/;\s*(?=(?:--[^\n]*\n\s*)*(?:CREATE|ALTER|INSERT|UPDATE|DELETE|$))/i),
    )
    .map((s) => s.trim().replace(/;$/, '').trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  const conn = await mysql.createConnection({ uri: url, multipleStatements: false });
  let applied = 0;
  let skipped = 0;

  try {
    const files = (await readdir(migrationsDir))
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort();
    if (files.length === 0) throw new Error(`No migrations found in ${migrationsDir}`);

    for (const file of files) {
      const raw = await readFile(resolve(migrationsDir, file), 'utf8');
      for (const statement of splitStatements(raw)) {
        try {
          await conn.query(statement);
          applied += 1;
        } catch (err) {
          if (isSkippableAlreadyAppliedError(err)) {
            skipped += 1;
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`${file} failed:\n${statement}\n\n${msg}`);
        }
      }
    }
  } finally {
    await conn.end();
  }

  console.log(`Numbered migrations applied. statements=${applied}, alreadyApplied=${skipped}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
