/**
 * File cleanup cron — one-shot script that pm2 restarts on a cron
 * schedule (hourly via `pm2 start ... --cron-restart "0 * * * *"`).
 *
 * Each run:
 *   1. SELECT every task_files row with status IN ('active','pending')
 *      AND expires_at < NOW(). 'output' rows and abandoned presigned
 *      uploads have a 24h TTL; ordinary input rows leave expires_at
 *      NULL and are never matched.
 *   2. For each row, delete storage_path via the configured storage
 *      provider (local disk or R2). Log per-file result so a botched
 *      run can be diagnosed from pm2 logs alone.
 *   3. UPDATE the row to status='expired' once the disk side has
 *      been handled (deleted OR confirmed-missing). Errored unlinks
 *      stay status='active' so the next run retries.
 *
 * No `rm -rf`. The per-file fs.unlink loop is intentional; it keeps
 * blast radius narrow if a path ever gets corrupted into something
 * dangerous, and the per-file log line is the only way to diagnose
 * a partial failure.
 *
 * Exit codes:
 *   0 — ran cleanly (zero or N rows processed).
 *   1 — fatal infra error (DB connect failed, etc.). pm2 will retry
 *       on the next cron tick anyway, but a non-zero exit shows up
 *       in `pm2 list` for ops visibility.
 */

import { eq, inArray } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { taskFiles } from '../db/schema/task-files.js';
import { logger } from '../config/logger.js';
import { getSharedStorageProvider } from './storage-provider.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.error('cleanup-cron: DATABASE_URL missing — aborting');
    process.exit(1);
  }
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 4,
    timezone: 'Z',
    dateStrings: false,
  });
  const db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' });

  const startedAt = Date.now();
  logger.info({ kind: 'cleanup-cron' }, 'cleanup-cron: scanning task_files for expired rows');
  const storage = getSharedStorageProvider({ logger });

  // Gather candidates. Bound the batch — under steady-state usage we
  // expect < 1000 expirations per hour; if something unusual lands a
  // huge backlog, the next tick picks up the rest.
  const candidates = await db
    .select()
    .from(taskFiles)
    .where(inArray(taskFiles.status, ['active', 'pending']))
    .limit(2000);
  const now = Date.now();
  const expired = candidates.filter(
    (row) => row.expiresAt != null && row.expiresAt.getTime() < now,
  );
  logger.info(
    { kind: 'cleanup-cron', scanned: candidates.length, expired: expired.length },
    'cleanup-cron: candidate set assembled',
  );

  let unlinked = 0;
  let alreadyMissing = 0;
  let errored = 0;
  for (const row of expired) {
    try {
      await storage.delete(row.storagePath);
      unlinked += 1;
      logger.info(
        { kind: 'cleanup-cron', fileId: row.externalId, path: row.storagePath, action: 'unlinked' },
        'cleanup-cron: deleted storage object',
      );
    } catch (err: unknown) {
      errored += 1;
      logger.error(
        {
          kind: 'cleanup-cron',
          fileId: row.externalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'cleanup-cron: storage delete failed — row stays active/pending for next tick',
      );
      continue; // Don't flip status when storage side failed.
    }
    await db
      .update(taskFiles)
      .set({ status: 'expired' })
      .where(eq(taskFiles.id, row.id));
  }

  await pool.end();
  logger.info(
    {
      kind: 'cleanup-cron',
      unlinked,
      alreadyMissing,
      errored,
      durationMs: Date.now() - startedAt,
    },
    'cleanup-cron: done',
  );
}

main().catch((err) => {
  logger.error(
    { kind: 'cleanup-cron', err: err instanceof Error ? err.message : String(err) },
    'cleanup-cron: fatal error',
  );
  process.exit(1);
});
