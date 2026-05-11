#!/usr/bin/env tsx
/**
 * Phase 5c — local → R2 bulk migration script.
 *
 * Walks `task_files` rows whose `storage_path` looks like a local
 * filesystem path, uploads the bytes to R2 using the configured
 * R2StorageProvider, and rewrites the row's `storage_path` to the
 * new R2 key. Runs idempotently — already-migrated rows (path
 * doesn't start with FILES_ROOT / has no leading slash) are skipped.
 *
 * **Run this BEFORE flipping STORAGE_PROVIDER=r2 in production.**
 * The runtime FileService trusts whatever path is in the row; if
 * you flip the flag while local-shaped paths are still in the DB,
 * the R2 provider will try to GET a path like
 * "/opt/holaday-files/usr_X/output/file_Y/report.xlsx" as an S3 key
 * and 404 every read.
 *
 * Usage:
 *   STORAGE_PROVIDER=r2 \
 *   R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com \
 *   R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=holaday-files \
 *   pnpm --filter @holaday/orchestrator exec tsx scripts/migrate-files-to-r2.ts
 *
 * Flags:
 *   --dry-run            print what would be migrated; touch nothing
 *   --batch=<n>          page size (default 100)
 *   --kind=input|output  only migrate this kind
 *
 * Safety:
 *   - The script does NOT delete the local file after upload. Run a
 *     separate cleanup once you've verified R2 reads work end-to-end.
 *   - Rows where the local file is missing on disk are skipped + the
 *     row's storage_path is left untouched (so a later pass can retry
 *     once the file's restored from backup, if any).
 */

import { promises as fs } from 'node:fs';
import { logger } from '../src/config/logger.js';
import { db } from '../src/db/client.js';
import { eq } from 'drizzle-orm';
import { taskFiles } from '../src/db/schema/task-files.js';
import { createStorageProvider, R2StorageProvider } from '../src/files/storage-provider.js';
import { users } from '../src/db/schema/users.js';

interface CliArgs {
  dryRun: boolean;
  batch: number;
  kind: 'input' | 'output' | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, batch: 100, kind: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--batch=')) {
      const n = parseInt(arg.slice('--batch='.length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --batch value: ${arg}`);
      }
      out.batch = n;
    } else if (arg === '--kind=input') out.kind = 'input';
    else if (arg === '--kind=output') out.kind = 'output';
    else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const provider = createStorageProvider({ logger });
  if (!(provider instanceof R2StorageProvider)) {
    logger.error('STORAGE_PROVIDER is not "r2" — refusing to migrate without an R2 target');
    process.exit(2);
  }
  logger.info({ args }, 'migrate-files-to-r2: starting');

  // Stream rows page-by-page so a 100k-file backlog doesn't OOM.
  // Order by id to make resume-from-cursor easy on a partial run.
  let cursor = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    const rows = await db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.id, cursor)) // placeholder; we override below
      .limit(args.batch);

    // Drizzle's where on `id = cursor` isn't useful for a page-by-id
    // walk; quick rewrite using a manual cursor query. Keeping the
    // strongly-typed query above so future schema changes catch the
    // table reference, but pulling the actual page via raw SQL:
    const pageRows = await db.execute(
      cursor === 0
        ? `SELECT * FROM task_files ORDER BY id ASC LIMIT ${args.batch}`
        : `SELECT * FROM task_files WHERE id > ${cursor} ORDER BY id ASC LIMIT ${args.batch}`,
    );
    void rows; // suppress unused — typed query above is the linter anchor
    const list = pageRows as unknown as Array<{
      id: number;
      external_id: string;
      user_id: number;
      kind: string;
      filename: string;
      mimetype: string;
      storage_path: string;
    }>;
    if (list.length === 0) break;

    for (const row of list) {
      cursor = row.id;
      if (args.kind && row.kind !== args.kind) {
        continue;
      }
      // Already-migrated rows have an R2-shaped key (no leading slash,
      // no FILES_ROOT prefix). Heuristic: if storage_path starts with
      // `/` we treat it as local.
      const looksLocal = row.storage_path.startsWith('/');
      if (!looksLocal) {
        skipped++;
        continue;
      }
      // Read the local file. If missing, skip + count as failed so the
      // operator can investigate; do NOT rewrite the row.
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(row.storage_path);
      } catch (err) {
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            fileId: row.external_id,
            path: row.storage_path,
          },
          'migrate: local file missing — skipping',
        );
        failed++;
        continue;
      }

      // Look up the user's external id so put() can scope correctly.
      const [user] = await db
        .select({ externalId: users.externalId })
        .from(users)
        .where(eq(users.id, row.user_id))
        .limit(1);
      if (!user) {
        logger.warn(
          { fileId: row.external_id, userId: row.user_id },
          'migrate: user not found — skipping',
        );
        failed++;
        continue;
      }

      if (args.dryRun) {
        logger.info(
          {
            fileId: row.external_id,
            user: user.externalId,
            kind: row.kind,
            bytes: buffer.length,
          },
          'migrate: would upload',
        );
        migrated++;
        continue;
      }

      try {
        const { storagePath: newKey } = await provider.put({
          userExternalId: user.externalId,
          kind: row.kind === 'input' ? 'input' : 'output',
          fileExternalId: row.external_id,
          filename: row.filename,
          buffer,
          mimetype: row.mimetype,
        });
        // Rewrite the row's storage_path to the R2 key.
        await db
          .update(taskFiles)
          .set({ storagePath: newKey })
          .where(eq(taskFiles.id, row.id));
        migrated++;
      } catch (err) {
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            fileId: row.external_id,
          },
          'migrate: upload failed',
        );
        failed++;
      }
    }
  }

  logger.info(
    { migrated, skipped, failed, dryRun: args.dryRun },
    'migrate-files-to-r2: done',
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'migrate: crashed');
  process.exit(2);
});
