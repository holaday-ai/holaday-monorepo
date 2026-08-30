import { newExternalId } from '@holaday/shared-types';
import { sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { readAffectedRows } from '../../db/mysql-result.js';
import {
  type UserFileClosureStore,
  createDbUserFileClosureStore,
} from '../../files/file-service.js';
import { deleteStorageObjectForClosure } from '../../files/storage-provider.js';
import {
  type ClosureHandlerContext,
  ClosureHandlerError,
  type RelationalDeleteTarget,
} from '../handler-contract.js';

function readIds(result: unknown): number[] {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return rows.map((row) => {
    const id = Number((row as { id?: unknown }).id);
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    return id;
  });
}

function idList(ids: readonly number[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

function assertEmpty(result: unknown): void {
  if (readIds(result).length > 0) throw new ClosureHandlerError('CAPABILITY_CHANGED');
}

function readPrivateObjectRows(
  result: unknown,
  pointer: 'storagePath' | 'r2Key',
): Array<{ id: number; pointer: string }> {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return rows.map((row) => {
    const id = Number((row as { id?: unknown }).id);
    const value = (row as Record<string, unknown>)[pointer];
    if (!Number.isSafeInteger(id) || id <= 0 || typeof value !== 'string') {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    return { id, pointer: value };
  });
}

/**
 * A team evidence/AI fact remains auditable after account closure, while the
 * source object's private payload is deleted and its relational shell is
 * minimized. Replays are safe because already-scrubbed rows no longer match.
 */
export async function minimizeRetainedTeamWorkSources(
  context: ClosureHandlerContext,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  const files = readPrivateObjectRows(
    await context.db.execute(sql`SELECT DISTINCT file.id, file.storage_path AS storagePath
      FROM task_files file
      INNER JOIN team_evidence_bindings binding ON binding.task_file_id = file.id
      WHERE file.user_id = ${context.request.userId} AND file.storage_path <> ''
      ORDER BY file.id ASC LIMIT ${limit}`),
    'storagePath',
  );
  for (const file of files) {
    context.signal.throwIfAborted();
    await deleteStorageObjectForClosure(context.storage, file.pointer, { signal: context.signal });
    const update = await context.db.execute(sql`UPDATE task_files
      SET filename = 'retained-evidence', mimetype = 'application/x-holaday-retained-evidence',
          size_bytes = 0, storage_path = '', status = 'expired', expires_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${file.id} AND user_id = ${context.request.userId} AND storage_path = ${file.pointer}`);
    if (readAffectedRows(update) !== 1) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  if (files.length > 0) return files.length;

  const artifacts = readPrivateObjectRows(
    await context.db.execute(sql`SELECT DISTINCT artifact.id, artifact.r2_key AS r2Key
      FROM evidence_artifacts artifact
      INNER JOIN team_evidence_bindings binding ON binding.evidence_artifact_id = artifact.id
      WHERE artifact.owner_user_id = ${context.request.userId} AND artifact.r2_key <> ''
      ORDER BY artifact.id ASC LIMIT ${limit}`),
    'r2Key',
  );
  for (const artifact of artifacts) {
    context.signal.throwIfAborted();
    await deleteStorageObjectForClosure(context.storage, artifact.pointer, {
      signal: context.signal,
    });
    const update = await context.db.execute(sql`UPDATE evidence_artifacts
      SET owner_user_id = NULL, task_id = NULL, site_id = NULL, exploration_run_id = NULL,
          source_url = NULL, final_url = NULL, r2_bucket = 'account-closure', r2_key = '',
          size_bytes = 0, raw_excerpt = NULL, viewport_json = NULL, dom_hash = NULL,
          screenshot_hash = NULL,
          metadata_json = JSON_OBJECT('scrubbed', TRUE, 'scrubbedReason', 'account_closure', 'retentionClass', 'team_business_fact')
      WHERE id = ${artifact.id} AND owner_user_id = ${context.request.userId} AND r2_key = ${artifact.pointer}`);
    if (readAffectedRows(update) !== 1) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  if (artifacts.length > 0) return artifacts.length;

  const taskIds = readIds(
    await context.db.execute(sql`SELECT DISTINCT task.id FROM tasks task
    INNER JOIN team_ai_contributions contribution ON contribution.execution_task_id = task.id
      AND contribution.contributed_by_user_id = task.user_id
      AND contribution.project_id = task.project_id
    WHERE task.user_id = ${context.request.userId}
      AND (task.intent <> '[account closed]' OR task.title IS NOT NULL OR task.plan IS NOT NULL
        OR task.plan_text IS NOT NULL OR task.plan_status IS NOT NULL OR task.awaiting_question IS NOT NULL
        OR task.awaiting_kind IS NOT NULL OR task.result IS NOT NULL OR task.source_context IS NOT NULL
        OR task.error_code IS NOT NULL OR task.error_message IS NOT NULL OR task.original_summary IS NOT NULL
        OR task.formatted_summary IS NOT NULL OR task.response_layer_metadata IS NOT NULL
        OR task.contract_json IS NOT NULL OR task.evidence_json IS NOT NULL OR task.verification_json IS NOT NULL)
    ORDER BY task.id ASC LIMIT ${limit}`),
  );
  if (taskIds.length === 0) return 0;
  const taskUpdate = await context.db.execute(sql`UPDATE tasks task
    SET task.intent = '[account closed]', task.title = NULL, task.plan = NULL,
        task.plan_text = NULL, task.plan_status = NULL, task.awaiting_question = NULL,
        task.awaiting_kind = NULL, task.result = NULL, task.source_context = NULL,
        task.error_code = NULL, task.error_message = NULL, task.original_summary = NULL,
        task.formatted_summary = NULL, task.response_layer_metadata = NULL,
        task.contract_json = NULL, task.evidence_json = NULL, task.verification_json = NULL
    WHERE task.user_id = ${context.request.userId} AND task.id IN (${idList(taskIds)})`);
  const minimizedTasks = readAffectedRows(taskUpdate);
  if (!Number.isSafeInteger(minimizedTasks) || minimizedTasks < 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  if (minimizedTasks !== taskIds.length) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return minimizedTasks;
}

/** Excludes the minimized FK shells that immutable team evidence still references. */
export function createTeamSafeUserFileClosureStore(db: DB): UserFileClosureStore {
  const base = createDbUserFileClosureStore(db);
  return {
    async listOwnedPage(input) {
      const partition =
        input.categoryId === 'media_assets'
          ? sql`(LOWER(mimetype) LIKE 'image/%' OR LOWER(mimetype) LIKE 'video/%' OR LOWER(mimetype) LIKE 'audio/%')`
          : sql`(mimetype IS NULL OR (LOWER(mimetype) NOT LIKE 'image/%' AND LOWER(mimetype) NOT LIKE 'video/%' AND LOWER(mimetype) NOT LIKE 'audio/%'))`;
      const result =
        await db.execute(sql`SELECT id, user_id AS userId, storage_path AS storagePath, mimetype
        FROM task_files
        WHERE user_id = ${input.userIdInternal} AND id > ${input.afterId}
          AND storage_path <> '' AND ${partition}
        ORDER BY id ASC LIMIT ${input.limit}`);
      const rows = Array.isArray(result) ? result[0] : null;
      if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      return rows.map((row) => ({
        id: Number((row as { id: unknown }).id),
        userId: Number((row as { userId: unknown }).userId),
        storagePath: String((row as { storagePath: unknown }).storagePath),
        mimetype:
          (row as { mimetype?: unknown }).mimetype === null
            ? null
            : String((row as { mimetype?: unknown }).mimetype),
      }));
    },
    deleteOwnedRow: (input) => base.deleteOwnedRow(input),
  };
}

async function queryResponsibilityBlockers(
  db: Pick<DB, 'execute'>,
  userId: number,
  lock: boolean,
): Promise<void> {
  const lockClause = lock ? sql` FOR UPDATE` : sql``;
  assertEmpty(
    await db.execute(
      sql`SELECT assignment.id FROM team_work_item_assignments assignment INNER JOIN team_work_items work_item ON work_item.id = assignment.work_item_id AND work_item.organization_id = assignment.organization_id AND work_item.project_id = assignment.project_id WHERE assignment.user_id = ${userId} AND assignment.role = 'responsible' AND assignment.status = 'accepted' AND work_item.status NOT IN ('accepted', 'completed', 'cancelled', 'rejected_final', 'archived') ORDER BY assignment.id ASC LIMIT 1${lockClause}`,
    ),
  );
  assertEmpty(
    await db.execute(
      sql`SELECT work_item.id FROM team_work_items work_item INNER JOIN acceptance_contract_versions contract ON contract.id = work_item.current_contract_version_id AND contract.work_item_id = work_item.id AND contract.organization_id = work_item.organization_id AND contract.project_id = work_item.project_id WHERE work_item.status IN ('submitted', 'resubmitted', 'in_review') AND contract.confirmed_at IS NOT NULL AND contract.approver_user_id = ${userId} ORDER BY work_item.id ASC LIMIT 1${lockClause}`,
    ),
  );
  assertEmpty(
    await db.execute(
      sql`SELECT work_item.id FROM team_work_items work_item INNER JOIN acceptance_contract_versions contract ON contract.id = work_item.current_contract_version_id AND contract.work_item_id = work_item.id AND contract.organization_id = work_item.organization_id AND contract.project_id = work_item.project_id INNER JOIN team_task_review_delegations delegation ON delegation.organization_id = work_item.organization_id AND delegation.project_id = work_item.project_id AND delegation.delegator_user_id = contract.approver_user_id WHERE work_item.status IN ('submitted', 'resubmitted', 'in_review') AND contract.confirmed_at IS NOT NULL AND delegation.delegate_user_id = ${userId} AND delegation.revoked_at IS NULL AND delegation.valid_from <= CURRENT_TIMESTAMP(3) AND delegation.valid_until > CURRENT_TIMESTAMP(3) ORDER BY work_item.id ASC LIMIT 1${lockClause}`,
    ),
  );
  assertEmpty(
    await db.execute(
      sql`SELECT appeal.id FROM team_work_item_appeals appeal INNER JOIN team_work_item_reviews review ON review.id = appeal.review_id AND review.work_item_id = appeal.work_item_id AND review.organization_id = appeal.organization_id AND review.project_id = appeal.project_id INNER JOIN acceptance_contract_versions contract ON contract.id = review.contract_version_id AND contract.work_item_id = review.work_item_id AND contract.organization_id = review.organization_id AND contract.project_id = review.project_id WHERE appeal.status IN ('appeal_open', 'appeal_reviewing') AND contract.arbitrator_user_id = ${userId} ORDER BY appeal.id ASC LIMIT 1${lockClause}`,
    ),
  );
}

export async function assertTeamWorkItemClosureSafe(context: ClosureHandlerContext): Promise<void> {
  await queryResponsibilityBlockers(context.db, context.request.userId, false);
}

export async function hasRetainedTeamWorkFacts(
  db: Pick<DB, 'execute'>,
  userId: number,
): Promise<boolean> {
  const rows = readIds(
    await db.execute(sql`SELECT retained.id FROM (
      SELECT id FROM team_milestones WHERE created_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_work_item_dependencies WHERE created_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_work_items WHERE created_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_work_item_assignments WHERE user_id = ${userId} OR offered_by_user_id = ${userId}
      UNION ALL SELECT id FROM acceptance_contract_versions WHERE approver_user_id = ${userId} OR arbitrator_user_id = ${userId} OR created_by_user_id = ${userId} OR confirmed_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_work_item_submissions WHERE submitted_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_work_item_reviews WHERE reviewer_user_id = ${userId}
      UNION ALL SELECT id FROM team_task_review_delegations WHERE delegator_user_id = ${userId} OR delegate_user_id = ${userId} OR revoked_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_work_item_appeals WHERE opened_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_arbitration_decisions WHERE arbitrator_user_id = ${userId}
      UNION ALL SELECT id FROM team_work_item_events WHERE actor_user_id = ${userId}
      UNION ALL SELECT id FROM team_project_planning_events WHERE actor_user_id = ${userId}
      UNION ALL SELECT id FROM team_evidence_bindings WHERE bound_by_user_id = ${userId}
      UNION ALL SELECT id FROM team_ai_contributions WHERE contributed_by_user_id = ${userId}
    ) retained ORDER BY retained.id ASC LIMIT 1`),
  );
  return rows.length > 0;
}

const assignments: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT assignment.id FROM team_work_item_assignments assignment WHERE assignment.user_id = ${context.request.userId} AND assignment.status <> 'removed' ORDER BY assignment.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds(context, ids) {
    if (ids.length === 0) return 0;
    return context.db.transaction(async (tx) => {
      const list = idList(ids);
      const workItemIds = readIds(
        await tx.execute(
          sql`SELECT DISTINCT work_item.id FROM team_work_items work_item INNER JOIN team_work_item_assignments assignment ON assignment.work_item_id = work_item.id AND assignment.organization_id = work_item.organization_id AND assignment.project_id = work_item.project_id WHERE assignment.id IN (${list}) AND assignment.user_id = ${context.request.userId} ORDER BY work_item.id ASC FOR UPDATE`,
        ),
      );
      if (workItemIds.length === 0) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      const locked = readIds(
        await tx.execute(
          sql`SELECT assignment.id FROM team_work_item_assignments assignment WHERE assignment.id IN (${list}) AND assignment.user_id = ${context.request.userId} ORDER BY assignment.id ASC FOR UPDATE`,
        ),
      );
      if (locked.length !== new Set(ids).size) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      assertEmpty(
        await tx.execute(
          sql`SELECT assignment.id FROM team_work_item_assignments assignment INNER JOIN team_work_items work_item ON work_item.id = assignment.work_item_id AND work_item.organization_id = assignment.organization_id AND work_item.project_id = assignment.project_id WHERE assignment.id IN (${list}) AND assignment.user_id = ${context.request.userId} AND assignment.role = 'responsible' AND assignment.status = 'accepted' AND work_item.status NOT IN ('accepted', 'completed', 'cancelled', 'rejected_final', 'archived') ORDER BY assignment.id ASC LIMIT 1`,
        ),
      );
      const updated = await tx.execute(
        sql`UPDATE team_work_item_assignments assignment SET status = 'removed', responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP(3)), updated_at = CURRENT_TIMESTAMP(3) WHERE assignment.id IN (${list}) AND assignment.user_id = ${context.request.userId} AND assignment.status <> 'removed'`,
      );
      const affected = readAffectedRows(updated);
      if (affected !== ids.length) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      for (const id of ids) {
        const event = await tx.execute(
          sql`INSERT INTO team_work_item_events (external_id, organization_id, project_id, work_item_id, actor_user_id, event_type, idempotency_key, metadata_json) SELECT ${newExternalId('teamWorkItemEvent')}, assignment.organization_id, assignment.project_id, assignment.work_item_id, ${context.request.userId}, 'account_closure_assignment_removed', CONCAT('acr:', ${context.request.externalId}, ':a:', assignment.id), JSON_OBJECT('assignmentExternalId', assignment.external_id) FROM team_work_item_assignments assignment WHERE assignment.id = ${id} AND assignment.user_id = ${context.request.userId}`,
        );
        if (readAffectedRows(event) !== 1) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      return affected;
    });
  },
};

const reviewDelegations: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(
        sql`SELECT delegation.id FROM team_task_review_delegations delegation WHERE (delegation.delegator_user_id = ${context.request.userId} OR delegation.delegate_user_id = ${context.request.userId}) AND delegation.revoked_at IS NULL ORDER BY delegation.id ASC LIMIT ${limit}`,
      ),
    );
  },
  async deleteOwnedIds(context, ids) {
    if (ids.length === 0) return 0;
    return context.db.transaction(async (tx) => {
      const list = idList(ids);
      const projectIds = readIds(
        await tx.execute(
          sql`SELECT DISTINCT project.id FROM projects project INNER JOIN team_task_review_delegations delegation ON delegation.project_id = project.id AND delegation.organization_id = project.organization_id WHERE delegation.id IN (${list}) AND (delegation.delegator_user_id = ${context.request.userId} OR delegation.delegate_user_id = ${context.request.userId}) ORDER BY project.id ASC FOR UPDATE`,
        ),
      );
      if (projectIds.length === 0) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      const locked = readIds(
        await tx.execute(
          sql`SELECT delegation.id FROM team_task_review_delegations delegation WHERE delegation.id IN (${list}) AND (delegation.delegator_user_id = ${context.request.userId} OR delegation.delegate_user_id = ${context.request.userId}) ORDER BY delegation.id ASC FOR UPDATE`,
        ),
      );
      if (locked.length !== new Set(ids).size) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      const updated = await tx.execute(
        sql`UPDATE team_task_review_delegations delegation SET revoked_at = GREATEST(delegation.valid_from, CURRENT_TIMESTAMP(3)), revoked_by_user_id = ${context.request.userId} WHERE delegation.id IN (${list}) AND delegation.revoked_at IS NULL AND (delegation.delegator_user_id = ${context.request.userId} OR delegation.delegate_user_id = ${context.request.userId})`,
      );
      const affected = readAffectedRows(updated);
      if (affected !== ids.length) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      for (const id of ids) {
        const event = await tx.execute(
          sql`INSERT INTO team_project_planning_events (external_id, organization_id, project_id, actor_user_id, event_type, idempotency_key, metadata_json) SELECT ${newExternalId('teamProjectPlanningEvent')}, delegation.organization_id, delegation.project_id, ${context.request.userId}, 'account_closure_review_delegation_revoked', CONCAT('acr:', ${context.request.externalId}, ':d:', delegation.id), JSON_OBJECT('delegationExternalId', delegation.external_id) FROM team_task_review_delegations delegation WHERE delegation.id = ${id}`,
        );
        if (readAffectedRows(event) !== 1) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      return affected;
    });
  },
};

const unretainedTasks: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(sql`SELECT task.id FROM tasks task
        WHERE task.user_id = ${context.request.userId}
          AND NOT EXISTS (SELECT 1 FROM team_ai_contributions contribution WHERE contribution.execution_task_id = task.id)
        ORDER BY task.id ASC LIMIT ${limit}`),
    );
  },
  async deleteOwnedIds(context, ids) {
    if (ids.length === 0) return 0;
    return readAffectedRows(
      await context.db.execute(sql`DELETE task FROM tasks task
        WHERE task.user_id = ${context.request.userId} AND task.id IN (${idList(ids)})
          AND NOT EXISTS (SELECT 1 FROM team_ai_contributions contribution WHERE contribution.execution_task_id = task.id)`),
    );
  },
};

const unretainedTaskFiles: RelationalDeleteTarget = {
  async selectOwnedIds(context, limit) {
    return readIds(
      await context.db.execute(sql`SELECT file.id FROM task_files file
        WHERE file.user_id = ${context.request.userId} AND file.storage_path <> ''
        ORDER BY file.id ASC LIMIT ${limit}`),
    );
  },
  async deleteOwnedIds() {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  },
};

export const TEAM_WORK_ITEM_CLOSURE_TARGETS = {
  assignments,
  reviewDelegations,
  unretainedTasks,
  unretainedTaskFiles,
} as const;

export async function assertNoActiveTeamWorkItemResponsibilitiesForFinalization(
  db: Pick<DB, 'execute'>,
  userId: number,
): Promise<void> {
  await queryResponsibilityBlockers(db, userId, true);
  assertEmpty(
    await db.execute(
      sql`SELECT delegation.id FROM team_task_review_delegations delegation WHERE (delegation.delegator_user_id = ${userId} OR delegation.delegate_user_id = ${userId}) AND delegation.revoked_at IS NULL ORDER BY delegation.id ASC LIMIT 1 FOR UPDATE`,
    ),
  );
}
