import {
  assertNoOwnedRows,
  createRelationalDeleteHandler,
  directUserRows,
  rowsOwnedThroughGrandparent,
  rowsOwnedThroughParent,
  rowsOwnedThroughThreeParents,
} from '../handler-contract.js';

const deferredObjectRows = [
  directUserRows('task_files'),
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

export const taskExecutionClosureHandler = createRelationalDeleteHandler({
  categoryId: 'task_execution',
  preflight: async (context) => {
    // Object-backed file/evidence rows belong to Task 7. Notification and
    // stock-monitor children must be handled by their own governed categories
    // before task parents can be removed without relying on FK side effects.
    await assertNoOwnedRows(context, [...deferredObjectRows, ...crossCategoryDependencies]);
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
    directUserRows('batch_tasks'),
    directUserRows('planned_tasks'),
    directUserRows('scheduled_tasks'),
    directUserRows('tasks'),
    directUserRows('projects'),
  ],
});
