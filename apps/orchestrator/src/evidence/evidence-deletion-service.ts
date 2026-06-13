import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../db/client.js';
import { evidenceArtifacts } from '../db/schema/evidence-artifacts.js';
import { type StorageProvider, getSharedStorageProvider } from '../files/storage-provider.js';

/**
 * Phase 1 #3 Pack B — task-delete evidence routing (design §4.9).
 *
 * `evidence_artifacts.task_id` is ON DELETE SET NULL (NOT cascade), so a
 * raw task delete would orphan its evidence. Deletion is resolved at the
 * APPLICATION layer by `purpose` / `retention_policy`, because the user's
 * delete-right and audit retention conflict and can't both be a single
 * FK behaviour:
 *
 *   - `task_evidence` (and any non-retained artifact) → user delete-right:
 *     delete the R2 object AND the MySQL row immediately.
 *   - `audit` purpose or `retention_policy ∈ {audit_180d, manual_hold}` →
 *     RETAIN: keep the row + R2 object, but scrub user linkage
 *     (owner_user_id / task_id → NULL, mark metadata scrubbed). The
 *     retention reaper later clears it by `expires_at`.
 *
 * Claims for the task are ON DELETE CASCADE off `tasks`, so they (and
 * their `claim_evidence_links`) disappear when the caller deletes the
 * task row — no handling needed here. `claim_evidence_links` for a
 * deleted artifact cascade off the artifact.
 *
 * Call this BEFORE deleting the task row (while `task_id` is still set).
 */

const RETAINED_POLICIES = new Set(['audit_180d', 'manual_hold']);

const NOOP_LOGGER = {
  warn() {},
  info() {},
  error() {},
  debug() {},
  child() {
    return NOOP_LOGGER;
  },
} as unknown as Logger;

export interface RouteDeleteOptions {
  storage?: StorageProvider;
  logger?: Logger;
}

export interface RouteDeleteResult {
  /** task_evidence rows hard-deleted (MySQL row removed). */
  deleted: number;
  /** audit/manual_hold rows scrubbed + retained. */
  scrubbed: number;
  /** R2 objects deleted for the hard-deleted rows. */
  r2Deleted: number;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export async function routeTaskEvidenceOnDelete(
  db: DB,
  taskInternalId: number,
  opts: RouteDeleteOptions = {},
): Promise<RouteDeleteResult> {
  const rows = await db
    .select({
      id: evidenceArtifacts.id,
      r2Key: evidenceArtifacts.r2Key,
      purpose: evidenceArtifacts.purpose,
      retentionPolicy: evidenceArtifacts.retentionPolicy,
      metadataJson: evidenceArtifacts.metadataJson,
    })
    .from(evidenceArtifacts)
    .where(eq(evidenceArtifacts.taskId, taskInternalId));

  const result: RouteDeleteResult = { deleted: 0, scrubbed: 0, r2Deleted: 0 };
  if (rows.length === 0) return result;

  // Lazily resolve the storage provider — only tasks that actually have
  // hard-deletable artifacts touch R2 (keeps the no-artifact common case
  // free of any storage init).
  let storage: StorageProvider | null = null;
  const resolveStorage = (): StorageProvider => {
    if (!storage) {
      storage = opts.storage ?? getSharedStorageProvider({ logger: opts.logger ?? NOOP_LOGGER });
    }
    return storage;
  };

  for (const a of rows) {
    const retain = a.purpose === 'audit' || RETAINED_POLICIES.has(a.retentionPolicy);
    if (retain) {
      await db
        .update(evidenceArtifacts)
        .set({
          ownerUserId: null,
          taskId: null,
          metadataJson: {
            ...asObject(a.metadataJson),
            scrubbed: true,
            scrubbedReason: 'task_deleted',
          },
        })
        .where(eq(evidenceArtifacts.id, a.id));
      result.scrubbed += 1;
      continue;
    }
    // user delete-right: drop the R2 object then the MySQL row.
    try {
      await resolveStorage().delete(a.r2Key);
      result.r2Deleted += 1;
    } catch (err) {
      // Providers swallow their own errors today; this guards a future
      // strict provider. We still drop the row (the user's delete-right
      // wins); the object may leak and is logged for a later sweep.
      opts.logger?.warn(
        { err: err instanceof Error ? err.message : String(err), r2Key: a.r2Key },
        'evidence-delete: R2 delete failed; removing row anyway (object may leak)',
      );
    }
    await db.delete(evidenceArtifacts).where(eq(evidenceArtifacts.id, a.id));
    result.deleted += 1;
  }
  return result;
}
