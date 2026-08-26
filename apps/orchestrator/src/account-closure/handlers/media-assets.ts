import { eq, sql } from 'drizzle-orm';
import {
  type DeleteVoiceParams,
  QwenVoiceCloneError,
  deleteVoice,
} from '../../agent/video/qwen-voice-clone-client.js';
import { env as appEnv } from '../../config/env.js';
import { readAffectedRows } from '../../db/mysql-result.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { users } from '../../db/schema/users.js';
import {
  type FileClosureCategory,
  createDbUserFileClosureStore,
  deleteUserFilesPage,
} from '../../files/file-service.js';
import { deleteStorageObjectForClosure } from '../../files/storage-provider.js';
import {
  type AccountClosureHandler,
  type ClosureHandlerContext,
  ClosureHandlerError,
} from '../handler-contract.js';

export interface MediaAssetsClosureDependencies {
  /** Null means the runtime cannot prove remote voice deletion capability. */
  deleteVoiceClone: ((voiceId: string, signal: AbortSignal) => Promise<void>) | null;
}

interface EvidenceClosurePageResult {
  deleted: number;
  restricted: number;
  done: boolean;
}

interface EvidenceClosureRow {
  id: number;
  r2Key: string;
  retained: boolean;
}

export function createMediaAssetsClosureHandler(
  dependencies: MediaAssetsClosureDependencies,
): AccountClosureHandler {
  return {
    categoryId: 'media_assets',
    version: 1,
    async run(context) {
      context.signal.throwIfAborted();
      const pageSize = boundedPageSize(context);
      const previousProcessed = context.checkpoint?.processedCount ?? 0;
      // Cursor 0 is the durable, non-personal marker that this category has
      // already minimized restricted evidence. Positive cursors are file IDs.
      const previouslyRestricted = context.checkpoint?.cursor === 0;
      const filePage = await deleteUserFilesPage(
        {
          userIdInternal: context.request.userId,
          ...(context.checkpoint?.cursor !== undefined && context.checkpoint.cursor > 0
            ? { afterId: context.checkpoint.cursor }
            : {}),
          limit: pageSize,
          categoryId: 'media_assets',
        },
        {
          store: createDbUserFileClosureStore(context.db),
          storage: context.storage,
          signal: context.signal,
        },
      );
      if (filePage.deleted > 0) {
        const processed = previousProcessed + filePage.deleted;
        return continueResult(processed, previouslyRestricted, filePage.nextAfterId);
      }

      context.signal.throwIfAborted();
      const evidencePage = await deleteUserEvidencePage(context, 'media_assets', pageSize);
      if (evidencePage.deleted + evidencePage.restricted > 0) {
        const processed = previousProcessed + evidencePage.deleted + evidencePage.restricted;
        return continueResult(processed, previouslyRestricted || evidencePage.restricted > 0);
      }

      context.signal.throwIfAborted();
      const [profile] = await context.db
        .select({
          avatarUrl: users.avatarUrl,
          qwenVoiceId: users.qwenVoiceId,
          baseVideoFileId: users.baseVideoFileId,
          videoSelfUseAuthorizedAt: users.videoSelfUseAuthorizedAt,
        })
        .from(users)
        .where(eq(users.id, context.request.userId))
        .limit(1);
      if (!profile) throw new ClosureHandlerError('INVARIANT_VIOLATION');

      if (profile.baseVideoFileId) {
        const [remainingBase] = await context.db
          .select({ id: taskFiles.id, userId: taskFiles.userId })
          .from(taskFiles)
          .where(eq(taskFiles.externalId, profile.baseVideoFileId))
          .limit(1);
        if (remainingBase) {
          // The soft pointer must never be cleared while any indexed object
          // remains, including a malformed MIME that changed the partition.
          throw new ClosureHandlerError('CAPABILITY_CHANGED');
        }
      }

      if (profile.qwenVoiceId) {
        if (!dependencies.deleteVoiceClone) throw new ClosureHandlerError('HANDLER_DEFERRED');
        await dependencies.deleteVoiceClone(profile.qwenVoiceId, context.signal);
      }

      context.signal.throwIfAborted();
      const profileFields = [
        profile.avatarUrl,
        profile.qwenVoiceId,
        profile.baseVideoFileId,
        profile.videoSelfUseAuthorizedAt,
      ].filter((value) => value !== null).length;
      if (profileFields > 0) {
        const result = await context.db.execute(sql`
          UPDATE users
          SET
            avatar_url = NULL,
            qwen_voice_id = NULL,
            base_video_file_id = NULL,
            video_self_use_authorized_at = NULL
          WHERE id = ${context.request.userId}
            AND avatar_url <=> ${profile.avatarUrl}
            AND qwen_voice_id <=> ${profile.qwenVoiceId}
            AND base_video_file_id <=> ${profile.baseVideoFileId}
            AND video_self_use_authorized_at <=> ${profile.videoSelfUseAuthorizedAt}
        `);
        if (readAffectedRows(result) !== 1) {
          throw new ClosureHandlerError('INVARIANT_VIOLATION');
        }
      }

      const processed = previousProcessed + profileFields;
      if (processed === 0) {
        return { kind: 'complete', processed: 0, retention: 'not_present' };
      }
      return {
        kind: 'complete',
        processed,
        retention: previouslyRestricted ? 'restricted' : 'deleted',
      };
    },
  };
}

/**
 * Deletes or minimizes one exclusive evidence partition. Hard deletions are
 * object-first. Retained authorization/dispute/audit rows are ordered last,
 * disconnected from the account, stripped to restricted evidence metadata,
 * and keep their object for the reviewed retention flow.
 */
export async function deleteUserEvidencePage(
  context: ClosureHandlerContext,
  categoryId: FileClosureCategory,
  limit: number,
): Promise<EvidenceClosurePageResult> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  const ownershipConflicts = parseEvidenceConflictRows(
    await context.db.execute(sql`
      SELECT artifact.id
      FROM evidence_artifacts AS artifact
      LEFT JOIN tasks AS owner_task ON owner_task.id = artifact.task_id
      LEFT JOIN sites AS owner_site ON owner_site.id = artifact.site_id
      LEFT JOIN exploration_runs AS owner_run ON owner_run.id = artifact.exploration_run_id
      LEFT JOIN sites AS owner_run_site ON owner_run_site.id = owner_run.site_id
      WHERE ${evidenceAnyTargetOwnershipPredicate(context.request.userId)}
        AND NOT ${evidenceOwnershipAxesCompatiblePredicate(context.request.userId)}
        AND ${evidencePartitionPredicate(categoryId)}
      ORDER BY artifact.id ASC
      LIMIT 1
    `),
  );
  if (ownershipConflicts > 0) throw new ClosureHandlerError('INVARIANT_VIOLATION');

  const selected = parseEvidenceRows(
    await context.db.execute(sql`
      SELECT
        artifact.id,
        artifact.r2_key AS r2Key,
        CASE WHEN ${retainedEvidencePredicate()} THEN 1 ELSE 0 END AS retained
      FROM evidence_artifacts AS artifact
      LEFT JOIN tasks AS owner_task ON owner_task.id = artifact.task_id
      LEFT JOIN sites AS owner_site ON owner_site.id = artifact.site_id
      LEFT JOIN exploration_runs AS owner_run ON owner_run.id = artifact.exploration_run_id
      LEFT JOIN sites AS owner_run_site ON owner_run_site.id = owner_run.site_id
      WHERE ${evidenceConsistentOwnershipPredicate(context.request.userId)}
        AND ${evidencePartitionPredicate(categoryId)}
      ORDER BY retained ASC, artifact.id ASC
      LIMIT ${limit + 1}
    `),
  );
  if (selected.length > limit + 1) throw new ClosureHandlerError('INVARIANT_VIOLATION');

  let deleted = 0;
  let restricted = 0;
  for (const row of selected.slice(0, limit)) {
    context.signal.throwIfAborted();
    if (row.retained) {
      const result = await context.db.execute(sql`
        UPDATE evidence_artifacts AS artifact
        LEFT JOIN tasks AS owner_task ON owner_task.id = artifact.task_id
        LEFT JOIN sites AS owner_site ON owner_site.id = artifact.site_id
        LEFT JOIN exploration_runs AS owner_run ON owner_run.id = artifact.exploration_run_id
        LEFT JOIN sites AS owner_run_site ON owner_run_site.id = owner_run.site_id
        SET
          artifact.owner_user_id = NULL,
          artifact.task_id = NULL,
          artifact.site_id = NULL,
          artifact.exploration_run_id = NULL,
          artifact.source_url = NULL,
          artifact.final_url = NULL,
          artifact.raw_excerpt = NULL,
          artifact.viewport_json = NULL,
          artifact.dom_hash = NULL,
          artifact.screenshot_hash = NULL,
          artifact.metadata_json = JSON_OBJECT(
            'scrubbed', TRUE,
            'scrubbedReason', 'account_closure',
            'retentionClass', 'restricted'
          )
        WHERE artifact.id = ${row.id}
          AND ${evidenceConsistentOwnershipPredicate(context.request.userId)}
          AND ${evidencePartitionPredicate(categoryId)}
      `);
      if (readAffectedRows(result) !== 1) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      restricted += 1;
      continue;
    }

    await deleteStorageObjectForClosure(context.storage, row.r2Key, {
      signal: context.signal,
    });
    context.signal.throwIfAborted();
    const result = await context.db.execute(sql`
      DELETE artifact
      FROM evidence_artifacts AS artifact
      LEFT JOIN tasks AS owner_task ON owner_task.id = artifact.task_id
      LEFT JOIN sites AS owner_site ON owner_site.id = artifact.site_id
      LEFT JOIN exploration_runs AS owner_run ON owner_run.id = artifact.exploration_run_id
      LEFT JOIN sites AS owner_run_site ON owner_run_site.id = owner_run.site_id
      WHERE artifact.id = ${row.id}
        AND ${evidenceConsistentOwnershipPredicate(context.request.userId)}
        AND ${evidencePartitionPredicate(categoryId)}
    `);
    if (readAffectedRows(result) !== 1) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    deleted += 1;
  }
  return { deleted, restricted, done: selected.length <= limit };
}

export function createQwenVoiceDeletionAdapter(
  options: Omit<DeleteVoiceParams, 'voiceId' | 'signal'>,
): (voiceId: string, signal: AbortSignal) => Promise<void> {
  return async (voiceId, signal) => {
    try {
      await deleteVoice({ ...options, voiceId, signal });
    } catch (error) {
      if (
        error instanceof QwenVoiceCloneError &&
        error.kind === 'http' &&
        (error.status === 404 || error.status === 410)
      ) {
        return;
      }
      throw error;
    }
  };
}

const configuredQwenVoiceDeletionAdapter = appEnv.DASHSCOPE_API_KEY
  ? createQwenVoiceDeletionAdapter({
      apiKey: appEnv.DASHSCOPE_API_KEY,
      baseUrl: appEnv.DASHSCOPE_BASE_URL,
      ...(appEnv.DASHSCOPE_WORKSPACE_ID ? { workspaceId: appEnv.DASHSCOPE_WORKSPACE_ID } : {}),
    })
  : null;

export const mediaAssetsClosureHandler = createMediaAssetsClosureHandler({
  deleteVoiceClone: configuredQwenVoiceDeletionAdapter,
});

function continueResult(processed: number, restricted: boolean, fileCursor: number | null = null) {
  return {
    kind: 'continue' as const,
    checkpoint: {
      ...(restricted ? { cursor: 0 } : fileCursor !== null ? { cursor: fileCursor } : {}),
      processedCount: processed,
    },
    processed,
  };
}

function boundedPageSize(context: ClosureHandlerContext): number {
  const pageSize = Math.min(context.pageSize, 100);
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return pageSize;
}

function retainedEvidencePredicate() {
  return sql`(
    artifact.purpose IN (
      'authorization',
      'media_authorization',
      'dispute',
      'legal_hold',
      'audit'
    )
    OR artifact.retention_policy = 'audit_180d'
  )`;
}

function evidencePartitionPredicate(categoryId: FileClosureCategory) {
  const media = sql`(
    LOWER(COALESCE(artifact.content_type, '')) LIKE 'image/%'
    OR LOWER(COALESCE(artifact.content_type, '')) LIKE 'video/%'
    OR LOWER(COALESCE(artifact.content_type, '')) LIKE 'audio/%'
    OR ${retainedEvidencePredicate()}
  )`;
  return categoryId === 'media_assets' ? media : sql`NOT ${media}`;
}

function evidenceAnyTargetOwnershipPredicate(userId: number) {
  return sql`(
    artifact.owner_user_id = ${userId}
    OR owner_task.user_id = ${userId}
    OR owner_site.owner_user_id = ${userId}
    OR owner_run_site.owner_user_id = ${userId}
  )`;
}

function evidenceOwnershipAxesCompatiblePredicate(userId: number) {
  return sql`(
    (artifact.owner_user_id IS NULL OR artifact.owner_user_id = ${userId})
    AND (owner_task.user_id IS NULL OR owner_task.user_id = ${userId})
    AND (owner_site.owner_user_id IS NULL OR owner_site.owner_user_id = ${userId})
    AND (owner_run_site.owner_user_id IS NULL OR owner_run_site.owner_user_id = ${userId})
  )`;
}

function evidenceConsistentOwnershipPredicate(userId: number) {
  return sql`(
    ${evidenceAnyTargetOwnershipPredicate(userId)}
    AND ${evidenceOwnershipAxesCompatiblePredicate(userId)}
  )`;
}

function parseEvidenceConflictRows(result: unknown): number {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  if (rows.length === 0) return 0;
  const id = Number((rows[0] as { id?: unknown }).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return 1;
}

function parseEvidenceRows(result: unknown): EvidenceClosureRow[] {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return rows.map((row) => {
    const record = row as { id?: number | string | bigint; r2Key?: unknown; retained?: unknown };
    const id = Number(record.id);
    const retained = Number(record.retained);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof record.r2Key !== 'string' ||
      (retained !== 0 && retained !== 1)
    ) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    return { id, r2Key: record.r2Key, retained: retained === 1 };
  });
}
