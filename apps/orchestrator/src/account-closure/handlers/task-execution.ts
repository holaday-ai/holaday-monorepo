import { deleteUserFilesPage } from '../../files/file-service.js';
import {
  type AccountClosureHandler,
  ClosureHandlerError,
  assertNoOwnedRows,
  createRelationalDeleteHandler,
  directUserRows,
  rowsOwnedThroughGrandparent,
  rowsOwnedThroughParent,
  rowsOwnedThroughThreeParents,
} from '../handler-contract.js';
import { deleteUserEvidencePage } from './media-assets.js';
import {
  TEAM_WORK_ITEM_CLOSURE_TARGETS,
  assertTeamWorkItemClosureSafe,
  createTeamSafeUserFileClosureStore,
  hasRetainedTeamWorkFacts,
  minimizeRetainedTeamWorkSources,
} from './team-work-items.js';
import {
  TEAM_WORKSPACE_CLOSURE_TARGETS,
  assertTeamWorkspaceClosureSafe,
} from './team-workspace.js';

const deferredObjectRows = [
  TEAM_WORK_ITEM_CLOSURE_TARGETS.unretainedTaskFiles,
  directUserRows('evidence_artifacts', 'owner_user_id'),
  rowsOwnedThroughParent({
    tableName: 'evidence_artifacts',
    parentTableName: 'tasks',
    childParentColumn: 'task_id',
  }),
  rowsOwnedThroughParent({
    tableName: 'evidence_artifacts',
    parentTableName: 'sites',
    childParentColumn: 'site_id',
    parentUserColumn: 'owner_user_id',
  }),
  rowsOwnedThroughGrandparent({
    tableName: 'evidence_artifacts',
    parentTableName: 'exploration_runs',
    ownerTableName: 'sites',
    childParentColumn: 'exploration_run_id',
    parentOwnerColumn: 'site_id',
    ownerUserColumn: 'owner_user_id',
  }),
];
const crossCategoryDependencies = [
  directUserRows('notifications'),
  directUserRows('stock_risk_monitors'),
];

const taskExecutionRelationalClosureHandler = createRelationalDeleteHandler({
  categoryId: 'task_execution',
  preflight: async (context) => {
    // Object-backed file/evidence rows belong to Task 7. Notification and
    // stock-monitor children must be handled by their own governed categories
    // before task parents can be removed without relying on FK side effects.
    await assertNoOwnedRows(context, [...deferredObjectRows, ...crossCategoryDependencies]);
    await assertTeamWorkItemClosureSafe(context);
    await assertTeamWorkspaceClosureSafe(context);
  },
  targets: [
    // Claims can carry private text and point at Task 7 evidence. Links are
    // removed first, including claims owned through a private site/capability.
    rowsOwnedThroughGrandparent({
      tableName: 'claim_evidence_links',
      parentTableName: 'claims',
      ownerTableName: 'tasks',
      childParentColumn: 'claim_id',
      parentOwnerColumn: 'task_id',
    }),
    rowsOwnedThroughGrandparent({
      tableName: 'claim_evidence_links',
      parentTableName: 'claims',
      ownerTableName: 'sites',
      childParentColumn: 'claim_id',
      parentOwnerColumn: 'site_id',
      ownerUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughThreeParents({
      tableName: 'claim_evidence_links',
      parentTableName: 'claims',
      ancestorTableName: 'site_capabilities',
      ownerTableName: 'sites',
      childParentColumn: 'claim_id',
      parentAncestorColumn: 'capability_id',
      ancestorOwnerColumn: 'site_id',
      ownerUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'task_action_captures',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'task_steps',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'task_events',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    // A crystallized path stores full sourceTaskIntent/externalId in JSON.
    // Delete its children while the source-task ownership edge still exists.
    rowsOwnedThroughGrandparent({
      tableName: 'canary_results',
      parentTableName: 'operation_paths',
      ownerTableName: 'tasks',
      childParentColumn: 'path_id',
      parentOwnerColumn: 'source_task_id',
    }),
    rowsOwnedThroughGrandparent({
      tableName: 'operation_path_steps',
      parentTableName: 'operation_paths',
      ownerTableName: 'tasks',
      childParentColumn: 'path_id',
      parentOwnerColumn: 'source_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'claims',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'canary_results',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'operation_paths',
      parentTableName: 'tasks',
      childParentColumn: 'source_task_id',
    }),
    // Private playbook graph, still with an explicit sites.owner_user_id edge.
    rowsOwnedThroughParent({
      tableName: 'claims',
      parentTableName: 'sites',
      childParentColumn: 'site_id',
      parentUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughGrandparent({
      tableName: 'claims',
      parentTableName: 'site_capabilities',
      ownerTableName: 'sites',
      childParentColumn: 'capability_id',
      parentOwnerColumn: 'site_id',
      ownerUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughGrandparent({
      tableName: 'canary_results',
      parentTableName: 'operation_paths',
      ownerTableName: 'sites',
      childParentColumn: 'path_id',
      parentOwnerColumn: 'site_id',
      ownerUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughGrandparent({
      tableName: 'canary_results',
      parentTableName: 'exploration_runs',
      ownerTableName: 'sites',
      childParentColumn: 'exploration_run_id',
      parentOwnerColumn: 'site_id',
      ownerUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughGrandparent({
      tableName: 'operation_path_steps',
      parentTableName: 'operation_paths',
      ownerTableName: 'sites',
      childParentColumn: 'path_id',
      parentOwnerColumn: 'site_id',
      ownerUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'operation_paths',
      parentTableName: 'sites',
      childParentColumn: 'site_id',
      parentUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'exploration_runs',
      parentTableName: 'sites',
      childParentColumn: 'site_id',
      parentUserColumn: 'owner_user_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'site_capabilities',
      parentTableName: 'sites',
      childParentColumn: 'site_id',
      parentUserColumn: 'owner_user_id',
    }),
    directUserRows('sites', 'owner_user_id'),
    rowsOwnedThroughGrandparent({
      tableName: 'planned_task_run_items',
      parentTableName: 'planned_task_runs',
      ownerTableName: 'planned_tasks',
      childParentColumn: 'planned_task_run_id',
      parentOwnerColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'planned_task_runs',
      parentTableName: 'planned_tasks',
      childParentColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'planned_task_occurrence_overrides',
      parentTableName: 'planned_tasks',
      childParentColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'planned_task_items',
      parentTableName: 'planned_tasks',
      childParentColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'batch_task_items',
      parentTableName: 'batch_tasks',
      childParentColumn: 'batch_id',
    }),
    directUserRows('video_edit_action_quotes'),
    directUserRows('video_edit_render_attempts'),
    rowsOwnedThroughParent({
      tableName: 'video_edit_versions',
      parentTableName: 'video_edit_projects',
      childParentColumn: 'project_id',
    }),
    directUserRows('video_edit_projects'),
    directUserRows('batch_tasks'),
    directUserRows('planned_tasks'),
    directUserRows('scheduled_tasks'),
    TEAM_WORK_ITEM_CLOSURE_TARGETS.assignments,
    TEAM_WORK_ITEM_CLOSURE_TARGETS.reviewDelegations,
    TEAM_WORKSPACE_CLOSURE_TARGETS.teamProjectAssociations,
    TEAM_WORKSPACE_CLOSURE_TARGETS.organizationAssociations,
    TEAM_WORKSPACE_CLOSURE_TARGETS.invitationsManaged,
    TEAM_WORKSPACE_CLOSURE_TARGETS.invitationsCreated,
    TEAM_WORKSPACE_CLOSURE_TARGETS.reportingLines,
    TEAM_WORK_ITEM_CLOSURE_TARGETS.unretainedTasks,
    TEAM_WORKSPACE_CLOSURE_TARGETS.personalProjects,
  ],
});

/**
 * Task-owned files/evidence are removed object-first before the relational
 * graph. Media MIME families and retained evidence remain exclusively owned by
 * `media_assets`; the relational preflight deliberately blocks until that
 * category has also finished, preventing task FK cleanup from orphaning an
 * object while avoiding double counting.
 */
export const taskExecutionClosureHandler: AccountClosureHandler = {
  categoryId: 'task_execution',
  version: 1,
  retentionOutcomes: ['deleted', 'anonymized', 'not_present'],
  async run(context) {
    context.signal.throwIfAborted();
    const pageSize = Math.min(context.pageSize, 100);
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    const previousProcessed = context.checkpoint?.processedCount ?? 0;
    const minimized = await minimizeRetainedTeamWorkSources(context, pageSize);
    if (minimized > 0) {
      const processed = previousProcessed + minimized;
      return { kind: 'continue', checkpoint: { processedCount: processed }, processed };
    }
    const filePage = await deleteUserFilesPage(
      {
        userIdInternal: context.request.userId,
        ...(context.checkpoint?.cursor !== undefined ? { afterId: context.checkpoint.cursor } : {}),
        limit: pageSize,
        categoryId: 'task_execution',
      },
      {
        store: createTeamSafeUserFileClosureStore(context.db),
        storage: context.storage,
        signal: context.signal,
      },
    );
    if (filePage.deleted > 0) {
      const processed = previousProcessed + filePage.deleted;
      return {
        kind: 'continue',
        checkpoint: {
          ...(filePage.nextAfterId !== null ? { cursor: filePage.nextAfterId } : {}),
          processedCount: processed,
        },
        processed,
      };
    }

    context.signal.throwIfAborted();
    const evidencePage = await deleteUserEvidencePage(context, 'task_execution', pageSize);
    if (evidencePage.restricted !== 0) throw new ClosureHandlerError('INVARIANT_VIOLATION');
    if (evidencePage.deleted > 0) {
      const processed = previousProcessed + evidencePage.deleted;
      return { kind: 'continue', checkpoint: { processedCount: processed }, processed };
    }

    context.signal.throwIfAborted();
    const relationalResult = await taskExecutionRelationalClosureHandler.run(context);
    if (relationalResult.kind === 'continue') return relationalResult;
    if (await hasRetainedTeamWorkFacts(context.db, context.request.userId)) {
      return { ...relationalResult, retention: 'anonymized' };
    }
    return relationalResult;
  },
};
