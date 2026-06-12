import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../db/client.js';
import { evidenceArtifacts } from '../db/schema/evidence-artifacts.js';
import { type StorageProvider, getSharedStorageProvider } from '../files/storage-provider.js';
import { EvidenceArtifactRepository } from './evidence-artifact-repository.js';

/**
 * Phase 1 #3 Pack B — Evidence retention reaper (design §4.9).
 *
 * Nightly sweep: find `evidence_artifacts` whose `expires_at <= now` and
 * whose `retention_policy != 'manual_hold'` (the repository query already
 * excludes manual_hold), then for each: delete the R2 object FIRST, then
 * the MySQL row. `claim_evidence_links` cascade off the deleted artifact.
 *
 * R2-failure semantics: if the R2 delete throws, the row is KEPT and a
 * `cleanup_error` is recorded in `metadata_json` so the next run retries
 * (design §4.9). NOTE: today's storage providers swallow their own delete
 * errors (idempotent, log-only) and never throw, so in practice the R2
 * attempt is best-effort and the row is removed; the try/catch wires the
 * strict-retry path for a future provider that surfaces failures.
 *
 * Best-effort + bounded (`limit`) so a single run can't wedge the loop.
 * Registered as a `setInterval` in `index.ts`, gated by
 * `RETENTION_REAPER_ENABLED` (default off — no artifacts exist until
 * `LEDGER_DB_WRITE` is on, so it's a no-op until then).
 */

const NOOP_LOGGER = {
  warn() {},
  info() {},
  error() {},
  debug() {},
  child() {
    return NOOP_LOGGER;
  },
} as unknown as Logger;

export interface ReaperOptions {
  db: DB;
  storage?: StorageProvider;
  logger?: Logger;
  now?: Date;
  /** Max artifacts processed per run (paging). Default 200. */
  limit?: number;
}

export interface ReaperResult {
  scanned: number;
  deleted: number;
  r2Deleted: number;
  r2Failed: number;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export async function runRetentionReaper(opts: ReaperOptions): Promise<ReaperResult> {
  const now = opts.now ?? new Date();
  const repo = new EvidenceArtifactRepository(opts.db);
  const expired = await repo.listExpired(now, opts.limit ?? 200);

  const result: ReaperResult = { scanned: expired.length, deleted: 0, r2Deleted: 0, r2Failed: 0 };
  if (expired.length === 0) return result;

  const storage = opts.storage ?? getSharedStorageProvider({ logger: opts.logger ?? NOOP_LOGGER });

  for (const a of expired) {
    try {
      await storage.delete(a.r2Key);
      result.r2Deleted += 1;
    } catch (err) {
      // Strict provider surfaced an R2 failure → keep the row, record the
      // error, retry next run. Do NOT delete the MySQL row.
      result.r2Failed += 1;
      await opts.db
        .update(evidenceArtifacts)
        .set({
          metadataJson: {
            ...asObject(a.metadataJson),
            cleanup_error: err instanceof Error ? err.message : String(err),
            cleanup_attempt_at: now.toISOString(),
          },
        })
        .where(eq(evidenceArtifacts.id, a.id));
      continue;
    }
    await repo.deleteByExternalId(a.externalId);
    result.deleted += 1;
  }
  return result;
}
