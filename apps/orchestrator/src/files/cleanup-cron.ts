/**
 * File cleanup cron — one-shot script that pm2 restarts on a cron
 * schedule (hourly via `pm2 start ... --cron-restart "0 * * * *"`).
 *
 * Each run:
 *   1. SELECT every task_files row with status='active' AND
 *      expires_at < NOW(). 'output' rows have a 24h TTL by spec;
 *      'input' rows leave expires_at NULL and are never matched.
 *   2. For each row, fs.unlink the storage_path. Log per-file
 *      result (deleted / already missing / errored) so a botched
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

import { promises as fs } from 'node:fs';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { taskFiles } from '../db/schema/task-files.js';
import { logger } from '../config/logger.js';

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

  // Gather candidates. Bound the batch — under steady-state usage we
  // expect < 1000 expirations per hour; if something unusual lands a
  // huge backlog, the next tick picks up the rest.
  const candidates = await db
    .select()
    .from(taskFiles)
    .where(eq(taskFiles.status, 'active'))
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
      await fs.unlink(row.storagePath);
      unlinked += 1;
      logger.info(
        { kind: 'cleanup-cron', fileId: row.externalId, path: row.storagePath, action: 'unlinked' },
        'cleanup-cron: deleted on-disk file',
      );
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        alreadyMissing += 1;
        logger.info(
          { kind: 'cleanup-cron', fileId: row.externalId, action: 'already-missing' },
          'cleanup-cron: file already gone (orphaned row)',
        );
      } else {
        errored += 1;
        logger.error(
          { kind: 'cleanup-cron', fileId: row.externalId, err: err instanceof Error ? err.message : String(err) },
          'cleanup-cron: unlink failed — row stays active for next tick',
        );
        continue; // Don't flip status when disk side failed.
      }
    }
    await db
      .update(taskFiles)
      .set({ status: 'expired' })
      .where(eq(taskFiles.id, row.id));
  }

  // Optional: try removing the per-file directory. fs.rmdir only
  // succeeds when the directory is already empty, so if some other
  // file shares the dir (shouldn't happen — each file gets its own
  // <fileId>/ dir) this no-ops cleanly.
  for (const row of expired) {
    if (errored && row.storagePath) continue;
    const dir = row.storagePath.slice(0, row.storagePath.lastIndexOf('/'));
    if (!dir) continue;
    try {
      await fs.rmdir(dir);
    } catch {
      // Non-fatal; usually 'directory not empty' or 'no such directory'.
    }
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
